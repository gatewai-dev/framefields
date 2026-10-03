import { getEnv } from "@gitframes/client-utils";
import {
	type ConnectedInput,
	type FrameContext,
	type FrameSignal,
	getActiveMediaMetadata,
	getMediaType,
	isSignal,
	updateClockSignals,
	type VirtualMediaData,
} from "@gitframes/core";
import {
	type GPUCommandEncoder,
	type GPUTexture,
	type GPUTextureView,
	type NodeRenderProps,
	webgpuRegistry,
} from "@gitframes/node-sdk";
import {
	clearVideoNodeState,
	drawCaptionNode,
	drawGifNode,
	drawImageNode,
	drawLottieNode,
	drawParagraphNode,
	drawSignalNode,
	drawSvgNode,
	drawVideoNode,
	lutStore,
	mediaDecoderCache,
	type RenderContextValue,
	SlugFontCache,
	signalRegistry,
	useRenderContext,
} from "@gitframes/webgpu-renderers";
import React, { memo } from "react";
import { computeRenderParams } from "../utils/apply-operations.js";
import { normalizeTimeline } from "../utils/normalization.js";
import { useCompositionState } from "./scene.js";

// Cache segment ranges per (segments reference) to avoid recomputation each frame
const segmentRangeCache = new WeakMap<
	object,
	{ fps: number; ranges: { seg: any; start: number; duration: number }[] }
>();

function getCachedSegmentRanges(
	segments: any[],
	fps: number,
): { seg: any; start: number; duration: number }[] {
	const cached = segmentRangeCache.get(segments);
	if (cached && cached.fps === fps) {
		return cached.ranges;
	}

	let currentStart = 0;
	const ranges = segments.map((seg: any) => {
		const durSec = (seg.endSec ?? 0) - seg.startSec;
		const durFrames = Math.max(1, Math.round(durSec * fps));
		const start = currentStart;
		currentStart += durFrames;
		return { seg, start, duration: durFrames };
	});

	segmentRangeCache.set(segments, { fps, ranges });
	return ranges;
}

// Pool FrameContext objects to reduce GC pressure
const frameCtxPool: FrameContext[] = [];

function acquireFrameContext(): FrameContext {
	return frameCtxPool.pop() ?? ({} as FrameContext);
}

/**
 * Effect operations carry every config field as a signal. Hand node renderers
 * the plain value for this frame (nested objects/arrays included), keeping only
 * GPU-bound signals intact since those are consumed as textures.
 */
function resolveSignalOperation(
	virtualMedia: VirtualMediaData,
	frameCtx: FrameContext,
): VirtualMediaData {
	const op = virtualMedia.operation as Record<string, unknown>;
	const resolved: Record<string, unknown> = { ...op };
	for (const [key, sig] of Object.entries(
		op.signals as Record<string, unknown>,
	)) {
		if (isSignal(sig) && !(sig as FrameSignal<unknown>).gpuBinding) {
			resolved[key] = sig.get(frameCtx);
		}
	}
	return { ...virtualMedia, operation: resolved } as VirtualMediaData;
}

export async function drawCompositionTree(
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	targetView: GPUTextureView,
	targetTexture: GPUTexture,
	targetWidth: number,
	targetHeight: number,
	virtualMedia: VirtualMediaData,
	props: NodeRenderProps,
	inheritedSeekOffset = 0,
	inheritedClockOffset = 0,
): Promise<void> {
	const fps = props.fps ?? 24;
	const op = virtualMedia.operation as any;
	if (!op) return;

	const isCompositor = op.op === "Compositor";

	const frame = props.frame ?? 0;
	const segments = op.timeline?.segments || [];
	const nodeStartFrame = op.startFrame ?? op.timeline?.startFrame ?? 0;
	const localFrame = frame - nodeStartFrame;

	const isTimelineProvider =
		op.timeline !== undefined ||
		op.startFrame !== undefined ||
		op.op === "compose";

	const resolvedDurationMs = isTimelineProvider
		? (getActiveMediaMetadata(virtualMedia)?.durationMs ??
			props.durationMs ??
			undefined)
		: (props.durationMs ??
			getActiveMediaMetadata(virtualMedia)?.durationMs ??
			undefined);

	const isLeafNode =
		op.op === "source" || op.op === "text" || op.op === "caption";
	if (!isLeafNode) {
		updateClockSignals(frame, fps, resolvedDurationMs);
	}

	const frameCtx = acquireFrameContext();
	frameCtx.frame = frame;
	frameCtx.fps = fps;
	frameCtx.time = fps > 0 ? frame / fps : 0;
	frameCtx.duration = (resolvedDurationMs ?? 0) / 1000;
	frameCtx.durationMs = resolvedDurationMs ?? 0;
	frameCtx.progress =
		resolvedDurationMs && resolvedDurationMs > 0
			? Math.max(0, Math.min(1, ((frame / fps) * 1000) / resolvedDurationMs))
			: 0;
	frameCtx.deltaTime = fps > 0 ? 1 / fps : 0;

	const resolvedElapsedMs = isTimelineProvider
		? ((localFrame !== undefined && fps !== undefined
				? (localFrame / fps) * 1000
				: undefined) ?? props.elapsedMs)
		: (props.elapsedMs ??
			(localFrame !== undefined && fps !== undefined
				? (localFrame / fps) * 1000
				: undefined));

	const effectiveLocalFrame =
		localFrame + Math.round(inheritedSeekOffset * fps);

	let activeSeg: any = null;
	let windowStartFrame = 0;

	if (segments.length > 0) {
		const segmentWithRange = getCachedSegmentRanges(segments, fps);

		const active = segmentWithRange.find(
			({ start, duration }: { start: number; duration: number }) =>
				effectiveLocalFrame >= start && effectiveLocalFrame < start + duration,
		);

		if (active) {
			activeSeg = active.seg;
			windowStartFrame = active.start;
		} else {
			return;
		}
	}

	const segmentLocalFrame = localFrame - windowStartFrame;
	const segmentSeekOffset = activeSeg
		? activeSeg.startSec - windowStartFrame / fps
		: 0;
	const accumulatedSeekOffsetSec = inheritedSeekOffset + segmentSeekOffset;
	const accumulatedClockOffsetSec =
		inheritedClockOffset + windowStartFrame / fps;
	if (typeof op.onRequestFrame === "function") {
		op.onRequestFrame(frameCtx);
	} else if (op.effect && typeof op.effect.notifyFrame === "function") {
		op.effect.notifyFrame(frameCtx);
	}

	const CustomRenderer = webgpuRegistry.get(op.op);

	if (CustomRenderer) {
		if (op.signals) {
			virtualMedia = resolveSignalOperation(virtualMedia, frameCtx);
		}
		const inputs = op?.inputs as Record<string, ConnectedInput> | undefined;
		if (inputs) {
			for (const entry of Object.values(inputs)) {
				if (entry?.connectionValid && entry?.outputItem?.type === "LUT") {
					const lutVirtualMedia = entry.outputItem
						.data as VirtualMediaData | null;
					if (
						lutVirtualMedia &&
						typeof lutVirtualMedia === "object" &&
						lutVirtualMedia.operation
					) {
						const lutW = lutVirtualMedia.metadata?.width ?? targetWidth;
						const lutH = lutVirtualMedia.metadata?.height ?? targetHeight;
						const dummyTex = ctx.renderer.getTemporaryTexture(lutW, lutH);
						const dummyView = dummyTex.createView();
						await drawCompositionTree(
							ctx,
							encoder,
							dummyView,
							dummyTex,
							lutW,
							lutH,
							lutVirtualMedia,
							{ ...props, virtualMedia: lutVirtualMedia },
							accumulatedSeekOffsetSec,
							accumulatedClockOffsetSec,
						);
					}
				} else if (
					entry?.connectionValid &&
					entry?.outputItem?.type === "Signal"
				) {
					const sigData = entry.outputItem.data as
						| Record<string, unknown>
						| undefined;
					if (sigData && typeof sigData === "object") {
						await signalRegistry.ensureAudioSourcesExtracted(
							ctx.device,
							(sigData.signalConfig as Record<string, unknown> | undefined) ??
								sigData,
							fps,
							props.renderId,
						);
					}
				}
			}
		}

		const pass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"load",
		);
		let passEnded = false;
		const originalEnd = pass.end.bind(pass);
		pass.end = () => {
			if (!passEnded) {
				originalEnd();
				passEnded = true;
			}
		};
		const renderArgs = {
			ctx,
			encoder,
			pass,
			targetView,
			targetTexture,
			targetWidth,
			targetHeight,
			props: {
				...props,
				virtualMedia,
				inheritedSeekOffset: accumulatedSeekOffsetSec,
				inheritedClockOffset: accumulatedClockOffsetSec,
				durationMs: resolvedDurationMs,
				elapsedMs: resolvedElapsedMs,
			},
			drawChild: async (
				child: VirtualMediaData,
				overrides?: Partial<NodeRenderProps>,
				targetViewOverride?: GPUTextureView,
				targetTextureOverride?: GPUTexture,
				targetWidthOverride?: number,
				targetHeightOverride?: number,
			) => {
				await drawCompositionTree(
					ctx,
					encoder,
					targetViewOverride ?? targetView,
					targetTextureOverride ?? targetTexture,
					targetWidthOverride ?? targetWidth,
					targetHeightOverride ?? targetHeight,
					child,
					{
						...props,
						durationMs: resolvedDurationMs,
						elapsedMs: resolvedElapsedMs,
						virtualMedia: child,
						...overrides,
						// Merge, never replace: the caller knows which of its own
						// textures are still live (a compositor's canvas, its groups).
						excludeTextures: [
							...(props.excludeTextures || []),
							...(overrides?.excludeTextures || []),
							targetTextureOverride ?? targetTexture,
						],
					},
					isCompositor ? 0 : accumulatedSeekOffsetSec,
					accumulatedClockOffsetSec,
				);
			},
		};
		await CustomRenderer(renderArgs);
		renderArgs.pass.end();
		return;
	}

	if (op.op === "LUT") {
		return;
	}

	if (
		op.op === "Signal" ||
		op.op === "SignalMath" ||
		op.dataType === "Signal"
	) {
		const pass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"load",
		);

		await drawSignalNode(ctx, encoder, pass, {
			nodeId:
				(op.nodeId as string) ||
				(op.signalConfig?.nodeId as string) ||
				props.renderId,
			func: op.func,
			amplitude: Number(op.amplitude ?? 1),
			frequency: Number(op.frequency ?? 1),
			phase: Number(op.phase ?? 0),
			offset: Number(op.offset ?? 0),
			signalConfig: { ...op.signalConfig, ...op },
			frame,
			fps,
			elapsedMs: resolvedElapsedMs,
			durationMs: resolvedDurationMs ?? 0,
			width: targetWidth,
			height: targetHeight,
			drawChild: async (
				child: any,
				childProps: any,
				childView: GPUTextureView,
				childTex: GPUTexture,
				childW: number,
				childH: number,
			) => {
				await drawCompositionTree(
					ctx,
					encoder,
					childView,
					childTex,
					childW,
					childH,
					child,
					{
						...props,
						durationMs: resolvedDurationMs,
						elapsedMs: resolvedElapsedMs,
						...childProps,
						excludeTextures: [
							...(props.excludeTextures || []),
							...(childProps?.excludeTextures || []),
							childTex,
						],
					},
				);
			},
		});

		pass.end();
		return;
	}

	if (op.op === "source" || op.op === "text" || op.op === "caption") {
		const pass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"load",
		);

		if (op.op === "source") {
			const mediaType = getMediaType(virtualMedia);
			const params = computeRenderParams(virtualMedia);

			if (params.sourceUrl) {
				const containerWidth = props.containerWidth ?? ctx.surface.width;
				const containerHeight = props.containerHeight ?? ctx.surface.height;

				if (mediaType === "Image") {
					await drawImageNode(ctx, pass, {
						src: params.sourceUrl,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						opacity: Number(op.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
					});
				} else if (mediaType === "SVG") {
					await drawSvgNode(ctx, pass, {
						src: params.sourceUrl,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						opacity: Number(op.opacity ?? 1),
						isHeadless: props.isHeadless,
					});
				} else if (mediaType === "Lottie") {
					await drawLottieNode(ctx, pass, {
						src: params.sourceUrl,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						frame:
							segmentLocalFrame + Math.round(accumulatedSeekOffsetSec * fps),
						fps,
						opacity: Number(op.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
					});
				} else if (mediaType === "GIF") {
					await drawGifNode(ctx, pass, {
						src: params.sourceUrl,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						frame:
							segmentLocalFrame + Math.round(accumulatedSeekOffsetSec * fps),
						fps,
						opacity: Number(op.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
					});
				} else if (mediaType === "Text") {
					const opText = { ...op } as any;
					drawParagraphNode(ctx, pass, {
						text: opText.text || "",
						dstRect: {
							x: Number(opText.x ?? 0),
							y: Number(opText.y ?? 0),
							width: Number(opText.width ?? containerWidth),
							height: Number(opText.height ?? containerHeight),
						},
						fontFamily: opText.fontFamily,
						fontSize: Number(opText.fontSize ?? 48),
						color: opText.fill ?? opText.color ?? "white",
						width: opText.width ? Number(opText.width) : undefined,
						height: opText.height ? Number(opText.height) : undefined,
						lineHeight: Number(opText.lineHeight ?? 1.2),
						align: opText.align,
						fontWeight: opText.fontWeight,
						fontStyle: opText.fontStyle,
						letterSpacing: opText.letterSpacing,
						shadows: opText.shadows,
						textBackgroundColor: opText.textBackgroundColor,
						borderRadius:
							opText.borderRadius != null
								? Number(opText.borderRadius)
								: undefined,
						padding:
							opText.padding != null ? Number(opText.padding) : undefined,
						stroke: opText.stroke,
						strokeWidth:
							(opText.strokeWidth ?? opText.strokeThickness)
								? Number(opText.strokeWidth ?? opText.strokeThickness)
								: undefined,
						strokeAlign: opText.strokeAlign,
						opacity: Number(opText.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
						animation: opText.animation ?? opText.textAnimation,
						animators: opText.animators,
						pathOptions: opText.pathOptions,
						typewriter: opText.typewriter,
						marquee: opText.marquee,
						textProgress:
							opText.textProgress != null
								? Number(opText.textProgress)
								: undefined,
						signals: props.signals ?? opText.signals,
						firstMargin:
							opText.firstMargin != null
								? Number(opText.firstMargin)
								: undefined,
						lastMargin:
							opText.lastMargin != null ? Number(opText.lastMargin) : undefined,
						baselineShift:
							opText.baselineShift != null
								? Number(opText.baselineShift)
								: undefined,
						frame: localFrame,
						fps,
						durationMs: resolvedDurationMs,
						elapsedMs: resolvedElapsedMs,
						isVideoMode: props.isVideoMode,
					});
				} else if (mediaType === "Video") {
					const finalPlaybackRate = Math.max(
						0.01,
						(Number(props.playbackRateOverride) || 1) *
							(Number(params.speed) || 1),
					);
					const effectiveTrimSec = Math.max(
						0,
						(Number(props.trimStartOverride) || 0) +
							(Number(params.trimStartSec) || 0) +
							accumulatedSeekOffsetSec,
					);
					const rawTimestampSec =
						(segmentLocalFrame / fps) * finalPlaybackRate + effectiveTrimSec;
					const timestampSec = Math.max(
						0,
						Number.isFinite(rawTimestampSec) ? rawTimestampSec : 0,
					);

					await drawVideoNode(ctx, pass, {
						nodeId: props.renderId,
						frameKey: `${props.renderId ?? "video"}-${params.sourceUrl}-${Math.round(timestampSec * fps)}`,
						sourceUrl: params.sourceUrl,
						timestampSec,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						opacity: Number(op.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
						isPlaying: props.isPlaying,
						forceWait: props.forceWait,
					});
				} else if (mediaType === "Caption") {
					const opCap = { ...op, ...props } as any;
					await drawCaptionNode(ctx, pass, {
						renderId: props.renderId,
						src: params.sourceUrl,
						dstRect: {
							x: 0,
							y: 0,
							width: containerWidth,
							height: containerHeight,
						},
						frame: localFrame,
						fps,
						fontFamily: opCap.fontFamily,
						fontSize: Number(opCap.fontSize ?? 48),
						color: opCap.fill ?? opCap.color ?? "white",
						lineHeight: Number(opCap.lineHeight ?? 1.2),
						align:
							opCap.align === "start"
								? "left"
								: opCap.align === "end"
									? "right"
									: (opCap.align ?? "center"),
						textAlignVertical: opCap.verticalAlign ?? opCap.textAlignVertical,
						fontWeight: opCap.fontWeight,
						fontStyle: opCap.fontStyle,
						letterSpacing: opCap.letterSpacing,
						shadows: opCap.shadows,
						textBackgroundColor: opCap.background ?? opCap.textBackgroundColor,
						borderRadius:
							(opCap.borderRadius ?? opCap.strokeRadius) != null
								? Number(opCap.borderRadius ?? opCap.strokeRadius)
								: undefined,
						strokeRadius:
							(opCap.strokeRadius ?? opCap.borderRadius) != null
								? Number(opCap.strokeRadius ?? opCap.borderRadius)
								: undefined,
						stroke: opCap.stroke,
						strokeWidth:
							(opCap.strokeWidth ?? opCap.strokeThickness) != null
								? Number(opCap.strokeWidth ?? opCap.strokeThickness)
								: undefined,
						maxWidth: opCap.maxWidth,
						padding: opCap.padding != null ? Number(opCap.padding) : undefined,
						opacity: Number(opCap.opacity ?? 1) * Number(props.opacity ?? 1),
						isHeadless: props.isHeadless,
						isVideoMode: props.isVideoMode,
					});
				}
			}
		} else if (op.op === "text") {
			const opText = { ...op } as any;
			const containerWidth = props.containerWidth ?? ctx.surface.width;
			const containerHeight = props.containerHeight ?? ctx.surface.height;
			drawParagraphNode(ctx, pass, {
				renderId: props.renderId,
				text: opText.text || "",
				dstRect: {
					x: Number(opText.x ?? 0),
					y: Number(opText.y ?? 0),
					width: Number(opText.width ?? containerWidth),
					height: Number(opText.height ?? containerHeight),
				},
				spans: opText.spans,
				fontFamily: opText.fontFamily,
				fontSize: Number(opText.fontSize ?? 48),
				color: opText.fill ?? opText.color ?? "white",
				width: opText.width ? Number(opText.width) : undefined,
				height: opText.height ? Number(opText.height) : undefined,
				lineHeight: Number(opText.lineHeight ?? 1.2),
				align: opText.align,
				fontWeight: opText.fontWeight,
				fontStyle: opText.fontStyle,
				letterSpacing: opText.letterSpacing,
				shadows: opText.shadows,
				textBackgroundColor: opText.textBackgroundColor,
				borderRadius:
					(opText.borderRadius ?? opText.strokeRadius) != null
						? Number(opText.borderRadius ?? opText.strokeRadius)
						: undefined,
				strokeRadius:
					(opText.strokeRadius ?? opText.borderRadius) != null
						? Number(opText.strokeRadius ?? opText.borderRadius)
						: undefined,
				padding: opText.padding != null ? Number(opText.padding) : undefined,
				stroke: opText.stroke,
				strokeWidth:
					(opText.strokeWidth ?? opText.strokeThickness)
						? Number(opText.strokeWidth ?? opText.strokeThickness)
						: undefined,
				strokeAlign: opText.strokeAlign,
				opacity: Number(opText.opacity ?? 1) * Number(props.opacity ?? 1),
				isHeadless: props.isHeadless,
				animation: opText.animation ?? opText.textAnimation,
				animators: opText.animators,
				pathOptions: opText.pathOptions,
				typewriter: opText.typewriter,
				marquee: opText.marquee,
				signals: props.signals ?? opText.signals,
				firstMargin:
					opText.firstMargin != null ? Number(opText.firstMargin) : undefined,
				lastMargin:
					opText.lastMargin != null ? Number(opText.lastMargin) : undefined,
				baselineShift:
					opText.baselineShift != null
						? Number(opText.baselineShift)
						: undefined,
				frame: localFrame,
				fps,
				durationMs: resolvedDurationMs,
				elapsedMs: resolvedElapsedMs,
				isVideoMode: props.isVideoMode,
			});
		}

		pass.end();
	}

	if (virtualMedia.children && virtualMedia.children.length > 0) {
		for (let i = 0; i < virtualMedia.children.length; i++) {
			const child = virtualMedia.children[i];
			if (child) {
				await drawCompositionTree(
					ctx,
					encoder,
					targetView,
					targetTexture,
					targetWidth,
					targetHeight,
					child,
					{
						...props,
						durationMs: resolvedDurationMs,
						elapsedMs: resolvedElapsedMs,
						virtualMedia: child,
						renderId: `${props.renderId}-c${i}`,
					},
					isCompositor ? 0 : accumulatedSeekOffsetSec,
					accumulatedClockOffsetSec,
				);
			}
		}
	}
}

export const CanvasComposition: React.FC<NodeRenderProps> = memo((props) => {
	const ctx = useRenderContext();
	const { renderId, virtualMedia: rawVirtualMedia } = props;
	const state = useCompositionState(renderId);

	const { virtualMedia, fps } = React.useMemo(() => {
		const fpsValue = props.fps ?? state.fps;
		const normalized = normalizeTimeline(rawVirtualMedia, fpsValue);
		return { virtualMedia: normalized, fps: fpsValue };
	}, [rawVirtualMedia, state.fps, props.fps]);

	const frame = props.frame ?? state.frame;

	const isMountedRef = React.useRef(false);
	const latestTaskRef = React.useRef<{
		ctx: RenderContextValue;
		virtualMedia: VirtualMediaData;
		frame: number;
		fps: number;
		props: NodeRenderProps;
	} | null>(null);
	const isRenderingRef = React.useRef(false);

	const [fontUpdateTick, forceUpdate] = React.useState(0);
	React.useEffect(() => {
		const unsubscribe = SlugFontCache.addListener(() => {
			if (isMountedRef.current) {
				forceUpdate((t) => t + 1);
			}
		});
		return unsubscribe;
	}, []);

	React.useEffect(() => {
		const cdnDomain = getEnv("R2_CUSTOM_DOMAIN") as string;
		if (!cdnDomain) {
			console.error("[CanvasComposition] R2_CUSTOM_DOMAIN is not defined.");
			return;
		}
		const url = `https://${cdnDomain}/static/NotoColorEmoji.ttf`;
		SlugFontCache.preloadEmojiFontFace(url).catch((err) => {
			console.error("[CanvasComposition] Failed to preload emoji font:", err);
		});
	}, []);

	const [lutUpdateTick, setLutUpdateTick] = React.useState(0);
	React.useEffect(() => {
		const unsubscribe = lutStore.onChange(() => {
			if (isMountedRef.current) {
				setLutUpdateTick((t) => t + 1);
			}
		});
		return unsubscribe;
	}, []);

	React.useLayoutEffect(() => {
		isMountedRef.current = true;
		return () => {
			isMountedRef.current = false;

			// 1. Clear media decoders associated with this composition
			mediaDecoderCache.clearNode(renderId);

			// 2. Clear video node state (cached fallback textures)
			clearVideoNodeState(renderId, ctx?.device);

			// 3. Clear any delay handles associated with this composition
			if (
				typeof globalThis !== "undefined" &&
				(globalThis as any).__GATEWAI_DELAYS__
			) {
				const delays = (globalThis as any).__GATEWAI_DELAYS__;
				if (delays instanceof Set) {
					for (const handle of delays) {
						if (typeof handle === "string" && handle.startsWith(renderId)) {
							delays.delete(handle);
						}
					}
				}
			}

			if (
				typeof window !== "undefined" &&
				(window as any).renderer_delayRenderHandles
			) {
				const handles = (window as any).renderer_delayRenderHandles;
				if (Array.isArray(handles)) {
					const filtered = handles.filter(
						(handle) =>
							!(typeof handle === "string" && handle.startsWith(renderId)),
					);
					(window as any).renderer_delayRenderHandles = filtered;
				}
			}
		};
	}, [renderId, ctx]);

	React.useLayoutEffect(() => {
		if (!ctx || !virtualMedia) return;

		latestTaskRef.current = {
			ctx,
			virtualMedia,
			frame,
			fps,
			props,
		};

		const triggerRender = async () => {
			if (isRenderingRef.current) return;
			isRenderingRef.current = true;

			while (latestTaskRef.current && isMountedRef.current) {
				const task = latestTaskRef.current;
				if (task.ctx !== ctx) {
					// Context changed (e.g. device lost), let the other effect handle it
					break;
				}
				latestTaskRef.current = null;

				try {
					const { device, surface, renderer } = task.ctx;
					const targetW = surface.width;
					const targetH = surface.height;
					if (targetW === 0 || targetH === 0) continue;

					const encoder = device.createCommandEncoder();
					const stableTex = renderer.getTemporaryTexture(targetW, targetH);
					const stableView = stableTex.createView();

					// Initial clear of the stable texture
					const clearPass = renderer.beginFrame(
						encoder,
						stableView,
						{ r: 0, g: 0, b: 0, a: 0 },
						targetW,
						targetH,
						"clear",
					);
					clearPass.end();

					await drawCompositionTree(
						task.ctx,
						encoder,
						stableView,
						stableTex,
						targetW,
						targetH,
						task.virtualMedia,
						{
							...task.props,
							frame: task.frame,
							fps: task.fps,
							isPlaying: task.props.isPlaying ?? state.isPlaying,
							isVideoMode: task.virtualMedia.operation.dataType === "Video",
							excludeTextures: [stableTex],
						},
					);

					if (latestTaskRef.current !== null) {
						// A newer task was scheduled while we were awaiting. Discard this stale frame.
						continue;
					}

					if (isMountedRef.current && !renderer.isDestroyed) {
						// Get FRESH canvas view right before submission
						const blitW = surface.width;
						const blitH = surface.height;
						if (blitW > 0 && blitH > 0) {
							const canvasView = surface.getCurrentTextureView();
							const blitPass = renderer.beginFrame(
								encoder,
								canvasView,
								{ r: 0, g: 0, b: 0, a: 0 },
								blitW,
								blitH,
								"clear",
							);
							renderer.drawTexture(blitPass, stableTex, {
								x: 0,
								y: 0,
								width: blitW,
								height: blitH,
							});
							blitPass.end();
						}

						device.queue.submit([encoder.finish()]);
						surface.present();

						// Synchronize with the frame capture process to avoid black frames
						const key = `${task.props.renderId}-${task.frame}`;
						if (!(window as any).__frameRenderResolvers) {
							(window as any).__frameRenderResolvers = new Map();
						}
						const status = (window as any).__frameRenderResolvers.get(key);
						if (status) {
							status.rendered = true;
							if (status.resolver) {
								status.resolver();
							}
						} else {
							(window as any).__frameRenderResolvers.set(key, {
								rendered: true,
							});
						}
					}
				} catch (err) {
					console.error("Error drawing WebGPU composition tree:", err);
				}
			}

			isRenderingRef.current = false;
			if (latestTaskRef.current && isMountedRef.current) {
				void triggerRender();
			}
		};

		void triggerRender();
	}, [ctx, virtualMedia, frame, fps, props, fontUpdateTick, lutUpdateTick]);

	return null;
});
