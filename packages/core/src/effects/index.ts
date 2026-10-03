import {
	type FrameContext,
	type FrameSignal,
	isSignal,
	type Signal,
	signal,
	type WritableSignal,
} from "../signals/index.js";

export type EffectConfigValue<T> =
	| T
	| Signal<T>
	| WritableSignal<T>
	| FrameSignal<T>;

export type EffectConfig<T extends object> = {
	[K in keyof T]: EffectConfigValue<T[K]>;
};

export abstract class Effect<TConfig extends object = Record<string, unknown>> {
	public abstract readonly op: string;
	public readonly signals: {
		[K in keyof TConfig]: WritableSignal<TConfig[K]> | Signal<TConfig[K]>;
	};
	public readonly config: TConfig;
	private _frameHooks: Array<(ctx: FrameContext) => void> = [];

	constructor(initialConfig: TConfig) {
		this.config = { ...initialConfig };
		this.signals = {} as any;

		for (const [key, val] of Object.entries(initialConfig)) {
			if (isSignal(val)) {
				(this.signals as Record<string, unknown>)[key] = val;
			} else {
				(this.signals as Record<string, unknown>)[key] = signal(val);
			}
		}

		// Proxy for seamless property access and mutation:
		// e.g. `vignette.strength -= 0.1` updates `signals.strength.value`
		return new Proxy(this, {
			get(target, prop, receiver) {
				if (typeof prop === "string" && prop in target.signals) {
					const sig = (target.signals as Record<string, Signal<unknown>>)[prop];
					return sig ? sig.value : undefined;
				}
				return Reflect.get(target, prop, receiver);
			},
			set(target, prop, val, receiver) {
				if (typeof prop === "string" && prop in target.signals) {
					const currentSig = (target.signals as Record<string, unknown>)[prop];
					if (isSignal(val)) {
						(target.signals as Record<string, unknown>)[prop] = val;
						(target.config as Record<string, unknown>)[prop] = val;
					} else if (
						currentSig &&
						typeof (currentSig as { set?: unknown }).set === "function"
					) {
						(currentSig as WritableSignal<unknown>).set(val);
						(target.config as Record<string, unknown>)[prop] = val;
					} else {
						(target.signals as Record<string, unknown>)[prop] = signal(val);
						(target.config as Record<string, unknown>)[prop] = val;
					}
					return true;
				}
				return Reflect.set(target, prop, val, receiver);
			},
		});
	}

	/**
	 * Game-engine per-frame lifecycle hook.
	 * Invoked before rendering each frame so scripts or agents can mutate properties.
	 */
	public onRequestFrame(callback: (ctx: FrameContext) => void): this {
		this._frameHooks.push(callback);
		return this;
	}

	public notifyFrame(ctx: FrameContext): void {
		for (const hook of this._frameHooks) {
			hook(ctx);
		}
	}

	/**
	 * Samples concrete scalar / config values for the current frame.
	 */
	public resolveUniforms(ctx?: FrameContext): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, sig] of Object.entries(this.signals)) {
			out[k] = (sig as Signal<unknown>).get(ctx);
		}
		return out;
	}

	/**
	 * Returns WebGPU texture bindings attached to any property signal.
	 */
	public resolveTextures(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const [k, sig] of Object.entries(this.signals)) {
			const gpu = (sig as FrameSignal<unknown>).gpuBinding;
			if (gpu?.textureView) {
				out[`${k}TextureView`] = gpu.textureView;
			}
			if (gpu?.texture) {
				out[`${k}Texture`] = gpu.texture;
			}
		}
		return out;
	}

	/**
	 * Converts the effect into an operation node for the VirtualMediaData AST.
	 */
	public toOperation(): Record<string, unknown> {
		const opPayload: Record<string, unknown> = {
			op: this.op,
			effect: this,
			onRequestFrame: (ctx: FrameContext) => this.notifyFrame(ctx),
			signals: this.signals,
			...this.config,
		};

		// Attach signals onto op payload while preserving scalar primitives for strings/booleans
		for (const [k, sig] of Object.entries(this.signals)) {
			const orig = (this.config as Record<string, unknown>)[k];
			if (
				!isSignal(orig) &&
				(typeof orig === "string" || typeof orig === "boolean")
			) {
				opPayload[k] = (sig as Signal<unknown>).value;
			} else {
				opPayload[k] = sig;
			}
		}

		return opPayload;
	}
}
