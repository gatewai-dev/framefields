import { probeModel } from "../model/probe-model.js";
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
	/** Ignored (may be empty) when `gpuBuffer` is set. */
	readonly data: Float32Array | Int32Array | BigInt64Array | Uint8Array;
	/** The input already on the GPU; only for providers with a `device` (it must be that device's). */
	readonly gpuBuffer?: GPUBuffer;
	readonly dims: readonly number[];
}

export type VisionTensorOutputs = Readonly<Record<string, VisionTensor>>;

export interface VisionSession {
	run(input: VisionTensorInput): Promise<VisionTensorOutputs>;
	/** Multi-input graphs; optional for compatibility with existing custom providers. */
	runMany?(inputs: readonly VisionTensorInput[]): Promise<VisionTensorOutputs>;
	release(): void;
}

/** External ONNX tensor files, verified by the model store before session creation. */
export interface VisionSessionOptions {
	readonly externalData?: readonly {
		readonly path: string;
		readonly data: Uint8Array;
	}[];
}

/** The hardware sessions run on; it decides which model precision runs fastest. */
export type VisionCompute = "webgpu" | "cuda" | "cpu";

export interface SessionProvider {
	readonly kind: "node" | "webgpu";
	/** The GPU device sessions run on, when they accept `gpuBuffer` inputs from it. */
	readonly device?: GPUDevice;
	/**
	 * Where sessions will run, known before any model is downloaded (see
	 * {@link sessionCompute}). Optional for custom providers.
	 */
	backend?(): Promise<VisionCompute>;
	createSession(
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<VisionSession>;
}

/** Where a provider's sessions run: its own answer, else WebGPU for WebGPU providers, else CPU. */
export function sessionCompute(
	provider: SessionProvider,
): Promise<VisionCompute> {
	if (provider.backend) return provider.backend();
	return Promise.resolve(provider.kind === "webgpu" ? "webgpu" : "cpu");
}

let defaultProvider: (() => SessionProvider) | undefined;
let visionDevice: GPUDevice | undefined;

/**
 * The GPU device the default provider runs WebGPU sessions on — the renderer's,
 * so frames can go from its textures into the models without a CPU round trip.
 * Applies to sessions created afterwards; without it, onnxruntime-web creates
 * its own device.
 */
export function setVisionDevice(device: GPUDevice | undefined): void {
	visionDevice = device;
}

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

/** Which backend the process's default provider chose, reported once. */
export interface VisionBackendInfo {
	readonly backend: VisionCompute;
	/** WebGPU on the renderer's device: frames reach the models without leaving the GPU. */
	readonly sharedDevice: boolean;
	/** Why WebGPU wasn't used, when it fell back. */
	readonly reason?: string;
}

/**
 * Hosts (the renderer) register a listener under this symbol to log the
 * backend; a global keeps it working however the packages are bundled.
 */
export const VISION_BACKEND_LISTENER = Symbol.for("framefields.vision.backend");

function reportBackend(info: VisionBackendInfo): void {
	const listener = (globalThis as Record<symbol, unknown>)[
		VISION_BACKEND_LISTENER
	];
	if (typeof listener === "function") {
		try {
			(listener as (info: VisionBackendInfo) => void)(info);
		} catch {
			// Logging must never break inference.
		}
	}
}

/** Inference backend: `FRAMEFIELDS_VISION_PROVIDER`, default "auto". */
export type VisionBackend = "auto" | "webgpu" | "cuda" | "cpu";

export function requestedVisionBackend(): VisionBackend {
	const value =
		typeof process !== "undefined"
			? process.env.FRAMEFIELDS_VISION_PROVIDER?.trim().toLowerCase()
			: undefined;
	return value === "webgpu" || value === "cuda" || value === "cpu"
		? value
		: "auto";
}

/**
 * Prefers the GPU (onnxruntime-web's WebGPU EP on the process's WebGPU device —
 * the Dawn device the renderer already creates, or one this ensures) and falls
 * back to the CPU provider (onnxruntime-node) when a WebGPU session cannot be
 * created: no hardware adapter, no Dawn, or onnxruntime-web not installed. The
 * choice is made on the first session and kept.
 *
 * `FRAMEFIELDS_VISION_PROVIDER` forces one backend instead: `webgpu`, `cpu`, or
 * `cuda` (onnxruntime-node's CUDA EP on Linux x64; needs the CUDA 12 and cuDNN 9
 * libraries). A forced backend that fails throws instead of falling back.
 */
export class AutoSessionProvider implements SessionProvider {
	private _resolved?: SessionProvider;
	private _resolving?: Promise<{
		provider: SessionProvider;
		first?: VisionSession;
	}>;

	public get kind(): "node" | "webgpu" {
		return this._resolved?.kind ?? "webgpu";
	}

	public get device(): GPUDevice | undefined {
		return this._resolved?.device;
	}

	public async createSession(
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<VisionSession> {
		if (this._resolved)
			return this._resolved.createSession(modelBytes, options);
		if (this._resolving)
			return (await this._resolving).provider.createSession(
				modelBytes,
				options,
			);
		const { provider, first } = await this.start(modelBytes, options);
		return first ?? provider.createSession(modelBytes, options);
	}

	/** Where sessions run. Before the first session it decides with a one-node probe graph. */
	public async backend(): Promise<VisionCompute> {
		if (!this._resolved && !this._resolving)
			(await this.start(probeModel())).first?.release();
		const provider = this._resolved ?? (await this._resolving)?.provider;
		if (!provider) throw new Error("No vision backend could be resolved.");
		return sessionCompute(provider);
	}

	private start(
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<{ provider: SessionProvider; first?: VisionSession }> {
		const resolving = this.resolve(modelBytes, options);
		this._resolving = resolving;
		resolving.then(
			({ provider }) => {
				this._resolved = provider;
			},
			() => {
				this._resolving = undefined;
			},
		);
		return resolving;
	}

	private async resolve(
		modelBytes: Uint8Array,
		options?: VisionSessionOptions,
	): Promise<{ provider: SessionProvider; first?: VisionSession }> {
		const backend = requestedVisionBackend();
		if (backend === "cpu") {
			reportBackend({
				backend: "cpu",
				sharedDevice: false,
				reason: "FRAMEFIELDS_VISION_PROVIDER=cpu",
			});
			return { provider: new NodeSessionProvider() };
		}
		if (backend === "cuda") {
			reportBackend({ backend: "cuda", sharedDevice: false });
			return { provider: cudaProvider() };
		}
		if (backend === "auto" && (await hasNvidiaDriver())) {
			// NVIDIA on Linux: CUDA when onnxruntime-node can load its CUDA EP, else WebGPU/CPU.
			try {
				const first = await new NodeSessionProvider({
					executionProviders: ["cuda"],
				}).createSession(modelBytes, options);
				reportBackend({ backend: "cuda", sharedDevice: false });
				first.release();
				return { provider: cudaProvider() };
			} catch {
				// No CUDA 12 / cuDNN 9 libraries: fall through.
			}
		}
		const webgpu = new NodeWebGPUProvider({
			wasmFallback: false,
			device: visionDevice,
		});
		try {
			const first = await webgpu.createSession(modelBytes, options);
			reportBackend({ backend: "webgpu", sharedDevice: !!visionDevice });
			return { provider: webgpu, first };
		} catch (err) {
			if (backend === "webgpu") throw err;
			// WebGPU isn't possible here — use CPU from now on.
			reportBackend({
				backend: "cpu",
				sharedDevice: false,
				reason: err instanceof Error ? err.message : String(err),
			});
			return { provider: new NodeSessionProvider() };
		}
	}
}

function cudaProvider(): NodeSessionProvider {
	return new NodeSessionProvider({ executionProviders: ["cuda", "cpu"] });
}

/** True on Linux with the NVIDIA kernel driver loaded (checked without touching CUDA). */
async function hasNvidiaDriver(): Promise<boolean> {
	if (typeof process === "undefined" || process.platform !== "linux")
		return false;
	try {
		const { access } = await import("node:fs/promises");
		await access("/proc/driver/nvidia/version");
		return true;
	} catch {
		return false;
	}
}

let processProvider: AutoSessionProvider | undefined;

/**
 * The provider for a runner created without one: GPU if possible, otherwise CPU.
 * One per process, so the GPU probe runs once however many runners there are.
 */
export function createDefaultSessionProvider(): SessionProvider {
	if (defaultProvider) return defaultProvider();
	processProvider ??= new AutoSessionProvider();
	return processProvider;
}

/**
 * CPUs this process may use: the affinity mask, capped by a cgroup CPU quota
 * (containers). ONNX Runtime sizes its thread pool from the host's cores, which
 * oversubscribes a container limited to fewer CPUs than the host has.
 */
export async function availableCpus(): Promise<number> {
	const os = await import("node:os");
	const cpus =
		typeof os.availableParallelism === "function"
			? os.availableParallelism()
			: os.cpus().length;
	const quota = await cgroupCpuQuota();
	return Math.max(1, quota !== undefined ? Math.min(cpus, quota) : cpus);
}

/** cgroup v2 `cpu.max` or v1 `cpu.cfs_quota_us`, in CPUs (rounded up); undefined when unlimited. */
async function cgroupCpuQuota(): Promise<number | undefined> {
	if (typeof process === "undefined" || process.platform !== "linux") {
		return undefined;
	}
	const { readFile } = await import("node:fs/promises");
	const read = (path: string) =>
		readFile(path, "utf8").then(
			(text) => text.trim(),
			() => undefined,
		);
	const toCpus = (quota: number, period: number) =>
		quota > 0 && period > 0 ? Math.ceil(quota / period) : undefined;

	const v2 = await read("/sys/fs/cgroup/cpu.max");
	if (v2 !== undefined) {
		const [quota, period] = v2.split(/\s+/);
		return quota === "max" ? undefined : toCpus(Number(quota), Number(period));
	}
	const v1Quota = await read("/sys/fs/cgroup/cpu/cpu.cfs_quota_us");
	const v1Period = await read("/sys/fs/cgroup/cpu/cpu.cfs_period_us");
	if (v1Quota === undefined || v1Period === undefined) return undefined;
	return toCpus(Number(v1Quota), Number(v1Period));
}

/**
 * Intra-op threads for CPU sessions: `FRAMEFIELDS_VISION_THREADS` when set,
 * else the available CPUs on Linux (where containers cap them), else ONNX
 * Runtime's own default (undefined).
 */
export async function cpuSessionThreads(): Promise<number | undefined> {
	const env =
		typeof process !== "undefined"
			? Number.parseInt(process.env.FRAMEFIELDS_VISION_THREADS ?? "", 10)
			: Number.NaN;
	if (Number.isFinite(env) && env > 0) return env;
	if (typeof process === "undefined" || process.platform !== "linux") {
		return undefined;
	}
	return availableCpus();
}

export interface NodeSessionProviderOptions {
	/** onnxruntime-node execution providers in priority order. Default `["cpu"]`. */
	readonly executionProviders?: readonly string[];
}

/** onnxruntime-node provider. The native module is imported lazily on first session. */
export class NodeSessionProvider implements SessionProvider {
	public readonly kind = "node" as const;

	private readonly _executionProviders: readonly string[];

	constructor(options: NodeSessionProviderOptions = {}) {
		this._executionProviders = options.executionProviders ?? ["cpu"];
	}

	public backend(): Promise<VisionCompute> {
		return Promise.resolve(
			this._executionProviders.includes("cuda") ? "cuda" : "cpu",
		);
	}

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
		options?: VisionSessionOptions,
	): Promise<VisionSession> {
		const ort = await this.ort();
		const threads = await cpuSessionThreads();
		const session = await ort.InferenceSession.create(modelBytes, {
			executionProviders: [...this._executionProviders],
			externalData: options?.externalData?.map(({ path, data }) => ({
				path,
				data,
			})),
			graphOptimizationLevel: "all",
			...(threads !== undefined
				? { intraOpNumThreads: threads, interOpNumThreads: 1 }
				: {}),
		});
		type OrtTensor = InstanceType<typeof ort.Tensor>;

		const runMany = async (
			inputs: readonly VisionTensorInput[],
		): Promise<VisionTensorOutputs> => {
			const feeds: Record<string, OrtTensor> = {};
			for (const input of inputs) {
				const name =
					inputs.length === 1 && !session.inputNames.includes(input.name)
						? (session.inputNames[0] ?? input.name)
						: input.name;
				if (input.gpuBuffer)
					throw new Error("CPU vision sessions do not accept GPU buffers.");
				feeds[name] =
					input.data instanceof Uint8Array
						? new ort.Tensor("bool", input.data, [...input.dims])
						: input.data instanceof BigInt64Array
							? new ort.Tensor("int64", input.data, [...input.dims])
							: input.data instanceof Int32Array
								? new ort.Tensor("int32", input.data, [...input.dims])
								: new ort.Tensor("float32", input.data, [...input.dims]);
			}
			const results = await session.run(feeds);
			const outputs: Record<string, VisionTensor> = {};
			for (const [name, tensor] of Object.entries(results)) {
				outputs[name] = {
					data: tensor.data as VisionTensor["data"],
					dims: [...tensor.dims],
				};
			}
			return outputs;
		};
		return {
			run: (input) => runMany([input]),
			runMany,
			release: () => {
				void session.release();
			},
		};
	}
}
