import {
	type FrameContext,
	type FrameSignal,
	frameSignal,
	type GPUTextureBinding,
	isSignal,
	registerSignalDependency,
	type Signal,
} from "./index.js";

export interface ProgrammaticSignalOptions {
	readonly fps?: number;
	readonly durationFrames?: number;
	readonly gpuBinding?: GPUTextureBinding;
	readonly nodeId?: string;
	readonly label?: string;
}

export interface GateSignalOptions {
	readonly mode?: "gate" | "trigger" | "toggle";
	readonly debounceFrames?: number;
	readonly holdFrames?: number;
	readonly invert?: boolean;
}

type EvaluatorFn = (ctx: FrameContext) => number;

export class ProgrammaticSignal implements FrameSignal<number> {
	public readonly gpuBinding?: GPUTextureBinding;
	public readonly label?: string;
	private _evaluator: EvaluatorFn;
	private _samples?: Float32Array;
	private _fps: number;
	private _durationFrames?: number;
	private _cachedFrame = -1;
	private _cachedValue = 0;
	private _seekedFrame = -1;
	private _subscribers = new Set<{ markDirty(): void }>();
	private _children = new Set<ProgrammaticSignal>();

	public get fps(): number {
		return this._fps;
	}

	constructor(
		source: number | ArrayLike<number> | EvaluatorFn | Signal<number>,
		options: ProgrammaticSignalOptions = {},
	) {
		this._fps = options.fps ?? 24;
		this._durationFrames = options.durationFrames;
		this.gpuBinding = options.gpuBinding;
		this.label = options.label;

		if (typeof source === "number") {
			const constVal = source;
			this._evaluator = () => constVal;
			this._cachedValue = constVal;
		} else if (typeof source === "function") {
			this._evaluator = source;
		} else if (isSignal(source)) {
			this._evaluator = (ctx) => Number(source.get(ctx)) || 0;
		} else {
			// ArrayLike<number>
			const arr = source;
			this._samples =
				arr instanceof Float32Array ? arr : new Float32Array(Array.from(arr));
			this._durationFrames = this._samples.length;
			this._cachedValue = this._samples.length > 0 ? this._samples[0] : 0;
			this._evaluator = (ctx) => {
				if (!this._samples || this._samples.length === 0) return 0;
				const compFps = ctx.fps ?? this._fps;
				const targetFrame =
					compFps !== this._fps && compFps > 0
						? (ctx.frame / compFps) * this._fps
						: ctx.frame;
				const idx = Math.max(
					0,
					Math.min(this._samples.length - 1, Math.round(targetFrame)),
				);
				return this._samples[idx];
			};
		}
	}

	get value(): number {
		return this.get();
	}

	get(ctx?: FrameContext): number {
		registerSignalDependency(this._subscribers);
		frameSignal.get();

		const currentFrame =
			ctx?.frame ??
			(this._seekedFrame >= 0 ? this._seekedFrame : frameSignal.value);

		if (this._cachedFrame === currentFrame) {
			return this._cachedValue;
		}

		const fps = ctx?.fps ?? this._fps;
		const time = ctx?.time ?? (fps > 0 ? currentFrame / fps : 0);
		const duration = ctx?.duration ?? this._durationFrames ?? 100;
		const durationMs = ctx?.durationMs ?? (duration / fps) * 1000;
		const progress = duration > 0 ? currentFrame / duration : 0;
		const deltaTime = ctx?.deltaTime ?? (fps > 0 ? 1 / fps : 0.0416);

		const resolvedCtx: FrameContext = {
			frame: currentFrame,
			fps,
			time,
			duration,
			durationMs,
			progress,
			deltaTime,
		};

		this._cachedFrame = currentFrame;
		this._cachedValue = this._evaluator(resolvedCtx);
		return this._cachedValue;
	}

	peek(): number {
		return this._cachedValue;
	}

	public registerChild(child: ProgrammaticSignal): void {
		this._children.add(child);
	}

	private _derive(
		evaluator: EvaluatorFn,
		options?: ProgrammaticSignalOptions,
		other?: Signal<number>,
	): ProgrammaticSignal {
		const child = new ProgrammaticSignal(evaluator, {
			fps: this._fps,
			durationFrames: this._durationFrames,
			...options,
		});
		this._children.add(child);
		if (other instanceof ProgrammaticSignal) {
			other.registerChild(child);
		}
		return child;
	}

	seekFrame(frame: number): void {
		this._seekedFrame = frame;
		this._cachedFrame = -1;
		for (const sub of this._subscribers) {
			sub.markDirty();
		}
		for (const child of this._children) {
			child.seekFrame(frame);
		}
	}

	invalidate(): void {
		this._cachedFrame = -1;
		for (const sub of this._subscribers) {
			sub.markDirty();
		}
		for (const child of this._children) {
			child.invalidate();
		}
	}

	valueOf(): number {
		return this.get();
	}

	[Symbol.toPrimitive](hint: string): unknown {
		if (hint === "number") {
			return Number(this.get());
		}
		if (hint === "string") {
			return String(this.get());
		}
		return this.get();
	}

	// ── Fluent Combinators & Filter Operations ────────────────────────────

	smooth(windowFrames: number): ProgrammaticSignal {
		const window = Math.max(1, Math.round(windowFrames));
		if (window <= 1) return this;

		return this._derive(
			(ctx) => {
				let sum = 0;
				let count = 0;
				const startF = Math.max(0, ctx.frame - window + 1);
				for (let f = startF; f <= ctx.frame; f++) {
					sum += this.get({ ...ctx, frame: f, time: f / ctx.fps });
					count++;
				}
				return count > 0 ? sum / count : 0;
			},
			{
				label: `${this.label ?? "sig"}_smoothed(${window})`,
			},
		);
	}

	remap(
		inMin: number,
		inMax: number,
		outMin: number,
		outMax: number,
		clamp = false,
	): ProgrammaticSignal {
		const inRange = inMax - inMin;
		const outRange = outMax - outMin;

		return this._derive(
			(ctx) => {
				const val = this.get(ctx);
				const norm = inRange !== 0 ? (val - inMin) / inRange : 0;
				const remapped = outMin + norm * outRange;
				if (clamp) {
					const lo = Math.min(outMin, outMax);
					const hi = Math.max(outMin, outMax);
					return Math.max(lo, Math.min(hi, remapped));
				}
				return remapped;
			},
			{
				label: `${this.label ?? "sig"}_remap`,
			},
		);
	}

	clamp(min: number, max: number): ProgrammaticSignal {
		const lo = Math.min(min, max);
		const hi = Math.max(min, max);
		return this._derive((ctx) => Math.max(lo, Math.min(hi, this.get(ctx))), {
			label: `${this.label ?? "sig"}_clamped`,
		});
	}

	gate(threshold: number, options: GateSignalOptions = {}): ProgrammaticSignal {
		const mode = options.mode ?? "gate";
		const debounce = Math.max(1, options.debounceFrames ?? 2);
		const hold = Math.max(1, options.holdFrames ?? 4);
		const invert = Boolean(options.invert);

		return this._derive(
			(ctx) => {
				const currentF = ctx.frame;
				let out = 0.0;

				if (mode === "gate") {
					const val = this.get(ctx);
					out = val >= threshold ? 1.0 : 0.0;
				} else if (mode === "trigger") {
					let lastTrigger = -Infinity;
					const startF = Math.max(0, currentF - 120);
					for (let f = startF; f <= currentF; f++) {
						const v = this.get({ ...ctx, frame: f, time: f / ctx.fps });
						const prev =
							f > 0
								? this.get({ ...ctx, frame: f - 1, time: (f - 1) / ctx.fps })
								: 0;
						if (
							v >= threshold &&
							prev < threshold &&
							f - lastTrigger >= debounce
						) {
							lastTrigger = f;
						}
					}
					out =
						currentF >= lastTrigger && currentF < lastTrigger + hold
							? 1.0
							: 0.0;
				} else if (mode === "toggle") {
					let toggleCount = 0;
					let lastTrigger = -Infinity;
					for (let f = 0; f <= currentF; f++) {
						const v = this.get({ ...ctx, frame: f, time: f / ctx.fps });
						const prev =
							f > 0
								? this.get({ ...ctx, frame: f - 1, time: (f - 1) / ctx.fps })
								: 0;
						if (
							v >= threshold &&
							prev < threshold &&
							f - lastTrigger >= debounce
						) {
							toggleCount++;
							lastTrigger = f;
						}
					}
					out = toggleCount % 2 === 1 ? 1.0 : 0.0;
				}

				return invert ? 1.0 - out : out;
			},
			{
				label: `${this.label ?? "sig"}_gate(${threshold})`,
			},
		);
	}

	velocity(dt = 1): ProgrammaticSignal {
		const step = Math.max(1, Math.round(dt));
		return this._derive(
			(ctx) => {
				const curr = this.get(ctx);
				const prevF = Math.max(0, ctx.frame - step);
				const prev = this.get({
					...ctx,
					frame: prevF,
					time: prevF / ctx.fps,
				});
				const deltaSec = step / ctx.fps;
				return deltaSec > 0 ? (curr - prev) / deltaSec : curr - prev;
			},
			{
				label: `${this.label ?? "sig"}_velocity`,
			},
		);
	}

	delay(frames: number): ProgrammaticSignal {
		const shift = Math.max(0, Math.round(frames));
		return this._derive(
			(ctx) => {
				const delayedF = Math.max(0, ctx.frame - shift);
				return this.get({
					...ctx,
					frame: delayedF,
					time: delayedF / ctx.fps,
				});
			},
			{
				label: `${this.label ?? "sig"}_delay(${shift})`,
			},
		);
	}

	spring(stiffness = 150, damping = 12): ProgrammaticSignal {
		// Second-order physical spring-damper simulator
		return this._derive(
			(ctx) => {
				const targetFrame = ctx.frame;
				if (targetFrame <= 0) return this.get(ctx);

				let pos = this.get({ ...ctx, frame: 0, time: 0 });
				let vel = 0.0;
				const dt = 1.0 / Math.max(1, ctx.fps);

				// Integrate forward from 0 to current frame
				for (let f = 1; f <= targetFrame; f++) {
					const targetVal = this.get({
						...ctx,
						frame: f,
						time: f / ctx.fps,
					});
					const displacement = pos - targetVal;
					const force = -stiffness * displacement - damping * vel;
					vel += force * dt;
					pos += vel * dt;
				}

				return pos;
			},
			{
				label: `${this.label ?? "sig"}_spring`,
			},
		);
	}

	add(other: number | Signal<number>): ProgrammaticSignal {
		if (typeof other === "number") {
			return this._derive((ctx) => this.get(ctx) + other);
		}
		return this._derive(
			(ctx) => this.get(ctx) + (Number(other.get(ctx)) || 0),
			undefined,
			other,
		);
	}

	subtract(other: number | Signal<number>): ProgrammaticSignal {
		if (typeof other === "number") {
			return this._derive((ctx) => this.get(ctx) - other);
		}
		return this._derive(
			(ctx) => this.get(ctx) - (Number(other.get(ctx)) || 0),
			undefined,
			other,
		);
	}

	multiply(factor: number | Signal<number>): ProgrammaticSignal {
		if (typeof factor === "number") {
			return this._derive((ctx) => this.get(ctx) * factor);
		}
		return this._derive(
			(ctx) => this.get(ctx) * (Number(factor.get(ctx)) || 0),
			undefined,
			factor,
		);
	}

	invert(): ProgrammaticSignal {
		return this._derive((ctx) => 1.0 - this.get(ctx), {
			label: `${this.label ?? "sig"}_inverted`,
		});
	}

	pow(exponent: number): ProgrammaticSignal {
		return this._derive((ctx) => this.get(ctx) ** exponent);
	}

	map(fn: (val: number, ctx: FrameContext) => number): ProgrammaticSignal {
		return this._derive((ctx) => fn(this.get(ctx), ctx));
	}

	toFrameArray(totalFrames: number, fps?: number): Float32Array {
		const count = Math.max(1, totalFrames);
		const f = fps ?? this._fps;
		const out = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			out[i] = this.get({
				frame: i,
				fps: f,
				time: i / f,
				duration: count,
				durationMs: (count / f) * 1000,
				progress: i / count,
				deltaTime: 1 / f,
			});
		}
		return out;
	}
}

export function programmaticSignal(
	source: number | ArrayLike<number> | EvaluatorFn | Signal<number>,
	options?: ProgrammaticSignalOptions,
): ProgrammaticSignal {
	return new ProgrammaticSignal(source, options);
}
