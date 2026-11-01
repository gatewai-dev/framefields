/**
 * Cloud renders on api.framefields.dev: the project renders from git on
 * framefields' GPU workers, billed to the account that owns the API key.
 *
 * ```ts
 * import { renderCloud } from "framefields/cloud";
 *
 * const result = await renderCloud({
 *   entry: "src/film.ts",
 *   workers: "auto", // split a long film across GPUs; 1 (default) renders on one
 *   outputPath: "output/film.mp4",
 *   onProgress: (s) => console.log(s.status, s.progress.frames),
 * });
 * ```
 *
 * `workers: "auto"` probes the film on one worker first, then splits it into
 * as many chunks as stay efficient: short films stay on one worker, long ones
 * spread out up to `maxWorkers`. `dryRun: true` returns that plan with the
 * estimated cost and renders nothing. Aborting `signal` cancels the render;
 * GPU time already used is charged.
 */
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { type CloudSource, resolveGitSource } from "./git-source.js";

export { type CloudSource, resolveGitSource, toHttps } from "./git-source.js";

export const FRAMEFIELDS_API_URL = "https://api.framefields.dev";

export interface CloudRenderOptions {
	/** The module that builds the composition, relative to `cwd`. */
	entry: string;
	/** Its export: a Composition, or a function returning one. Default `buildFilm`. */
	export?: string;
	/** Passed to the export when it is a function. */
	args?: unknown;
	/** When the export returns several compositions, the one to render. */
	select?: string;
	/** 1 (default) renders on one worker; a number or "auto" splits the film. */
	workers?: number | "auto";
	/** Upper bound for "auto" (the API caps it too). */
	maxWorkers?: number;
	codec?: "h264" | "vp9";
	quality?: string;
	/** Probe and plan only: returns the plan and estimated cost, renders nothing. */
	dryRun?: boolean;
	/** Download the finished video here. */
	outputPath?: string;
	/** Project folder. Default `process.cwd()`. */
	cwd?: string;
	/** Instead of reading repo, branch and commit from git. */
	source?: CloudSource;
	/** Default `process.env.FRAMEFIELDS_API_KEY`. */
	apiKey?: string;
	/** Default `process.env.FRAMEFIELDS_API_URL`, else https://api.framefields.dev. */
	apiUrl?: string;
	/** Called with every status poll. */
	onProgress?: (status: CloudRenderStatus) => void;
	/** Called for each warning (uncommitted changes). Default: stderr. */
	onWarning?: (message: string) => void;
	/** Aborting cancels the cloud render. */
	signal?: AbortSignal;
	/** Status poll interval, ms. Default 3000. */
	pollMs?: number;
}

export type CloudRenderPhase =
	| "probing"
	| "holding"
	| "rendering"
	| "stitching"
	| "planned"
	| "completed"
	| "failed"
	| "cancelled";

export interface CloudRenderPlan {
	workers: number;
	/** Render time of the whole film on one GPU, seconds. */
	workSec: number;
	/** Expected wall time with this plan, seconds. */
	etaSec: number;
	chunks: { start: number; end: number; workSec: number }[];
}

export interface CloudRenderStatus {
	id: string;
	status: CloudRenderPhase;
	workers: number;
	plan?: CloudRenderPlan;
	progress: {
		frames: number;
		totalFrames: number | null;
		etaSec: number | null;
	};
	/** Charged so far (final once the render ended), USD. */
	costUsd: number;
	gpuSeconds: number;
	/** The planned render's estimated charge, USD. */
	estimateUsd?: number;
	/** The commit rendered. */
	sha?: string;
	output?: { url: string; bytes?: number };
	error?: { code: string; message: string };
}

export interface CloudRenderResult extends CloudRenderStatus {
	/** Where the video was downloaded (`outputPath`). */
	filePath?: string;
}

/** A cloud render that failed, was cancelled, or was refused by the API. */
export class CloudRenderError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status?: CloudRenderStatus,
	) {
		super(message);
		this.name = "CloudRenderError";
	}
}

const DONE = new Set<CloudRenderPhase>([
	"planned",
	"completed",
	"failed",
	"cancelled",
]);

/** Starts a cloud render and waits for it; resolves when it completed (or was planned). */
export async function renderCloud(
	options: CloudRenderOptions,
): Promise<CloudRenderResult> {
	const api = cloudClient(options);
	const cwd = options.cwd ?? process.cwd();
	const resolved = options.source
		? { source: options.source, entry: options.entry, warnings: [] }
		: resolveGitSource(cwd, options.entry);
	const warn =
		options.onWarning ??
		((m: string) => process.stderr.write(`framefields: ${m}\n`));
	for (const w of resolved.warnings) warn(w);

	let status = await api.start({
		source: resolved.source,
		target: {
			entry: resolved.entry,
			export: options.export ?? "buildFilm",
			...(options.args !== undefined && { args: options.args }),
			...(options.select && { select: [options.select] }),
		},
		render: {
			codec: options.codec ?? "h264",
			...(options.quality && { quality: options.quality }),
		},
		workers: options.workers ?? 1,
		...(options.maxWorkers && { max_workers: options.maxWorkers }),
		dry_run: options.dryRun ?? false,
	});
	options.onProgress?.(status);

	try {
		while (!DONE.has(status.status)) {
			await sleep(options.pollMs ?? 3000, options.signal);
			status = await api.status(status.id);
			options.onProgress?.(status);
		}
	} catch (err) {
		if (options.signal?.aborted) {
			const final = await api.cancel(status.id).catch(() => status);
			throw new CloudRenderError(
				"The cloud render was cancelled.",
				"cancelled",
				final,
			);
		}
		throw err;
	}

	if (status.status === "failed" || status.status === "cancelled")
		throw new CloudRenderError(
			status.error
				? `Cloud render ${status.status}: ${status.error.message} (${status.error.code})`
				: `Cloud render ${status.status}.`,
			status.error?.code ?? status.status,
			status,
		);
	if (status.status === "completed" && options.outputPath && status.output) {
		await download(status.output.url, options.outputPath, options.signal);
		return { ...status, filePath: options.outputPath };
	}
	return status;
}

/** The API calls behind `renderCloud`, for callers who track renders themselves. */
export function cloudClient(
	options: Pick<CloudRenderOptions, "apiKey" | "apiUrl">,
) {
	const key = options.apiKey ?? process.env.FRAMEFIELDS_API_KEY;
	if (!key)
		throw new CloudRenderError(
			"No API key. Set FRAMEFIELDS_API_KEY (keys at https://framefields.dev/dashboard/keys) or pass apiKey.",
			"invalid_api_key",
		);
	const base = (
		options.apiUrl ??
		process.env.FRAMEFIELDS_API_URL ??
		FRAMEFIELDS_API_URL
	).replace(/\/+$/, "");
	const call = async (method: string, route: string, body?: unknown) => {
		const res = await fetch(`${base}/v1/render${route}`, {
			method,
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			...(body !== undefined && { body: JSON.stringify(body) }),
		});
		const json = (await res.json().catch(() => ({}))) as ApiStatus & {
			error?: { type?: string; message?: string };
		};
		if (!res.ok)
			throw new CloudRenderError(
				json.error?.message ??
					`api.framefields.dev answered HTTP ${res.status}`,
				json.error?.type ?? `http_${res.status}`,
			);
		return fromApi(json);
	};
	return {
		start: (body: unknown) => call("POST", "", body),
		status: (id: string) => call("GET", `/${encodeURIComponent(id)}`),
		cancel: (id: string) => call("DELETE", `/${encodeURIComponent(id)}`),
	};
}

/** The API's snake_case status. */
interface ApiStatus {
	id: string;
	status: CloudRenderPhase;
	workers?: number;
	plan?: {
		workers: number;
		work_sec: number;
		eta_sec: number;
		chunks: CloudRenderPlan["chunks"];
	};
	progress?: {
		frames?: number;
		total_frames?: number | null;
		eta_sec?: number | null;
	};
	cost_usd?: number;
	gpu_seconds?: number;
	estimate_usd?: number;
	sha?: string;
	output?: { url: string; bytes?: number };
	error?: { code: string; message: string };
}

function fromApi(s: ApiStatus): CloudRenderStatus {
	return {
		id: s.id,
		status: s.status,
		workers: s.workers ?? 1,
		...(s.plan && {
			plan: {
				workers: s.plan.workers,
				workSec: s.plan.work_sec,
				etaSec: s.plan.eta_sec,
				chunks: s.plan.chunks,
			},
		}),
		progress: {
			frames: s.progress?.frames ?? 0,
			totalFrames: s.progress?.total_frames ?? null,
			etaSec: s.progress?.eta_sec ?? null,
		},
		costUsd: s.cost_usd ?? 0,
		gpuSeconds: s.gpu_seconds ?? 0,
		...(s.estimate_usd !== undefined && { estimateUsd: s.estimate_usd }),
		...(s.sha && { sha: s.sha }),
		...(s.output && { output: s.output }),
		...(s.error && { error: s.error }),
	};
}

async function download(url: string, file: string, signal?: AbortSignal) {
	const res = await fetch(url, { signal });
	if (!res.ok || !res.body)
		throw new CloudRenderError(
			`Downloading the render failed: HTTP ${res.status}`,
			"download_failed",
		);
	await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
	await pipeline(
		Readable.fromWeb(res.body as WebReadableStream),
		createWriteStream(file),
	);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		const timer = setTimeout(resolve, ms);
		signal?.addEventListener(
			"abort",
			() => {
				clearTimeout(timer);
				reject(signal.reason);
			},
			{ once: true },
		);
	});
}
