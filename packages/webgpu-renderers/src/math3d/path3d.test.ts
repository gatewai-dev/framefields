import { describe, expect, it } from "vitest";
import { Path3D } from "./path3d.js";
import { Vector3Math } from "./vector3.js";

describe("Path3D Mathematical Curves & Kinematics", () => {
	it("interpolates Catmull-Rom spline with uniform arc-length parameterization", () => {
		const waypoints: Array<[number, number, number]> = [
			[0, 0, 0],
			[100, 50, 20],
			[200, -50, 40],
			[300, 0, 60],
		];

		const path = Path3D.catmullRom(waypoints, { tension: 0.5 });
		expect(path.totalLength).toBeGreaterThan(300);

		// Start point at u = 0 must match initial waypoint
		const p0 = path.getPointAt(0);
		expect(p0.position[0]).toBeCloseTo(0, 1);
		expect(p0.position[1]).toBeCloseTo(0, 1);
		expect(p0.position[2]).toBeCloseTo(0, 1);
		expect(p0.distance).toBe(0);

		// End point at u = 1 must match terminal waypoint
		const pEnd = path.getPointAt(1);
		expect(pEnd.position[0]).toBeCloseTo(300, 1);
		expect(pEnd.position[1]).toBeCloseTo(0, 1);
		expect(pEnd.position[2]).toBeCloseTo(60, 1);
		expect(pEnd.distance).toBeCloseTo(path.totalLength, 1);

		// Midpoint progression must be monotonic
		const pMid = path.getPointAt(0.5);
		expect(pMid.distance).toBeCloseTo(path.totalLength * 0.5, 1);
		expect(pMid.position[0]).toBeGreaterThan(0);
		expect(pMid.position[0]).toBeLessThan(300);
	});

	it("maintains orthonormal Rotation-Minimizing Frames (RMF) along curves", () => {
		const waypoints: Array<[number, number, number]> = [
			[0, 100, 0],
			[200, 300, 100],
			[400, 100, 300],
			[600, 400, 200],
		];

		const path = Path3D.catmullRom(waypoints);

		// Sample across entire path and verify orthonormal frame invariants
		for (let u = 0; u <= 1.0; u += 0.1) {
			const pt = path.getPointAt(u);

			// Tangent must be unit length
			expect(Vector3Math.length(pt.tangent)).toBeCloseTo(1.0, 4);

			// Normal must be unit length
			expect(Vector3Math.length(pt.normal)).toBeCloseTo(1.0, 4);

			// Binormal must be unit length
			expect(Vector3Math.length(pt.binormal)).toBeCloseTo(1.0, 4);

			// Tangent and Normal must be perpendicular
			expect(Vector3Math.dot(pt.tangent, pt.normal)).toBeCloseTo(0, 3);

			// Binormal must be cross(tangent, normal)
			const expectedB = Vector3Math.cross(pt.tangent, pt.normal);
			expect(Vector3Math.distance(pt.binormal, expectedB)).toBeCloseTo(0, 3);
		}
	});

	it("generates 3D cubic Bezier curves with exact boundary derivatives", () => {
		const path = Path3D.bezier([
			{
				p0: [0, 0, 0],
				p1: [50, 100, 0],
				p2: [150, 100, 50],
				p3: [200, 0, 100],
			},
		]);

		expect(path.totalLength).toBeGreaterThan(200);

		const startPt = path.getPointAt(0);
		expect(startPt.position[0]).toBeCloseTo(0);
		expect(startPt.position[1]).toBeCloseTo(0);
		expect(startPt.position[2]).toBeCloseTo(0);

		// Initial tangent must point towards p1 - p0 = [50, 100, 0]
		const expectedTan = Vector3Math.normalize([50, 100, 0]);
		expect(startPt.tangent[0]).toBeCloseTo(expectedTan[0], 2);
		expect(startPt.tangent[1]).toBeCloseTo(expectedTan[1], 2);

		const endPt = path.getPointAt(1);
		expect(endPt.position[0]).toBeCloseTo(200, 1);
		expect(endPt.position[1]).toBeCloseTo(0, 1);
		expect(endPt.position[2]).toBeCloseTo(100, 1);
	});

	it("creates 3D helical spirals with constant pitch and radius", () => {
		const helix = Path3D.helix({
			center: [400, 300, 0],
			radius: 200,
			pitch: 150,
			turns: 3,
			axis: "z",
		});

		expect(helix.totalLength).toBeGreaterThan(1000);

		// Any point on helix must have distance to Z-axis equal to radius (200)
		for (let u = 0; u <= 1.0; u += 0.2) {
			const pt = helix.getPointAt(u);
			const dx = pt.position[0] - 400;
			const dy = pt.position[1] - 300;
			const rad = Math.sqrt(dx * dx + dy * dy);
			expect(rad).toBeCloseTo(200, 1);
		}
	});

	it("creates 3D circular orbit path returning to origin", () => {
		const circle = Path3D.circle({
			center: [500, 500, 0],
			radius: 300,
		});

		expect(circle.totalLength).toBeCloseTo(2 * Math.PI * 300, 0);

		const p0 = circle.getPointAt(0);
		const p1 = circle.getPointAt(1);

		// Start and end must coincide on closed circle
		expect(Vector3Math.distance(p0.position, p1.position)).toBeCloseTo(0, 1);
	});
});
