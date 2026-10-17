import type { RendererConfig } from "../config/index.js";

export interface WorkerStats {
	completedJobs: number;
	heapUsedMb: number;
	rssMb: number;
	strayErrors: number;
	leakedHandles: number;
	requested?: string;
}

/**
 * Why this worker should stop taking jobs and restart, or undefined to keep
 * going (PLAN.md §8.3).
 */
export function recycleReason(
	stats: WorkerStats,
	config: RendererConfig,
): string | undefined {
	const r = config.recycle;
	if (stats.requested) return stats.requested;
	if (r.maxJobs > 0 && stats.completedJobs >= r.maxJobs)
		return `completed ${stats.completedJobs} jobs`;
	if (r.heapMb > 0 && stats.heapUsedMb > r.heapMb)
		return `heap ${stats.heapUsedMb}MB > ${r.heapMb}MB`;
	if (r.rssMb > 0 && stats.rssMb > r.rssMb)
		return `rss ${stats.rssMb}MB > ${r.rssMb}MB`;
	if (r.strayErrorLimit > 0 && stats.strayErrors >= r.strayErrorLimit) {
		return `${stats.strayErrors} errors from repo code outside any job`;
	}
	if (r.leakedHandleLimit > 0 && stats.leakedHandles > r.leakedHandleLimit) {
		return `${stats.leakedHandles} timers/handles left behind by repo code`;
	}
	return undefined;
}

export function currentStats(
	completedJobs: number,
	baselineHandles: number,
	strayErrors: number,
	requested: string | undefined,
): WorkerStats {
	const mem = process.memoryUsage();
	return {
		completedJobs,
		heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
		rssMb: Math.round(mem.rss / 1024 / 1024),
		strayErrors,
		leakedHandles: Math.max(
			0,
			process.getActiveResourcesInfo().length - baselineHandles,
		),
		requested,
	};
}
