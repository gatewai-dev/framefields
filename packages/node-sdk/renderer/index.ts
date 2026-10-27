/// <reference types="@webgpu/types" />
import type {
	MediaOperation,
	NodeInputConnection,
	NodeOperation,
	VirtualMediaData,
} from "@framefields/core";
import type { RenderContextValue } from "@framefields/webgpu-renderers";

export type GPUCommandEncoder = globalThis.GPUCommandEncoder;
export type GPURenderPassEncoder = globalThis.GPURenderPassEncoder;
export type GPUTextureView = globalThis.GPUTextureView;
export type GPUTexture = globalThis.GPUTexture;

export type { MediaOperation, NodeInputConnection, NodeOperation };

export interface NodeRenderProps<
	TOperation extends MediaOperation = MediaOperation,
> {
	renderId: string;
	virtualMedia: VirtualMediaData<TOperation>;
	volume?: number;
	playbackRateOverride?: number;
	trimStartOverride?: number;
	trimEndOverride?: number;
	containerWidth: number;
	containerHeight: number;
	opacity?: number;
	frame?: number;
	compositionFrame?: number;
	/** Absolute source time for a remapped media leaf; effect clocks stay unchanged. */
	sourceTimeSec?: number;
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

/**
 * How far an effect draws past the pixels it is given, px, for one of its
 * operations; `null` when it isn't local (it reads or writes pixels anywhere,
 * like a mirror or a portal) or can't tell (a size driven by a signal).
 */
export type EffectReach = (operation: Record<string, unknown>) => number | null;

/**
 * A node's GPU renderer. An effect renderer may carry `reach`: a compositor
 * then runs it over the layer's own region plus that margin instead of the
 * whole target. Without it the effect always gets the whole target.
 */
export type WebGPUNodeRenderer<
	TOperation extends MediaOperation = MediaOperation,
> = WebGPUNodeRenderFn<TOperation> & { reach?: EffectReach };

type WebGPUNodeRenderFn<TOperation extends MediaOperation> = (args: {
	ctx: RenderContextValue;
	encoder: GPUCommandEncoder;
	pass: GPURenderPassEncoder;
	targetView: GPUTextureView;
	targetTexture: GPUTexture;
	targetWidth: number;
	targetHeight: number;
	props: NodeRenderProps<TOperation>;
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
	compositionFrame?: number;
	fps?: number;
	elapsedMs?: number;
	durationMs?: number;
	renderId?: string;
}

export type AudioProcessor<TOperation extends MediaOperation = MediaOperation> =
	(
		channels: Float32Array[],
		sampleRate: number,
		virtualMedia: VirtualMediaData<TOperation>,
		ctx?: AudioProcessorContext,
	) => void | Promise<void>;

export {
	isSignal,
	resolveBoolean,
	resolveNumber,
	resolveParam,
	resolveString,
} from "@framefields/core";

/**
 * A numeric node parameter at `frame`: a number, a signal-like `get(ctx)` or
 * `{ value }`, a `(ctx) => number` function, or anything `Number()` accepts;
 * `fallback` when none of those yields a finite number.
 */
export function resolveFrameNumber(
	val: unknown,
	fallback: number,
	frame: number,
	fps: number,
): number {
	if (val === undefined || val === null) return fallback;
	if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
	if (typeof val === "object" && val !== null) {
		if (
			"get" in (val as Record<string, unknown>) &&
			typeof (val as { get: unknown }).get === "function"
		) {
			try {
				const res = (val as { get: (ctx?: unknown) => unknown }).get({
					frame,
					fps,
					time: fps > 0 ? frame / fps : 0,
					duration: 0,
					durationMs: 0,
					progress: 0,
					deltaTime: fps > 0 ? 1 / fps : 0,
				});
				const n = Number(res);
				if (Number.isFinite(n)) return n;
			} catch {
				// fallback
			}
		}
		if ("value" in (val as Record<string, unknown>)) {
			const n = Number((val as { value: unknown }).value);
			if (Number.isFinite(n)) return n;
		}
	}
	if (typeof val === "function") {
		try {
			const n = Number(val({ frame, fps, time: fps > 0 ? frame / fps : 0 }));
			if (Number.isFinite(n)) return n;
		} catch {
			// fallback
		}
	}
	const n = Number(val);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * A static node parameter at `frame`: calls `get(ctx)` / `(frame, fps)`
 * functions and reads `{ value }` wrappers, keeping a signal's GPU texture
 * binding when it has one. Anything else is returned as-is.
 */
export function unwrapFrameParam(
	raw: unknown,
	frame: number,
	fps: number,
): { value: unknown; gpuTextureView?: GPUTextureView } {
	if (raw === undefined || raw === null) return { value: raw };
	if (typeof raw === "function") {
		return { value: (raw as (f: number, fps: number) => unknown)(frame, fps) };
	}
	if (typeof raw !== "object") return { value: raw };
	const obj = raw as Record<string, unknown>;
	if (typeof obj.get === "function") {
		return {
			value: (obj.get as (ctx: { frame: number; fps: number }) => unknown)({
				frame,
				fps,
			}),
		};
	}
	if ("value" in obj) {
		const sig = raw as {
			value: unknown;
			gpuBinding?: { textureView?: GPUTextureView };
		};
		return { value: sig.value, gpuTextureView: sig.gpuBinding?.textureView };
	}
	return { value: raw };
}

/** The `inputs` map node operations carry: one entry per connected handle. */
export type NodeOperationInputs = Record<
	string,
	{
		connectionValid: boolean;
		outputItem: { type: string; data: unknown } | null;
	}
>;

export interface HandleParam<SD> {
	val: number;
	/** The value comes from a signal (`sd`) sampled on the GPU. */
	hasStaticSig: boolean;
	sd: SD | null;
	handleId: string | null | undefined;
}

/**
 * A numeric parameter fed through `handleId`: a connected Number (clamped), a
 * connected Signal (sampled on the GPU, `val` stays `fallbackVal`), or else
 * `fallbackVal` clamped to [clampMin, clampMax].
 */
export function resolveHandleParam<SD>(
	inputs: NodeOperationInputs | undefined,
	handleId: string | null | undefined,
	fallbackVal: number,
	clampMin: number,
	clampMax: number,
): HandleParam<SD> {
	const clamp = (v: number) => Math.max(clampMin, Math.min(clampMax, v));
	const input = handleId ? inputs?.[handleId] : undefined;
	if (input?.connectionValid) {
		const outputItem = input.outputItem;
		if (outputItem?.type === "Number") {
			const numVal =
				typeof outputItem.data === "number"
					? outputItem.data
					: ((outputItem.data as { value?: number })?.value ?? fallbackVal);
			return { val: clamp(numVal), hasStaticSig: false, sd: null, handleId };
		}
		if (outputItem?.type === "Signal" && outputItem.data) {
			return {
				val: fallbackVal,
				hasStaticSig: true,
				sd: outputItem.data as SD,
				handleId,
			};
		}
	}
	return { val: clamp(fallbackVal), hasStaticSig: false, sd: null, handleId };
}

/**
 * A numeric field `fieldName` of a node operation, fed through its
 * `${fieldName}HandleId` input: a connected Signal/Numeric (`sd`, sampled on
 * the GPU; `value` is its offset), a connected Number, or the operation's own
 * value — each clamped to [minVal, maxVal].
 */
export function resolveSignalField<SD>(
	op: { inputs?: NodeOperationInputs },
	fieldName: string,
	defaultValue: number,
	minVal = Number.NEGATIVE_INFINITY,
	maxVal = Number.POSITIVE_INFINITY,
): { hasSignal: boolean; sd: SD | null; value: number } {
	const clamp = (v: number) => Math.max(minVal, Math.min(maxVal, v));
	const fields = op as Record<string, unknown>;
	const handleId = fields[`${fieldName}HandleId`] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;
	const outputType = signalInput?.connectionValid
		? signalInput.outputItem?.type
		: undefined;
	const hasSignal = outputType === "Signal" || outputType === "Numeric";
	const sd =
		hasSignal && signalInput?.outputItem?.data
			? (signalInput.outputItem.data as SD)
			: null;

	let value = defaultValue;
	if (!hasSignal) {
		const raw =
			outputType === "Number"
				? signalInput?.outputItem?.data
				: fields[fieldName];
		value = clamp(Number(raw ?? defaultValue));
	} else if (sd) {
		value = clamp(Number((sd as { offset?: unknown }).offset ?? defaultValue));
	}
	return { hasSignal, sd, value };
}

/**
 * Whether the handle whose id is stored at `op[handleIdKey]` has a valid
 * Signal or Number connection.
 */
export function isHandleConnected(
	op: Record<string, unknown>,
	handleIdKey: string,
): boolean {
	const handleId = op[handleIdKey];
	if (typeof handleId !== "string" || !handleId) return false;
	const input = (op.inputs as NodeOperationInputs | undefined)?.[handleId];
	return Boolean(
		input?.connectionValid &&
			input.outputItem &&
			(input.outputItem.type === "Signal" ||
				input.outputItem.type === "Number"),
	);
}

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

/**
 * How far an operation's effect draws past its pixels, from its registered
 * renderer; `null` when unknown: no renderer, no `reach`, or no answer.
 */
export function effectReach(operation: Record<string, unknown>): number | null {
	const op = operation.op;
	if (typeof op !== "string") return null;
	return webgpuRegistry.get(op)?.reach?.(operation) ?? null;
}

export type { WebGPUNodeRendererArgs } from "./gpu.js";

export interface TextureSourceOp {
	op: "TextureSource";
	sourceTexture: GPUTexture;
	opacity?: number;
	dataType?: "Image";
}

registerWebGPURenderer("TextureSource", (args) => {
	const op = args.props.virtualMedia.operation as unknown as TextureSourceOp;
	if (op?.sourceTexture) {
		args.ctx.renderer.drawTexture(
			args.pass,
			op.sourceTexture,
			{ x: 0, y: 0, width: args.targetWidth, height: args.targetHeight },
			{ opacity: Number(op.opacity ?? 1) },
		);
	}
});

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

export * from "./homography.js";
