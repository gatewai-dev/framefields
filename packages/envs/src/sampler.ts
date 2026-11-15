/**
 * The scenario sampler: a spec of distributions (how many objects, which
 * shapes, surfaces, textures, lighting, cameras, motion) and a seed draw
 * plain-JSON scene parameters; the parameters build the scene. `scenario`
 * makes an `Env` of a spec, so a new randomized environment is a few lines:
 *
 * ```ts
 * export const marbles = scenario({
 *   name: "marbles",
 *   description: "Glass and metal spheres dropped on a checker floor.",
 *   objects: { count: [4, 9], shapes: "sphere", surfaces: ["glass", "metal"] },
 *   floor: { patterns: "checker" },
 * });
 * ```
 *
 * Every draw comes from the seed, in a fixed order, so a seed builds the
 * same scene on every machine; the parameters are written into each
 * sample's json, so a scene can be rebuilt from its sample alone.
 */
import {
	Composition,
	Layer,
	Layer3D,
	type LayoutNode,
	Lighting,
	Physics,
	type PhysicsBody3D,
	type PhysicsWorld3D,
} from "framefields";
import type { Env, EnvView } from "framefields/datasets";
import { type Random, random } from "framefields/datasets";

// ---------------------------------------------------------------------------
// Distributions.
// ---------------------------------------------------------------------------

/** A fixed value, or `[min, max]` drawn uniformly. */
export type Range = number | readonly [number, number];
/** A fixed value, or a list drawn from uniformly. */
export type Choice<T> = T | readonly T[];

function draw(r: Random, range: Range): number {
	return typeof range === "number" ? range : r.range(range[0], range[1]);
}

function drawInt(r: Random, range: Range): number {
	return typeof range === "number"
		? Math.round(range)
		: r.int(Math.ceil(range[0]), Math.floor(range[1]));
}

function choose<T>(r: Random, choice: Choice<T>): T {
	return Array.isArray(choice) ? r.pick(choice as readonly T[]) : (choice as T);
}

/** Rounded to `digits` decimals, so params stay short and exact in JSON. */
const round = (v: number, digits = 0) => {
	const k = 10 ** digits;
	return Math.round(v * k) / k;
};

// ---------------------------------------------------------------------------
// The spec.
// ---------------------------------------------------------------------------

export const SHAPES = [
	"box",
	"sphere",
	"cylinder",
	"capsule",
	"torus",
] as const;
export type Shape = (typeof SHAPES)[number];
export const SURFACES = ["matte", "plastic", "metal", "glass"] as const;
export type Surface = (typeof SURFACES)[number];
export const PATTERNS = ["checker", "stripes", "dots", "noise"] as const;
export type Pattern = (typeof PATTERNS)[number];
export const RIGS = ["studio", "soft", "sunset", "dramatic"] as const;
export type Rig = (typeof RIGS)[number];

const PALETTE = [
	"#e6194b",
	"#3cb44b",
	"#ffe119",
	"#4363d8",
	"#f58231",
	"#911eb4",
	"#42d4f4",
	"#f032e6",
	"#fabed4",
	"#469990",
	"#dcbeff",
	"#9a6324",
	"#fffac8",
	"#800000",
	"#aaffc3",
	"#e8e8e8",
] as const;

const FLOOR_COLORS = ["#8a8f98", "#5b5f66", "#c9c2b8", "#3a4048", "#a7b0a0"];

export interface ScenarioSpec {
	/** Letters, digits, `-`. */
	name: string;
	description: string;
	/** Default 24 fps, 48 frames, 640×480. */
	clip?: { fps?: number; frames?: number; width?: number; height?: number };
	objects?: {
		/** Default [3, 7]. */
		count?: Range;
		/** Default every shape. */
		shapes?: Choice<Shape>;
		/** Radius, or half a box's edge, px. Default [25, 55]. */
		size?: Range;
		/** Default every surface. */
		surfaces?: Choice<Surface>;
		/** Default a 16-color palette. */
		colors?: Choice<string>;
		/** Chance an object wears a pattern texture, 0..1. Default 0.4. */
		textured?: number;
		/** Default every pattern. */
		patterns?: Choice<Pattern>;
		/** Radius of the area objects start in, px. Default 220. */
		spread?: number;
	};
	floor?: {
		colors?: Choice<string>;
		/** Chance the floor wears a pattern, 0..1. Default 0.5. */
		textured?: number;
		patterns?: Choice<Pattern>;
	};
	lighting?: {
		/** `Lighting` rigs. Default every rig. */
		rigs?: Choice<Rig>;
		/** Rig turn about the vertical, degrees. Default [0, 360]. */
		rotation?: Range;
		/** Default [0.7, 1.3]. */
		intensity?: Range;
		/** Stops. Default [-0.5, 0.5]. */
		exposure?: Range;
	};
	cameras?: {
		/** Views rendered from the one scene. Default 1. */
		views?: number;
		/** Degrees between neighboring views. Default 50. */
		apart?: number;
		/** From the scene's center, px. Default [650, 950]. */
		distance?: Range;
		/** Degrees above the floor. Default [8, 35]. */
		elevation?: Range;
		/** Degrees around, 0 is the front (scene -z). Default [-30, 30]. */
		azimuth?: Range;
		/** Vertical field of view, degrees. Default [35, 55]. */
		fov?: Range;
	};
	/**
	 * `drop`: objects fall from above with spin and settle (Steel).
	 * `still`: they rest on the floor, upright, and nothing moves.
	 * Default `drop`.
	 */
	motion?: Choice<"drop" | "still">;
}

// ---------------------------------------------------------------------------
// Parameters: what a seed draws (plain JSON).
// ---------------------------------------------------------------------------

export interface PatternParams {
	kind: Pattern;
	colors: [string, string];
	/** Repeats across the texture. */
	scale: number;
	/** Stripes: degrees. */
	angle: number;
}

export interface ScenarioObject {
	shape: Shape;
	/** Radius, or half a box's edge, px. */
	size: number;
	color: string;
	surface: Surface;
	roughness: number;
	pattern?: PatternParams;
	position: [number, number, number];
	/** Euler degrees. */
	rotation: [number, number, number];
	/** px/s (drop). */
	velocity: [number, number, number];
	restitution: number;
}

export interface ScenarioCamera {
	name: string;
	eye: [number, number, number];
	target: [number, number, number];
	fov: number;
}

export interface ScenarioParams {
	motion: "drop" | "still";
	objects: ScenarioObject[];
	floor: { color: string; pattern?: PatternParams };
	lighting: { rig: Rig; rotation: number; intensity: number; exposure: number };
	cameras: ScenarioCamera[];
}

/** The floor's top, scene px (y down); the scene centers on x = z = 0. */
const FLOOR_Y = 400;

function patternParams(r: Random, patterns: Choice<Pattern>, base: string) {
	const kind = choose(r, patterns);
	return {
		kind,
		colors: [base, r.pick(PALETTE.filter((c) => c !== base))] as [
			string,
			string,
		],
		scale: drawInt(r, kind === "noise" ? [3, 8] : [3, 10]),
		angle: Math.round(r.range(0, 180)),
	};
}

/** Half its height resting upright, and the radius of its footprint, px. */
function restingExtent(shape: Shape, size: number): [number, number] {
	switch (shape) {
		case "box":
			return [size, size * Math.SQRT2];
		case "sphere":
		case "cylinder":
			return [size, size];
		case "capsule":
			return [size * 1.4, size * 0.6];
		case "torus":
			return [size * 0.35, size * 1.35];
	}
}

/**
 * Upright rest poses inside the spread, footprints apart; an object that
 * finds no room in 50 tries is dropped from the scene.
 */
function placeStill(r: Random, objects: ScenarioObject[], spread: number) {
	const placed: Array<{ o: ScenarioObject; x: number; z: number; f: number }> =
		[];
	for (const o of objects) {
		const [half, footprint] = restingExtent(o.shape, o.size);
		for (let k = 0; k < 50; k++) {
			const a = r.range(0, Math.PI * 2);
			const d = Math.sqrt(r.next()) * spread;
			const x = Math.cos(a) * d;
			const z = Math.sin(a) * d;
			if (
				placed.some((p) => Math.hypot(p.x - x, p.z - z) < p.f + footprint + 4)
			)
				continue;
			o.position = [Math.round(x), FLOOR_Y - half, Math.round(z)];
			// Upright, turned about the vertical only (a torus lies flat).
			o.rotation = [
				o.shape === "torus" ? 90 : 0,
				Math.round(r.range(0, 360)),
				0,
			];
			o.velocity = [0, 0, 0];
			placed.push({ o, x, z, f: footprint });
			break;
		}
	}
	return placed.map((p) => p.o);
}

/** Draws a scene from the spec. */
export function sampleScenario(
	spec: ScenarioSpec,
	seed: number,
): ScenarioParams {
	const r = random(seed);
	const os = spec.objects ?? {};
	const motion = choose(r, spec.motion ?? "drop");
	const spread = os.spread ?? 220;
	const count = drawInt(r, os.count ?? [3, 7]);
	let objects: ScenarioObject[] = Array.from({ length: count }, () => {
		const color = choose(r, os.colors ?? PALETTE);
		const surface = choose(r, os.surfaces ?? SURFACES);
		const textured = surface !== "glass" && r.next() < (os.textured ?? 0.4);
		const a = r.range(0, Math.PI * 2);
		const d = Math.sqrt(r.next()) * spread;
		return {
			shape: choose(r, os.shapes ?? SHAPES),
			size: Math.round(draw(r, os.size ?? [25, 55])),
			color,
			surface,
			roughness: round(
				surface === "metal"
					? r.range(0.15, 0.5)
					: surface === "plastic"
						? r.range(0.2, 0.45)
						: r.range(0.6, 0.95),
				2,
			),
			...(textured && {
				pattern: patternParams(r, os.patterns ?? PATTERNS, color),
			}),
			position: [
				Math.round(Math.cos(a) * d),
				Math.round(r.range(-150, 200)),
				Math.round(Math.sin(a) * d),
			] as [number, number, number],
			rotation: [
				Math.round(r.range(0, 360)),
				Math.round(r.range(0, 360)),
				Math.round(r.range(0, 360)),
			] as [number, number, number],
			velocity: [
				Math.round(r.range(-150, 150)),
				Math.round(r.range(-100, 50)),
				Math.round(r.range(-150, 150)),
			] as [number, number, number],
			restitution: round(r.range(0.1, 0.6), 2),
		};
	});
	if (motion === "still") objects = placeStill(r, objects, spread);

	const fs = spec.floor ?? {};
	const floorColor = choose(r, fs.colors ?? FLOOR_COLORS);
	const floor = {
		color: floorColor,
		...(r.next() < (fs.textured ?? 0.5) && {
			pattern: patternParams(r, fs.patterns ?? PATTERNS, floorColor),
		}),
	};

	const ls = spec.lighting ?? {};
	const lighting = {
		rig: choose(r, ls.rigs ?? RIGS),
		rotation: Math.round(draw(r, ls.rotation ?? [0, 360])),
		intensity: round(draw(r, ls.intensity ?? [0.7, 1.3]), 2),
		exposure: round(draw(r, ls.exposure ?? [-0.5, 0.5]), 2),
	};

	const cs = spec.cameras ?? {};
	const views = cs.views ?? 1;
	const apart = cs.apart ?? 50;
	const distance = draw(r, cs.distance ?? [650, 950]);
	const elevation = draw(r, cs.elevation ?? [8, 35]);
	const azimuth = draw(r, cs.azimuth ?? [-30, 30]);
	const fov = round(draw(r, cs.fov ?? [35, 55]), 1);
	const target: [number, number, number] = [0, FLOOR_Y - 60, 0];
	const cameras = Array.from({ length: views }, (_, i) => {
		const az = ((azimuth + (i - (views - 1) / 2) * apart) * Math.PI) / 180;
		const el = (elevation * Math.PI) / 180;
		return {
			name: views === 1 ? "front" : `view${i}`,
			eye: [
				Math.round(Math.sin(az) * Math.cos(el) * distance),
				Math.round(target[1] - Math.sin(el) * distance),
				Math.round(-Math.cos(az) * Math.cos(el) * distance),
			] as [number, number, number],
			target,
			fov,
		};
	});
	return { motion, objects, floor, lighting, cameras };
}

// ---------------------------------------------------------------------------
// Building a scene from its parameters.
// ---------------------------------------------------------------------------

function wgslColor(hex: string): string {
	const v = Number.parseInt(hex.slice(1), 16);
	const c = (s: number) => ((v >> s) & 255) / 255;
	return `vec3<f32>(${c(16).toFixed(4)}, ${c(8).toFixed(4)}, ${c(0).toFixed(4)})`;
}

/** The WGSL of a pattern: 0 or 1 (or between, for noise) per uv. */
function patternMask(p: PatternParams): string {
	const s = p.scale.toFixed(1);
	switch (p.kind) {
		case "checker":
			return `let c = floor(uv * ${s}); return fract((c.x + c.y) * 0.5) * 2.0;`;
		case "stripes": {
			const a = (p.angle * Math.PI) / 180;
			return `let t = dot(uv, vec2<f32>(${Math.cos(a).toFixed(4)}, ${Math.sin(a).toFixed(4)})); return step(0.5, fract(t * ${s}));`;
		}
		case "dots":
			return `return 1.0 - step(0.3, length(fract(uv * ${s}) - vec2<f32>(0.5)));`;
		case "noise":
			return `let p = uv * ${s};
	let i = floor(p);
	let f = fract(p);
	let w = f * f * (3.0 - 2.0 * f);
	let a = hash(i);
	let b = hash(i + vec2<f32>(1.0, 0.0));
	let c = hash(i + vec2<f32>(0.0, 1.0));
	let d = hash(i + vec2<f32>(1.0, 1.0));
	return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);`;
	}
}

/** A pattern as a shader layer, used as a surface's texture. */
export function patternLayer(
	p: PatternParams,
	size: { width: number; height: number },
): LayoutNode {
	return Layer.shader({
		width: size.width,
		height: size.height,
		fragment: `fn hash(p : vec2<f32>) -> f32 {
	return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn mask(uv : vec2<f32>) -> f32 {
	${patternMask(p)}
}
fn shade(uv : vec2<f32>) -> vec4<f32> {
	return vec4<f32>(mix(${wgslColor(p.colors[0])}, ${wgslColor(p.colors[1])}, mask(uv)), 1.0);
}`,
	}) as unknown as LayoutNode;
}

function surfaceProps(o: ScenarioObject) {
	switch (o.surface) {
		case "metal":
			return {
				material: "metallic" as const,
				metallic: 1,
				roughness: o.roughness,
			};
		case "glass":
			return { material: "glass" as const, ior: 1.5, roughness: 0.05 };
		default:
			return { roughness: o.roughness };
	}
}

function solid(
	o: ScenarioObject,
	id: string,
	size: { width: number; height: number },
): LayoutNode {
	const base = {
		id,
		label: o.shape,
		color: o.pattern ? "#ffffff" : o.color,
		...surfaceProps(o),
		...(o.pattern && { texture: patternLayer(o.pattern, size) }),
		x: o.position[0],
		y: o.position[1],
		z: o.position[2],
		rotateX: o.rotation[0],
		rotateY: o.rotation[1],
		rotateZ: o.rotation[2],
	};
	const s = o.size;
	switch (o.shape) {
		case "box":
			return Layer3D.roundedBox({
				...base,
				width: s * 2,
				height: s * 2,
				depth: s * 2,
				radius: s * 0.08,
			}) as LayoutNode;
		case "sphere":
			return Layer3D.sphere({ ...base, radius: s }) as LayoutNode;
		case "cylinder":
			return Layer3D.cylinder({
				...base,
				radius: s,
				height: s * 2,
			}) as LayoutNode;
		case "capsule":
			return Layer3D.capsule({
				...base,
				radius: s * 0.6,
				length: s * 1.6,
			}) as LayoutNode;
		case "torus":
			return Layer3D.torus({
				...base,
				radius: s,
				tube: s * 0.35,
			}) as LayoutNode;
	}
}

/** Every body's state at a frame and the contacts that began in it. */
function physicsAt(bodies: PhysicsBody3D[], fps: number, frame: number) {
	const ctx = { frame, fps } as never;
	const read = (s: { get(c: never): unknown }) => s.get(ctx) as number;
	const id = (b: PhysicsBody3D) => (b.layer as { id?: string } | undefined)?.id;
	return {
		bodies: bodies.map((b) => ({
			layer: id(b),
			position: [read(b.x), read(b.y), read(b.z)],
			rotation: [read(b.rotateX), read(b.rotateY), read(b.rotateZ)],
			velocity: [read(b.vx), read(b.vy), read(b.vz)],
		})),
		contacts: bodies.flatMap((b) =>
			b.collisions
				.filter((c) => c.frame === frame)
				.map((c) => ({
					a: id(b),
					b: (c.with.layer as { id?: string } | undefined)?.id ?? "floor",
					speed: c.speed,
				})),
		),
	};
}

export interface ScenarioClip {
	fps: number;
	frames: number;
	width: number;
	height: number;
}

/** The scene from one camera, and its world when objects drop. */
export async function scenarioView(
	params: ScenarioParams,
	camera: ScenarioCamera,
	clip: ScenarioClip,
): Promise<EnvView & { world?: PhysicsWorld3D }> {
	const c = new Composition({
		width: clip.width,
		height: clip.height,
		fps: clip.fps,
		durationFrames: clip.frames,
		backgroundColor: "#0e1116",
	});
	const solids = params.objects.map((o, i) => solid(o, `obj${i}`, clip));
	const { floor, lighting } = params;
	c.add([
		Layer.camera({
			x: camera.eye[0],
			y: camera.eye[1],
			z: camera.eye[2],
			targetX: camera.target[0],
			targetY: camera.target[1],
			targetZ: camera.target[2],
			fov: camera.fov,
		}),
		...(Lighting[lighting.rig]({
			target: [0, FLOOR_Y, 0],
			rotation: lighting.rotation,
			intensity: lighting.intensity,
			exposure: lighting.exposure,
		}) as unknown as LayoutNode[]),
		Layer3D.roundedBox({
			id: "floor",
			label: "floor",
			width: 3000,
			height: 20,
			depth: 3000,
			x: 0,
			y: FLOOR_Y + 10,
			z: 0,
			roughness: 0.85,
			color: floor.pattern ? "#ffffff" : floor.color,
			...(floor.pattern && {
				texture: patternLayer(
					{ ...floor.pattern, scale: floor.pattern.scale * 4 },
					clip,
				),
			}),
		}) as LayoutNode,
		...solids,
	]);
	const view = { name: camera.name, composition: c };
	if (params.motion === "still") return view;
	const world = await Physics.world3d({ fps: clip.fps, frames: clip.frames });
	world.ground({ y: FLOOR_Y });
	const bodies = params.objects.map((o, i) =>
		world.body(solids[i], { restitution: o.restitution, velocity: o.velocity }),
	);
	await world.simulate();
	return {
		...view,
		world,
		physics: (frame) => physicsAt(bodies, clip.fps, frame),
	};
}

/** An environment of a spec: seeds draw scenes, every camera is a view. */
export function scenario(spec: ScenarioSpec): Env<ScenarioParams> {
	const clip: ScenarioClip = {
		fps: spec.clip?.fps ?? 24,
		frames: spec.clip?.frames ?? 48,
		width: spec.clip?.width ?? 640,
		height: spec.clip?.height ?? 480,
	};
	return {
		name: spec.name,
		description: spec.description,
		...clip,
		params: (seed) => sampleScenario(spec, seed),
		build: (params) =>
			Promise.all(params.cameras.map((cam) => scenarioView(params, cam, clip))),
	};
}
