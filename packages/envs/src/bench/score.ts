/**
 * Scores answers to benchmark items. Every task scores 0..1 per item: a
 * missing, unparsable or invalid answer scores 0 and says why. `summarize`
 * averages per task, with the task's own measures beside the score.
 */
import { HeadlessMediaRenderer } from "framefields";
import { scenes } from "../envs/scenes.js";
import type { ViolationParams } from "../envs/violation.js";
import { scorePosesAgainst } from "../tasks/predict.js";
import { scoreRecreateProgram } from "../tasks/recreate-program.js";
import { scoreViolation } from "../tasks/violation.js";
import type { BenchItem, TaskName } from "./data.js";
import {
	type PredictTruth,
	type RecreateTruth,
	SPATIAL_QUESTIONS,
	type SpatialTruth,
	type ViolationTruth,
} from "./items.js";

export interface ItemScore {
	id: string;
	task: TaskName;
	/** 0..1. */
	score: number;
	/** The task's own measures (frame error, IoU, position error …). */
	details?: Record<string, unknown>;
	/** Why the answer scored 0 without being judged. */
	error?: string;
}

const renderer = new HeadlessMediaRenderer();

function scoreViolationItem(truth: ViolationTruth, answer: unknown) {
	const params = {
		violation: {
			kind: truth.kind ?? "teleport",
			frame: truth.frame ?? 0,
			object: Number(truth.object?.slice(3) ?? 0),
		},
	} as ViolationParams;
	const s = scoreViolation(
		params,
		truth.violation ? "violated" : "plausible",
		answer,
	);
	return { score: s.score, details: { ...s } };
}

function scorePredictItem(truth: PredictTruth, answer: unknown) {
	const s = scorePosesAgainst(truth.poses, answer, truth.tolerance);
	return { score: s.score, details: { ...s } };
}

async function scoreRecreateItem(truth: RecreateTruth, answer: unknown) {
	const [view] = await scenes.build(scenes.params(truth.seed));
	const s = await scoreRecreateProgram(view, answer, truth.frame, renderer);
	return {
		score: s.iou,
		details: {
			iou: s.iou,
			psnr: s.psnr,
			ssim: s.ssim,
			depthError: s.depthError,
			lint: s.lint.map((d) => d.code),
		},
	};
}

function scoreSpatialItem(truth: SpatialTruth, answer: unknown) {
	const given = (answer as { answer?: unknown } | null)?.answer;
	if (given === undefined) throw new Error('answer: {"answer": …}');
	const right =
		typeof truth.answer === "number"
			? Number(given) === truth.answer
			: String(given).trim().toUpperCase().replace(/\.$/, "") === truth.answer;
	return {
		score: right ? 1 : 0,
		details: { question: truth.question, expected: truth.answer, given },
	};
}

/** Scores one answer (`null`: none could be read from the reply). */
export async function scoreItem(
	item: BenchItem,
	answer: unknown,
): Promise<ItemScore> {
	const base = { id: item.id, task: item.task };
	if (answer === null || answer === undefined)
		return { ...base, score: 0, error: "no JSON answer in the reply" };
	try {
		const s =
			item.task === "violation"
				? scoreViolationItem(item.truth as ViolationTruth, answer)
				: item.task === "predict"
					? scorePredictItem(item.truth as PredictTruth, answer)
					: item.task === "recreate"
						? await scoreRecreateItem(item.truth as RecreateTruth, answer)
						: scoreSpatialItem(item.truth as SpatialTruth, answer);
		return { ...base, ...s };
	} catch (error) {
		return {
			...base,
			score: 0,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

export interface TaskSummary {
	items: number;
	/** Mean item score, 0..1: the task's headline. */
	score: number;
	/** Answers that could not be judged (no JSON, wrong format). */
	invalid: number;
	/** Task measures: detection accuracy, mean IoU, accuracy per question … */
	measures: Record<string, number>;
}

const mean = (values: number[]) =>
	values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

function measures(task: TaskName, scores: ItemScore[]): Record<string, number> {
	const valid = scores.filter((s) => !s.error);
	const num = (s: ItemScore, key: string) => Number(s.details?.[key]);
	if (task === "violation") {
		const detected = scores.map((s) => (s.details?.detected ? 1 : 0));
		const frameErrors = valid
			.map((s) => num(s, "frameError"))
			.filter(Number.isFinite);
		return {
			detectionAccuracy: mean(detected),
			...(frameErrors.length && { meanFrameError: mean(frameErrors) }),
		};
	}
	if (task === "predict")
		return {
			withinTolerance: mean(scores.map((s) => s.score)),
			meanPositionErrorPx: mean(valid.map((s) => num(s, "positionError"))),
		};
	if (task === "recreate")
		return {
			meanIou: mean(scores.map((s) => s.score)),
			meanSsimValid: mean(valid.map((s) => num(s, "ssim"))),
		};
	const by: Record<string, number> = {};
	for (const q of SPATIAL_QUESTIONS) {
		const of = scores.filter((s) => s.id.endsWith(`-${q}`));
		if (of.length) by[`${q}Accuracy`] = mean(of.map((s) => s.score));
	}
	return by;
}

/** Per-task means of item scores. */
export function summarize(
	scores: ItemScore[],
): Partial<Record<TaskName, TaskSummary>> {
	const out: Partial<Record<TaskName, TaskSummary>> = {};
	for (const task of new Set(scores.map((s) => s.task))) {
		const of = scores.filter((s) => s.task === task);
		out[task] = {
			items: of.length,
			score: mean(of.map((s) => s.score)),
			invalid: of.filter((s) => s.error).length,
			measures: measures(task, of),
		};
	}
	return out;
}
