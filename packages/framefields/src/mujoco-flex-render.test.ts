/**
 * MuJoCo flexes through the real renderer: a cloth dropped on a box drapes
 * over it, and its skinned surface follows the simulated vertices frame by
 * frame (its pixels move down the box's sides as it falls and folds).
 */
import { describe, expect, it } from "vitest";
import { Composition, Layer, type LayoutNode, truthLabels } from "./index.js";
import { Physics } from "./physics/index.js";

const MJCF = `<mujoco>
  <option timestep="0.004" iterations="10" ls_iterations="10"/>
  <worldbody>
    <geom name="floor" type="plane" size="2 2 0.1" group="3"/>
    <geom name="table" type="box" size="0.12 0.12 0.1" pos="0 0 0.1"/>
    <flexcomp name="towel" type="grid" count="9 9 1" spacing="0.035 0.035 0.035"
      pos="0.03 0 0.3" radius="0.004" dim="2" mass="0.1" rgba="0.9 0.35 0.3 1">
      <edge equality="true"/>
      <contact condim="3" solref="0.01 1" selfcollide="none"/>
    </flexcomp>
  </worldbody>
</mujoco>`;

describe("MuJoCo flexes", () => {
	it("draw a cloth that drapes as the simulation says", async () => {
		const world = await Physics.mujoco({
			mjcf: MJCF,
			fps: 30,
			frames: 45,
			pixelsPerMeter: 1000,
		});
		expect(world.flexNames).toEqual(["towel"]);
		const { layers, skipped } = world.layers();
		expect(skipped).toEqual([]);
		expect(layers.map((l) => (l as { id?: string }).id)).toContain(
			"mujoco:flex:towel",
		);
		// It falls onto the box (top 0.2 m) and hangs down its sides.
		const lowest = (frame: number) => {
			const v = world.flexVertices("towel", frame);
			let z = Number.POSITIVE_INFINITY;
			for (let k = 2; k < v.length; k += 3) z = Math.min(z, v[k]);
			return z;
		};
		expect(lowest(0)).toBeCloseTo(0.3, 3);
		expect(lowest(44)).toBeLessThan(0.17);

		const c = new Composition({
			width: 160,
			height: 120,
			fps: 30,
			durationFrames: 45,
		});
		c.add([
			Layer.camera({ x: 0, y: -250, z: -600, targetX: 0, targetY: -150 }),
			Layer.ambientLight("#ffffff", 1),
			...(layers as LayoutNode[]),
		]);
		const towelBox = async (frame: number) => {
			const truth = await c.renderTruth({ frame });
			const towel = truthLabels(truth.scenes[0]).objects.find(
				(o) => o.layer === "mujoco:flex:towel",
			);
			expect(towel?.pixels).toBeGreaterThan(50);
			return towel?.box2d ?? [0, 0, 0, 0];
		};
		const before = await towelBox(0);
		const after = await towelBox(44);
		// Draped: its pixels reach further down the image than the flat sheet's.
		expect(after[3]).toBeGreaterThan(before[3] + 15);
	});
});
