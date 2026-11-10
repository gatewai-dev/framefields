/**
 * Types shared by the web bundle builder (Node), the loader (`framefields/web`)
 * and the export runtime inside a bundle (`engine/web.mjs`).
 */
import type { RenderQueue } from "./queue.js";

/** Written by `framefields bundle` as `manifest.json` at the bundle's root. */
export interface WebBundleManifest {
	format: 1;
	/** Changes whenever the composition's code or any shipped file changes. */
	id: string;
	title: string;
	/** The export of the entry module the bundle renders. */
	export: string;
	width: number;
	height: number;
	fps: number;
	frameCount: number;
	durationMs: number;
	/** The composition's working directory, as a bundle path (`/` is the project). */
	cwd: string;
	/** Files the composition reads, by the path it reads them at. */
	files: Record<string, WebBundleFile>;
}

export interface WebBundleFile {
	/** Where it is, relative to the bundle's root. */
	url: string;
	size: number;
	sha256: string;
}

/** Bitrate presets, as `renderVideo` names them, or bits per second. */
export type WebExportQuality =
	| "very_low"
	| "low"
	| "medium"
	| "high"
	| "very_high"
	| number;

export interface WebExportOptions {
	/** Video codec. Default `"h264"`. */
	codec?: "h264" | "hevc";
	/** Default `"very_high"`, as `renderVideo`. */
	quality?: WebExportQuality;
	/** Seconds between keyframes. Default 5. */
	keyFrameIntervalSec?: number;
	/** Write the soundtrack (mixed and encoded apart, copied in at the stitch). Default true. */
	audio?: boolean;
	/**
	 * Most estimated render time per chunk, in seconds. A chunk is the most a
	 * stop (the app backgrounded or killed) loses; caches are freed between
	 * chunks. Default 20.
	 */
	chunkSec?: number;
	/** Most frames per chunk. Default 900. */
	maxChunkFrames?: number;
	/** Fewest frames per chunk. Default 30. */
	minChunkFrames?: number;
	/** Points along the timeline timed to plan chunks by cost. Default 6. */
	probeSamples?: number;
	/**
	 * Continue an export of the same bundle and settings that stopped: chunks
	 * already written are kept. Default true. Needs persistent storage (OPFS).
	 */
	resume?: boolean;
	/** Where chunks go: the origin private file system (default when available), or memory. */
	storage?: "opfs" | "memory";
	signal?: AbortSignal;
	onProgress?: (progress: WebExportProgress) => void;
}

export type WebExportPhase =
	| "prepare"
	| "probe"
	| "render"
	| "audio"
	| "stitch"
	| "done";

export interface WebExportProgress {
	phase: WebExportPhase;
	/** Frames of the film rendered so far, kept chunks included. */
	frames: number;
	totalFrames: number;
	/** The chunk being rendered (0-based) and how many there are, from "render" on. */
	chunk?: number;
	chunks?: number;
	/** Seconds left, estimated from measured frame costs. */
	etaSec?: number;
	message: string;
}

export interface WebExportChunkStats {
	start: number;
	end: number;
	/** Wall time to render and encode it; 0 when kept from an earlier run. */
	ms: number;
	bytes: number;
	resumed: boolean;
}

export interface WebExportResult {
	/** The MP4: disk-backed when written to OPFS. */
	file: File;
	frames: number;
	durationSec: number;
	/** Identifies the export in storage (`clearExports`). */
	jobId: string;
	chunks: WebExportChunkStats[];
	elapsedMs: number;
}

/** A web bundle, opened: what it renders, and the export of it. */
export interface WebBundle {
	manifest: WebBundleManifest;
	/**
	 * Renders waiting in line, run one after another on this page's GPU and
	 * saved across reloads: `enqueue(options)` returns at once; `subscribe`
	 * reports progress and results.
	 */
	queue: RenderQueue;
	/**
	 * Renders the composition to MP4 on this device, chunk by chunk, and
	 * waits for it: a queue of one, behind whatever is already in line.
	 */
	exportVideo(options?: WebExportOptions): Promise<WebExportResult>;
	/** Cancels the queue and deletes every export kept in this origin's storage (finished files included). */
	clearExports(): Promise<void>;
}
