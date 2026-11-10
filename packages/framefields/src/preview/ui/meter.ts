/**
 * Frame rate reached: distinct frames shown per second while playing, over
 * the last 2 s, stalls included. The film's own rate is in the meta.
 */
export type MeterReading =
	| { state: "paused"; fps: number | null }
	| { state: "measuring"; fps: null }
	| { state: "playing"; fps: number };

const WINDOW_MS = 2000;

export class FpsMeter {
	#started: number | null = null;
	#lastFrame: number | null = null;
	#samples: number[] = [];
	#lastFps: number | null = null;

	constructor(
		/** The film's rate: counting whole frames in the window can overshoot it. */
		private readonly cap: () => number = () => Number.POSITIVE_INFINITY,
		private readonly now: () => number = () => performance.now(),
	) {}

	read(): MeterReading {
		if (this.#started === null) return { state: "paused", fps: this.#lastFps };
		const now = this.now();
		const elapsed = Math.min(WINDOW_MS, now - this.#started);
		this.#samples = this.#samples.filter((t) => t > now - WINDOW_MS);
		if (elapsed < 1000) return { state: "measuring", fps: null };
		return {
			state: "playing",
			fps: Math.min(this.cap(), (this.#samples.length * 1000) / elapsed),
		};
	}

	start(): void {
		this.#started = this.now();
		this.#lastFrame = null;
		this.#samples = [];
	}

	stop(): void {
		if (this.#started === null) return;
		// A playback too short to measure leaves no rate, not an older one.
		const r = this.read();
		this.#lastFps = r.state === "playing" ? r.fps : null;
		this.#started = null;
		this.#samples = [];
	}

	record(frame: number): void {
		if (this.#started === null || frame === this.#lastFrame) return;
		this.#lastFrame = frame;
		this.#samples.push(this.now());
	}
}
