/**
 * MuJoCo textures and ellipsoids through the real renderer: a plane wears its
 * material's checker texture (repeated as `texrepeat` says), a mesh with
 * texture coordinates wears its texture, and an ellipsoid keeps its three
 * radii.
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, truthLabels } from "./index.js";
import { Physics } from "./physics/index.js";

const W = 400;
const H = 300;
const PPM = 400;

// Seen from the camera (scene -z is MuJoCo -y): a wall plane turned to face
// it, an ellipsoid in front of its left half, and a textured tetrahedron.
const MJCF = `<mujoco>
  <asset>
    <texture name="checker" type="2d" builtin="checker" rgb1="1 0 0" rgb2="0 0 1" width="64" height="64"/>
    <material name="wall" texture="checker" texrepeat="2 2"/>
    <texture name="green" type="2d" builtin="flat" rgb1="0 1 0" width="8" height="8"/>
    <material name="leaf" texture="green"/>
    <mesh name="tri" vertex="0 0 0  0.1 0 0  0 0 0.1  0 0.05 0" face="0 1 2  0 3 1  0 2 3  1 3 2" texcoord="0 0 1 0 0 1 1 1"/>
  </asset>
  <worldbody>
    <geom name="wall" type="plane" size="0.25 0.25 0.01" euler="90 0 0" material="wall"/>
    <body name="egg" pos="-0.15 -0.1 0.1">
      <geom name="egg" type="ellipsoid" size="0.03 0.03 0.08" rgba="1 1 1 1" contype="0" conaffinity="0"/>
    </body>
    <body name="leaf" pos="0.1 -0.1 -0.2">
      <geom name="leaf" type="mesh" mesh="tri" material="leaf" contype="0" conaffinity="0"/>
    </body>
  </worldbody>
</mujoco>`;

describe("MuJoCo textures and ellipsoids", () => {
	it("draws a checker wall, a textured mesh and an ellipsoid", async () => {
		const world = await Physics.mujoco({
			mjcf: MJCF,
			fps: 30,
			frames: 1,
			pixelsPerMeter: PPM,
			origin: [200, 150, 0],
		});
		const { layers, skipped } = world.layers();
		expect(skipped).toEqual([]);
		const c = new Composition({
			width: W,
			height: H,
			fps: 30,
			durationFrames: 1,
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
		const objectOf = (layer: string) =>
			truthLabels(s).objects.find((o) => o.layer === layer);

		// The wall: 2 × 2 repeats of a 2 × 2 checker, so 4 cells across, red
		// and blue alternating along a row through its right half.
		const wall = objectOf("mujoco:wall");
		expect(wall?.box2d).not.toBeNull();
		const [x0, , x1] = wall?.box2d ?? [0, 0, 0, 0];
		const row = Math.round(
			H / 2 +
				(0.07 *
					PPM *
					(s.height / 2 / Math.tan((s.camera.fov * Math.PI) / 360))) /
					900,
		);
		const colors: string[] = [];
		for (let x = Math.ceil(x0) + 2; x < x1 - 2; x++) {
			const i = (row * W + x) * 4;
			const [r, , b] = truth.rgba.subarray(i, i + 3);
			const c = r > b + 60 ? "r" : b > r + 60 ? "b" : "";
			if (c && c !== colors.at(-1)) colors.push(c);
		}
		expect(colors.length).toBeGreaterThanOrEqual(4);

		// The leaf's texture is green.
		const leaf = objectOf("mujoco:leaf");
		expect(leaf?.box2d).not.toBeNull();
		const [lx0, ly0, lx1, ly1] = leaf?.box2d ?? [0, 0, 0, 0];
		const li =
			(Math.round(ly1 - (ly1 - ly0) * 0.25) * W +
				Math.round(lx0 + (lx1 - lx0) * 0.25)) *
			4;
		expect(truth.rgba[li + 1]).toBeGreaterThan(truth.rgba[li] + 80);

		// The egg: 0.16 m tall, 0.06 m wide.
		const egg = objectOf("mujoco:egg");
		const [ex0, ey0, ex1, ey1] = egg?.box2d ?? [0, 0, 0, 0];
		expect((ey1 - ey0) / (ex1 - ex0)).toBeGreaterThan(2.2);
		expect((ey1 - ey0) / (ex1 - ex0)).toBeLessThan(3.1);
	});
});
