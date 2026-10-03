export interface FrameContext {
	frame: number;
	fps: number;
	time: number;
	duration: number;
	durationMs: number;
	progress: number;
	deltaTime: number;
}

export interface GPUTextureBinding {
	nodeId: string;
	channel?: "primary" | "beat" | "bass" | "energy";
	textureView?: unknown;
	texture?: unknown;
	buffer?: unknown;
	stats?: { min: number; max: number };
}

export interface Signal<T> {
	readonly value: T;
	get(ctx?: FrameContext): T;
	peek(): T;
}

export interface WritableSignal<T> extends Signal<T> {
	value: T;
	set(value: T): void;
	update(fn: (prev: T) => T): void;
}

export interface FrameSignal<T = number> extends Signal<T> {
	readonly gpuBinding?: GPUTextureBinding;
	readonly fps?: number;
	seekFrame?(frame: number): void;
}

export type SignalContext = FrameContext;
export type SignalValue<T = unknown> =
	| T
	| Signal<T>
	| WritableSignal<T>
	| FrameSignal<T extends number ? number : T>;

// ---------------------------------------------------------------------------
// Dependency Tracking Engine
// ---------------------------------------------------------------------------

let activeComputed: ComputedImpl<unknown> | null = null;

export function registerSignalDependency(
	subscribers: Set<ComputedImpl<unknown>>,
): void {
	if (activeComputed !== null) {
		subscribers.add(activeComputed);
		activeComputed.deps.add(subscribers);
	}
}

export function isSignal(val: unknown): val is Signal<unknown> {
	return (
		val !== null &&
		typeof val === "object" &&
		"get" in val &&
		typeof (val as { get: unknown }).get === "function" &&
		"value" in val
	);
}

class StateSignalImpl<T> implements WritableSignal<T> {
	private _value: T;
	private _subscribers = new Set<ComputedImpl<unknown>>();

	constructor(initialValue: T) {
		this._value = initialValue;
	}

	get value(): T {
		return this.get();
	}

	set value(nextValue: T) {
		this.set(nextValue);
	}

	get(): T {
		if (activeComputed !== null) {
			this._subscribers.add(activeComputed);
			activeComputed.deps.add(this._subscribers);
		}
		return this._value;
	}

	peek(): T {
		return this._value;
	}

	set(nextValue: T): void {
		if (Object.is(this._value, nextValue)) return;
		this._value = nextValue;
		this.notifySubscribers();
	}

	update(fn: (prev: T) => T): void {
		this.set(fn(this._value));
	}

	private notifySubscribers(): void {
		if (this._subscribers.size === 0) return;
		const toNotify = Array.from(this._subscribers);
		for (const sub of toNotify) {
			sub.markDirty();
		}
	}

	valueOf(): T {
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
}

class ComputedImpl<T> implements Signal<T> {
	private _fn: () => T;
	private _value!: T;
	private _dirty = true;
	private _evaluating = false;
	public deps = new Set<Set<ComputedImpl<unknown>>>();
	private _subscribers = new Set<ComputedImpl<unknown>>();

	constructor(fn: () => T) {
		this._fn = fn;
	}

	get value(): T {
		return this.get();
	}

	get(): T {
		if (activeComputed !== null && activeComputed !== this) {
			this._subscribers.add(activeComputed);
			activeComputed.deps.add(this._subscribers);
		}

		if (this._dirty) {
			this.compute();
		}

		return this._value;
	}

	peek(): T {
		if (this._dirty) {
			this.compute();
		}
		return this._value;
	}

	public markDirty(): void {
		if (this._dirty) return;
		this._dirty = true;
		const toNotify = Array.from(this._subscribers);
		for (const sub of toNotify) {
			sub.markDirty();
		}
	}

	private compute(): void {
		if (this._evaluating) {
			throw new Error("Cyclic dependency detected in computed signal");
		}

		// Clear previous subscriptions
		for (const depSubSet of this.deps) {
			depSubSet.delete(this);
		}
		this.deps.clear();

		const prevActive = activeComputed;
		activeComputed = this;
		this._evaluating = true;

		try {
			this._value = this._fn();
			this._dirty = false;
		} finally {
			this._evaluating = false;
			activeComputed = prevActive;
		}
	}

	valueOf(): T {
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
}

class FrameArraySignalImpl implements FrameSignal<number> {
	public readonly gpuBinding?: GPUTextureBinding;
	public readonly fps: number;
	private _samples: ArrayLike<number>;
	private _cachedFrame = -1;
	private _cachedValue = 0;
	private _seekedFrame = -1;
	private _subscribers = new Set<ComputedImpl<unknown>>();

	constructor(
		samples: ArrayLike<number>,
		fps = 24,
		gpuBinding?: GPUTextureBinding,
	) {
		this._samples = samples;
		this.fps = fps;
		this.gpuBinding = gpuBinding;
		if (samples.length > 0) {
			this._cachedValue = samples[0];
		}
	}

	get value(): number {
		return this.get();
	}

	get(ctx?: FrameContext): number {
		if (activeComputed !== null) {
			this._subscribers.add(activeComputed);
			activeComputed.deps.add(this._subscribers);
		}
		frameSignal.get();

		const currentFrame =
			ctx?.frame ??
			(this._seekedFrame >= 0 ? this._seekedFrame : frameSignal.value);
		if (this._cachedFrame === currentFrame) {
			return this._cachedValue;
		}
		this._cachedFrame = currentFrame;

		if (!this._samples || this._samples.length === 0) {
			this._cachedValue = 0;
			return 0;
		}

		const compFps = ctx?.fps ?? this.fps;
		const targetFrame =
			compFps !== this.fps && compFps > 0
				? (currentFrame / compFps) * this.fps
				: currentFrame;

		const idx = Math.max(
			0,
			Math.min(this._samples.length - 1, Math.round(targetFrame)),
		);
		this._cachedValue = Number(this._samples[idx]) || 0;
		return this._cachedValue;
	}

	peek(): number {
		return this._cachedValue;
	}

	seekFrame(frame: number): void {
		this._seekedFrame = frame;
		this._cachedFrame = frame;
		if (!this._samples || this._samples.length === 0) {
			this._cachedValue = 0;
		} else {
			const idx = Math.max(
				0,
				Math.min(this._samples.length - 1, Math.round(frame)),
			);
			this._cachedValue = Number(this._samples[idx]) || 0;
		}
		for (const sub of this._subscribers) {
			sub.markDirty();
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
}

// ---------------------------------------------------------------------------
// Public Signal Constructors
// ---------------------------------------------------------------------------

export function signal<T>(initialValue: T): WritableSignal<T> {
	return new StateSignalImpl<T>(initialValue);
}

export function computed<T>(fn: () => T): Signal<T> {
	return new ComputedImpl<T>(fn);
}

export function frameArraySignal(
	samples: ArrayLike<number>,
	fps = 24,
	gpuBinding?: GPUTextureBinding,
): FrameSignal<number> {
	return new FrameArraySignalImpl(samples, fps, gpuBinding);
}

// ---------------------------------------------------------------------------
// Engine Time & Clock Signals
// ---------------------------------------------------------------------------

export const frameSignal: WritableSignal<number> = signal(0);
export const timeSignal: WritableSignal<number> = signal(0.0);
export const progressSignal: WritableSignal<number> = signal(0.0);

export function updateClockSignals(
	frame: number,
	fps = 24,
	durationMs?: number,
): void {
	frameSignal.set(frame);
	const timeSec = fps > 0 ? frame / fps : 0;
	timeSignal.set(timeSec);
	if (durationMs && durationMs > 0) {
		const durSec = durationMs / 1000;
		progressSignal.set(Math.max(0, Math.min(1, timeSec / durSec)));
	} else {
		progressSignal.set(0);
	}
}

// ---------------------------------------------------------------------------
// Procedural Signal Builder
// ---------------------------------------------------------------------------

export interface SignalBuilderConfig {
	type?: "sine" | "triangle" | "sawtooth" | "square" | "bounce" | "custom";
	frequency?: number;
	amplitude?: number;
	offset?: number;
	phase?: number;
	wgsl?: string;
	gpuBinding?: GPUTextureBinding;
	fn?: (ctx: FrameContext) => number;
}

class ProceduralSignalImpl implements FrameSignal<number> {
	public readonly gpuBinding?: GPUTextureBinding;
	private _config: SignalBuilderConfig;

	constructor(config: SignalBuilderConfig) {
		this._config = {
			type: "sine",
			frequency: 1.0,
			amplitude: 1.0,
			offset: 0.0,
			phase: 0.0,
			...config,
		};
		this.gpuBinding = config.gpuBinding;
	}

	get value(): number {
		return this.get();
	}

	get(ctx?: FrameContext): number {
		frameSignal.get();
		const frame = ctx?.frame ?? frameSignal.value;
		const fps = ctx?.fps ?? 24;
		const time = ctx?.time ?? (fps > 0 ? frame / fps : 0);

		if (this._config.fn) {
			return this._config.fn(
				ctx ?? {
					frame,
					fps,
					time,
					duration: 0,
					durationMs: 0,
					progress: 0,
					deltaTime: fps > 0 ? 1 / fps : 0,
				},
			);
		}

		const freq = this._config.frequency ?? 1.0;
		const amp = this._config.amplitude ?? 1.0;
		const off = this._config.offset ?? 0.0;
		const phase = this._config.phase ?? 0.0;
		const type = this._config.type ?? "sine";

		switch (type) {
			case "sine":
				return off + amp * Math.sin(2 * Math.PI * freq * time + phase);
			case "triangle":
				return (
					off +
					amp *
						(2 *
							Math.abs(
								2 *
									(time * freq +
										phase / (2 * Math.PI) -
										Math.floor(time * freq + phase / (2 * Math.PI) + 0.5)),
							) -
							1)
				);
			case "sawtooth":
				return (
					off +
					amp *
						(2 *
							(time * freq +
								phase / (2 * Math.PI) -
								Math.floor(time * freq + phase / (2 * Math.PI) + 0.5)))
				);
			case "square":
				return (
					off + (Math.sin(2 * Math.PI * freq * time + phase) >= 0 ? amp : -amp)
				);
			case "bounce": {
				const cycle = (time * freq) % 1;
				const raw = Math.abs(Math.sin(Math.PI * cycle));
				return off + amp * raw;
			}
			default:
				return off + amp * Math.sin(2 * Math.PI * freq * time + phase);
		}
	}

	peek(): number {
		return this.get();
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
}

export function signalBuilder(
	config: SignalBuilderConfig,
): FrameSignal<number> {
	return new ProceduralSignalImpl(config);
}

export interface SineSignalOptions {
	min?: number;
	max?: number;
	period?: number;
	frequency?: number;
	amplitude?: number;
	offset?: number;
	phase?: number;
}

export function sineSignal(
	options: SineSignalOptions = {},
): FrameSignal<number> {
	const min = options.min;
	const max = options.max;
	let amplitude = options.amplitude ?? 1.0;
	let offset = options.offset ?? 0.0;

	if (min !== undefined && max !== undefined) {
		offset = (min + max) / 2;
		amplitude = (max - min) / 2;
	} else if (min !== undefined) {
		offset = min + amplitude;
	} else if (max !== undefined) {
		offset = max - amplitude;
	}

	const period = options.period;
	const frequency = options.frequency;
	const phase = options.phase ?? 0.0;

	return signalBuilder({
		type: "custom",
		fn: (ctx: FrameContext) => {
			let angle: number;
			if (period !== undefined && period > 0) {
				angle = (2 * Math.PI * ctx.frame) / period + phase;
			} else {
				const freq = frequency ?? 1.0;
				angle = 2 * Math.PI * freq * ctx.time + phase;
			}
			return offset + amplitude * Math.sin(angle);
		},
	});
}

export function cosineSignal(
	options: SineSignalOptions = {},
): FrameSignal<number> {
	const min = options.min;
	const max = options.max;
	let amplitude = options.amplitude ?? 1.0;
	let offset = options.offset ?? 0.0;

	if (min !== undefined && max !== undefined) {
		offset = (min + max) / 2;
		amplitude = (max - min) / 2;
	} else if (min !== undefined) {
		offset = min + amplitude;
	} else if (max !== undefined) {
		offset = max - amplitude;
	}

	const period = options.period;
	const frequency = options.frequency;
	const phase = options.phase ?? 0.0;

	return signalBuilder({
		type: "custom",
		fn: (ctx: FrameContext) => {
			let angle: number;
			if (period !== undefined && period > 0) {
				angle = (2 * Math.PI * ctx.frame) / period + phase;
			} else {
				const freq = frequency ?? 1.0;
				angle = 2 * Math.PI * freq * ctx.time + phase;
			}
			return offset + amplitude * Math.cos(angle);
		},
	});
}

export {
	type GateSignalOptions,
	ProgrammaticSignal,
	type ProgrammaticSignalOptions,
	programmaticSignal,
} from "./programmatic.js";

import { programmaticSignal } from "./programmatic.js";

export const Signal = {
	state: signal,
	computed,
	builder: signalBuilder,
	fromArray: frameArraySignal,
	programmatic: programmaticSignal,
	frame: frameSignal,
	time: timeSignal,
	progress: progressSignal,
	sine: sineSignal,
	cosine: cosineSignal,
};
