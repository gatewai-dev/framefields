/**
 * MuJoCo mesh geoms through the real renderer: a model loaded from its file
 * (an STL mesh beside it, a material for its color) draws the mesh where and
 * how MuJoCo places it.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Composition, Layer } from "./index.js";
import { Physics } from "./physics/index.js";

const W = 400;
const H = 300;
const PPM = 400;

/** A binary STL of an axis-aligned box with half sizes `h`, faces outward. */
function boxStl(h: [number, number, number]): Uint8Array {
	const [x, y, z] = h;
	const v = (i: number): [number, number, number] => [
		i & 1 ? x : -x,
		i & 2 ? y : -y,
		i & 4 ? z : -z,
	];
	// Two outward (counter-clockwise from outside) triangles per face.
	const quads = [
		[0, 2, 3, 1], // -z
		[4, 5, 7, 6], // +z
		[0, 1, 5, 4], // -y
		[2, 6, 7, 3], // +y
		[0, 4, 6, 2], // -x
		[1, 3, 7, 5], // +x
	];
	const tris = quads.flatMap(([a, b, c, d]) => [
		[a, b, c],
		[a, c, d],
	]);
	const buf = new DataView(new ArrayBuffer(84 + tris.length * 50));
	buf.setUint32(80, tris.length, true);
	tris.forEach((t, i) => {
		let o = 84 + i * 50 + 12; // normal left zero: MuJoCo computes its own
		for (const k of t) {
			for (const c of v(k)) {
				buf.setFloat32(o, c, true);
				o += 4;
			}
		}
	});
	return new Uint8Array(buf.buffer);
}

const MJCF = `<mujoco>
  <compiler meshdir="assets"/>
  <asset>
    <mesh name="bar" file="bar.stl"/>
    <material name="green" rgba="0 1 0 1"/>
  </asset>
  <worldbody>
    <body name="holder" pos="0 0 0.3" euler="0 45 0">
      <geom name="bar" type="mesh" mesh="bar" material="green" contype="0" conaffinity="0"/>
    </body>
  </worldbody>
</mujoco>`;

describe("MuJoCo mesh geoms", () => {
	it("loads a model from its file and draws its mesh in place", async () => {
		const dir = await mkdtemp(path.join(os.tmpdir(), "mujoco-mesh-"));
		await mkdir(path.join(dir, "assets"));
		await writeFile(
			path.join(dir, "assets", "bar.stl"),
			boxStl([0.15, 0.02, 0.02]),
		);
		await writeFile(path.join(dir, "robot.xml"), MJCF);

		const world = await Physics.mujoco({
			path: path.join(dir, "robot.xml"),
			fps: 30,
			frames: 2,
			pixelsPerMeter: PPM,
			origin: [200, 200, 0],
		}).finally(() => rm(dir, { recursive: true, force: true }));
		const { layers, skipped } = world.layers();
		expect(skipped).toEqual([]);
		const c = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 2,
			backgroundColor: "#000000",
		});
		c.add([
			Layer.camera({
				x: 200,
				y: 150,
				z: -900,
				targetX: 200,
				targetY: 150,
				targetZ: 0,
			}),
			Layer.ambientLight("#ffffff", 1),
			...layers,
		]);
		const truth = await c.renderTruth(0);
		const [s] = truth.scenes;
		const f = H / 2 / Math.tan((s.camera.fov * Math.PI) / 360);
		const pixel = (x: number, y: number) =>
			Math.round(150 + ((y - 150) * f) / 900) * W +
			Math.round(200 + ((x - 200) * f) / 900);
		const geomAt = (x: number, y: number) =>
			s.objects.find((o) => o.id === s.object[pixel(x, y)])?.layer;

		// MuJoCo (0, 0, 0.3) → scene (200, 80). Turned 45° about +y, the bar's
		// +x end goes toward -z: down and to the right on screen.
		const [cx, cy] = [200, 200 - 0.3 * PPM];
		const d = Math.SQRT1_2 * 45;
		for (const t of [-1, 0, 1]) {
			expect(geomAt(cx + d * t, cy + d * t)).toBe("mujoco:bar");
		}
		// Mirrored it would run up and to the right: nothing there.
		expect(geomAt(cx + d, cy - d)).toBeUndefined();
		expect(geomAt(cx - d, cy + d)).toBeUndefined();
		// Its material's green.
		const i = pixel(cx, cy) * 4;
		expect(truth.rgba[i + 1]).toBeGreaterThan(truth.rgba[i] + 80);
	});
});
