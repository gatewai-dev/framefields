import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { RenderError } from "../errors.js";
import { CommandError, exec } from "../git/exec.js";
import type { RenderedFile } from "../jobs/pipeline.js";

export interface VerifiedFile extends RenderedFile {
	bytes: number;
	sha256: string;
	durationMs?: number;
	frames?: number;
}

const PROBED = new Set(["mp4", "webm", "m4a", "mp3", "gif"]);

/**
 * Checks a rendered file before it leaves the worker (PLAN.md §8.5): it must
 * exist, be non-empty and within the size limit, and media files must probe
 * cleanly with the frame count the engine promised (±1).
 */
export async function verifyFile(
	file: RenderedFile,
	options: { maxBytes: number; signal?: AbortSignal; probe?: boolean },
): Promise<VerifiedFile> {
	const stat = await fs.stat(file.path).catch(() => undefined);
	if (!stat?.isFile()) {
		throw new RenderError("OUTPUT_MISSING", `Output ${file.name} was not written.`, { phase: "verify" });
	}
	if (stat.size === 0) {
		throw new RenderError("OUTPUT_INVALID", `Output ${file.name} is empty.`, { phase: "verify" });
	}
	if (options.maxBytes > 0 && stat.size > options.maxBytes) {
		throw new RenderError(
			"OUTPUT_TOO_LARGE",
			`Output ${file.name} is ${stat.size} bytes, over FF_OUTPUT_MAX_BYTES (${options.maxBytes}).`,
			{ phase: "verify" },
		);
	}

	const verified: VerifiedFile = { ...file, bytes: stat.size, sha256: await sha256File(file.path) };
	if (options.probe !== false && PROBED.has(file.ext)) {
		Object.assign(verified, await probe(file, options.signal));
	}
	return verified;
}

export async function sha256File(file: string): Promise<string> {
	const hash = createHash("sha256");
	for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
	return hash.digest("hex");
}

interface ProbeOutput {
	format?: { duration?: string };
	streams?: { codec_type?: string; nb_frames?: string; nb_read_frames?: string }[];
}

async function probe(file: RenderedFile, signal?: AbortSignal): Promise<{ durationMs?: number; frames?: number }> {
	let out: ProbeOutput;
	try {
		const { stdout } = await exec(
			"ffprobe",
			["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file.path],
			{ timeoutMs: 120_000, signal },
		);
		out = JSON.parse(stdout) as ProbeOutput;
	} catch (err) {
		if (err instanceof CommandError) {
			throw new RenderError("OUTPUT_INVALID", `Output ${file.name} is not readable media: ${err.message}`, {
				phase: "verify",
			});
		}
		if (/ENOENT/.test(String(err))) {
			// No ffprobe on this host: size and hash checks still ran.
			return {};
		}
		throw err;
	}

	const duration = Number(out.format?.duration);
	const video = out.streams?.find((s) => s.codec_type === "video");
	const frames = Number(video?.nb_frames ?? video?.nb_read_frames);
	const result = {
		...(Number.isFinite(duration) && { durationMs: Math.round(duration * 1000) }),
		...(Number.isFinite(frames) && frames > 0 && { frames }),
	};
	if (!out.streams?.length) {
		throw new RenderError("OUTPUT_INVALID", `Output ${file.name} has no streams.`, { phase: "verify" });
	}
	if (file.expectedFrames && result.frames !== undefined && Math.abs(result.frames - file.expectedFrames) > 1) {
		throw new RenderError(
			"OUTPUT_INVALID",
			`Output ${file.name} has ${result.frames} frames; the engine rendered ${file.expectedFrames}.`,
			{ phase: "verify" },
		);
	}
	return result;
}

interface QaIssueLike {
	severity?: string;
	code?: string;
	message?: string;
}

/**
 * QA issues that fail the job under `render.qa.failOn`. Entries match an
 * issue code (`black_frames`, `frozen_video`, `audio_clipping`, …) or a
 * severity (`error`, `warning`).
 */
export function qaFailures(report: unknown, failOn: readonly string[] | undefined): QaIssueLike[] {
	if (!failOn?.length || !report || typeof report !== "object") return [];
	const issues = (report as { issues?: QaIssueLike[] }).issues ?? [];
	return issues.filter((i) => failOn.includes(i.code ?? "") || failOn.includes(i.severity ?? ""));
}
