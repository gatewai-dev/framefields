/**
 * Objects falling and colliding (Rapier): a few solids of random shape,
 * size and color dropped with random spin onto a floor. `falling` sees it
 * from one camera; `fallingMultiView` from three at once (every view runs
 * the same deterministic simulation, so they agree frame by frame).
 */
import {
	Composition,
	Layer,
	Layer3D,
	type LayoutNode,
	Physics,
	type PhysicsBody3D,
	type PhysicsState,
	type PhysicsWorld3D,
} from "framefields";
import type { Env, EnvView } from "framefields/datasets";
import { random } from "framefields/datasets";

const SHAPES = ["box", "sphere", "cylinder", "capsule"] as const;
const COLORS = [
	"#e6194b",
	"#3cb44b",
	"#ffe119",
	"#4363d8",
	"#f58231",
	"#911eb4",
	"#42d4f4",
	"#f032e6",
] as const;

/** The floor's top, scene px (y down). */
const FLOOR_Y = 400;

export interface FallingObject {
	shape: (typeof SHAPES)[number];
	/** Radius, or half the edge of a box, px. */
	size: number;
	color: string;
	position: [number, number, number];
	/** Euler degrees. */
	rotation: [number, number, number];
	/** px/s. */
	velocity: [number, number, number];
	restitution: number;
}

export interface CameraParams {
	name: string;
	eye: [number, number, number];
	target: [number, number, number];
}

export interface FallingParams {
	objects: FallingObject[];
	light: [number, number, number];
	cameras: CameraParams[];
}

function objectParams(r: ReturnType<typeof random>): FallingObject {
	return {
		shape: r.pick(SHAPES),
		size: Math.round(r.range(25, 55)),
		color: r.pick(COLORS),
		position: [
			Math.round(r.range(180, 460)),
			Math.round(r.range(-150, 200)),
			Math.round(r.range(-120, 120)),
		],
		rotation: [
			Math.round(r.range(0, 360)),
			Math.round(r.range(0, 360)),
			Math.round(r.range(0, 360)),
		],
		velocity: [
			Math.round(r.range(-150, 150)),
			Math.round(r.range(-100, 50)),
			Math.round(r.range(-150, 150)),
		],
		restitution: Math.round(r.range(0.1, 0.6) * 100) / 100,
	};
}

/** A camera on a circle around the drop zone, `angle` degrees from front. */
function orbitCamera(
	name: string,
	angle: number,
	height: number,
): CameraParams {
	const a = (angle * Math.PI) / 180;
	return {
		name,
		eye: [
			Math.round(320 + Math.sin(a) * 900),
			Math.round(height),
			Math.round(-Math.cos(a) * 900),
		],
		target: [320, 300, 0],
	};
}

export function fallingParams(seed: number, views: number[]): FallingParams {
	const r = random(seed);
	const count = r.int(3, 7);
	const objects = Array.from({ length: count }, () => objectParams(r));
	const light: [number, number, number] = [
		Math.round(r.range(-600, 600)),
		Math.round(r.range(-700, -300)),
		Math.round(r.range(-700, -200)),
	];
	const height = r.range(0, 200);
	const base = r.range(-25, 25);
	const names = ["left", "front", "right"];
	const cameras = views.map((offset, i) =>
		orbitCamera(views.length === 1 ? "front" : names[i], base + offset, height),
	);
	return { objects, light, cameras };
}

function solid(o: FallingObject, id: string): LayoutNode {
	const base = {
		id,
		label: o.shape,
		color: o.color,
		x: o.position[0],
		y: o.position[1],
		z: o.position[2],
		rotateX: o.rotation[0],
		rotateY: o.rotation[1],
		rotateZ: o.rotation[2],
	};
	switch (o.shape) {
		case "box":
			return Layer3D.roundedBox({
				...base,
				width: o.size * 2,
				height: o.size * 2,
				depth: o.size * 2,
			}) as LayoutNode;
		case "sphere":
			return Layer3D.sphere({ ...base, radius: o.size }) as LayoutNode;
		case "cylinder":
			return Layer3D.cylinder({
				...base,
				radius: o.size,
				height: o.size * 2,
			}) as LayoutNode;
		case "capsule":
			return Layer3D.capsule({
				...base,
				radius: o.size * 0.6,
				length: o.size * 1.6,
			}) as LayoutNode;
	}
}

/** Every body's state at a frame, the contacts that began in it, and interventions. */
function physicsAt(
	world: PhysicsWorld3D,
	bodies: PhysicsBody3D[],
	fps: number,
	frame: number,
) {
	const ctx = { frame, fps } as never;
	const read = (s: { get(c: never): unknown }) => s.get(ctx) as number;
	return {
		interventions: world.interventions,
		bodies: bodies.map((b) => ({
			layer: (b.layer as { id?: string } | undefined)?.id,
			position: [read(b.x), read(b.y), read(b.z)],
			rotation: [read(b.rotateX), read(b.rotateY), read(b.rotateZ)],
			velocity: [read(b.vx), read(b.vy), read(b.vz)],
		})),
		contacts: bodies.flatMap((b) =>
			b.collisions
				.filter((c) => c.frame === frame)
				.map((c) => ({
					a: (b.layer as { id?: string } | undefined)?.id,
					b: (c.with.layer as { id?: string } | undefined)?.id ?? "floor",
					speed: c.speed,
				})),
		),
	};
}

export interface FallingViewOptions {
	/** The view's name (default: the camera's). */
	name?: string;
	/** Simulation frames whose state to keep, to branch from. */
	keepStates?: number[];
	/** Continue from this state of the same scene's run. */
	from?: PhysicsState;
	/** Interventions to plan on the world before it simulates. */
	intervene?: (world: PhysicsWorld3D, bodies: PhysicsBody3D[]) => void;
}

/** The falling scene from one camera, and its world (for states and labels). */
export async function fallingView(
	params: FallingParams,
	camera: CameraParams,
	env: { fps: number; frames: number; width: number; height: number },
	options: FallingViewOptions = {},
): Promise<EnvView & { world: PhysicsWorld3D }> {
	const c = new Composition({
		width: env.width,
		height: env.height,
		fps: env.fps,
		durationFrames: env.frames,
		backgroundColor: "#0e1116",
	});
	const solids = params.objects.map((o, i) => solid(o, `obj${i}`));
	c.add([
		Layer.camera({
			x: camera.eye[0],
			y: camera.eye[1],
			z: camera.eye[2],
			targetX: camera.target[0],
			targetY: camera.target[1],
			targetZ: camera.target[2],
		}),
		Layer.ambientLight("#ffffff", 0.35),
		Layer.directionalLight({
			x: params.light[0],
			y: params.light[1],
			z: params.light[2],
			targetX: 320,
			targetY: FLOOR_Y,
			targetZ: 0,
			intensity: 0.9,
			castShadow: true,
		}),
		Layer3D.roundedBox({
			id: "floor",
			label: "floor",
			width: 3000,
			height: 20,
			depth: 3000,
			x: 320,
			y: FLOOR_Y + 10,
			z: 0,
			color: "#8a8f98",
		}) as LayoutNode,
		...solids,
	]);
	const world = await Physics.world3d({
		fps: env.fps,
		frames: env.frames,
		keepStates: options.keepStates,
		from: options.from,
	});
	world.ground({ y: FLOOR_Y });
	const bodies = params.objects.map((o, i) =>
		world.body(solids[i], {
			restitution: o.restitution,
			velocity: o.velocity,
		}),
	);
	options.intervene?.(world, bodies);
	world.simulate();
	return {
		name: options.name ?? camera.name,
		composition: c,
		world,
		physics: (frame) => physicsAt(world, bodies, env.fps, frame),
	};
}

/** The falling envs' clip: 2 s at 24 fps, 640×480. */
export const FALLING_CLIP = { fps: 24, frames: 48, width: 640, height: 480 };

function fallingEnv(
	name: string,
	description: string,
	views: number[],
): Env<FallingParams> {
	const env = FALLING_CLIP;
	return {
		name,
		description,
		...env,
		params: (seed) => fallingParams(seed, views),
		build: (params) =>
			Promise.all(params.cameras.map((cam) => fallingView(params, cam, env))),
	};
}

export const falling = fallingEnv(
	"falling",
	"3 to 7 solids (box, sphere, cylinder, capsule) of random size, color and spin dropped onto a floor; one camera.",
	[0],
);

export const fallingMultiView = fallingEnv(
	"falling-multiview",
	"The falling scene seen from three cameras 50 degrees apart, rendered from one shared simulation.",
	[-50, 0, 50],
);
