/**
 * Recreate the scene: shown a falling-objects clip, answer the parameters
 * that make it (`FallingParams` as JSON). The answer is checked, rendered
 * from the clip's own camera and compared with the clip, frame by frame:
 * object-mask IoU (the score), RGB PSNR and SSIM, and depth error where both show an
 * object. Nothing the answer says is executed.
 */
import { HeadlessMediaRenderer } from "framefields";
import { maskAndDepth, psnr, ssim } from "framefields/datasets";
import {
	type FallingObject,
	type FallingParams,
	falling,
} from "../envs/falling.js";

const SHAPES = new Set(["box", "sphere", "cylinder", "capsule"]);

/** What a model is told about the answer format. */
export const RECREATE_PROMPT = `Recreate the scene in the clip as JSON:
{"objects": [{"shape": "box" | "sphere" | "cylinder" | "capsule",
  "size": radius or half edge in px (10-80),
  "color": "#rrggbb",
  "position": [x, y, z] px at frame 0 (y down; the floor top is y = 400),
  "rotation": [rx, ry, rz] degrees,
  "velocity": [vx, vy, vz] px/s at frame 0,
  "restitution": 0-1}],
 "light": [x, y, z] px}
The camera is given; 24 fps, 48 frames.`;

function vec3(v: unknown, what: string): [number, number, number] {
	if (
		!Array.isArray(v) ||
		v.length !== 3 ||
		!v.every((n) => typeof n === "number" && Number.isFinite(n))
	)
		throw new Error(`${what}: three finite numbers`);
	return [v[0], v[1], v[2]];
}

function objectAnswer(o: unknown, i: number): FallingObject {
	const at = `objects[${i}]`;
	if (typeof o !== "object" || o === null) throw new Error(`${at}: an object`);
	const r = o as Record<string, unknown>;
	if (typeof r.shape !== "string" || !SHAPES.has(r.shape))
		throw new Error(`${at}.shape: box, sphere, cylinder or capsule`);
	if (typeof r.size !== "number" || !(r.size >= 10 && r.size <= 80))
		throw new Error(`${at}.size: a number from 10 to 80`);
	if (typeof r.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(r.color))
		throw new Error(`${at}.color: #rrggbb`);
	const restitution = r.restitution ?? 0.3;
	if (
		typeof restitution !== "number" ||
		!(restitution >= 0 && restitution <= 1)
	)
		throw new Error(`${at}.restitution: 0 to 1`);
	return {
		shape: r.shape as FallingObject["shape"],
		size: r.size,
		color: r.color,
		position: vec3(r.position, `${at}.position`),
		rotation: vec3(r.rotation ?? [0, 0, 0], `${at}.rotation`),
		velocity: vec3(r.velocity ?? [0, 0, 0], `${at}.velocity`),
		restitution,
	};
}

/** An answer checked against the format; throws naming what is wrong. */
export function parseRecreateAnswer(
	json: unknown,
): Omit<FallingParams, "cameras"> {
	if (typeof json !== "object" || json === null)
		throw new Error("answer: an object");
	const r = json as Record<string, unknown>;
	if (
		!Array.isArray(r.objects) ||
		r.objects.length < 1 ||
		r.objects.length > 12
	)
		throw new Error("objects: 1 to 12 objects");
	return {
		objects: r.objects.map(objectAnswer),
		light: vec3(r.light ?? [-300, -500, -500], "light"),
	};
}

export interface RecreateScore {
	/** Mean IoU of the objects' masks (floor excluded), 0..1: the score. */
	iou: number;
	/** Mean RGB PSNR, dB. */
	psnr: number;
	/** Mean SSIM, -1..1. */
	ssim: number;
	/** Mean |depth difference| where both show an object, scene px. */
	depthError: number;
}

/** Scores an answer against the target scene on `frames` of the clip. */
export async function scoreRecreate(
	target: FallingParams,
	answer: unknown,
	frames: number[] = [0, 12, 24, 36, 47],
): Promise<RecreateScore> {
	const parsed = parseRecreateAnswer(answer);
	const renderer = new HeadlessMediaRenderer();
	const [targetView] = await falling.build(target);
	const [answerView] = await falling.build({
		...parsed,
		cameras: target.cameras,
	});
	const render = (view: typeof targetView, frame: number) =>
		view.composition.renderTruth({ frame, renderer });
	const sum = { iou: 0, psnr: 0, ssim: 0, depthError: 0 };
	for (const frame of frames) {
		const a = await render(targetView, frame);
		const b = await render(answerView, frame);
		const md = maskAndDepth(a.scenes[0], b.scenes[0]);
		sum.iou += md.iou;
		sum.depthError += md.depthError;
		sum.psnr += psnr(a.rgba, b.rgba);
		sum.ssim += ssim(a.rgba, b.rgba, falling.width, falling.height);
	}
	return {
		iou: sum.iou / frames.length,
		psnr: sum.psnr / frames.length,
		ssim: sum.ssim / frames.length,
		depthError: sum.depthError / frames.length,
	};
}
