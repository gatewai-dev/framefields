import { RenderError } from "../errors.js";

export interface QueuedJob {
	id: string;
	run(signal: AbortSignal): Promise<void>;
	/** Called instead of run() when the job is cancelled while waiting. */
	onCancelledWhileQueued(reason: RenderError): void;
}

/**
 * Runs one job at a time (PLAN.md §3: cwd, env and the GPU are process-wide).
 * Waiting jobs are capped at `max`; past that, enqueue throws BUSY.
 */
export class JobQueue {
	private readonly waiting: QueuedJob[] = [];
	private active?: { job: QueuedJob; controller: AbortController };
	private closed = false;
	private idleResolvers: (() => void)[] = [];

	constructor(private readonly max: number) {}

	enqueue(job: QueuedJob): void {
		if (this.closed) {
			throw new RenderError("SHUTDOWN", "This worker is shutting down.");
		}
		if (this.waiting.length >= this.max) {
			throw new RenderError("BUSY", `Queue full (${this.max} waiting).`);
		}
		this.waiting.push(job);
		this.pump();
	}

	/** Cancels a waiting or running job. Returns false if unknown. */
	cancel(id: string, reason: RenderError): boolean {
		const index = this.waiting.findIndex((j) => j.id === id);
		if (index >= 0) {
			const [job] = this.waiting.splice(index, 1);
			job.onCancelledWhileQueued(reason);
			return true;
		}
		if (this.active?.job.id === id) {
			this.active.controller.abort(reason);
			return true;
		}
		return false;
	}

	/**
	 * Stops accepting jobs. Waiting jobs are cancelled with `reason`; the
	 * running one is aborted too when `abortActive` is set.
	 */
	close(reason: RenderError, abortActive: boolean): void {
		this.closed = true;
		for (const job of this.waiting.splice(0))
			job.onCancelledWhileQueued(reason);
		if (abortActive) this.active?.controller.abort(reason);
	}

	get busy(): boolean {
		return this.active !== undefined;
	}

	get activeId(): string | undefined {
		return this.active?.job.id;
	}

	get depth(): number {
		return this.waiting.length;
	}

	get isClosed(): boolean {
		return this.closed;
	}

	/** Resolves once nothing is running or waiting. */
	idle(): Promise<void> {
		if (!this.active && this.waiting.length === 0) return Promise.resolve();
		return new Promise((resolve) => this.idleResolvers.push(resolve));
	}

	private pump(): void {
		if (this.active) return;
		const job = this.waiting.shift();
		if (!job) {
			for (const resolve of this.idleResolvers.splice(0)) resolve();
			return;
		}
		const controller = new AbortController();
		this.active = { job, controller };
		job
			.run(controller.signal)
			.catch(() => {
				// run() reports its own failures; never let one stop the queue.
			})
			.finally(() => {
				this.active = undefined;
				this.pump();
			});
	}
}
