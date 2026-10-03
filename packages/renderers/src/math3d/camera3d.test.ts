import { describe, expect, it } from "vitest";
import { Camera3D } from "./camera3d.js";
import { Matrix4Math } from "./matrix4.js";
import { Vector3Math } from "./vector3.js";

describe("Vector3Math", () => {
	it("performs vector arithmetic and dot/cross products", () => {
		const a = Vector3Math.create(1, 2, 3);
		const b = Vector3Math.create(4, 5, 6);

		expect(Vector3Math.add(a, b)).toEqual([5, 7, 9]);
		expect(Vector3Math.subtract(b, a)).toEqual([3, 3, 3]);
		expect(Vector3Math.dot(a, b)).toBe(4 + 10 + 18); // 32

		const cross = Vector3Math.cross([1, 0, 0], [0, 1, 0]);
		expect(cross).toEqual([0, 0, 1]);

		const norm = Vector3Math.normalize([0, 3, 4]);
		expect(norm[0]).toBeCloseTo(0);
		expect(norm[1]).toBeCloseTo(3 / 5);
		expect(norm[2]).toBeCloseTo(4 / 5);
	});
});

describe("Matrix4Math", () => {
	it("creates identity matrix", () => {
		const m = Matrix4Math.identity();
		expect(m).toHaveLength(16);
		expect(m[0]).toBe(1);
		expect(m[5]).toBe(1);
		expect(m[10]).toBe(1);
		expect(m[15]).toBe(1);
	});

	it("inverts non-singular matrices", () => {
		const t = Matrix4Math.translate(10, -20, 30);
		const r = Matrix4Math.rotateY(Math.PI / 4);
		const m = Matrix4Math.multiply(t, r);

		const inv = Matrix4Math.invert(m);
		expect(inv).not.toBeNull();
		if (!inv) return;

		const ident = Matrix4Math.multiply(m, inv);
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				const expected = row === col ? 1 : 0;
				expect(ident[col * 4 + row]).toBeCloseTo(expected, 4);
			}
		}
	});

	it("computes LookAt view matrix correctly", () => {
		const eye = Vector3Math.create(0, 0, -100);
		const target = Vector3Math.create(0, 0, 0);
		const up = Vector3Math.create(0, -1, 0);

		const view = Matrix4Math.lookAt(eye, target, up);
		expect(view).toBeDefined();

		// A point at the target should map to (0, 0, 100) in view space
		const ptTarget = Matrix4Math.projectPoint(view, target);
		expect(ptTarget[0]).toBeCloseTo(0);
		expect(ptTarget[1]).toBeCloseTo(0);
		expect(ptTarget[2]).toBeCloseTo(100);
	});
});

describe("Camera3D Kinematics & Conformance Invariants", () => {
	it("Invariant 1: Canvas-Aligned Perspective Default at Z=0", () => {
		const width = 1920;
		const height = 1080;
		const camera = Camera3D.createDefaultCamera(width, height, 50);

		const vp = Camera3D.computeViewProjectionMatrix(camera);

		// Project canvas center (width/2, height/2, 0)
		const centerNDC = Matrix4Math.projectPoint(vp, [width / 2, height / 2, 0]);
		expect(centerNDC[0]).toBeCloseTo(0, 3);
		expect(centerNDC[1]).toBeCloseTo(0, 3);

		// Project top-left corner (0, 0, 0) -> NDC should be (-1, 1) in Y-down screen
		const topLeftNDC = Matrix4Math.projectPoint(vp, [0, 0, 0]);
		expect(topLeftNDC[0]).toBeCloseTo(-1, 2);
		expect(topLeftNDC[1]).toBeCloseTo(1, 2);

		// Project bottom-right corner (width, height, 0) -> NDC should be (1, -1)
		const bottomRightNDC = Matrix4Math.projectPoint(vp, [width, height, 0]);
		expect(bottomRightNDC[0]).toBeCloseTo(1, 2);
		expect(bottomRightNDC[1]).toBeCloseTo(-1, 2);
	});

	it("Invariant 2: Spherical Orbit Radius Invariance", () => {
		const target = Vector3Math.create(960, 540, 0);
		const radius = 1500;

		const testAngles = [
			{ az: 0, el: 0 },
			{ az: 45, el: 30 },
			{ az: 90, el: -45 },
			{ az: 180, el: 60 },
			{ az: -120, el: 15 },
		];

		for (const { az, el } of testAngles) {
			const eye = Camera3D.orbit(target, radius, az, el);
			const dist = Vector3Math.distance(eye, target);
			expect(dist).toBeCloseTo(radius, 4);
		}
	});

	it("Invariant 3: Dolly Motion changes distance along optical axis", () => {
		const eye = Vector3Math.create(960, 540, -2000);
		const target = Vector3Math.create(960, 540, 0);

		const initialDist = Vector3Math.distance(eye, target);
		expect(initialDist).toBe(2000);

		const result = Camera3D.dolly(eye, target, 500);
		const newDist = Vector3Math.distance(result.eye, result.target);
		expect(newDist).toBeCloseTo(1500);
	});

	it("Invariant 4: Depth of Field Focal Razor (0 CoC at focus distance)", () => {
		const focusDist = 1200;
		const focalLength = 50;
		const fStop = 2.8;

		// Exact focus plane
		const cocAtFocus = Camera3D.computeCircleOfConfusion(
			focusDist,
			focusDist,
			focalLength,
			fStop,
		);
		expect(cocAtFocus).toBe(0);

		// Foreground and background have non-zero blur
		const cocNear = Camera3D.computeCircleOfConfusion(
			600,
			focusDist,
			focalLength,
			fStop,
		);
		expect(cocNear).toBeGreaterThan(0);

		const cocFar = Camera3D.computeCircleOfConfusion(
			2400,
			focusDist,
			focalLength,
			fStop,
		);
		expect(cocFar).toBeGreaterThan(0);
	});

	it("Invariant 5: Frustum Culling detects box containment", () => {
		const camera = Camera3D.createDefaultCamera(1920, 1080, 50);
		const vp = Camera3D.computeViewProjectionMatrix(camera);
		const planes = Camera3D.computeCameraFrustumPlanes(vp);

		// Center card should be inside frustum
		const inside = Camera3D.isBoxInFrustum(
			[800, 400, -100],
			[1120, 680, 100],
			planes,
		);
		expect(inside).toBe(true);

		// Far offscreen box behind camera or way outside should be culled
		const wayOutside = Camera3D.isBoxInFrustum(
			[50000, 50000, 1000],
			[51000, 51000, 1100],
			planes,
		);
		expect(wayOutside).toBe(false);
	});
});
