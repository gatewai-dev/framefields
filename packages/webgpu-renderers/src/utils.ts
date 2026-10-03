import { useMemo } from "react";

declare global {
	var __GATEWAI_DELAYS__: Set<number>;
}

if (typeof globalThis !== "undefined") {
	globalThis.__GATEWAI_DELAYS__ = globalThis.__GATEWAI_DELAYS__ || new Set();
}

export const hasDelayRender = (): {
	delayRender: (msg: string) => number;
	continueRender: (h: number) => void;
} | null => {
	return useMemo(() => {
		let nextHandle = 0;
		return {
			delayRender: (_msg: string) => {
				const h = nextHandle++;
				if (typeof globalThis !== "undefined") {
					globalThis.__GATEWAI_DELAYS__.add(h);
				}
				return h;
			},
			continueRender: (h: number) => {
				if (typeof globalThis !== "undefined") {
					globalThis.__GATEWAI_DELAYS__.delete(h);
				}
			},
		};
	}, []);
};

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
