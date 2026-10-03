import { registerHeadlessFont } from "@gitframes/webgpu-renderers";
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

/**
 * Preloads a font into the browser or headless environment.
 */
export async function preloadFont(family: string, url: string): Promise<void> {
	if (typeof window !== "undefined" && typeof FontFace !== "undefined") {
		try {
			const font = new FontFace(family, `url(${url})`);
			const loadedFace = await font.load();
			(document.fonts as any).add(loadedFace);
			await document.fonts.ready;
		} catch (e) {
			console.warn(
				`[preloadFont] Failed to load font "${family}" from ${url}:`,
				e,
			);
		}
	} else {
		// Headless / Node.js mode
		await registerHeadlessFont(family, url);
	}
}
