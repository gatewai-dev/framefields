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
		const landed = w.contacts(59).filter((c) => c.geom2 === "box");
		expect(landed.length).toBeGreaterThan(0);
		// Resting: the floor carries its weight (box density 1000 × 0.002 m³ × g).
		const weight = 1000 * 0.2 * 0.2 * 0.1 * 9.81;
		const total = landed.reduce((n, c) => n + c.force, 0);
		expect(total).toBeGreaterThan(weight * 0.3);
		expect(landed[0].position[1]).toBeCloseTo(300, -1);
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

	it("records velocities, commands, sensors and joints", async () => {
		const w = await Physics.mujoco({
			mjcf: MJCF.replace(
				"</mujoco>",
				`<sensor><jointpos name="angle" joint="hinge"/><jointvel name="speed" joint="hinge"/></sensor></mujoco>`,
			),
			fps: FPS,
			frames: 30,
			control: (frame) => [frame < 10 ? 0 : 0.5],
		});
		expect(w.joints.map((j) => [j.name, j.type, j.qpos, j.qvel])).toEqual([
			["joint0", "free", 0, 0],
			["hinge", "hinge", 7, 6],
		]);
		expect(w.actuatorNames).toEqual(["actuator0"]);
		expect(w.sensors).toEqual([
			{ name: "angle", adr: 0, dim: 1 },
			{ name: "speed", adr: 1, dim: 1 },
		]);
		expect(w.qvel(20).length).toBe(7);
		// The sensors read what qpos / qvel say.
		expect(w.sensor("angle", 20)[0]).toBeCloseTo(w.qpos(20)[7], 6);
		expect(w.sensor("speed", 20)[0]).toBeCloseTo(w.qvel(20)[6], 6);
		// ctrl is what stepped into a frame; action, what steps out of it.
		expect(Array.from(w.ctrl(0))).toEqual([0]);
		expect(Array.from(w.ctrl(11))).toEqual([0.5]);
		expect(Array.from(w.action(10))).toEqual([0.5]);
		expect(Array.from(w.action(9))).toEqual([0]);
		expect(Array.from(w.action(29))).toEqual([0.5]);
		expect(() => w.sensor("nope", 0)).toThrow('no sensor "nope"');
	});

	it("catches a contact that begins and ends between two frames", async () => {
		// A fast ball bounces off a wall and is gone again within one frame.
		const mjcf = `<mujoco>
  <option timestep="0.001" gravity="0 0 0"/>
  <worldbody>
    <geom name="wall" type="box" size="0.01 0.5 0.5" pos="0.1 0 0"/>
    <body name="ball" pos="0 0 0">
      <freejoint/>
      <geom name="ball" type="sphere" size="0.02" solref="0.002 0.2"/>
    </body>
  </worldbody>
</mujoco>`;
		const probe = await Physics.mujoco({ mjcf, fps: 30, frames: 1 });
		// The integration state is time, qpos (nq = 7), qvel: 6 m/s along x.
		const start = probe.state(0).slice();
		start[1 + 7] = 6;
		// At 10 fps the whole bounce falls inside frame 1.
		const w = await Physics.mujoco({
			mjcf,
			fps: 10,
			frames: 3,
			initialState: start,
		});
		expect(w.contacts(0)).toEqual([]);
		const hit = w.contacts(1);
		expect(hit.map((c) => [c.geom1, c.geom2].sort())).toEqual([
			["ball", "wall"],
		]);
		expect(hit[0].force).toBeGreaterThan(10);
		// By the frame's end it is away from the wall (edge at 0.09 m).
		expect(w.qvel(1)[0]).toBeLessThan(0);
		expect(w.qpos(1)[0] + 0.02).toBeLessThan(0.09);
		expect(w.contacts(2)).toEqual([]);
	});

	it("starts from a keyframe and gives control the velocities", async () => {
		const mjcf = MJCF.replace(
			"</mujoco>",
			`<keyframe>
    <key name="raised" qpos="0.5 0.2 0.05 1 0 0 0 -1.2" ctrl="-1.2"/>
    <key qpos="0.5 0.2 0.05 1 0 0 0 0.4" qvel="0 0 0 0 0 0 3" ctrl="0.4"/>
  </keyframe></mujoco>`,
		);
		const seen: number[] = [];
		const w = await Physics.mujoco({
			mjcf,
			fps: FPS,
			frames: 10,
			keyframe: "raised",
			control: (_f, { qvel }) => {
				seen.push(qvel[6]);
				return [-1.2];
			},
		});
		expect(w.keyframeNames).toEqual(["raised", "key1"]);
		expect(w.qpos(0)[7]).toBe(-1.2);
		// Held there (gravity sags it a little against kp 20).
		expect(w.qpos(9)[7]).toBeCloseTo(-1.2, 1);
		expect(seen[0]).toBe(0);
		// Without `control` the keyframe's ctrl holds; by index, with its qvel.
		const held = await Physics.mujoco({
			mjcf,
			fps: FPS,
			frames: 30,
			keyframe: 1,
		});
		expect(held.qvel(0)[6]).toBe(3);
		expect(Array.from(held.ctrl(29))).toEqual([0.4]);
		expect(Math.abs(held.qpos(29)[7] - 0.4)).toBeLessThan(0.1);
		await expect(
			Physics.mujoco({ mjcf, fps: FPS, frames: 1, keyframe: "home" }),
		).rejects.toThrow('no keyframe "home" (keyframes: raised, key1)');
	});
});
