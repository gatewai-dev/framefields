/**
 * Browser / WebGPU session provider (specs/yolov4plan.ts §Phase E).
 *
 * Mirrors `NodeSessionProvider` but uses `onnxruntime-web` with the WebGPU execution provider
 * and a WASM fallback. The ORT module is imported lazily behind an injectable loader, so:
 *  - the Node core entry never pulls browser code, and
 *  - unit tests can run fully offline with a fake module.
 *
 * `onnxruntime-web` is an OPTIONAL peer dependency — consumers of `@gitframes/yolo/web`
 * provide it; the main `@gitframes/yolo` entry never touches it.
 */

import type {
	SessionProvider,
	YoloSession,
	YoloTensorInput,
	YoloTensorOutputs,
} from "./session-provider.js";

/** Minimal structural view of the `onnxruntime-web` module — isolates the ORT API surface. */
export interface OrtWebTensor {
	readonly data: Float32Array;
	readonly dims: readonly number[];
}

export interface OrtWebSession {
	readonly inputNames: readonly string[];
	run(feeds: Record<string, unknown>): Promise<Record<string, OrtWebTensor>>;
	release(): Promise<void>;
}

export interface OrtWebModule {
	readonly InferenceSession: {
		create(
			modelBytes: Uint8Array,
			options: {
				executionProviders: string[];
				graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
			},
		): Promise<OrtWebSession>;
	};
	/** ORT tensor constructor (called with `new`). */
	readonly Tensor: new (
		type: "float32",
		data: Float32Array,
		dims: readonly number[],
	) => unknown;
}

export interface WebGPUProviderOptions {
	/** Injected ORT loader — defaults to a dynamic `import("onnxruntime-web")`. */
	readonly loader?: () => Promise<OrtWebModule>;
	/** Execution providers in priority order. Defaults to `["webgpu", "wasm"]`. */
	readonly executionProviders?: readonly string[];
	/** Fall back to WASM automatically if the WebGPU session fails to create. Default true. */
	readonly wasmFallback?: boolean;
}

const ORT_WEB_SPECIFIER = "onnxruntime-web";

const defaultLoader = (): Promise<OrtWebModule> =>
	import(
		/* @vite-ignore */ ORT_WEB_SPECIFIER
	) as unknown as Promise<OrtWebModule>;

export class WebGPUProvider implements SessionProvider {
	public readonly kind = "webgpu" as const;

	private readonly _loader: () => Promise<OrtWebModule>;
	private readonly _providers: readonly string[];
	private readonly _wasmFallback: boolean;
	private _ortPromise?: Promise<OrtWebModule>;

	constructor(options: WebGPUProviderOptions = {}) {
		this._loader = options.loader ?? defaultLoader;
		this._providers = options.executionProviders ?? ["webgpu", "wasm"];
		this._wasmFallback = options.wasmFallback !== false;
	}

	private ort(): Promise<OrtWebModule> {
		if (!this._ortPromise) {
			this._ortPromise = this._loader().catch((err: unknown) => {
				this._ortPromise = undefined;
				throw new Error(
					`onnxruntime-web failed to load (${String(err)}). ` +
						"Install it in the browser bundle or pass a custom loader.",
				);
			});
		}
		return this._ortPromise;
	}

	public async createSession(
		modelBytes: Uint8Array,
		_opts: { imgsz: number; fp16?: boolean },
	): Promise<YoloSession> {
		const ort = await this.ort();

		let session: OrtWebSession;
		try {
			session = await ort.InferenceSession.create(modelBytes, {
				executionProviders: [...this._providers],
				graphOptimizationLevel: "all",
			});
		} catch (err) {
			if (!this._wasmFallback || !this._providers.includes("webgpu")) throw err;
			session = await ort.InferenceSession.create(modelBytes, {
				executionProviders: ["wasm"],
				graphOptimizationLevel: "all",
			});
		}

		return {
			run: async (
				input: YoloTensorInput | readonly YoloTensorInput[],
			): Promise<YoloTensorOutputs> => {
				const inputs = Array.isArray(input) ? input : [input];
				const feeds: Record<string, unknown> = {};
				for (const inp of inputs) {
					const inputName = session.inputNames.includes(inp.name)
						? inp.name
						: (session.inputNames[0] ?? inp.name);
					feeds[inputName] = new ort.Tensor("float32", inp.data, [...inp.dims]);
				}
				const results = await session.run(feeds);
				const outputs: Record<string, YoloTensorOutputs[string]> = {};
				for (const [name, tensor] of Object.entries(results)) {
					outputs[name] = {
						data: tensor.data as Float32Array,
						dims: [...tensor.dims],
					};
				}
				return outputs;
			},
			release: () => {
				void session.release();
			},
		};
	}
}

/**
 * Convenience factory: a `SessionProvider` type guard for the browser entry. Kept tiny so
 * `@gitframes/yolo/web` stays tree-shakeable.
 */
export function createWebGPUProvider(
	options?: WebGPUProviderOptions,
): WebGPUProvider {
	return new WebGPUProvider(options);
}

/** True when the environment exposes a WebGPU device (synchronous capability probe). */
export function hasWebGPU(): boolean {
	return typeof navigator !== "undefined" && "gpu" in navigator;
}
