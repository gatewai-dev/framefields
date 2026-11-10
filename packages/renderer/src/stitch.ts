/**
 * Joins the chunks of one render split across workers, as files. Each chunk
 * is made with `renderVideo({ frames, audio: false })`, starts on a keyframe
 * and timestamps from 0; see `stitchSegments` for how they are joined.
 * Nothing is decoded or re-encoded, so it needs no GPU.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { FilePathSource, FilePathTarget } from "mediabunny";
import { stitchSegments } from "./stitch-segments.js";

export interface StitchOptions {
	/** Chunk files in timeline order, each a `renderVideo({ frames, audio: false })` output. */
	chunks: readonly string[];
	/**
	 * An audio-only render of the whole timeline (`renderVideo({ codec: "aac" })`,
	 * or `"opus"` for WebM chunks), copied in as the audio track.
	 */
	audio?: string;
	outputPath: string;
	/** Stops between packets; the promise rejects and no file is left behind. */
	signal?: AbortSignal;
}

export interface StitchResult {
	filePath: string;
	/** Video frames written, across all chunks. */
	frames: number;
	/** End of the video track, in seconds. */
	durationSec: number;
}

export async function stitchChunks(
	options: StitchOptions,
): Promise<StitchResult> {
	if (options.chunks.length === 0)
		throw new Error("stitchChunks needs at least one chunk.");
	const file = (name: string) => ({ name, source: new FilePathSource(name) });
	await fs.mkdir(path.dirname(path.resolve(options.outputPath)), {
		recursive: true,
	});
	try {
		const written = await stitchSegments({
			chunks: options.chunks.map(file),
			audio: options.audio ? file(options.audio) : undefined,
			target: new FilePathTarget(options.outputPath),
			signal: options.signal,
		});
		return { filePath: options.outputPath, ...written };
	} catch (error) {
		await fs.rm(options.outputPath, { force: true });
		throw error;
	}
}
