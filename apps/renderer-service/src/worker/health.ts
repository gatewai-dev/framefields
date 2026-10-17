/**
 * Worker-level state that decides when the process should recycle itself
 * (PLAN.md §8.3). Recycling = stop taking jobs, finish the current one, exit.
 */
class WorkerHealth {
	private reason: string | undefined;

	/** Marks the worker as unable to safely run more jobs. */
	requestRecycle(reason: string): void {
		this.reason ??= reason;
	}

	get recycleReason(): string | undefined {
		return this.reason;
	}
}

export const workerHealth = new WorkerHealth();
