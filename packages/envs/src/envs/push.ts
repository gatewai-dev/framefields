/**
 * Push (interactive, Rapier): the agent is a blue ball on a floor; the
 * action pushes it (a 2D impulse each frame, x and depth). The task: get
 * the red box onto the green goal. Reward each step is minus the box's
 * distance to the goal in meters; the episode ends when the box's center
 * is within 40 px of the goal's.
 */
import {
	Composition,
	Layer,
	Layer3D,
	type LayoutNode,
	Physics,
} from "framefields";
import { type InteractiveEnv, random } from "framefields/datasets";

export interface PushParams {
	agent: [number, number];
	box: [number, number];
	goal: [number, number];
	camera: { azimuth: number; elevation: number };
}

/** The floor's top, scene px (y down). */
const FLOOR_Y = 400;
const BOX = 30;
const AGENT = 22;
/** px/s an action of 1 adds to the agent per frame. */
const PUSH = 160;
const GOAL_RADIUS = 40;

function place(r: ReturnType<typeof random>, spread: number): [number, number] {
	return [
		Math.round(r.range(-spread, spread)),
		Math.round(r.range(-spread, spread)),
	];
}

export const push: InteractiveEnv<PushParams, number[]> = {
	name: "push",
	description:
		"Push the red box onto the green goal with the blue ball. Action: [x, depth] push in [-1, 1]; reward: minus the box's distance to the goal (m); done within 40 px.",
	fps: 24,
	frames: 240,
	width: 128,
	height: 128,
	frameSkip: 2,
	actionSpace: { type: "box", shape: [2], low: -1, high: 1 },
	params(seed) {
		const r = random(seed);
		const box = place(r, 120);
		let goal = place(r, 220);
		while (Math.hypot(goal[0] - box[0], goal[1] - box[1]) < 150)
			goal = place(r, 220);
		let agent = place(r, 220);
		while (Math.hypot(agent[0] - box[0], agent[1] - box[1]) < 90)
			agent = place(r, 220);
		return {
			agent,
			box,
			goal,
			camera: {
				azimuth: Math.round(r.range(-20, 20)),
				elevation: Math.round(r.range(45, 65)),
			},
		};
	},
	async start(params, host) {
		const { width, height, fps, frames } = push;
		const c = new Composition({
			width,
			height,
			fps,
			durationFrames: frames,
			backgroundColor: "#0e1116",
		});
		const az = (params.camera.azimuth * Math.PI) / 180;
		const el = (params.camera.elevation * Math.PI) / 180;
		const d = 640;
		const ball = Layer3D.sphere({
			id: "agent",
			label: "agent",
			radius: AGENT,
			x: params.agent[0],
			y: FLOOR_Y - AGENT,
			z: params.agent[1],
			color: "#4363d8",
		});
		const box = Layer3D.roundedBox({
			id: "box",
			label: "box",
			width: BOX * 2,
			height: BOX * 2,
			depth: BOX * 2,
			x: params.box[0],
			y: FLOOR_Y - BOX,
			z: params.box[1],
			color: "#e6194b",
		});
		c.add([
			Layer.camera({
				x: Math.round(Math.sin(az) * Math.cos(el) * d),
				y: Math.round(FLOOR_Y - Math.sin(el) * d),
				z: Math.round(-Math.cos(az) * Math.cos(el) * d),
				targetX: 0,
				targetY: FLOOR_Y,
				targetZ: 0,
				fov: 50,
			}),
			Layer.ambientLight("#ffffff", 0.5),
			Layer.directionalLight({
				x: -300,
				y: -800,
				z: -400,
				targetX: 0,
				targetY: FLOOR_Y,
				targetZ: 0,
				intensity: 0.8,
			}),
			Layer3D.roundedBox({
				id: "floor",
				label: "floor",
				width: 700,
				height: 20,
				depth: 700,
				x: 0,
				y: FLOOR_Y + 10,
				z: 0,
				color: "#8a8f98",
			}) as LayoutNode,
			Layer3D.cylinder({
				id: "goal",
				label: "goal",
				radius: GOAL_RADIUS,
				height: 2,
				x: params.goal[0],
				y: FLOOR_Y - 1,
				z: params.goal[1],
				color: "#3cb44b",
			}) as LayoutNode,
			box as LayoutNode,
			ball as LayoutNode,
		]);
		const world = await Physics.world3d({ fps, frames });
		// The floor and four walls around it (its top at FLOOR_Y), so nothing leaves it.
		world.walls({
			x: 0,
			y: FLOOR_Y - 200,
			z: 0,
			width: 700,
			height: 400,
			depth: 700,
		});
		const agent = world.body(ball as LayoutNode, {
			friction: 0.4,
			linearDamping: 1.5,
			density: 3,
		});
		// Lighter than the ball, so the ball can shove it.
		const target = world.body(box as LayoutNode, {
			friction: 0.5,
			linearDamping: 1,
			density: 0.4,
		});
		world.live(host);
		const read = (s: { get(c: never): unknown }, frame: number) =>
			s.get({ frame, fps } as never) as number;
		const distance = (frame: number) =>
			Math.hypot(
				read(target.x, frame) - params.goal[0],
				read(target.z, frame) - params.goal[1],
			);
		return {
			views: [{ name: "top", composition: c }],
			act: (frame, action) => {
				const ax = Math.max(-1, Math.min(1, Number(action[0]) || 0));
				const az = Math.max(-1, Math.min(1, Number(action[1]) || 0));
				world.impulse(agent, frame, [ax * PUSH, 0, az * PUSH]);
			},
			reward: (frame) => -distance(frame) / 100,
			terminated: (frame) => distance(frame) < GOAL_RADIUS,
			info: (frame) => ({
				distance: distance(frame),
				agent: [read(agent.x, frame), read(agent.z, frame)],
				box: [read(target.x, frame), read(target.z, frame)],
				goal: params.goal,
			}),
		};
	},
};
