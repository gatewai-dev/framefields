import { describe, expect, it } from "vitest";
import {
	compileTimeline,
	type CompilerVirtualMedia,
} from "../shared/compiler.js";
import {
	has3DTransform,
	type Point2D,
	solveHomography,
	Transform3DMath,
} from "./transform3d.js";

const closeTo = (actual: number, expected: number, eps = 1e-5) =>
	expect(Math.abs(actual - expected)).toBeLessThan(eps);

const expectPoint = (a: Point2D, e: Point2D, eps = 1e-5) => {
	closeTo(a.x, e.x, eps);
	closeTo(a.y, e.y, eps);
};

describe("Transform3DMath (Pure 4x4 Projections)", () => {
	const w = 400;
	const h = 300;
	const x = 50;
	const y = 80;

	it("Invariant 1: Zero Rotation Invariant — projected quad corners match 2D bounding rect exactly", () => {
		const m = Transform3DMath.buildLayer3DMatrix({
			x,
			y,
			width: w,
			height: h,
			rotateXDeg: 0,
			rotateYDeg: 0,
			rotateZDeg: 0,
			translateZPx: 0,
			perspectivePx: 0,
		});

		const quad = Transform3DMath.projectRectangleCorners(m, w, h);
		expectPoint(quad.topLeft, { x: 50, y: 80 });
		expectPoint(quad.topRight, { x: 450, y: 80 });
		expectPoint(quad.bottomLeft, { x: 50, y: 380 });
		expectPoint(quad.bottomRight, { x: 450, y: 380 });

		const signedArea = Transform3DMath.computeSignedArea(quad);
		expect(signedArea).toBeCloseTo(w * h, 3);
	});

	it("Invariant 2: Perspective Foreshortening Invariant — rotateY > 0 foreshortens right edge", () => {
		const m = Transform3DMath.buildLayer3DMatrix({
			x: 0,
			y: 0,
			width: w,
			height: h,
			rotateYDeg: 30,
			perspectivePx: 1000,
			originXRatio: 0.5,
			originYRatio: 0.5,
		});

		const quad = Transform3DMath.projectRectangleCorners(m, w, h);

		const leftHeight = quad.bottomLeft.y - quad.topLeft.y;
		const rightHeight = quad.bottomRight.y - quad.topRight.y;

		// Right edge turned away into depth: height must be strictly smaller than left edge
		expect(rightHeight).toBeLessThan(leftHeight);
		expect(rightHeight).toBeGreaterThan(0);
		expect(leftHeight).toBeGreaterThan(h);
	});

	it("Invariant 3: Depth Scaling Invariant — translateZ > 0 with perspective > 0 magnifies dimensions", () => {
		const unprojectedM = Transform3DMath.buildLayer3DMatrix({
			x: 0,
			y: 0,
			width: w,
			height: h,
			perspectivePx: 1000,
			translateZPx: 0,
		});
		const unprojectedQuad = Transform3DMath.projectRectangleCorners(
			unprojectedM,
			w,
			h,
		);
		const unprojectedW = unprojectedQuad.topRight.x - unprojectedQuad.topLeft.x;
		const unprojectedH =
			unprojectedQuad.bottomLeft.y - unprojectedQuad.topLeft.y;

		const nearM = Transform3DMath.buildLayer3DMatrix({
			x: 0,
			y: 0,
			width: w,
			height: h,
			perspectivePx: 1000,
			translateZPx: 200,
		});
		const nearQuad = Transform3DMath.projectRectangleCorners(nearM, w, h);
		const nearW = nearQuad.topRight.x - nearQuad.topLeft.x;
		const nearH = nearQuad.bottomLeft.y - nearQuad.topLeft.y;

		expect(nearW).toBeGreaterThan(unprojectedW);
		expect(nearH).toBeGreaterThan(unprojectedH);
		// With d = 1000 and tz = 200: W = 1 - 200/1000 = 0.8 -> scale = 1/0.8 = 1.25
		closeTo(nearW, w * 1.25, 0.01);
		closeTo(nearH, h * 1.25, 0.01);
	});

	it("Invariant 4: Backface Culling Invariant — 180° Y rotation flips signed area to negative", () => {
		const frontM = Transform3DMath.buildLayer3DMatrix({
			x: 0,
			y: 0,
			width: w,
			height: h,
			rotateYDeg: 0,
		});
		const frontQuad = Transform3DMath.projectRectangleCorners(frontM, w, h);
		expect(Transform3DMath.computeSignedArea(frontQuad)).toBeGreaterThan(0);

		const backM = Transform3DMath.buildLayer3DMatrix({
			x: 0,
			y: 0,
			width: w,
			height: h,
			rotateYDeg: 180,
		});
		const backQuad = Transform3DMath.projectRectangleCorners(backM, w, h);
		expect(Transform3DMath.computeSignedArea(backQuad)).toBeLessThan(0);
	});

	it("preserves pivot anchor invariance under 3D rotation", () => {
		for (const [ox, oy] of [
			[0.5, 0.5],
			[0, 0],
			[1, 1],
			[0.2, 0.8],
		]) {
			const m = Transform3DMath.buildLayer3DMatrix({
				x: 100,
				y: 150,
				width: 200,
				height: 100,
				rotateXDeg: 25,
				rotateYDeg: -35,
				rotateZDeg: 15,
				perspectivePx: 1200,
				originXRatio: ox,
				originYRatio: oy,
			});

			const pivotLocal = { x: 200 * ox, y: 100 * oy, z: 0 };
			const projectedPivot = Transform3DMath.projectPoint(m, pivotLocal);

			expectPoint(projectedPivot, {
				x: 100 + 200 * ox,
				y: 150 + 100 * oy,
			});
		}
	});

	it("Invariant 5: solveHomography Invariant — reconstructs source unit square accurately", () => {
		const m = Transform3DMath.buildLayer3DMatrix({
			x: 100,
			y: 100,
			width: 400,
			height: 300,
			rotateXDeg: 20,
			rotateYDeg: -25,
			perspectivePx: 1000,
		});

		const quad = Transform3DMath.projectRectangleCorners(m, 400, 300);

		// Normalized destination coordinates across a 1920x1080 canvas
		const destW = 1920;
		const destH = 1080;
		const dstPoints: Point2D[] = [
			{ x: quad.topLeft.x / destW, y: quad.topLeft.y / destH },
			{ x: quad.topRight.x / destW, y: quad.topRight.y / destH },
			{ x: quad.bottomLeft.x / destW, y: quad.bottomLeft.y / destH },
			{ x: quad.bottomRight.x / destW, y: quad.bottomRight.y / destH },
		];

		const h = solveHomography(dstPoints);

		// Check that mapping dstPoints through H yields (0,0), (1,0), (0,1), (1,1)
		const expectedSrc = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 0, y: 1 },
			{ x: 1, y: 1 },
		];

		for (let i = 0; i < 4; i++) {
			const pt = dstPoints[i];
			const d = h[6] * pt.x + h[7] * pt.y + h[8];
			const u = (h[0] * pt.x + h[1] * pt.y + h[2]) / d;
			const v = (h[3] * pt.x + h[4] * pt.y + h[5]) / d;

			closeTo(u, expectedSrc[i].x, 1e-4);
			closeTo(v, expectedSrc[i].y, 1e-4);
		}
	});

	it("has3DTransform predicate identifies active 3D properties and tracks", () => {
		expect(has3DTransform({}, {})).toBe(false);
		expect(has3DTransform({ rotateX: 0, rotateY: 0 }, {})).toBe(false);
		expect(has3DTransform({ rotateX: 10 }, {})).toBe(true);
		expect(has3DTransform({ rotateY: -5 }, {})).toBe(true);
		expect(has3DTransform({ translateZ: 50 }, {})).toBe(true);
		expect(has3DTransform({ rotateZ: 45 }, {})).toBe(true);
		expect(has3DTransform({ perspective: 1000, rotateX: 5 }, {})).toBe(true);

		// Animation track triggers 3D path even at frame 0 when value is 0
		expect(
			has3DTransform(
				{ rotateX: 0 },
				{
					animation: {
						tracks: [{ prop: "rotateX" }],
					},
				},
			),
		).toBe(true);
	});
});

describe("GSAP Timeline 3D Compilation Continuity", () => {
	it("Invariant 6: Animation Continuity Invariant — animates rotateX without frame 0 jumping", () => {
		const virtualMedia = {
			metadata: { width: 1920, height: 1080, durationMs: 2000 },
			operation: { op: "Compositor" },
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "card",
						kind: "box",
						x: 100,
						y: 100,
						width: 400,
						height: 300,
						rotateX: 0,
						rotateY: 0,
						perspective: 1000,
						animation: {
							tracks: [
								{
									id: "tilt-track",
									prop: "rotateX",
									keyframes: [
										{ id: "k0", frame: 0, value: 0 },
										{ id: "k1", frame: 24, value: 25 },
									],
								},
							],
						},
					},
					children: [],
				},
			],
		};

		const { tl, targetsById } = compileTimeline(
			"test-3d-render",
			virtualMedia as CompilerVirtualMedia,
			{
				fps: 24,
				durationSec: 2,
			},
		);

		const cardStub = targetsById.card;
		expect(cardStub).toBeDefined();

		// Frame 0: exactly 0, no jumping
		tl.seek(0);
		expect(cardStub.rotateX).toBe(0);

		// Halfway (frame 12): smoothly interpolated
		tl.seek(12 / 24);
		expect(cardStub.rotateX).toBeGreaterThan(0);
		expect(cardStub.rotateX).toBeLessThan(25);

		// Frame 24: reaches target 25
		tl.seek(24 / 24);
		expect(cardStub.rotateX).toBe(25);
	});
});
