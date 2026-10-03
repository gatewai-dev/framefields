/**
 * Minimal ONNX Runtime surface — isolates the ORT API to exactly two files so the decode
 * and signals layers never touch it. Node path uses onnxruntime-node (CPU EP); the web
 * entry can swap in a WebGPU-backed provider with the same interface.
 */

export interface YoloTensor {
	readonly data: Float32Array;
	readonly dims: readonly number[];
}

export interface YoloTensorInput {
	readonly name: string;
	readonly data: Float32Array;
	readonly dims: readonly number[];
}

export type YoloTensorOutputs = Readonly<Record<string, YoloTensor>>;

export interface YoloSession {
	run(
		input: YoloTensorInput | readonly YoloTensorInput[],
	): Promise<YoloTensorOutputs>;
	release(): void;
}

export interface SessionProvider {
	readonly kind: "node" | "webgpu";
	createSession(
		modelBytes: Uint8Array,
		opts: { imgsz: number; fp16?: boolean },
	): Promise<YoloSession>;
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

	public async createSession(
		modelBytes: Uint8Array,
		_opts: { imgsz: number; fp16?: boolean },
	): Promise<YoloSession> {
		const ort = await this.ort();
		const session = await ort.InferenceSession.create(modelBytes, {
			executionProviders: ["cpu"],
			graphOptimizationLevel: "all",
		});
		type OrtTensor = InstanceType<typeof ort.Tensor>;

		return {
			run: async (
				input: YoloTensorInput | readonly YoloTensorInput[],
			): Promise<YoloTensorOutputs> => {
				const inputs = Array.isArray(input) ? input : [input];
				const feeds: Record<string, OrtTensor> = {};
				for (const inp of inputs) {
					const inputName = session.inputNames.includes(inp.name)
						? inp.name
						: (session.inputNames[0] ?? inp.name);
					feeds[inputName] = new ort.Tensor("float32", inp.data, [...inp.dims]);
				}
				const results = await session.run(feeds);
				const outputs: Record<string, YoloTensor> = {};
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
