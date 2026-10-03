let deviceInstance: GPUDevice | null = null;

let loadPromise: Promise<GPUDevice> | null = null;

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
	const adapter = await (globalThis as any).navigator.gpu.requestAdapter({
		powerPreference: "high-performance",
		...opts,
	});
	if (!adapter) throw new Error("WebGPU not available");

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
