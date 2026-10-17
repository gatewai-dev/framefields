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
	readonly data: Float32Array;
	/** The input already on the GPU; only for providers with a `device` (it must be that device's). */
	readonly gpuBuffer?: GPUBuffer;
	readonly dims: readonly number[];
}

export type VisionTensorOutputs = Readonly<Record<string, VisionTensor>>;

export interface VisionSession {
	run(input: VisionTensorInput): Promise<VisionTensorOutputs>;
	release(): void;
}

export interface SessionProvider {
	readonly kind: "node" | "webgpu";
	/** The GPU device sessions run on, when they accept `gpuBuffer` inputs from it. */
	readonly device?: GPUDevice;
	createSession(modelBytes: Uint8Array): Promise<VisionSession>;
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
	readonly backend: "webgpu" | "cpu" | "cuda";
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

	public async createSession(modelBytes: Uint8Array): Promise<VisionSession> {
		if (this._resolved) return this._resolved.createSession(modelBytes);
		if (!this._resolving) {
			this._resolving = this.resolve(modelBytes);
			this._resolving.catch(() => {
				this._resolving = undefined;
			});
			const { provider, first } = await this._resolving;
			this._resolved = provider;
			if (first) return first;
			return provider.createSession(modelBytes);
		}
		const { provider } = await this._resolving;
		return provider.createSession(modelBytes);
	}

	private async resolve(
		modelBytes: Uint8Array,
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
			return {
				provider: new NodeSessionProvider({
					executionProviders: ["cuda", "cpu"],
				}),
			};
		}
		const webgpu = new NodeWebGPUProvider({
			wasmFallback: false,
			device: visionDevice,
		});
		try {
			const first = await webgpu.createSession(modelBytes);
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
		const threads = await cpuSessionThreads();
		const session = await ort.InferenceSession.create(modelBytes, {
			executionProviders: [...this._executionProviders],
			graphOptimizationLevel: "all",
			...(threads !== undefined
				? { intraOpNumThreads: threads, interOpNumThreads: 1 }
				: {}),
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
