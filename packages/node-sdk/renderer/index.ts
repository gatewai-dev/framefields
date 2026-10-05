/// <reference types="@webgpu/types" />
import type { VirtualMediaData } from "@framefields/core";
import type { RenderContextValue } from "@framefields/webgpu-renderers";

export type GPUCommandEncoder = globalThis.GPUCommandEncoder;
export type GPURenderPassEncoder = globalThis.GPURenderPassEncoder;
export type GPUTextureView = globalThis.GPUTextureView;
export type GPUTexture = globalThis.GPUTexture;

export interface NodeRenderProps {
	renderId: string;
	virtualMedia: VirtualMediaData;
	volume?: number;
	playbackRateOverride?: number;
	trimStartOverride?: number;
	trimEndOverride?: number;
	containerWidth: number;
	containerHeight: number;
	opacity?: number;
	frame?: number;
	fps?: number;
	elapsedMs?: number;
	durationMs?: number;
	timestampSec?: number;
	renderingContext?: "visual" | "audio";
	inheritedSeekOffset?: number;
	inheritedClockOffset?: number;
	isHeadless?: boolean;
	forceWait?: boolean;
	isVideoMode?: boolean;
	isPlaying?: boolean;
	excludeTextures?: GPUTexture[];
	/** Signal values that override the node's own (text animators read them). */
	signals?: Record<string, unknown>;
	renderChild?: (
		child: VirtualMediaData,
		overrides?: Partial<NodeRenderProps>,
	) => unknown;
}

export type WebGPUNodeRenderer = (args: {
	ctx: RenderContextValue;
	encoder: GPUCommandEncoder;
	pass: GPURenderPassEncoder;
	targetView: GPUTextureView;
	targetTexture: GPUTexture;
	targetWidth: number;
	targetHeight: number;
	props: NodeRenderProps;
	drawChild: (
		child: VirtualMediaData,
		overrides?: Partial<NodeRenderProps>,
		targetViewOverride?: GPUTextureView,
		targetTextureOverride?: GPUTexture,
		targetWidthOverride?: number,
		targetHeightOverride?: number,
	) => Promise<void>;
}) => Promise<void> | void;

export interface AudioProcessorContext {
	device?: GPUDevice;
	frame?: number;
	fps?: number;
	elapsedMs?: number;
	durationMs?: number;
	renderId?: string;
}

export type AudioProcessor = (
	channels: Float32Array[],
	sampleRate: number,
	virtualMedia: VirtualMediaData,
	ctx?: AudioProcessorContext,
) => void | Promise<void>;

export interface NodeRendererPlugin {
	WebGPURenderer?: WebGPUNodeRenderer;
	audioProcessor?: AudioProcessor;
}

export function defineRenderer(
	plugin: NodeRendererPlugin,
): Readonly<NodeRendererPlugin> {
	return Object.freeze(plugin);
}

const GLOBAL_WEBGPU_REGISTRY_KEY = Symbol.for("framefields.webgpuRegistry");

export class WebGPURegistry {
	private renderers = new Map<string, WebGPUNodeRenderer>();

	register(op: string, renderer: WebGPUNodeRenderer): void {
		this.renderers.set(op, renderer);
	}

	get(op: string): WebGPUNodeRenderer | undefined {
		return this.renderers.get(op);
	}

	has(op: string): boolean {
		return this.renderers.has(op);
	}
}

export const webgpuRegistry: WebGPURegistry = (() => {
	const g = globalThis as typeof globalThis & {
		[GLOBAL_WEBGPU_REGISTRY_KEY]?: WebGPURegistry;
	};
	if (!g[GLOBAL_WEBGPU_REGISTRY_KEY]) {
		g[GLOBAL_WEBGPU_REGISTRY_KEY] = new WebGPURegistry();
	}
	return g[GLOBAL_WEBGPU_REGISTRY_KEY];
})();

export function registerWebGPURenderer(
	op: string,
	renderer: WebGPUNodeRenderer,
): void {
	webgpuRegistry.register(op, renderer);
}

class AudioProcessorRegistry {
	private processors = new Map<string, AudioProcessor>();

	register(opType: string, processor: AudioProcessor): void {
		this.processors.set(opType, processor);
	}

	get(opType: string): AudioProcessor | null {
		return this.processors.get(opType) || null;
	}
}

const GLOBAL_AUDIO_KEY = Symbol.for("framefields.audioRegistry");
export const audioRegistry: AudioProcessorRegistry = (() => {
	const g = globalThis as typeof globalThis & {
		[GLOBAL_AUDIO_KEY]?: AudioProcessorRegistry;
	};
	if (!g[GLOBAL_AUDIO_KEY]) {
		g[GLOBAL_AUDIO_KEY] = new AudioProcessorRegistry();
	}
	return g[GLOBAL_AUDIO_KEY];
})();
