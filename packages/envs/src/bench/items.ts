/**
 * The benchmark's items: each task turns a seed into a few questions, each
 * with its images, its prompt and the truth it is scored against. Seeds,
 * frames and prompts are fixed here, so a release is rebuilt byte for byte
 * from the code (`pnpm bench build`).
 *
 * - `violation`: 16 frames of a falling-objects clip; did something
 *   physically impossible happen, when, and to which object?
 * - `predict`: the first second of a fall (frames and positions); where is
 *   every object in the second half?
 * - `recreate`: one frame of a randomized scene; answer it as a framefields
 *   program, rendered and compared by object masks.
 * - `spatial`: one frame of a still scene; how many objects, which is
 *   closest to the camera, which is leftmost?
 */
import { HeadlessMediaRenderer, truthLabels } from "framefields";
import type { EnvView, Pose } from "framefields/datasets";
import sharp from "sharp";
import { falling } from "../envs/falling.js";
import { scenes } from "../envs/scenes.js";
import { fallingViolation, type ViolationKind } from "../envs/violation.js";
import { type ScenarioParams, scenario } from "../sampler.js";
import { truthPoses } from "../tasks/predict.js";
import { RECREATE_PROGRAM_PROMPT } from "../tasks/recreate-program.js";
import type { BenchItem, TaskName } from "./data.js";

/** An item and its images' PNG bytes, by file name. */
export interface BuiltItems {
	items: BenchItem[];
	images: Map<string, Uint8Array>;
}

/** The colors the envs draw from, by name. */
const COLOR_NAMES: Record<string, string> = {
	"#e6194b": "red",
	"#3cb44b": "green",
	"#ffe119": "yellow",
	"#4363d8": "blue",
	"#f58231": "orange",
	"#911eb4": "purple",
	"#42d4f4": "cyan",
	"#f032e6": "magenta",
	"#9a6324": "brown",
	"#e8e8e8": "white",
};

const SHAPE_NAMES: Record<string, string> = {
	box: "cube",
	sphere: "sphere",
	cylinder: "cylinder",
	capsule: "capsule",
	torus: "ring",
};

const describe = (o: { color: string; shape: string }) =>
	`${COLOR_NAMES[o.color] ?? o.color} ${SHAPE_NAMES[o.shape] ?? o.shape}`;

const renderer = new HeadlessMediaRenderer();

/** A frame of a view as PNG, at `scale` of its size. */
async function frame(view: EnvView, f: number, scale = 1): Promise<Uint8Array> {
	const png = await view.composition.renderFrame({
		frame: f,
		format: "png",
		renderer,
	});
	if (scale === 1) return new Uint8Array(png);
	const { width, height } = view.composition;
	return new Uint8Array(
		await sharp(png)
			.resize(Math.round(width * scale), Math.round(height * scale))
			.png()
			.toBuffer(),
	);
}

const SCENE_AXES = `Coordinates are scene pixels: x to the right, y DOWN (the floor's top is y = 400), z away from the front camera.`;

// ---------------------------------------------------------------------------
// violation
// ---------------------------------------------------------------------------

const VIOLATION_FRAMES = Array.from({ length: 16 }, (_, k) => k * 3);

export interface ViolationTruth {
	violation: boolean;
	frame?: number;
	object?: string;
	kind?: ViolationKind;
}

async function violationItems(seed: number): Promise<BuiltItems> {
	const params = fallingViolation.params(seed);
	const views = await fallingViolation.build(params);
	const objects = params.objects
		.map((o, i) => `obj${i}: ${describe(o)}`)
		.join("\n");
	const prompt = `These are 16 frames of a 2-second clip (24 fps), in order: frames ${VIOLATION_FRAMES.join(", ")}.
Solid objects fall onto a floor under gravity. The objects:
${objects}

Does anything physically impossible happen (an object jumps to another place, disappears, sinks through the floor, or everything starts falling upward)?
Answer with only a JSON object:
{"violation": true or false,
 "frame": the first shown frame where it is visible (when true),
 "object": "obj<index>" it happens to (when true; omit when everything is affected),
 "kind": "teleport" | "vanish" | "passThrough" | "antigravity" (when true)}`;
	const { violation } = params;
	const out: BuiltItems = { items: [], images: new Map() };
	for (const view of views) {
		const id = `violation-${seed}-${view.name}`;
		const images: string[] = [];
		for (const f of VIOLATION_FRAMES) {
			const file = `images/${id}-${String(f).padStart(2, "0")}.png`;
			out.images.set(file, await frame(view, f, 0.5));
			images.push(file);
		}
		const truth: ViolationTruth =
			view.name === "violated"
				? {
						violation: true,
						frame: violation.frame,
						kind: violation.kind,
						...(violation.kind !== "antigravity" && {
							object: `obj${violation.object}`,
						}),
					}
				: { violation: false };
		out.items.push({
			id,
			task: "violation",
			seed,
			prompt,
			images,
			inputs: {
				frames: VIOLATION_FRAMES,
				objects: params.objects.map((o, i) => ({
					name: `obj${i}`,
					shape: o.shape,
					color: COLOR_NAMES[o.color] ?? o.color,
				})),
			},
			truth,
		});
	}
	return out;
}

// ---------------------------------------------------------------------------
// predict
// ---------------------------------------------------------------------------

const PREDICT_CONTEXT = [0, 4, 8, 12, 16, 20, 23];
const PREDICT_KNOWN = [0, 12, 23];
export const PREDICT_HORIZON = [29, 35, 41, 47];

export interface PredictTruth {
	/** Per horizon frame, every object's pose. */
	poses: Record<string, Record<string, Pose>>;
	tolerance: number;
}

const fmt = (v: readonly number[]) =>
	`[${v.map((x) => Math.round(x)).join(", ")}]`;

async function predictItems(seed: number): Promise<BuiltItems> {
	const params = falling.params(seed);
	const [view] = await falling.build(params);
	const id = `predict-${seed}`;
	const out: BuiltItems = { items: [], images: new Map() };
	const images: string[] = [];
	for (const f of PREDICT_CONTEXT) {
		const file = `images/${id}-${String(f).padStart(2, "0")}.png`;
		out.images.set(file, await frame(view, f, 0.5));
		images.push(file);
	}
	const known = PREDICT_KNOWN.map((f) => [f, truthPoses(view, f)] as const);
	const objects = params.objects
		.map((o, i) => {
			const name = `obj${i}`;
			const at = known
				.map(([f, poses]) => `frame ${f} ${fmt(poses[name].position)}`)
				.join(", ");
			return `${name}: ${describe(o)}, size ${o.size} px (radius or half edge), restitution ${o.restitution}; center at ${at}`;
		})
		.join("\n");
	const [camera] = params.cameras;
	const prompt = `These are frames ${PREDICT_CONTEXT.join(", ")} of a clip (24 fps, 48 frames, rendered at 640x480, shown at half size).
Solid objects fall onto a floor and collide (rigid-body physics, gravity 2400 px/s² pulling toward +y).
${SCENE_AXES}
The camera is at ${fmt(camera.eye)} looking at ${fmt(camera.target)} (vertical field of view 50°).
The objects and their measured centers:
${objects}

Predict the center of every object at frames ${PREDICT_HORIZON.join(", ")}.
Answer with only a JSON object:
{"frames": {"29": {"obj0": {"position": [x, y, z]}, …}, "35": {…}, "41": {…}, "47": {…}}}`;
	const poses = Object.fromEntries(
		PREDICT_HORIZON.map((f) => [
			String(f),
			Object.fromEntries(
				Object.entries(truthPoses(view, f)).map(([name, pose]) => [
					name,
					{
						position: pose.position.map((v) => Math.round(v * 100) / 100),
						...(pose.rotation && {
							rotation: pose.rotation.map((v) => Math.round(v * 100) / 100),
						}),
					},
				]),
			),
		]),
	);
	const truth: PredictTruth = { poses, tolerance: 25 };
	const inputs = {
		frames: PREDICT_CONTEXT,
		horizon: PREDICT_HORIZON,
		camera: { eye: camera.eye, target: camera.target, fov: 50 },
		gravity: [0, 2400, 0],
		floorY: 400,
		objects: params.objects.map((o, i) => ({
			name: `obj${i}`,
			shape: o.shape,
			color: COLOR_NAMES[o.color] ?? o.color,
			size: o.size,
			restitution: o.restitution,
			positions: Object.fromEntries(
				known.map(([f, poses]) => [
					String(f),
					poses[`obj${i}`].position.map((v) => Math.round(v)),
				]),
			),
		})),
	};
	out.items.push({ id, task: "predict", seed, prompt, images, inputs, truth });
	return out;
}

// ---------------------------------------------------------------------------
// recreate
// ---------------------------------------------------------------------------

/** The frame of a `scenes` clip to recreate: the last, once things settle. */
export const RECREATE_FRAME = 47;

export interface RecreateTruth {
	env: "scenes";
	seed: number;
	frame: number;
}

async function recreateItems(seed: number): Promise<BuiltItems> {
	const params = scenes.params(seed);
	const [view] = await scenes.build(params);
	const id = `recreate-${seed}`;
	const file = `images/${id}.png`;
	// Without its id: auto ids count layers made in the process, not the scene.
	const { id: _, ...camera } =
		view.composition.toSpec().layout.find((n) => n.kind === "camera") ?? {};
	const prompt = `${RECREATE_PROGRAM_PROMPT}
The image is 640x480. ${SCENE_AXES}
The camera node (given, keep it out of your answer): ${JSON.stringify(camera)}
Answer with only the JSON object.`;
	const truth: RecreateTruth = { env: "scenes", seed, frame: RECREATE_FRAME };
	return {
		items: [
			{
				id,
				task: "recreate",
				seed,
				prompt,
				images: [file],
				inputs: { frame: RECREATE_FRAME, camera },
				truth,
			},
		],
		images: new Map([[file, await frame(view, RECREATE_FRAME)]]),
	};
}

// ---------------------------------------------------------------------------
// spatial
// ---------------------------------------------------------------------------

/** Still scenes of plainly colored, nameable objects. */
export const spatialScenes = scenario({
	name: "bench-spatial",
	description:
		"3 to 8 still objects whose colors read as their names: matte or plastic, no patterns, neutral light.",
	motion: "still",
	objects: {
		count: [3, 8],
		size: [20, 60],
		colors: Object.keys(COLOR_NAMES),
		// Metal and glass, and tinted rigs, shift a color away from its name.
		surfaces: ["matte", "plastic"],
		textured: 0,
	},
	floor: { textured: 0.3 },
	lighting: { rigs: ["studio", "soft"] },
});

export const SPATIAL_QUESTIONS = [
	"count",
	"closest",
	"leftmost",
	"farther",
	"largest",
] as const;

export interface SpatialTruth {
	question: (typeof SPATIAL_QUESTIONS)[number];
	answer: number | string;
}

const LETTERS = "ABCDEFGH";

/** A visible object: enough pixels to see what it is. */
const VISIBLE = 400;
/** Below this, an object counts as hidden; between the two, a count is ambiguous. */
const HIDDEN = 30;

/** What the spatial questions need of an object: from the engine's labels. */
interface Seen {
	name: string;
	pixels: number;
	/** Center of its visible pixels, x. */
	centerX: number;
	/** Camera to the center of its geometry, px. */
	distance: number;
	/** Its bounding box's volume, px³. */
	volume: number;
}

async function spatialItems(seed: number): Promise<BuiltItems> {
	const params: ScenarioParams = spatialScenes.params(seed);
	const [view] = await spatialScenes.build(params);
	const [camera] = params.cameras;
	const truth = await view.composition.renderTruth({ frame: 0, renderer });
	const labels = truthLabels(truth.scenes[0]);
	const seen: Seen[] = params.objects.map((o, i) => {
		const l = labels.objects.find((x) => x.layer === `obj${i}`);
		const box = l?.box2d;
		const center = l?.box3d?.center ?? o.position;
		const size = l?.box3d?.size ?? [0, 0, 0];
		return {
			name: describe(o),
			pixels: l?.pixels ?? 0,
			centerX: box ? (box[0] + box[2]) / 2 : 0,
			distance: Math.hypot(
				center[0] - camera.eye[0],
				center[1] - camera.eye[1],
				center[2] - camera.eye[2],
			),
			volume: size[0] * size[1] * size[2],
		};
	});
	const id = `spatial-${seed}`;
	const file = `images/${id}.png`;
	const out: BuiltItems = {
		items: [],
		images: new Map([[file, await frame(view, 0)]]),
	};
	const ask = (
		question: SpatialTruth["question"],
		text: string,
		answer: number | string,
		options?: string[],
	) =>
		out.items.push({
			id: `${id}-${question}`,
			task: "spatial",
			seed,
			prompt: `${text}${options ? `\n${options.map((o, k) => `${LETTERS[k]}. the ${o}`).join("\n")}` : ""}\nAnswer with only a JSON object: {"answer": ${options ? '"<letter>"' : "<number>"}}`,
			images: [file],
			inputs: { question, ...(options && { options }) },
			truth: { question, answer } satisfies SpatialTruth,
		});

	if (!seen.some((s) => s.pixels > HIDDEN && s.pixels < VISIBLE))
		ask(
			"count",
			"How many objects stand on the floor in this image? (The floor itself is not an object.)",
			seen.filter((s) => s.pixels >= VISIBLE).length,
		);
	// Named questions only when every visible object has a name of its own.
	const visible = seen.filter((s) => s.pixels >= VISIBLE);
	const named = visible.every(
		(s) => visible.filter((t) => t.name === s.name).length === 1,
	);
	if (named && visible.length >= 3) spatialChoices(visible, ask);
	return out;
}

type Ask = (
	question: SpatialTruth["question"],
	text: string,
	answer: string,
	options: string[],
) => void;

/** The multiple-choice questions, each asked only when its answer is clear. */
function spatialChoices(visible: Seen[], ask: Ask): void {
	const options = visible.map((s) => s.name);
	const first = (key: (s: Seen) => number, gap: number) => {
		const order = [...visible].sort((a, b) => key(a) - key(b));
		return key(order[1]) - key(order[0]) >= gap ? order[0] : undefined;
	};
	const letter = (s: Seen) => LETTERS[visible.indexOf(s)];
	const closest = first((s) => s.distance, 40);
	if (closest)
		ask(
			"closest",
			"Which object is closest to the camera?",
			letter(closest),
			options,
		);
	const leftmost = first((s) => s.centerX, 30);
	if (leftmost)
		ask(
			"leftmost",
			"Which object appears furthest to the left in the image?",
			letter(leftmost),
			options,
		);
	// The real size, not the apparent one: 40% more volume than the next.
	const largest = first((s) => -s.volume, 0);
	const volumes = visible.map((s) => s.volume).sort((a, b) => b - a);
	if (largest && volumes[0] >= volumes[1] * 1.4)
		ask(
			"largest",
			"Which object is the largest in reality (its actual size, not how big it looks from here)?",
			letter(largest),
			options,
		);
	// Two objects nearest in depth that are still 25 px apart.
	let pair: [Seen, Seen] | undefined;
	for (const a of visible)
		for (const b of visible) {
			const gap = b.distance - a.distance;
			if (gap >= 25 && (!pair || gap < pair[1].distance - pair[0].distance))
				pair = [a, b];
		}
	if (pair) {
		const [near, far] = pair;
		// Option order by name, so the farther one is A or B by chance.
		const two = near.name < far.name ? [near, far] : [far, near];
		ask(
			"farther",
			"Which of these two objects is farther from the camera?",
			LETTERS[two.indexOf(far)],
			two.map((s) => s.name),
		);
	}
}

const BUILDERS: Record<TaskName, (seed: number) => Promise<BuiltItems>> = {
	violation: violationItems,
	predict: predictItems,
	recreate: recreateItems,
	spatial: spatialItems,
};

/** The items (and images) of one seed of a task. */
export function buildItems(task: TaskName, seed: number): Promise<BuiltItems> {
	return BUILDERS[task](seed);
}
