/**
 * MuJoCo worlds: reproducible runs, branching from a saved state, actuator
 * control, contacts, and MuJoCo's z-up meters mapped to scene pixels.
 */
import { describe, expect, it } from "vitest";
import { Physics } from "./index.js";

const FPS = 30;

/** A box dropped onto a floor, and a position-controlled hinge arm. */
const MJCF = `<mujoco>
  <option timestep="0.002"/>
  <worldbody>
    <geom name="floor" type="plane" size="0 0 0.1"/>
    <body name="box" pos="0.5 0.2 1" euler="10 20 30">
      <freejoint/>
      <geom name="box" type="box" size="0.1 0.1 0.05" rgba="1 0 0 1"/>
    </body>
    <body name="arm" pos="-0.5 0 0.5">
      <joint name="hinge" type="hinge" axis="0 1 0" damping="1"/>
      <geom name="link" type="capsule" fromto="0 0 0 0.3 0 0" size="0.03"/>
    </body>
  </worldbody>
  <actuator><position joint="hinge" kp="20"/></actuator>
</mujoco>`;

async function world(
	options: { initialState?: Float64Array; frames?: number } = {},
) {
	return Physics.mujoco({
		mjcf: MJCF,
		fps: FPS,
		frames: options.frames ?? 60,
		origin: [400, 300, 0],
		control: () => [0.8],
		initialState: options.initialState,
	});
}

describe("Physics.mujoco", () => {
	it("runs the same every time", async () => {
		const a = await world();
		const b = await world();
		for (let f = 0; f < a.frames; f++) {
			expect(Array.from(b.qpos(f))).toEqual(Array.from(a.qpos(f)));
		}
	});

	it("branches from a saved state onto the same trajectory", async () => {
		const a = await world();
		const b = await world({ initialState: a.state(20), frames: 40 });
		for (let k = 0; k < 40; k++) {
			expect(Array.from(b.qpos(k))).toEqual(Array.from(a.qpos(20 + k)));
		}
	});

	it("drives actuators, reports contacts, maps axes to scene pixels", async () => {
		const w = await world();
		// The position actuator holds the hinge at its 0.8 rad target.
		const hinge = w.qpos(59)[7];
		expect(hinge).toBeCloseTo(0.8, 1);
		// The box has landed: it touches the floor, its centre 0.05 m up.
		expect(w.contacts(59)).toContainEqual({ geom1: "floor", geom2: "box" });
		const at = { frame: 59, fps: FPS } as never;
		const box = w.geom("box");
		// MuJoCo (x, y, z) → origin + 100 px/m · (x, -z, y).
		expect(box.x.get(at) as number).toBeCloseTo(400 + 50, -1);
		expect(box.y.get(at) as number).toBeCloseTo(300 - 5, 0);
		expect(box.z.get(at) as number).toBeCloseTo(0 + 20, -1);
		// Before landing it was a metre up.
		expect(w.geom("box").y.get({ frame: 0, fps: FPS } as never)).toBeCloseTo(
			200,
			0,
		);
	});

	it("draws visible geoms as layers", async () => {
		const w = await world();
		const { layers, skipped } = w.layers();
		expect(layers.map((l) => (l as { id?: string }).id)).toEqual([
			"mujoco:floor",
			"mujoco:box",
			"mujoco:link",
		]);
		expect(skipped).toEqual([]);
	});
});
