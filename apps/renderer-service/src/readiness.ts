export class ReadinessTracker {
	private _gpuReady = false;
	private _rendererReady = false;
	private _failureReason: string | null = null;

	get isReady(): boolean {
		return this._gpuReady && this._rendererReady;
	}

	get status() {
		return {
			ready: this.isReady,
			components: {
				gpu: this._gpuReady,
				renderer: this._rendererReady,
			},
			...(this._failureReason && { error: this._failureReason }),
		};
	}

	setGpuReady(ready: boolean) {
		this._gpuReady = ready;
	}

	setRendererReady(ready: boolean) {
		this._rendererReady = ready;
	}

	setFailure(reason: string) {
		this._failureReason = reason;
	}
}
