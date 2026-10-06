/**
 * Headless (Node) WebGPU session provider.
 *
 * Runs `onnxruntime-web`'s WebGPU execution provider against the WebGPU device
 * the process already has — the Dawn device the renderer creates, or one this
 * ensures. `AutoSessionProvider` uses it when no provider is passed, falling
 * back to the CPU `NodeSessionProvider` if a WebGPU session can't be created.
 *
 * `onnxruntime-web` and `webgpu` are imported lazily behind non-analyzable
 * specifiers, so the browser entry never pulls this module's runtime imports.
 */

import type { SessionProvider, VisionSession } from "./session-provider.js";
import {
	type OrtWebModule,
	WebGPUProvider,
	type WebGPUProviderOptions,
} from "./webgpu-provider.js";

const ORT_WEBGPU_SPECIFIER = "onnxruntime-web/webgpu";
const WEBGPU_SPECIFIER = "webgpu";

let nodeWebGPUReady: Promise<void> | undefined;

/**
 * Ensure `globalThis.navigator.gpu` exists. In the renderer this is already the
 * Dawn device; otherwise imports the `webgpu` (Dawn) package and installs its
 * globals plus an adapter, which is what onnxruntime-web's WebGPU EP needs.
 */
export function ensureNodeWebGPU(): Promise<void> {
	if (!nodeWebGPUReady) {
		nodeWebGPUReady = (async () => {
			const g = globalThis as { navigator?: { gpu?: unknown } };
			if (g.navigator?.gpu) return;
			const { create, globals } = (await import(
				/* @vite-ignore */ WEBGPU_SPECIFIER
			)) as {
				create: (flags: string[]) => unknown;
				globals: Record<string, unknown>;
			};
			Object.assign(globalThis, globals);
			const nav = (g.navigator ??= {});
			Object.defineProperty(nav, "gpu", {
				value: create([]),
				configurable: true,
				writable: true,
			});
		})();
		nodeWebGPUReady.catch(() => {
			nodeWebGPUReady = undefined;
		});
	}
	return nodeWebGPUReady;
}

/** Options mirror the browser provider; the loader is overridden for Node. */
export type NodeWebGPUProviderOptions = WebGPUProviderOptions;

export class NodeWebGPUProvider implements SessionProvider {
	public readonly kind = "webgpu" as const;

	private readonly _inner: WebGPUProvider;

	constructor(options: NodeWebGPUProviderOptions = {}) {
		const loader =
			options.loader ??
			(async (): Promise<OrtWebModule> => {
				await ensureNodeWebGPU();
				const mod = (await import(
					/* @vite-ignore */ ORT_WEBGPU_SPECIFIER
				)) as OrtWebModule & {
					env?: { wasm?: { numThreads?: number } };
				};
				// Single-threaded WASM: Node has no cross-origin isolation, and the
				// WASM path is only a fallback behind the WebGPU EP.
				if (mod.env?.wasm) mod.env.wasm.numThreads = 1;
				return mod;
			});
		// No WASM fallback inside the WebGPU provider: when WebGPU isn't possible
		// the caller (AutoSessionProvider) falls back to the node CPU provider,
		// which is faster than wasm and already installed.
		this._inner = new WebGPUProvider({
			wasmFallback: false,
			...options,
			loader,
		});
	}

	public createSession(modelBytes: Uint8Array): Promise<VisionSession> {
		return this._inner.createSession(modelBytes);
	}
}

export function createNodeWebGPUProvider(
	options?: NodeWebGPUProviderOptions,
): NodeWebGPUProvider {
	return new NodeWebGPUProvider(options);
}
