import { describe, expect, it } from "vitest";
import { Camera3D } from "./camera3d.js";
import {
	cameraBasis,
	cubeFaceCameras,
	cubeTexel,
	defaultCubeFaceSize,
} from "./cube-lens.js";
import type { Vec3 } from "./vector3.js";

/** Clip-space position of world point `p` (column-major matrix). */
function project(m: number[], p: Vec3): [number, number, number, number] {
	const out: [number, number, number, number] = [0, 0, 0, 0];
	for (let r = 0; r < 4; r++) {
		out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
	}
	return out;
}

describe("cube-map cameras", () => {
	const eye: Vec3 = [120, -40, 300];
	const faces = cubeFaceCameras(eye, 1, 10000);

	it("draws each face where WebGPU samples it", () => {
		let checked = 0;
		for (let i = 0; i < 6; i++) {
			const viewProj = Camera3D.computeViewProjectionMatrix(faces[i]);
			for (const x of [-0.9, -0.3, 0, 0.45, 0.8]) {
				for (const y of [-0.85, -0.2, 0, 0.5, 0.95]) {
					// A world ray through this face's NDC (x, y).
					const { right, up, forward } = cameraBasis(faces[i]);
					const dir: Vec3 = [0, 1, 2].map(
						(k) => forward[k] + x * right[k] + y * up[k],
					) as Vec3;
					const point: Vec3 = [0, 1, 2].map(
						(k) => eye[k] + dir[k] * 500,
					) as Vec3;
					const clip = project(viewProj, point);
					const ndcX = clip[0] / clip[3];
					const ndcY = clip[1] / clip[3];
					expect(ndcX).toBeCloseTo(x, 5);
					expect(ndcY).toBeCloseTo(y, 5);
					const texel = cubeTexel(dir);
					expect(texel.face).toBe(i);
					expect(texel.u).toBeCloseTo((ndcX + 1) / 2, 5);
					expect(texel.v).toBeCloseTo((1 - ndcY) / 2, 5);
					checked++;
				}
			}
		}
		expect(checked).toBe(150);
	});

	it("covers every direction with square 90° faces", () => {
		for (const face of faces) {
			expect(face.fov).toBe(90);
			expect(face.aspect).toBe(1);
		}
		const forwards = faces.map((f) => cameraBasis(f).forward);
		for (let a = 0; a < 6; a++) {
			for (let b = a + 1; b < 6; b++) {
				const dot = forwards[a].reduce((s, v, k) => s + v * forwards[b][k], 0);
				expect([0, -1]).toContain(Math.round(dot));
			}
		}
	});

	it("sizes faces to the lens's density at the centre", () => {
		const max = 4096;
		// 1080p height, 90° vertical: 540 px per unit tangent → 1080-wide faces.
		expect(
			defaultCubeFaceSize(
				{ projection: "perspective", fov: 90, zoom: 1 },
				1920,
				1080,
				max,
			),
		).toBe(2048);
		expect(
			defaultCubeFaceSize(
				{ projection: "equirectangular", fov: 90, zoom: 1 },
				2048,
				1024,
				max,
			),
		).toBe(1024);
		expect(
			defaultCubeFaceSize(
				{ projection: "perspective", fov: 10, zoom: 1 },
				1920,
				1080,
				max,
			),
		).toBe(max);
	});
});
