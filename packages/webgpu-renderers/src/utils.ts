declare global {
	var __GATEWAI_DELAYS__: Set<number>;
}

if (typeof globalThis !== "undefined") {
	globalThis.__GATEWAI_DELAYS__ = globalThis.__GATEWAI_DELAYS__ || new Set();
}

export function withTempTexture<T>(
	device: GPUDevice,
	desc: GPUTextureDescriptor,
	fn: (tex: GPUTexture) => T,
): T {
	const tex = device.createTexture(desc);
	try {
		return fn(tex);
	} finally {
		tex.destroy();
	}
}
