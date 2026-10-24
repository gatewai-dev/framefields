import { describe, expect, it } from "vitest";
import {
	buildLayerMatrix,
	type Matrix2D,
	multiply,
	resolveLayer2DPosition,
	rotate,
	scale,
	transformPoint,
	translate,
} from "./transform.js";

const closeTo = (actual: number, expected: number, eps = 1e-9) =>
	expect(Math.abs(actual - expected)).toBeLessThan(eps);

const expectPoint = (
	a: { x: number; y: number },
	e: { x: number; y: number },
) => {
	closeTo(a.x, e.x);
	closeTo(a.y, e.y);
};

describe("transform (pure affine)", () => {
	it("composes translations in apply-order (m1 ∘ m2)", () => {
		const m = multiply(translate(3, 4), translate(5, 6));
		expectPoint(transformPoint(m, 0, 0), { x: 8, y: 10 });
	});

	it("rotate is clockwise in screen space (y-down)", () => {
		expectPoint(transformPoint(rotate(90), 1, 0), { x: 0, y: 1 });
		expectPoint(transformPoint(rotate(90), 0, 1), { x: -1, y: 0 });
	});

	it("scale multiplies and can mirror through negative x", () => {
		expectPoint(transformPoint(scale(2), 3, 4), { x: 6, y: 8 });
	});
});

describe("buildLayerMatrix — anchor-aware pivot (review H2)", () => {
	const box = { x: 10, y: 20, width: 200, height: 100 };

	it("is a plain placement when scale=1 and rotation=0 (any anchor)", () => {
		for (const anchorX of [0, 0.5, 1]) {
			for (const anchorY of [0, 0.5, 1]) {
				const m = buildLayerMatrix({
					...box,
					rotation: 0,
					scale: 1,
					anchorX,
					anchorY,
				});
				expectPoint(transformPoint(m, 0, 0), { x: 10, y: 20 });
				expectPoint(transformPoint(m, 200, 100), { x: 210, y: 120 });
			}
		}
	});

	it("keeps the default center anchor (0.5/0.5) invariant under scale", () => {
		const m = buildLayerMatrix({ ...box, rotation: 0, scale: 2 });
		// center of the box
		expectPoint(transformPoint(m, 100, 50), { x: 110, y: 70 });
		// top-left scales AWAY from the center (the H2 fix)
		expectPoint(transformPoint(m, 0, 0), { x: -90, y: -30 });
		// top-right scales away symmetrically: x + w·s − ax·w = 10 + 400 − 100
		expectPoint(transformPoint(m, 200, 0), { x: 310, y: -30 });
	});

	it("keeps the center anchor invariant under rotation", () => {
		const m = buildLayerMatrix({ ...box, rotation: 45, scale: 1 });
		expectPoint(transformPoint(m, 100, 50), { x: 110, y: 70 });
	});

	it("keeps ANY anchor point invariant under the full transform (scale+rotation)", () => {
		for (const anchorX of [0, 0.25, 0.5, 0.75, 1]) {
			for (const anchorY of [0, 0.25, 0.5, 0.75, 1]) {
				const anchorXAbs = anchorX * box.width;
				const anchorYAbs = anchorY * box.height;
				const m = buildLayerMatrix({
					...box,
					rotation: 33,
					scale: 1.7,
					anchorX,
					anchorY,
				});
				expectPoint(transformPoint(m, anchorXAbs, anchorYAbs), {
					x: box.x + anchorXAbs,
					y: box.y + anchorYAbs,
				});
			}
		}
	});

	it("anchor (0,0) reproduces the legacy top-left pivot exactly", () => {
		const m = buildLayerMatrix({
			...box,
			rotation: 90,
			scale: 2,
			anchorX: 0,
			anchorY: 0,
		});
		// top-left corner stays put; the rest scales/rotates around it
		expectPoint(transformPoint(m, 0, 0), { x: 10, y: 20 });
		// right-middle: (200,50) → rotate 90° clockwise around (0,0): (x,y)→(-50·? …)
		// y' = x = 200 → scaled 2 → (0 - 50·2, 20 + 200·2) = (-100, 420)
		expectPoint(transformPoint(m, 200, 50), {
			x: 10 - 50 * 2,
			y: 20 + 200 * 2,
		});
	});

	it("does not corrupt the matrix type contract used by the renderer (DOMMatrix mapping)", () => {
		const m: Matrix2D = buildLayerMatrix({ ...box, rotation: 0, scale: 1 });
		// DOMMatrix([a,b,c,d,e,f]) maps (x,y) → (a·x + c·y + e, b·x + d·y + f)
		const mapped = {
			x: m.a * 100 + m.c * 50 + m.e,
			y: m.b * 100 + m.d * 50 + m.f,
		};
		expectPoint(mapped, { x: 110, y: 70 });
	});

	it("scales independently on X and Y with non-uniform scaleX and scaleY", () => {
		// box: x=10, y=20, width=200, height=100
		// default center anchor: px = 100, py = 50. Screen pivot: (110, 70)
		const m = buildLayerMatrix({
			...box,
			rotation: 0,
			scaleX: 2,
			scaleY: 0.5,
		});

		// Center anchor stays invariant:
		expectPoint(transformPoint(m, 100, 50), { x: 110, y: 70 });

		// Width doubled around center: left edge x=0 maps to 110 - 100*2 = -90
		// Height halved around center: top edge y=0 maps to 70 - 50*0.5 = 45
		expectPoint(transformPoint(m, 0, 0), { x: -90, y: 45 });

		// Right edge x=200 maps to 110 + 100*2 = 310
		// Bottom edge y=100 maps to 70 + 50*0.5 = 95
		expectPoint(transformPoint(m, 200, 100), { x: 310, y: 95 });
	});

	it("stretches bars upward with bottom anchor (anchorY: 1)", () => {
		// Bar positioned at x=50, y=100 with width=20, height=200
		const bar = { x: 50, y: 100, width: 20, height: 200 };
		const m = buildLayerMatrix({
			...bar,
			rotation: 0,
			scaleX: 1,
			scaleY: 2.5,
			anchorX: 0.5,
			anchorY: 1, // grounded at the bottom
		});

		// Bottom-center pivot (10, 200) -> screen (50 + 10, 100 + 200) = (60, 300)
		expectPoint(transformPoint(m, 10, 200), { x: 60, y: 300 });

		// Bottom edge is invariant
		expectPoint(transformPoint(m, 0, 200), { x: 50, y: 300 });
		expectPoint(transformPoint(m, 20, 200), { x: 70, y: 300 });

		// Top edge (y=0) stretches upward by 2.5x: height goes from 200 to 500
		// Screen y: 300 - 500 = -200
		expectPoint(transformPoint(m, 10, 0), { x: 60, y: -200 });
	});

	it("combines uniform scale with scaleX and scaleY", () => {
		const m = buildLayerMatrix({
			...box,
			rotation: 0,
			scale: 2,
			scaleX: 1.5, // effective sx = 3
			scaleY: 0.5, // effective sy = 1
			anchorX: 0,
			anchorY: 0, // top-left anchor
		});

		// Top-left corner invariant
		expectPoint(transformPoint(m, 0, 0), { x: 10, y: 20 });
		// x scales by 3: 200 * 3 = 600 -> screen 610
		// y scales by 1: 100 * 1 = 100 -> screen 120
		expectPoint(transformPoint(m, 200, 100), { x: 610, y: 120 });
	});
});

describe("resolveLayer2DPosition (2D parent translation inheritance)", () => {
	it("returns base/sampled position for top-level layers (no parent)", () => {
		const pos = resolveLayer2DPosition({
			rect: { x: 100, y: 200 },
			baseX: 100,
			baseY: 200,
			sampledX: 100,
			sampledY: 200,
			parentRect: null,
			parentMatrix: null,
		});
		expect(pos).toEqual({ x: 100, y: 200 });
	});

	it("applies keyframe delta for animated top-level layers", () => {
		const pos = resolveLayer2DPosition({
			rect: { x: 100, y: 200 },
			baseX: 100,
			baseY: 200,
			sampledX: 140,
			sampledY: 230,
			parentRect: null,
			parentMatrix: null,
		});
		expect(pos).toEqual({ x: 140, y: 230 });
	});

	it("inherits 2D parent translation inside a container", () => {
		// Parent container at (300, 200)
		const parentMatrix = translate(300, 200);
		const parentRect = { x: 300, y: 200 };
		// Child placed at (50, 40) within parent: layout rect is (350, 240)
		const childRect = { x: 350, y: 240 };

		const pos = resolveLayer2DPosition({
			rect: childRect,
			parentRect,
			baseX: 50,
			baseY: 40,
			sampledX: 50,
			sampledY: 40,
			parentMatrix,
		});
		expect(pos).toEqual({ x: 350, y: 240 });
	});

	it("inherits cumulative translation through nested containers (components inside components)", () => {
		// Grandparent at (100, 100), Parent at (200, 150) -> cumulative parentMatrix translates by (300, 250)
		const parentMatrix = multiply(translate(100, 100), translate(200, 150));
		const parentRect = { x: 300, y: 250 };
		// Child placed at (25, 35) inside component -> layout rect (325, 285)
		const childRect = { x: 325, y: 285 };

		const pos = resolveLayer2DPosition({
			rect: childRect,
			parentRect,
			baseX: 25,
			baseY: 35,
			sampledX: 25,
			sampledY: 35,
			parentMatrix,
		});
		expect(pos).toEqual({ x: 325, y: 285 });
	});

	it("combines parent container animation with child layer animation", () => {
		// Parent animated to (350, 220)
		const parentMatrix = translate(350, 220);
		const parentRect = { x: 300, y: 200 };
		// Child layout rect (350, 240), but animated locally from baseX=50 to sampledX=80
		const childRect = { x: 350, y: 240 };

		const pos = resolveLayer2DPosition({
			rect: childRect,
			parentRect,
			baseX: 50,
			baseY: 40,
			sampledX: 80,
			sampledY: 40,
			parentMatrix,
		});
		// localX = (350 - 300) + (80 - 50) = 50 + 30 = 80
		// worldX = 350 + 80 = 430
		// worldY = 220 + 40 = 260
		expect(pos).toEqual({ x: 430, y: 260 });
	});

	it("transforms child position when parent container has 2D rotation", () => {
		// Parent container rotated 90 degrees around (100, 100)
		// Screen space: 90 deg clockwise maps (dx, dy) -> (-dy, dx)
		const parentMatrix = multiply(translate(100, 100), rotate(90));
		const parentRect = { x: 100, y: 100 };
		const childRect = { x: 150, y: 100 }; // local dx = 50, dy = 0

		const pos = resolveLayer2DPosition({
			rect: childRect,
			parentRect,
			baseX: 50,
			baseY: 0,
			sampledX: 50,
			sampledY: 0,
			parentMatrix,
		});
		// (50, 0) rotated 90 deg -> (0, 50). Translated by (100, 100) -> (100, 150)
		closeTo(pos.x, 100);
		closeTo(pos.y, 150);
	});

	it("falls back gracefully when rect is missing but parent translation exists", () => {
		const parentMatrix = translate(400, 300);
		const pos = resolveLayer2DPosition({
			baseX: 20,
			baseY: 30,
			sampledX: 20,
			sampledY: 30,
			parentMatrix,
		});
		expect(pos).toEqual({ x: 420, y: 330 });
	});
});
