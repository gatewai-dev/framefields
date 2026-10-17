/**
 * Browser / WebGPU session provider .
 *
 * Mirrors `NodeSessionProvider` but uses `onnxruntime-web` with the WebGPU execution provider
 * and a WASM fallback. The ORT module is imported lazily behind an injectable loader, so:
 *  - the Node core entry never pulls browser code, and
 *  - unit tests can run fully offline with a fake module.
 *
 * `onnxruntime-web` is an OPTIONAL peer dependency — consumers of `@framefields/vision/web`
 * provide it; the main `@framefields/vision` entry never touches it.
 */

import type {
	SessionProvider,
	VisionSession,
	VisionTensorInput,
	VisionTensorOutputs,
} from "./session-provider.js";

/** An execution provider with options, e.g. `{ name: "webgpu", preferredLayout: "NCHW" }`. */
export interface OrtWebExecutionProvider {
	readonly name: string;
	readonly preferredLayout?: "NCHW" | "NHWC";
	/** WebGPU: run on this device instead of one onnxruntime-web creates. */
	readonly device?: GPUDevice;
}

/** Minimal structural view of the `onnxruntime-web` module — isolates the ORT API surface. */
export interface OrtWebTensor {
	readonly data: Float32Array | BigInt64Array | Int32Array;
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
				executionProviders: (string | OrtWebExecutionProvider)[];
				graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
				/** 0 verbose … 4 fatal. */
				logSeverityLevel?: 0 | 1 | 2 | 3 | 4;
			},
		): Promise<OrtWebSession>;
	};
	/** ORT tensor constructor (called with `new`), with `fromGpuBuffer` on WebGPU builds. */
	readonly Tensor: (new (
		type: "float32",
		data: Float32Array,
		dims: readonly number[],
	) => unknown) & {
		fromGpuBuffer?(
			buffer: GPUBuffer,
			options: { dataType: "float32"; dims: readonly number[] },
		): unknown;
	};
}

export interface WebGPUProviderOptions {
	/** Injected ORT loader — defaults to a dynamic `import("onnxruntime-web")`. */
	readonly loader?: () => Promise<OrtWebModule>;
	/** Execution providers in priority order. Defaults to `["webgpu", "wasm"]`. */
	readonly executionProviders?: readonly string[];
	/** Fall back to WASM automatically if the WebGPU session fails to create. Default true. */
	readonly wasmFallback?: boolean;
	/**
	 * Run WebGPU sessions on this device (e.g. the renderer's) instead of one
	 * onnxruntime-web creates. Sessions then accept `gpuBuffer` inputs from it.
	 */
	readonly device?: GPUDevice;
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
	public readonly device?: GPUDevice;

	constructor(options: WebGPUProviderOptions = {}) {
		this._loader = options.loader ?? defaultLoader;
		this._providers = options.executionProviders ?? ["webgpu", "wasm"];
		this._wasmFallback = options.wasmFallback !== false;
		this.device = options.device;
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

	public async createSession(modelBytes: Uint8Array): Promise<VisionSession> {
		const ort = await this.ort();

		let session: OrtWebSession;
		try {
			const device = this.device;
			session = await ort.InferenceSession.create(modelBytes, {
				executionProviders: this._providers.map((name) =>
					withProviderOptions(name, device),
				),
				graphOptimizationLevel: "all",
				// Errors only: node-placement notes print as console errors otherwise.
				logSeverityLevel: 3,
			});
		} catch (err) {
			if (!this._wasmFallback || !this._providers.includes("webgpu")) throw err;
			session = await ort.InferenceSession.create(modelBytes, {
				executionProviders: ["wasm"],
				graphOptimizationLevel: "all",
				// Errors only: node-placement notes print as console errors otherwise.
				logSeverityLevel: 3,
			});
		}

		return {
			run: async (input: VisionTensorInput): Promise<VisionTensorOutputs> => {
				const inputName = session.inputNames.includes(input.name)
					? input.name
					: (session.inputNames[0] ?? input.name);
				const tensor =
					input.gpuBuffer && ort.Tensor.fromGpuBuffer
						? ort.Tensor.fromGpuBuffer(input.gpuBuffer, {
								dataType: "float32",
								dims: [...input.dims],
							})
						: new ort.Tensor("float32", input.data, [...input.dims]);
				const results = await session.run({ [inputName]: tensor });
				const outputs: Record<string, VisionTensorOutputs[string]> = {};
				for (const [name, tensor] of Object.entries(results)) {
					outputs[name] = {
						data: tensor.data,
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
 * `@framefields/vision/web` stays tree-shakeable.
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

/**
 * The WebGPU EP runs in NCHW. Its default NHWC layout computes grouped convolutions wrong
 * when the channels per group aren't a multiple of 4 (onnxruntime-web 1.30) — RTMO's head
 * has group=8 convs over 104 channels (13 per group), which turned one dancer into several
 * skeletons. NCHW matches the CPU EP on every pinned model.
 */
function withProviderOptions(
	name: string,
	device: GPUDevice | undefined,
): string | OrtWebExecutionProvider {
	if (name !== "webgpu") return name;
	return device
		? { name, preferredLayout: "NCHW", device }
		: { name, preferredLayout: "NCHW" };
}
