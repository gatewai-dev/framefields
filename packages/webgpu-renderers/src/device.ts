let deviceInstance: GPUDevice | null = null;

let loadPromise: Promise<GPUDevice> | null = null;

/** The adapter behind the rendering device. */
export interface GpuAdapterDescription {
	vendor: string;
	architecture: string;
	device: string;
	description: string;
	/** A CPU implementation (lavapipe/llvmpipe, SwiftShader, WARP). */
	software: boolean;
}

let adapterInfo: GpuAdapterDescription | null = null;

const SOFTWARE_ADAPTER =
	/llvmpipe|lavapipe|softpipe|swiftshader|\bwarp\b|software/i;

function readAdapterInfo(adapter: any): GpuAdapterDescription {
	const info = adapter.info ?? {};
	const out = {
		vendor: String(info.vendor ?? ""),
		architecture: String(info.architecture ?? ""),
		device: String(info.device ?? ""),
		description: String(info.description ?? ""),
	};
	const software =
		info.isFallbackAdapter === true ||
		adapter.isFallbackAdapter === true ||
		SOFTWARE_ADAPTER.test(
			`${out.vendor} ${out.architecture} ${out.device} ${out.description}`,
		);
	return { ...out, software };
}

/** Initialises the rendering device if needed and describes its adapter. */
export async function describeGpu(): Promise<GpuAdapterDescription> {
	await ensureDevice();
	if (!adapterInfo) throw new Error("WebGPU adapter unknown");
	return adapterInfo;
}

export async function acquireDevice(
	opts?: GPURequestAdapterOptions,
): Promise<GPUDevice> {
	if (
		typeof process !== "undefined" &&
		!!process.versions?.node &&
		!(globalThis as any).navigator?.gpu
	) {
		const { create, globals } = await import(
			/* webpackIgnore: true */ "webgpu"
		);

		Object.assign(globalThis, globals);
		const flags: string[] = [];
		if (typeof globalThis.navigator === "undefined") {
			(globalThis as any).navigator = {
				gpu: create(flags),
			};
		} else {
			Object.defineProperty(globalThis.navigator, "gpu", {
				value: create(flags),
				configurable: true,
				writable: true,
			});
		}
	}
	const gpu = (globalThis as any).navigator.gpu;
	// No GPU: fall back to a software adapter (e.g. lavapipe, SwiftShader).
	const adapter =
		(await gpu.requestAdapter({
			powerPreference: "high-performance",
			...opts,
		})) ??
		(opts?.forceFallbackAdapter
			? null
			: await gpu.requestAdapter({ ...opts, forceFallbackAdapter: true }));
	if (!adapter) throw new Error("WebGPU not available");
	adapterInfo = readAdapterInfo(adapter);

	const requiredFeatures: string[] = [];
	if (adapter.features.has("float32-filterable")) {
		requiredFeatures.push("float32-filterable");
	}

	const requiredLimits: Record<string, number> = {};
	if (
		adapter.limits &&
		Number.isInteger(adapter.limits.maxTextureDimension2D)
	) {
		requiredLimits.maxTextureDimension2D = Math.min(
			8192,
			adapter.limits.maxTextureDimension2D,
		);
	}
	if (
		adapter.limits &&
		Number.isInteger(adapter.limits.maxStorageBuffersPerShaderStage)
	) {
		requiredLimits.maxStorageBuffersPerShaderStage = Math.min(
			16,
			adapter.limits.maxStorageBuffersPerShaderStage,
		);
	}
	if (
		adapter.limits &&
		Number.isInteger(adapter.limits.maxStorageBuffersPerPipelineLayout)
	) {
		requiredLimits.maxStorageBuffersPerPipelineLayout = Math.min(
			16,
			adapter.limits.maxStorageBuffersPerPipelineLayout,
		);
	}

	return adapter.requestDevice({
		requiredFeatures: requiredFeatures as unknown as GPUFeatureName[],
		requiredLimits,
	});
}

export function resetDeviceInstance(): void {
	deviceInstance = null;
	loadPromise = null;
}

export const ensureDevice = async (
	opts?: GPURequestAdapterOptions,
): Promise<GPUDevice> => {
	if (deviceInstance) return deviceInstance;
	if (loadPromise) return loadPromise;

	loadPromise = (async () => {
		const dev = await acquireDevice(opts);
		deviceInstance = dev;
		dev.lost.then((lostInfo) => {
			if (lostInfo.reason !== "destroyed") {
				resetDeviceInstance();
			}
		});
		return dev;
	})();
	return loadPromise;
};

export const getDevice = (): GPUDevice => {
	if (!deviceInstance) {
		throw new Error("Device not loaded. Call ensureDevice() first!");
	}
	return deviceInstance;
};
