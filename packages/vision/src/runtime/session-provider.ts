import { NodeWebGPUProvider } from "./node-webgpu-provider.js";

/**
 * Minimal ONNX Runtime surface — isolates the ORT API to exactly two files so the decode
 * and signals layers never touch it. Node path uses onnxruntime-node (CPU EP); the web
 * entry can swap in a WebGPU-backed provider with the same interface.
 */

/** Model output tensor. Integer outputs (e.g. RTMDet-Ins `labels`) arrive as BigInt64Array. */
export interface VisionTensor {
	readonly data: Float32Array | BigInt64Array | Int32Array;
	readonly dims: readonly number[];
}

export interface VisionTensorInput {
	readonly name: string;
	readonly data: Float32Array;
	readonly dims: readonly number[];
}

export type VisionTensorOutputs = Readonly<Record<string, VisionTensor>>;

export interface VisionSession {
	run(input: VisionTensorInput): Promise<VisionTensorOutputs>;
	release(): void;
}

export interface SessionProvider {
	readonly kind: "node" | "webgpu";
	createSession(modelBytes: Uint8Array): Promise<VisionSession>;
}

let defaultProvider: (() => SessionProvider) | undefined;

/**
 * Sets the provider runners use when none is passed, for hosts that create
 * runners indirectly (e.g. a browser player rendering vision nodes). `undefined`
 * restores the default, onnxruntime-node.
 */
export function setDefaultSessionProvider(
	factory: (() => SessionProvider) | undefined,
): void {
	defaultProvider = factory;
}

/**
 * Prefers the GPU (onnxruntime-web's WebGPU EP on the process's WebGPU device —
 * the Dawn device the renderer already creates, or one this ensures) and falls
 * back to the CPU provider (onnxruntime-node) when a WebGPU session cannot be
 * created: no device, no Dawn, or the EP unavailable. The choice is made on the
 * first session and reused for the runner's lifetime.
 */
export class AutoSessionProvider implements SessionProvider {
	private _resolved?: SessionProvider;

	public get kind(): "node" | "webgpu" {
		return this._resolved?.kind ?? "webgpu";
	}

	public async createSession(modelBytes: Uint8Array): Promise<VisionSession> {
		if (!this._resolved) {
			const webgpu = new NodeWebGPUProvider({ wasmFallback: false });
			try {
				const session = await webgpu.createSession(modelBytes);
				this._resolved = webgpu;
				return session;
			} catch {
				// WebGPU isn't possible here — use CPU from now on.
				this._resolved = new NodeSessionProvider();
			}
		}
		return this._resolved.createSession(modelBytes);
	}
}

/**
 * The provider for a runner created without one: GPU if possible, otherwise CPU.
 */
export function createDefaultSessionProvider(): SessionProvider {
	return defaultProvider?.() ?? new AutoSessionProvider();
}

/** onnxruntime-node provider. The native module is imported lazily on first session. */
export class NodeSessionProvider implements SessionProvider {
	public readonly kind = "node" as const;

	private ortPromise?: Promise<typeof import("onnxruntime-node")>;

	private async ort(): Promise<typeof import("onnxruntime-node")> {
		if (!this.ortPromise) {
			this.ortPromise = import("onnxruntime-node").catch((err: unknown) => {
				this.ortPromise = undefined;
				throw new Error(
					`onnxruntime-node failed to load (${String(err)}). ` +
						"Install it in the environment or provide a custom SessionProvider.",
				);
			});
		}
		return this.ortPromise;
	}

	public async createSession(modelBytes: Uint8Array): Promise<VisionSession> {
		const ort = await this.ort();
		const session = await ort.InferenceSession.create(modelBytes, {
			executionProviders: ["cpu"],
			graphOptimizationLevel: "all",
		});
		type OrtTensor = InstanceType<typeof ort.Tensor>;

		return {
			run: async (input: VisionTensorInput): Promise<VisionTensorOutputs> => {
				const inputName = session.inputNames.includes(input.name)
					? input.name
					: (session.inputNames[0] ?? input.name);
				const feeds: Record<string, OrtTensor> = {
					[inputName]: new ort.Tensor("float32", input.data, [...input.dims]),
				};
				const results = await session.run(feeds);
				const outputs: Record<string, VisionTensor> = {};
				for (const [name, tensor] of Object.entries(results)) {
					outputs[name] = {
						data: tensor.data as VisionTensor["data"],
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
