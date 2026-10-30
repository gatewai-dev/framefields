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

import { needsNchwLayout } from "../model/conv-layout.js";
import type {
	SessionProvider,
	VisionSession,
	VisionSessionOptions,
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
				externalData?: { path: string; data: Uint8Array }[];
				graphOptimizationLevel?: "disabled" | "basic" | "extended" | "all";
				/** 0 verbose … 4 fatal. */
				logSeverityLevel?: 0 | 1 | 2 | 3 | 4;
			},
		): Promise<OrtWebSession>;
	};
	/** ORT tensor constructor (called with `new`), with `fromGpuBuffer` on WebGPU builds. */
	readonly Tensor: (new (
		type: "float32" | "int32" | "int64" | "bool",
		data: Float32Array | Int32Array | BigInt64Array | Uint8Array,
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

	private async createOrtSession(
		ort: OrtWebModule,
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<OrtWebSession> {
		try {
			const device = this.device;
			const layout = needsNchwLayout(modelBytes) ? "NCHW" : "NHWC";
			return await ort.InferenceSession.create(modelBytes, {
				executionProviders: this._providers.map((name) =>
					withProviderOptions(name, device, layout),
				),
				graphOptimizationLevel: "all",
				externalData: options?.externalData?.map(({ path, data }) => ({
					path,
					data,
				})),
				// Errors only: node-placement notes print as console errors otherwise.
				logSeverityLevel: 3,
			});
		} catch (err) {
			if (!this._wasmFallback || !this._providers.includes("webgpu")) throw err;
			return await ort.InferenceSession.create(modelBytes, {
				executionProviders: ["wasm"],
				graphOptimizationLevel: "all",
				externalData: options?.externalData?.map(({ path, data }) => ({
					path,
					data,
				})),
				// Errors only: node-placement notes print as console errors otherwise.
				logSeverityLevel: 3,
			});
		}
	}

	public async createSession(
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<VisionSession> {
		const ort = await this.ort();
		const session = await exclusive(ort, () =>
			this.createOrtSession(ort, modelBytes, options),
		);

		const runMany = async (
			inputs: readonly VisionTensorInput[],
		): Promise<VisionTensorOutputs> => {
			const feeds: Record<string, unknown> = {};
			for (const input of inputs) {
				const name =
					inputs.length === 1 && !session.inputNames.includes(input.name)
						? (session.inputNames[0] ?? input.name)
						: input.name;
				if (input.gpuBuffer && !(input.data instanceof Float32Array)) {
					throw new Error("GPU-buffer vision inputs must be float32.");
				}
				feeds[name] =
					input.gpuBuffer && ort.Tensor.fromGpuBuffer
						? ort.Tensor.fromGpuBuffer(input.gpuBuffer, {
								dataType: "float32",
								dims: [...input.dims],
							})
						: new ort.Tensor(
								input.data instanceof Uint8Array
									? "bool"
									: input.data instanceof BigInt64Array
										? "int64"
										: input.data instanceof Int32Array
											? "int32"
											: "float32",
								input.data,
								[...input.dims],
							);
			}
			const results = await exclusive(ort, () => session.run(feeds));
			const outputs: Record<string, VisionTensorOutputs[string]> = {};
			for (const [name, tensor] of Object.entries(results)) {
				outputs[name] = {
					data: tensor.data,
					dims: [...tensor.dims],
				};
			}
			return outputs;
		};
		return {
			run: (input) => runMany([input]),
			runMany,
			release: () => {
				void exclusive(ort, () => session.release());
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
	preferredLayout: "NCHW" | "NHWC",
): string | OrtWebExecutionProvider {
	if (name !== "webgpu") return name;
	return device ? { name, preferredLayout, device } : { name, preferredLayout };
}

/**
 * ORT Web's WebGPU build takes one call at a time per runtime: a concurrent session create
 * throws, and a run entered while another awaits the GPU corrupts its wasm heap. Every
 * create, run and release on one module therefore queues here.
 */
const queues = new WeakMap<OrtWebModule, Promise<unknown>>();

function exclusive<T>(ort: OrtWebModule, call: () => Promise<T>): Promise<T> {
	const result = (queues.get(ort) ?? Promise.resolve()).then(call, call);
	queues.set(
		ort,
		result.catch(() => undefined),
	);
	return result;
}
