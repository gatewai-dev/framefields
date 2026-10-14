import { EventEmitter } from "node:events";
import type { RenderErrorJSON } from "../errors.js";

export type JobStatus =
	| "IN_QUEUE"
	| "IN_PROGRESS"
	| "COMPLETED"
	| "FAILED"
	| "CANCELLED";

export type JobPhaseName =
	| "queued"
	| "resolving"
	| "fetching"
	| "lfs"
	| "installing"
	| "loading"
	| "rendering"
	| "encoding"
	| "verifying"
	| "uploading"
	| "done";

export interface JobProgress {
	phase: JobPhaseName;
	/** Index of the output being rendered, when the plan has several. */
	output?: number;
	frame?: number;
	total?: number;
	fps?: number;
	etaSec?: number;
	message?: string;
}

export interface JobRecord {
	id: string;
	status: JobStatus;
	progress: JobProgress;
	createdAt: string;
	updatedAt: string;
	startedAt?: string;
	finishedAt?: string;
	result?: Record<string, unknown>;
	error?: RenderErrorJSON;
	warnings: string[];
}

const TERMINAL: ReadonlySet<JobStatus> = new Set([
	"COMPLETED",
	"FAILED",
	"CANCELLED",
]);

export function isTerminal(status: JobStatus): boolean {
	return TERMINAL.has(status);
}

/**
 * In-memory job records with TTL and size-bounded eviction. Emits `update`
 * with the record on every change (SSE progress).
 */
export class JobStore extends EventEmitter<{ update: [JobRecord] }> {
	private readonly jobs = new Map<string, JobRecord>();

	constructor(
		private readonly ttlMs: number,
		private readonly maxHistory: number,
		private readonly now: () => number = Date.now,
	) {
		super();
		this.setMaxListeners(0);
	}

	create(id: string): JobRecord {
		const ts = new Date(this.now()).toISOString();
		const record: JobRecord = {
			id,
			status: "IN_QUEUE",
			progress: { phase: "queued" },
			createdAt: ts,
			updatedAt: ts,
			warnings: [],
		};
		this.jobs.set(id, record);
		this.prune();
		this.emit("update", record);
		return record;
	}

	get(id: string): JobRecord | undefined {
		return this.jobs.get(id);
	}

	update(
		id: string,
		patch: Partial<Omit<JobRecord, "id" | "createdAt">>,
	): JobRecord | undefined {
		const record = this.jobs.get(id);
		if (!record) return undefined;
		// A finished job never changes again (late progress from a slow abort).
		if (isTerminal(record.status)) return record;
		Object.assign(record, patch, {
			updatedAt: new Date(this.now()).toISOString(),
		});
		if (patch.status && isTerminal(patch.status)) {
			record.finishedAt = record.updatedAt;
		}
		this.emit("update", record);
		return record;
	}

	/** Restores a record written before a crash (crash journal, PLAN.md §8.3). */
	restore(record: JobRecord): void {
		this.jobs.set(record.id, record);
		this.prune();
	}

	prune(): void {
		const cutoff = this.now() - this.ttlMs;
		for (const [id, job] of this.jobs) {
			if (isTerminal(job.status) && Date.parse(job.updatedAt) < cutoff) {
				this.jobs.delete(id);
			}
		}
		// Oldest finished jobs go first; active jobs are never evicted.
		if (this.jobs.size > this.maxHistory) {
			for (const [id, job] of this.jobs) {
				if (this.jobs.size <= this.maxHistory) break;
				if (isTerminal(job.status)) this.jobs.delete(id);
			}
		}
	}

	get size(): number {
		return this.jobs.size;
	}
}
