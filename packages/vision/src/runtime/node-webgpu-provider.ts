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

interface NodeGPUAdapter {
	readonly features: object;
	readonly info?: {
		readonly vendor?: string;
		readonly architecture?: string;
		readonly device?: string;
		readonly description?: string;
		readonly isFallbackAdapter?: boolean;
	};
	readonly isFallbackAdapter?: boolean;
}

interface NodeGPU {
	requestAdapter(options?: {
		powerPreference?: "low-power" | "high-performance";
	}): Promise<NodeGPUAdapter | null>;
}

/** CPU rasterizers (lavapipe, llvmpipe, SwiftShader): slower than the CPU EP. */
const SOFTWARE_ADAPTER = /llvmpipe|lavapipe|swiftshader|software/i;

/**
 * Ensure `globalThis.navigator.gpu` exists and has a hardware adapter that
 * onnxruntime-web's WebGPU EP can use. In the renderer this is already the Dawn
 * device; otherwise imports the `webgpu` (Dawn) package and installs its
 * globals. Rejects when the only adapter is a software rasterizer.
 */
export function ensureNodeWebGPU(): Promise<void> {
	if (!nodeWebGPUReady) {
		nodeWebGPUReady = (async () => {
			const g = globalThis as { navigator?: { gpu?: NodeGPU } };
			if (!g.navigator?.gpu) {
				const { create, globals } = (await import(
					/* @vite-ignore */ WEBGPU_SPECIFIER
				)) as {
					create: (flags: string[]) => NodeGPU;
					globals: Record<string, unknown>;
				};
				Object.assign(globalThis, globals);
				g.navigator ??= {};
				Object.defineProperty(g.navigator, "gpu", {
					value: create([]),
					configurable: true,
					writable: true,
				});
			}
			const gpu = g.navigator?.gpu as NodeGPU;
			const adapter = await gpu.requestAdapter({
				powerPreference: "high-performance",
			});
			if (!adapter) throw new Error("No WebGPU adapter.");
			const info = adapter.info ?? {};
			const name = [
				info.vendor,
				info.architecture,
				info.device,
				info.description,
			]
				.filter(Boolean)
				.join(" ");
			if (
				adapter.isFallbackAdapter === true ||
				info.isFallbackAdapter === true ||
				SOFTWARE_ADAPTER.test(name)
			) {
				throw new Error(`WebGPU adapter is a software rasterizer (${name}).`);
			}
			patchSupportedFeatures(adapter.features);
		})();
		nodeWebGPUReady.catch(() => {
			nodeWebGPUReady = undefined;
		});
	}
	return nodeWebGPUReady;
}

/**
 * Dawn's Node `GPUSupportedFeatures` has `has`/`keys`/`size` but no `forEach`,
 * which onnxruntime-web's WebGPU build calls on adapter and device features
 * (they share the class). Adds the missing set-like methods once.
 */
function patchSupportedFeatures(features: object): void {
	const proto = Object.getPrototypeOf(features) as {
		keys?: () => IterableIterator<string>;
		forEach?: unknown;
		values?: unknown;
		entries?: unknown;
		[Symbol.iterator]?: unknown;
	} | null;
	if (!proto || typeof proto.keys !== "function") return;
	type SetLike = { keys(): IterableIterator<string> };
	if (typeof proto.forEach !== "function") {
		Object.defineProperty(proto, "forEach", {
			value(
				this: SetLike,
				callback: (value: string, key: string, set: SetLike) => void,
				thisArg?: unknown,
			) {
				for (const key of this.keys()) callback.call(thisArg, key, key, this);
			},
			configurable: true,
			writable: true,
		});
	}
	if (typeof proto.values !== "function") {
		Object.defineProperty(proto, "values", {
			value(this: SetLike) {
				return this.keys();
			},
			configurable: true,
			writable: true,
		});
	}
	if (typeof proto.entries !== "function") {
		Object.defineProperty(proto, "entries", {
			*value(this: SetLike) {
				for (const key of this.keys()) yield [key, key];
			},
			configurable: true,
			writable: true,
		});
	}
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
					env?: {
						wasm?: { numThreads?: number };
						webgpu?: { powerPreference?: string };
					};
				};
				// Single-threaded WASM: Node has no cross-origin isolation, and the
				// WASM path is only a fallback behind the WebGPU EP.
				if (mod.env?.wasm) mod.env.wasm.numThreads = 1;
				if (mod.env?.webgpu)
					mod.env.webgpu.powerPreference = "high-performance";
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
