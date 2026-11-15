/**
 * Reacher (Steel): a two-joint arm sweeping over a table with a cube, seen
 * from a fixed front camera and a wrist camera at its tip. Each seed scripts
 * a sweep from one pose to another; `reacherEpisode` turns the run into a
 * LeRobot episode (joint state, drive targets as actions, velocities, both
 * cameras' videos).
 */
import { Composition, Layer, Physics } from "framefields";
import {
	type LeRobotEpisode,
	random,
	steelEpisode,
} from "framefields/datasets";

const MJCF = `<mujoco model="reacher">
  <compiler angle="radian"/>
  <worldbody>
    <geom name="floor" type="plane" size="0.6 0.6 0.01" rgba="0.3 0.32 0.36 1"/>
    <camera name="front" pos="0 -0.9 0.55" xyaxes="1 0 0 0 0.52 0.85" fovy="50"/>
    <body name="base" pos="0 0 0.05">
      <geom name="base" type="cylinder" size="0.05 0.05" rgba="0.2 0.2 0.25 1"/>
      <body name="upper" pos="0 0 0.06">
        <joint name="shoulder" type="hinge" axis="0 0 1" damping="0.5"/>
        <geom name="upper" type="capsule" fromto="0 0 0 0.2 0 0" size="0.02" rgba="0.9 0.5 0.1 1"/>
        <body name="lower" pos="0.2 0 0">
          <joint name="elbow" type="hinge" axis="0 0 1" damping="0.5" range="-2.5 2.5"/>
          <geom name="lower" type="capsule" fromto="0 0 0 0.18 0 0" size="0.018" rgba="0.9 0.6 0.2 1"/>
          <camera name="wrist" pos="0.18 0 0.12" xyaxes="0 -1 0 1 0 0.4" fovy="70"/>
        </body>
      </body>
    </body>
    <body name="cube" pos="0.25 0.18 0.03">
      <freejoint/>
      <geom name="cube" type="box" size="0.03 0.03 0.03" rgba="0.85 0.1 0.15 1" mass="0.05"/>
    </body>
  </worldbody>
  <actuator>
    <position name="shoulder" joint="shoulder" kp="4"/>
    <position name="elbow" joint="elbow" kp="4"/>
  </actuator>
</mujoco>`;

export const REACHER_CLIP = { fps: 24, frames: 72, width: 192, height: 144 };

/** Each body's color (Steel's MJCF loader keeps no `rgba`); the floor is the world's. */
const COLORS: Record<string, string> = {
	world: "#4d525c",
	base: "#33333f",
	upper: "#e6801a",
	lower: "#e69933",
	cube: "#d91a26",
};

/** Smoothly from `a` to `b` as `t` goes 0 → 1. */
const ease = (a: number, b: number, t: number) =>
	a + (b - a) * (t * t * (3 - 2 * t));

/** A seed's sweep: shoulder and elbow targets at the start and the end. */
export function reacherSweep(seed: number): {
	from: [number, number];
	to: [number, number];
} {
	const r = random(seed);
	const angle = () => Math.round(r.range(-1.4, 1.4) * 100) / 100;
	return { from: [angle(), angle()], to: [angle(), angle()] };
}

/** The run of a seed's sweep, and a LeRobot episode of it. */
export async function reacherEpisode(seed: number): Promise<LeRobotEpisode> {
	const { fps, frames, width, height } = REACHER_CLIP;
	const { from, to } = reacherSweep(seed);
	const world = await Physics.steel({
		fps,
		frames,
		pixelsPerMeter: 600,
		build: async (scene, load) => {
			await load.mjcf(scene, MJCF);
		},
		control: (frame, s) => {
			const t = Math.min(1, frame / (frames * 0.8));
			s.setJointTarget("shoulder", ease(from[0], to[0], t));
			s.setJointTarget("elbow", ease(from[1], to[1], t));
		},
	});
	await world.simulate();
	const view = (camera: string) => {
		const c = new Composition({
			width,
			height,
			fps,
			durationFrames: frames,
			backgroundColor: "#141820",
		});
		c.add([
			world.camera(camera),
			Layer.ambientLight("#ffffff", 0.45),
			Layer.directionalLight({
				x: -400,
				y: -900,
				z: -300,
				targetX: 0,
				targetY: 0,
				targetZ: 0,
				intensity: 0.9,
			}),
			...world.layers({
				planeSize: 1.2,
				style: (shape) => ({ color: COLORS[shape.body ?? "world"] }),
			}),
		]);
		return c;
	};
	return steelEpisode(world, {
		task: "Sweep the arm across the table.",
		cameras: { front: view("front"), wrist: view("wrist") },
	});
}
