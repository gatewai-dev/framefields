/**
 * Worker readiness. The worker is ready once the tools it shells out to are
 * present; the GPU is initialised by the first job, with that project's
 * framefields (PLAN.md §7), so it is reported but not required.
 */
export class ReadinessTracker {
	private _toolsReady = false;
	private _engine: string | null = null;
	private _failureReason: string | null = null;

	get isReady(): boolean {
		return this._toolsReady && !this._failureReason;
	}

	get status() {
		return {
			ready: this.isReady,
			components: { tools: this._toolsReady, engine: this._engine },
			...(this._failureReason && { error: this._failureReason }),
		};
	}

	setToolsReady(ready: boolean) {
		this._toolsReady = ready;
	}

	/** framefields version bound by the first job (GPU initialised). */
	setEngine(version: string | null) {
		this._engine = version;
	}

	setFailure(reason: string) {
		this._failureReason = reason;
	}
}
