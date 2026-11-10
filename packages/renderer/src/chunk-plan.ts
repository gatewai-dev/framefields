/**
 * Plans a render split across workers: how many chunks, and where each one
 * starts and ends. Pure arithmetic over measured frame costs, so it runs
 * anywhere (a worker's probe job, a coordinator, a local script).
 *
 * Every chunk pays a fixed cost before its first frame (worker start, fetch,
 * install, composition build). `workers: "auto"` adds workers only while each
 * chunk still spends at least `efficiency` of its time rendering, so a short
 * film stays on one worker and a long one spreads out until `maxWorkers`.
 * Chunks are cut at equal render cost, not equal frame counts, so a heavy
 * stretch (3D, vision) gets shorter chunks.
 *
 * `planChunksByBudget` plans for one device rendering its chunks in turn
 * (a phone exporting on its own GPU): chunks sized by render time and frame
 * count, so a stop loses little and caches are freed between chunks.
 */

/** A measured render time for one frame. */
export interface FrameCostSample {
	frame: number;
	ms: number;
}

export interface ChunkPlanOptions {
	/** Frames in the composition. */
	totalFrames: number;
	/** Measured frame times; between samples the cost is interpolated linearly. */
	samples: readonly FrameCostSample[];
	/** A worker count, or `"auto"` to pick one from the cost. Default 1. */
	workers?: number | "auto";
	/** Upper bound for `"auto"` (and for a number). Default 10. */
	maxWorkers?: number;
	/** Fixed cost each chunk pays before rendering, in seconds. Default 90 (a cold start). */
	overheadSec?: number;
	/**
	 * `"auto"` only: the smallest share of a chunk's time spent rendering,
	 * between 0 and 1. Default 0.85: each chunk renders at least
	 * `overheadSec × 0.85 / 0.15` (about 5.7× the overhead).
	 */
	efficiency?: number;
	/** No chunk is shorter than this many frames. Default 60. */
	minChunkFrames?: number;
}

export interface PlannedChunk {
	/** First frame (inclusive). */
	start: number;
	/** Last frame (exclusive). */
	end: number;
	/** Estimated render time of its frames, in seconds. */
	workSec: number;
}

export interface ChunkPlan {
	workers: number;
	/** Estimated render time of the whole composition on one worker, without overhead. */
	workSec: number;
	/** Estimated wall time with this plan: overhead plus the longest chunk. */
	etaSec: number;
	chunks: PlannedChunk[];
}

export function planChunks(options: ChunkPlanOptions): ChunkPlan {
	const total = options.totalFrames;
	if (!Number.isInteger(total) || total < 1)
		throw new Error(
			`planChunks: totalFrames must be a positive integer, got ${total}.`,
		);
	const overheadSec = options.overheadSec ?? 90;
	const maxWorkers = Math.max(1, Math.floor(options.maxWorkers ?? 10));
	const minChunkFrames = Math.max(1, Math.floor(options.minChunkFrames ?? 60));
	const cost = frameCosts(total, options.samples);
	const workSec = cost.reduce((sum, ms) => sum + ms, 0) / 1000;

	const wanted = workerCount(
		options.workers ?? 1,
		workSec,
		overheadSec,
		options.efficiency ?? 0.85,
	);
	const workers = Math.max(
		1,
		Math.min(wanted, maxWorkers, Math.floor(total / minChunkFrames)),
	);
	const chunks = splitByCost(cost, workers, minChunkFrames);
	const longest = Math.max(...chunks.map((c) => c.workSec));
	return {
		workers: chunks.length,
		workSec,
		etaSec: overheadSec + longest,
		chunks,
	};
}

function workerCount(
	workers: number | "auto",
	workSec: number,
	overheadSec: number,
	efficiency: number,
): number {
	if (workers !== "auto") {
		if (!Number.isInteger(workers) || workers < 1)
			throw new Error(
				`planChunks: workers must be a positive integer or "auto", got ${workers}.`,
			);
		return workers;
	}
	if (!(efficiency > 0 && efficiency < 1))
		throw new Error(
			`planChunks: efficiency must be between 0 and 1, got ${efficiency}.`,
		);
	const minChunkSec = (overheadSec * efficiency) / (1 - efficiency);
	return minChunkSec > 0
		? Math.max(1, Math.floor(workSec / minChunkSec))
		: Number.POSITIVE_INFINITY;
}

export interface BudgetPlanOptions {
	/** Frames in the composition. */
	totalFrames: number;
	/** Measured frame times; between samples the cost is interpolated linearly. */
	samples: readonly FrameCostSample[];
	/**
	 * The longest a chunk may take to render, in seconds of estimated work.
	 * What a device can lose when it stops mid-chunk (backgrounded, killed),
	 * and how often its caches are freed.
	 */
	chunkSec: number;
	/** No chunk holds more frames than this (a memory bound). Default: no cap. */
	maxChunkFrames?: number;
	/**
	 * No chunk is shorter than this many frames (each starts on a keyframe),
	 * unless `maxChunkFrames` is below twice it. Default 30.
	 */
	minChunkFrames?: number;
}

/**
 * Plans a render that one device makes chunk after chunk, each chunk within
 * a budget of render time and frames, instead of across workers. Chunks are
 * cut at equal render cost, as `planChunks` cuts them; one that would hold
 * more than `maxChunkFrames` is split evenly. `etaSec` is the whole render
 * on the one device: every chunk in turn, without overhead.
 */
export function planChunksByBudget(options: BudgetPlanOptions): ChunkPlan {
	const total = options.totalFrames;
	if (!Number.isInteger(total) || total < 1)
		throw new Error(
			`planChunksByBudget: totalFrames must be a positive integer, got ${total}.`,
		);
	if (!(options.chunkSec > 0))
		throw new Error(
			`planChunksByBudget: chunkSec must be above 0, got ${options.chunkSec}.`,
		);
	const maxFrames = Math.floor(
		options.maxChunkFrames ?? Number.POSITIVE_INFINITY,
	);
	if (!(maxFrames >= 1))
		throw new Error(
			`planChunksByBudget: maxChunkFrames must be at least 1, got ${options.maxChunkFrames}.`,
		);
	const minFrames = Math.max(
		1,
		Math.min(Math.floor(options.minChunkFrames ?? 30), maxFrames),
	);
	const cost = frameCosts(total, options.samples);
	const workSec = cost.reduce((sum, ms) => sum + ms, 0) / 1000;
	const count = Math.max(
		1,
		Math.min(
			Math.ceil(workSec / options.chunkSec),
			Math.floor(total / minFrames),
		),
	);
	const chunks = splitByCost(cost, count, minFrames).flatMap((chunk) =>
		splitEvenly(chunk, cost, maxFrames),
	);
	return { workers: 1, workSec, etaSec: workSec, chunks };
}

/** A chunk longer than `maxFrames`, cut into the fewest parts of about equal length that fit. */
function splitEvenly(
	chunk: PlannedChunk,
	cost: Float64Array,
	maxFrames: number,
): PlannedChunk[] {
	const length = chunk.end - chunk.start;
	const parts = Math.ceil(length / maxFrames);
	if (parts <= 1) return [chunk];
	const out: PlannedChunk[] = [];
	for (let i = 0; i < parts; i++) {
		const start = chunk.start + Math.round((i * length) / parts);
		const end = chunk.start + Math.round(((i + 1) * length) / parts);
		let ms = 0;
		for (let f = start; f < end; f++) ms += cost[f];
		out.push({ start, end, workSec: ms / 1000 });
	}
	return out;
}

/** Per-frame cost in ms: linear between samples, flat beyond the first and last. */
function frameCosts(
	total: number,
	samples: readonly FrameCostSample[],
): Float64Array {
	const sorted = samples
		.filter(
			(s) => Number.isFinite(s.frame) && Number.isFinite(s.ms) && s.ms >= 0,
		)
		.toSorted((a, b) => a.frame - b.frame);
	if (sorted.length === 0)
		throw new Error("planChunks: needs at least one frame cost sample.");
	const cost = new Float64Array(total);
	let s = 0;
	for (let f = 0; f < total; f++) {
		while (s + 1 < sorted.length && sorted[s + 1].frame <= f) s++;
		const a = sorted[s];
		const b = sorted[s + 1];
		cost[f] =
			!b || f <= a.frame
				? a.ms
				: a.ms + ((b.ms - a.ms) * (f - a.frame)) / (b.frame - a.frame);
	}
	return cost;
}

/**
 * Cuts the frames into `count` contiguous chunks of about equal total cost,
 * none shorter than `minFrames` (`count × minFrames` must fit).
 */
function splitByCost(
	cost: Float64Array,
	count: number,
	minFrames: number,
): PlannedChunk[] {
	const total = cost.reduce((sum, ms) => sum + ms, 0);
	const chunks: PlannedChunk[] = [];
	let start = 0;
	let acc = 0;
	let chunkMs = 0;
	for (let f = 0; f < cost.length; f++) {
		acc += cost[f];
		chunkMs += cost[f];
		const cut = (total * (chunks.length + 1)) / count;
		const framesLeft = cost.length - (f + 1);
		const chunksLeft = count - chunks.length - 1;
		const long = f + 1 - start >= minFrames;
		const roomAfter = framesLeft >= minFrames * chunksLeft;
		if (
			chunksLeft > 0 &&
			long &&
			((acc >= cut && roomAfter) || framesLeft === minFrames * chunksLeft)
		) {
			chunks.push({ start, end: f + 1, workSec: chunkMs / 1000 });
			start = f + 1;
			chunkMs = 0;
		}
	}
	chunks.push({ start, end: cost.length, workSec: chunkMs / 1000 });
	return chunks;
}
