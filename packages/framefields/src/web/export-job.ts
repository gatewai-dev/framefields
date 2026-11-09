/**
 * The on-device export as a job: measure frame costs, plan chunks within a
 * render-time and frame budget, render each chunk into its own file, render
 * the soundtrack apart, then stitch the files without re-encoding. Its state
 * (the plan, which chunks are written) is saved after every step, so an
 * export that stopped (the app backgrounded or killed) continues from the
 * first missing chunk. The drawing is the backend's: the browser runtime's,
 * or a test's.
 */
import {
	type ChunkPlan,
	type FrameCostSample,
	type PlannedChunk,
	planChunksByBudget,
	stitchSegments,
} from "@framefields/renderer/split";
import { BlobSource, StreamTarget } from "mediabunny";
import type { ExportStore, StoreWriter } from "./store.js";
import type {
	WebExportChunkStats,
	WebExportOptions,
	WebExportPhase,
	WebExportProgress,
	WebExportResult,
} from "./types.js";

/** What draws and encodes: the browser runtime, or a test's stand-in. */
export interface ExportBackend {
	/** Times frames at `count` points along the timeline (see `probeRender`). */
	probe(count: number, signal?: AbortSignal): Promise<FrameCostSample[]>;
	/**
	 * Renders frames [start, end) as a video-only file into `writer`: first
	 * frame a keyframe, timestamps from 0. `onFrame` after each frame.
	 */
	renderChunk(
		chunk: PlannedChunk,
		writer: StoreWriter,
		onFrame: (done: number) => void,
		signal?: AbortSignal,
	): Promise<void>;
	/**
	 * Renders the whole soundtrack as an audio-only file: into a writer from
	 * `open` (again, after aborting the last, when it must start over), which
	 * it closes when the file is complete. False when there is nothing to write.
	 */
	renderAudio(
		open: () => Promise<StoreWriter>,
		signal?: AbortSignal,
	): Promise<boolean>;
	/** Frees what the last chunk built up before the next one starts. */
	betweenChunks?(): Promise<void>;
}

/** What the job's output depends on: a change starts the export over. */
export interface ExportSettings {
	bundleId: string;
	totalFrames: number;
	fps: number;
	width: number;
	height: number;
	codec: "h264" | "hevc";
	quality: NonNullable<WebExportOptions["quality"]>;
	keyFrameIntervalSec: number;
	audio: boolean;
}

/** Saved as `job.json` in the job's folder after every step. */
export interface ExportJobState {
	format: 1;
	jobId: string;
	settings: ExportSettings;
	samples: FrameCostSample[];
	plan: ChunkPlan;
	/** Bytes and render time of each chunk written, by index. */
	written: Record<number, { bytes: number; ms: number }>;
	/** `null` when the film is silent, absent until rendered. */
	audio?: { bytes: number } | null;
}

const STATE = "job.json";
const chunkName = (i: number) => `chunk-${String(i).padStart(4, "0")}.mp4`;
const AUDIO = "audio.m4a";
const OUTPUT = "output.mp4";

/** A stable id for an export of these settings. */
export async function exportJobId(settings: ExportSettings): Promise<string> {
	const bytes = new TextEncoder().encode(JSON.stringify(settings));
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return Array.from(new Uint8Array(digest).slice(0, 12), (b) =>
		b.toString(16).padStart(2, "0"),
	).join("");
}

export interface RunExportJob {
	jobId: string;
	settings: ExportSettings;
	store: ExportStore;
	backend: ExportBackend;
	options: Pick<
		WebExportOptions,
		| "chunkSec"
		| "maxChunkFrames"
		| "minChunkFrames"
		| "probeSamples"
		| "resume"
		| "signal"
		| "onProgress"
	>;
}

export async function runExportJob(
	job: RunExportJob,
): Promise<WebExportResult> {
	const started = performance.now();
	const { store, backend, settings, options } = job;
	const total = settings.totalFrames;
	const signal = options.signal;
	const report = progressReporter(total, options.onProgress);

	const state = await loadOrPlan(job, report);
	const chunks = state.plan.chunks;
	const stats: WebExportChunkStats[] = [];
	const keptFrames = () =>
		chunks.reduce(
			(sum, c, i) => (state.written[i] ? sum + c.end - c.start : sum),
			0,
		);
	// Seconds per second of estimated work, as measured in this run: the
	// probe times drawing only, not encoding or presenting.
	let measuredMs = 0;
	let measuredWorkSec = 0;
	const etaSec = (from: number, doneInChunk: number) => {
		let work = 0;
		for (let j = from; j < chunks.length; j++) {
			if (state.written[j]) continue;
			const c = chunks[j];
			const left = j === from ? 1 - doneInChunk / (c.end - c.start) : 1;
			work += c.workSec * left;
		}
		const pace = measuredWorkSec > 0 ? measuredMs / 1000 / measuredWorkSec : 1;
		return work * pace;
	};

	for (let i = 0; i < chunks.length; i++) {
		const chunk = chunks[i];
		const kept = state.written[i];
		if (kept && (await store.file(chunkName(i)))?.size === kept.bytes) {
			stats.push({ ...chunk, ms: 0, bytes: kept.bytes, resumed: true });
			continue;
		}
		delete state.written[i];
		signal?.throwIfAborted();
		const before = keptFrames();
		const chunkStarted = performance.now();
		const writer = await store.write(chunkName(i));
		try {
			await backend.renderChunk(
				chunk,
				writer,
				(done) =>
					report("render", before + done, {
						chunk: i,
						chunks: chunks.length,
						etaSec: etaSec(i, done),
						message: `Rendering frames ${chunk.start + done}/${total} (chunk ${i + 1}/${chunks.length})`,
					}),
				signal,
			);
			await writer.close();
		} catch (err) {
			await writer.abort();
			throw err;
		}
		const bytes = (await store.file(chunkName(i)))?.size ?? 0;
		const ms = performance.now() - chunkStarted;
		measuredMs += ms;
		measuredWorkSec += chunk.workSec;
		state.written[i] = { bytes, ms };
		await store.writeJson(STATE, state);
		stats.push({ ...chunk, ms, bytes, resumed: false });
		if (i < chunks.length - 1) await backend.betweenChunks?.();
	}

	const done = { chunks: chunks.length, chunk: chunks.length - 1 };
	const keptAudio =
		state.audio === null ||
		(state.audio !== undefined &&
			(await store.file(AUDIO))?.size === state.audio.bytes);
	if (settings.audio && !keptAudio) {
		signal?.throwIfAborted();
		report("audio", total, { ...done, message: "Mixing and encoding audio" });
		const audible = await backend.renderAudio(() => store.write(AUDIO), signal);
		state.audio = audible
			? { bytes: (await store.file(AUDIO))?.size ?? 0 }
			: null;
		await store.writeJson(STATE, state);
	}

	report("stitch", total, { ...done, message: "Joining chunks" });
	const segments = await Promise.all(
		chunks.map(async (_, i) => {
			const file = await store.file(chunkName(i));
			if (!file) throw new Error(`Chunk ${i} is missing from storage.`);
			return { name: chunkName(i), source: new BlobSource(file) };
		}),
	);
	const audioFile = state.audio ? await store.file(AUDIO) : undefined;
	const writer = await store.write(OUTPUT);
	let written: { frames: number; durationSec: number };
	try {
		written = await stitchSegments({
			chunks: segments,
			audio: audioFile
				? { name: AUDIO, source: new BlobSource(audioFile) }
				: undefined,
			target: new StreamTarget(writer.stream, { chunked: true }),
			signal,
		});
		await writer.close();
	} catch (err) {
		await writer.abort();
		throw err;
	}
	const file = await store.file(OUTPUT);
	if (!file) throw new Error("The stitched file is missing from storage.");
	// The pieces are in the output now.
	await Promise.all([
		...chunks.map((_, i) => store.remove(chunkName(i))),
		store.remove(AUDIO),
		store.remove(STATE),
	]);
	report("done", total, { ...done, etaSec: 0, message: "Done" });
	return {
		file,
		jobId: job.jobId,
		chunks: stats,
		elapsedMs: performance.now() - started,
		...written,
	};
}

/** The saved state of this job, or a new plan from measured frame costs. */
async function loadOrPlan(
	job: RunExportJob,
	report: Reporter,
): Promise<ExportJobState> {
	const { store, backend, settings, options } = job;
	const resume = options.resume !== false && store.persistent;
	const saved = resume
		? await store.readJson<ExportJobState>(STATE)
		: undefined;
	if (
		saved?.format === 1 &&
		saved.jobId === job.jobId &&
		JSON.stringify(saved.settings) === JSON.stringify(settings)
	) {
		const kept = Object.keys(saved.written).length;
		report("prepare", 0, {
			message: `Resuming: ${kept} of ${saved.plan.chunks.length} chunks already written`,
		});
		return saved;
	}
	await store.clear();
	report("probe", 0, { message: "Timing frames to plan chunks" });
	const samples = await backend.probe(
		Math.max(1, Math.floor(options.probeSamples ?? 6)),
		options.signal,
	);
	const plan = planChunksByBudget({
		totalFrames: settings.totalFrames,
		samples,
		chunkSec: options.chunkSec ?? 20,
		maxChunkFrames: options.maxChunkFrames ?? 900,
		minChunkFrames: options.minChunkFrames ?? 30,
	});
	const state: ExportJobState = {
		format: 1,
		jobId: job.jobId,
		settings,
		samples,
		plan,
		written: {},
	};
	await store.writeJson(STATE, state);
	return state;
}

type Reporter = (
	phase: WebExportPhase,
	frames: number,
	extra: Omit<WebExportProgress, "phase" | "frames" | "totalFrames">,
) => void;

function progressReporter(
	totalFrames: number,
	onProgress: WebExportOptions["onProgress"],
): Reporter {
	return (phase, frames, extra) =>
		onProgress?.({ phase, frames, totalFrames, ...extra });
}
