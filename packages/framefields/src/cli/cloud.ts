/**
 * `framefields render <name|entry> --cloud`: renders the project on
 * api.framefields.dev and downloads the video. `name` is a render in
 * framefields.json; a module path renders without one. Prints one plain
 * line per phase, and a progress line at most every 10 seconds while
 * frames render.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import {
	CloudRenderError,
	type CloudRenderOptions,
	type CloudRenderStatus,
	renderCloud,
} from "../cloud/index.js";
import { CONFIG_FILE, findRender, readConfig } from "./config.js";

export interface CloudCliOptions {
	/** A render named in framefields.json, or a module path. Optional when framefields.json has one render. */
	entry?: string;
	export?: string;
	select?: string;
	workers?: string;
	maxWorkers?: string;
	codec?: string;
	quality?: string;
	output?: string;
	plan?: boolean;
	json?: boolean;
	/** Project folder. Default `process.cwd()`. */
	cwd?: string;
}

const PROGRESS_EVERY_MS = 10_000;

export async function runCloudRender(
	o: CloudCliOptions,
	log: (line: string) => void,
	render: (
		options: CloudRenderOptions,
	) => Promise<CloudRenderStatus> = renderCloud,
): Promise<number> {
	const cwd = o.cwd ?? process.cwd();
	const workers = parseWorkers(o.workers);
	if (workers === null) {
		log(
			`--workers must be "auto" or a positive whole number, not "${o.workers}".`,
		);
		return 2;
	}
	if (o.codec && o.codec !== "h264" && o.codec !== "vp9") {
		log(`--codec must be h264 or vp9, not "${o.codec}".`);
		return 2;
	}
	const target = pickRender(o.entry, cwd);
	if ("error" in target) {
		log(target.error);
		return 2;
	}
	const spec = target.name ? findRender(cwd, target.name) : undefined;
	const codec = (o.codec ?? spec?.codec ?? "h264") as "h264" | "vp9";
	const outputPath =
		o.output ??
		spec?.output ??
		path.join(
			"output",
			`${target.name ?? path.basename(target.entry ?? "").replace(/\.[^.]+$/, "")}.${codec === "vp9" ? "webm" : "mp4"}`,
		);
	// A plan of a one-worker render would only ever say "one worker".
	const planWorkers =
		o.plan && (workers ?? spec?.workers ?? 1) === 1 ? "auto" : workers;
	const controller = new AbortController();
	const onSigint = () => {
		log("Cancelling the cloud render…");
		controller.abort(new Error("cancelled"));
	};
	process.once("SIGINT", onSigint);
	const started = Date.now();
	const narrate = narrator(o.json ? () => {} : log, Date.now);
	try {
		const result = await render({
			cwd,
			render: target.name,
			entry: target.entry,
			export: o.export,
			select: o.select,
			workers: planWorkers,
			maxWorkers: o.maxWorkers ? Number(o.maxWorkers) : undefined,
			codec: o.codec as "h264" | "vp9" | undefined,
			quality: o.quality,
			dryRun: o.plan,
			outputPath: o.plan ? undefined : outputPath,
			signal: controller.signal,
			onProgress: narrate,
			onWarning: (m) => log(`warning: ${m}`),
			onLog: log,
		});
		if (o.json) {
			log(JSON.stringify(result));
			return 0;
		}
		if (result.status === "planned") {
			const planned = planWorkers === "auto" && spec?.workers !== "auto";
			log(
				`Render it: ${renderCommand({ ...o, entry: target.name ?? target.entry, workers: o.workers ?? (planned ? "auto" : undefined) })}`,
			);
			return 0;
		}
		const bytes = result.output?.bytes;
		log(
			`Done in ${duration((Date.now() - started) / 1000)}: ${outputPath}${bytes ? ` (${(bytes / 1e6).toFixed(1)} MB)` : ""}, ${Math.round(result.gpuSeconds)} GPU seconds, ${usd(result.costUsd)}.`,
		);
		return 0;
	} catch (err) {
		if (err instanceof CloudRenderError) {
			log(err.message);
			if (err.status && err.status.costUsd > 0)
				log(`Charged ${usd(err.status.costUsd)} for the GPU time used.`);
			if (err.code === "insufficient_credits")
				log("Top up at https://framefields.dev/dashboard/billing");
			return 1;
		}
		throw err;
	} finally {
		process.removeListener("SIGINT", onSigint);
	}
}

/** The command that renders what `--plan` just planned: the same options, without `--plan`. */
export function renderCommand(o: CloudCliOptions): string {
	const flags: [string, string | undefined][] = [
		["--export", o.export],
		["--select", o.select],
		["--workers", o.workers],
		["--max-workers", o.maxWorkers],
		["--codec", o.codec],
		["--quality", o.quality],
		["--output", o.output],
	];
	return [
		`framefields render ${o.entry ?? ""} --cloud`.replace("  ", " "),
		...flags.filter(([, v]) => v !== undefined).map(([f, v]) => `${f} ${v}`),
	].join(" ");
}

/**
 * What `framefields render [arg]` renders: a render named in framefields.json,
 * or a module path; with no argument, the project's only named render.
 */
export function pickRender(
	arg: string | undefined,
	cwd: string,
): { name?: string; entry?: string } | { error: string } {
	const renders = readConfig(cwd).config.renders ?? {};
	const names = Object.keys(renders);
	if (arg === undefined) {
		if (names.length === 1) return { name: names[0] };
		return {
			error: names.length
				? `Name the render: ${names.join(", ")}. \`framefields renders\` lists them.`
				: `Name a module, e.g. \`framefields render src/film.ts --cloud\`, or add "renders" to ${CONFIG_FILE}.`,
		};
	}
	if (renders[arg]) return { name: arg };
	if (existsSync(path.resolve(cwd, arg))) return { entry: arg };
	return {
		error: names.length
			? `"${arg}" is neither a render in ${CONFIG_FILE} (${names.join(", ")}) nor a file.`
			: `"${arg}" is not a file, and ${CONFIG_FILE} names no renders.`,
	};
}

/** --workers: undefined when not given, null when invalid. */
function parseWorkers(
	value: string | undefined,
): number | "auto" | undefined | null {
	if (value === undefined) return undefined;
	if (value === "auto") return "auto";
	const n = Number(value);
	return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Turns status polls into log lines: one per phase, throttled frame progress. */
export function narrator(
	log: (line: string) => void,
	now: () => number,
): (s: CloudRenderStatus) => void {
	let phase: string | undefined;
	let planned = false;
	let lastProgress = 0;
	return (s) => {
		if (!phase) log(`Cloud render ${s.id} started.`);
		if (s.plan && !planned) {
			planned = true;
			log(describePlan(s));
		}
		if (s.status !== phase) {
			phase = s.status;
			const line = phaseLine(s);
			if (line) log(line);
			lastProgress = now();
			return;
		}
		if (s.status === "rendering" && now() - lastProgress >= PROGRESS_EVERY_MS) {
			lastProgress = now();
			log(progressLine(s));
		}
	};
}

export function describePlan(s: CloudRenderStatus): string {
	const plan = s.plan;
	if (!plan) return "";
	const est =
		s.estimateUsd !== undefined ? `, estimated ${usd(s.estimateUsd)}` : "";
	return `Plan: ${plan.workers} ${plan.workers === 1 ? "worker" : "workers"}, ${duration(plan.workSec)} of render work, ready in about ${duration(plan.etaSec)}${est}.`;
}

function phaseLine(s: CloudRenderStatus): string | undefined {
	switch (s.status) {
		case "probing":
			return "Measuring frame costs on one worker to plan the split…";
		case "rendering":
			return s.workers > 1
				? `Rendering ${s.workers} chunks and the audio in parallel…`
				: "Rendering on one worker…";
		case "stitching":
			return `Joining ${s.workers} chunks…`;
		default:
			return undefined;
	}
}

export function progressLine(s: CloudRenderStatus): string {
	const { frames, totalFrames, etaSec } = s.progress;
	const share = totalFrames
		? `${Math.floor((frames / totalFrames) * 100)}% (${frames}/${totalFrames} frames)`
		: `${frames} frames`;
	const eta = etaSec ? `, about ${duration(etaSec)} left` : "";
	return `Rendering ${share}${eta}, ${usd(s.costUsd)} so far.`;
}

export function duration(sec: number): string {
	const s = Math.max(0, Math.round(sec));
	if (s < 90) return `${s} s`;
	const m = Math.round(s / 60);
	if (m < 90) return `${m} min`;
	return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export function usd(value: number): string {
	return value > 0 && value < 0.01 ? "<$0.01" : `$${value.toFixed(2)}`;
}
