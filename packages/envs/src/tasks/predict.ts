/**
 * Predict what happens next: shown the first frames of a clip (its context),
 * predict the rest (its horizon). World models answer with frames, scored by
 * PSNR and SSIM per horizon step; language and vision models answer with
 * where each object will be, scored against the simulation's state by
 * position and rotation error and the share of objects placed within a
 * tolerance (the score).
 */
import type { EnvView } from "../env.js";
import { type Pose, poseError, psnr, ssim } from "../metrics.js";

/** Context frames shown, and the horizon frames to predict. */
export interface PredictSplit {
	context: number[];
	horizon: number[];
}

/** The first `context` frames shown; the next `horizon` (default the rest) predicted. */
export function predictSplit(
	frames: number,
	context = Math.floor(frames / 2),
	horizon = frames - context,
): PredictSplit {
	if (context < 1 || horizon < 1 || context + horizon > frames)
		throw new Error(
			`predictSplit: ${context} context + ${horizon} horizon frames do not fit ${frames}.`,
		);
	return {
		context: Array.from({ length: context }, (_, f) => f),
		horizon: Array.from({ length: horizon }, (_, k) => context + k),
	};
}

export const PREDICT_PROMPT = `The clip shows the first frames of a scene (24 fps; objects are named
obj0, obj1, … from the scene list; positions in scene px, y down, the floor top at y = 400).
Predict where every object is at each asked frame. Answer as JSON:
{"frames": {"<frame>": {"obj<index>": {"position": [x, y, z],
  "rotation": [rx, ry, rz] degrees (optional)}}}}`;

/** The simulation's pose of every object at a frame, by layer id. */
export function truthPoses(view: EnvView, frame: number): Record<string, Pose> {
	const state = view.physics?.(frame) as
		| {
				bodies?: Array<{
					layer?: string;
					position: number[];
					rotation?: number[];
				}>;
		  }
		| undefined;
	if (!state?.bodies)
		throw new Error(`view "${view.name}" has no physics state to predict.`);
	return Object.fromEntries(
		state.bodies
			.filter((b) => b.layer !== undefined)
			.map((b) => [b.layer, { position: b.position, rotation: b.rotation }]),
	);
}

export interface PosePredictionScore {
	/** Share of (frame, object) predictions within `tolerance` px, 0..1: the score. */
	score: number;
	/** Mean position error, px (a missing prediction counts as the tolerance × 4). */
	positionError: number;
	/** Mean rotation error, degrees, over predictions that give a rotation. */
	rotationError?: number;
	/** Mean position error per horizon frame, px. */
	byFrame: Record<string, number>;
}

function parsePoses(answer: unknown): Record<string, Record<string, Pose>> {
	const frames = (answer as { frames?: unknown } | null)?.frames;
	if (typeof frames !== "object" || frames === null)
		throw new Error('answer: {"frames": {"<frame>": {...}}}');
	const out: Record<string, Record<string, Pose>> = {};
	for (const [frame, objects] of Object.entries(frames)) {
		if (typeof objects !== "object" || objects === null)
			throw new Error(`frames.${frame}: an object of obj<index> poses`);
		out[frame] = {};
		for (const [name, pose] of Object.entries(objects)) {
			const p = pose as { position?: unknown; rotation?: unknown };
			const ok = (v: unknown) =>
				Array.isArray(v) &&
				v.length === 3 &&
				v.every((n) => typeof n === "number" && Number.isFinite(n));
			if (!ok(p?.position))
				throw new Error(`frames.${frame}.${name}.position: three numbers`);
			if (p.rotation !== undefined && !ok(p.rotation))
				throw new Error(`frames.${frame}.${name}.rotation: three numbers`);
			out[frame][name] = {
				position: p.position as number[],
				...(p.rotation !== undefined && { rotation: p.rotation as number[] }),
			};
		}
	}
	return out;
}

/** Scores predicted object poses against the view's simulation on `frames`. */
export function scorePredictedPoses(
	view: EnvView,
	answer: unknown,
	frames: number[],
	tolerance = 25,
): PosePredictionScore {
	const predicted = parsePoses(answer);
	let within = 0;
	let count = 0;
	let positionSum = 0;
	let rotationSum = 0;
	let rotationCount = 0;
	const byFrame: Record<string, number> = {};
	for (const frame of frames) {
		const truth = truthPoses(view, frame);
		let frameSum = 0;
		const names = Object.keys(truth);
		for (const name of names) {
			const guess = predicted[String(frame)]?.[name];
			const e = guess
				? poseError(guess, truth[name])
				: { position: tolerance * 4 };
			if (e.position <= tolerance) within++;
			positionSum += e.position;
			frameSum += e.position;
			if (e.rotation !== undefined) {
				rotationSum += e.rotation;
				rotationCount++;
			}
			count++;
		}
		byFrame[frame] = names.length ? frameSum / names.length : 0;
	}
	return {
		score: count ? within / count : 1,
		positionError: count ? positionSum / count : 0,
		...(rotationCount && { rotationError: rotationSum / rotationCount }),
		byFrame,
	};
}

export interface FramePredictionScore {
	/** Mean SSIM over the horizon: the score. */
	ssim: number;
	psnr: number;
	/** Per horizon frame. */
	byFrame: Record<string, { psnr: number; ssim: number }>;
}

/**
 * Scores predicted RGBA frames against the true ones (same order, same
 * size), each horizon frame on its own and on average.
 */
export function scorePredictedFrames(
	truth: Array<{ frame: number; rgba: Uint8Array }>,
	predicted: Uint8Array[],
	width: number,
	height: number,
): FramePredictionScore {
	if (predicted.length !== truth.length)
		throw new Error(
			`scorePredictedFrames: ${predicted.length} predicted frames for ${truth.length} horizon frames.`,
		);
	const byFrame: FramePredictionScore["byFrame"] = {};
	let p = 0;
	let s = 0;
	truth.forEach(({ frame, rgba }, i) => {
		const e = {
			psnr: psnr(rgba, predicted[i]),
			ssim: ssim(rgba, predicted[i], width, height),
		};
		byFrame[frame] = e;
		p += e.psnr;
		s += e.ssim;
	});
	return { ssim: s / truth.length, psnr: p / truth.length, byFrame };
}
