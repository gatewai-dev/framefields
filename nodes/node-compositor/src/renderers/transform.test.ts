import { describe, expect, it } from "vitest";
import {
	buildLayerMatrix,
	type Matrix2D,
	multiply,
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
});
