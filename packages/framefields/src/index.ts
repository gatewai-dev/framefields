export {
	AudioSignal,
	type AudioSignalOptions,
	computed,
	cosineSignal,
	type ExtractedAudioSignalsBundle,
	type FrameSignal,
	Signal,
	type SignalContext,
	type SignalValue,
	type SineSignalOptions,
	signal,
	signalBuilder,
	signalRegistry,
	sineSignal,
} from "./signals/index.js";

import {
	FontManager,
	type RegisteredFont,
	type RegisterFontOptions,
} from "./fonts/index.js";
import { autoId } from "./ids.js";
import { normalizeTextSpans, type TextSpan } from "./rich-text.js";

export {
	encodeStereoWav,
	mixAudioTracks,
	mixSfxInto,
	type RenderedSfx,
	renderSfx,
	type SfxRenderContext,
	type SfxTrigger,
	softLimit,
} from "./audio/index.js";
export {
	accent,
	bold,
	code,
	color,
	italic,
	type MarkOptions,
	mark,
	normalizeTextSpans,
	parseMarkup,
	rich,
	size,
	span,
	sub,
	sup,
	type TextSpan,
	type TextSpanItem,
	type TextSpanMark,
} from "./rich-text.js";
export { FontManager, type RegisteredFont, type RegisterFontOptions };

export {
	CannyComputePipeline,
	type CannyOptions,
	type ControlNetConditioningOutputs,
	ControlNetMultiplexer,
	type DeflickerOptions,
	DepthNormalsComputePipeline,
	type DepthNormalsOptions,
	type NormalRelightingOptions,
	OpticalFlowComputePipeline,
	type OpticalFlowOptions,
	TemporalDeflickerPipeline,
	type TensorDimensions,
	type TensorFormat,
	type TensorNode,
	TensorPipeline,
	type TensorPipelineConfig,
	type TensorSource,
	type TensorViewExport,
} from "@framefields/tensor-webgpu";
export {
	COCO_CLASSES,
	COCO17_BONES,
	COCO17_KEYPOINT_NAMES,
	COCO17_KEYPOINTS,
	type DetectedObject,
	type InstanceMask,
	type Landmark3D,
	type LandmarkCoordinateSignals,
	type MaskTrackSignals,
	type NormalizedLandmarkList,
	type ObjectAnchorName,
	type ObjectAnchorsSignals,
	type ObjectBoundingBox,
	type ObjectBoundingBoxSignals,
	type ObjectCollectionSignals,
	type ObjectKinematicsSignals,
	type ObjectTrackSignals,
	type PersonMatte,
	type PinToLandmarkOptions,
	type PinToObjectOptions,
	type PoseLandmarkSignals,
	type PoseResult,
	PoseSkeletonRenderer,
	pinNodeToLandmark,
	pinNodeToObject,
	type SegmentationResult,
	SegmentationTexturePool,
	SpatialLandmarkTransformer,
	TemporalObjectTracker,
	type TrackedObject,
	VisionBundle,
	type VisionConfig,
	VisionNode,
	VisionRunner,
	type VisionTask,
	type VisionVariant,
} from "@framefields/vision";

import fs from "node:fs/promises";
import path from "node:path";
import {
	type AnimationTrack,
	type BoxNode,
	type CameraNode,
	type CompositorProgramConfig,
	type CompositorToProgramOptions,
	compositorToProgram,
	type FlexNode,
	LayerAnimation,
	type LayoutNode,
	type LightNode,
	type MediaNode,
	type Model3DNode,
	type ShapeNode,
	type TextNode,
} from "@framefields/compositions/program";
import {
	appendOperation,
	Effect as CoreEffect,
	createVirtualMedia,
	type DataType,
	type FrameContext,
	type MediaMetadata,
	type MediaOperation,
	type MediaSourceInput,
	type MeshAudioDeformConfig,
	ProgrammaticSignal,
	type Signal,
	type VirtualMediaData,
} from "@framefields/core";
import {
	analyzeSequence as analyzeVisionFrames,
	type LandmarkCoordinateSignals,
	type MaskTrackSignals,
	type ObjectTrackSignals,
	type PinToLandmarkOptions,
	type PinToObjectOptions,
	pinNodeToLandmark,
	pinNodeToObject,
	type VisionAnalysisReport,
	VisionBundle,
	VisionNode,
	VisionRunner,
	type VisionTask,
} from "@framefields/vision";

export {
	analyzeSequence,
	type VisionAnalysisReport,
} from "@framefields/vision";

import {
	type DeflickerOptions,
	type NormalRelightingOptions,
	TensorPipeline,
} from "@framefields/tensor-webgpu";
import { inputStore, mediaDecoderCache } from "@framefields/webgpu-renderers";
import { buildChart, type ChartOptions } from "./chart.js";
import {
	ApplyLUT,
	type ApplyLUTProps,
	Blur,
	type BlurProps,
	ColorBalance,
	type ColorBalanceProps,
	ColorKey,
	type ColorKeyProps,
	Crop,
	type CropProps,
	Curves,
	type CurvesProps,
	CustomEffect,
	type DeflickerProps,
	DepthOfField,
	type DepthOfFieldProps,
	FilmGrain,
	type FilmGrainProps,
	GradientMap,
	type GradientMapProps,
	HalftoneScreen,
	type HalftoneScreenProps,
	HighPass,
	type HighPassProps,
	Levels,
	type LevelsProps,
	Modulate,
	type ModulateProps,
	MotionBlur,
	type MotionBlurProps,
	PBRGlass,
	type PBRGlassProps,
	Relight3D,
	type Relight3DProps,
	SelectiveColor,
	type SelectiveColorProps,
	ShadowsHighlights,
	type ShadowsHighlightsProps,
	SSAO,
	type SSAOProps,
	TemporalDeflicker,
	TileOffset,
	type TileOffsetProps,
	UnsharpMask,
	type UnsharpMaskProps,
	Vignette,
	type VignetteProps,
	Vision,
	type VisionProps,
} from "./effects/index.js";
import {
	type FrameGridOptions,
	HeadlessMediaRenderer,
	renderFrameGrid,
	type VideoQaOptions,
	type VideoQaReport,
} from "./renderer/index.js";
import {
	type Carousel3DOptions,
	type Cube3DOptions,
	Layer3D,
	type Plane3DOptions,
	type Prism3DOptions,
} from "./shapes3d.js";

export interface SectionOptions {
	readonly id?: string;
	readonly position?: "absolute" | "relative";
	readonly source?: string | MediaNode;
	readonly effects?: unknown[];
	readonly padding?: number;
	readonly borderRadius?: number;
	readonly borderColor?: string;
	readonly borderWidth?: number;
	readonly opacity?: number | unknown;
	readonly blendMode?: string;
	readonly fit?: "cover" | "contain";
	readonly width?: number | unknown;
	readonly height?: number | unknown;
	readonly x?: number | unknown;
	readonly y?: number | unknown;
	readonly hideWhenLost?: boolean;
	readonly smoothFrames?: number;
	readonly children?: LayoutNode[];
	readonly [key: string]: unknown;
}

export type SectionNode = AnimatableNode<BoxNode> & {
	readonly innerMedia: AnimatableNode<MediaNode>;
	// Any effect, whatever its config shape (Blur, FilmGrain, …).
	readonly effects: Effect<object>[];
	addEffect(effect: Effect<object>): SectionNode;
	withEffect(effect: Effect<object>): SectionNode;
	withEffects(effects: Effect<object>[]): SectionNode;
};

export type TrackedRegionOptions = SectionOptions;

/** Editing helpers attached to every tracked object (see decorateTrackSignals). */
export interface TrackEditing {
	/** A section of the source that follows this track */
	section(
		sourceOrOptions?: string | MediaNode | SectionOptions,
		options?: SectionOptions,
	): SectionNode;
	/** A blur confined to this track's region */
	blurEffect(options?: Partial<BlurProps>): Blur;
	/** The tracked region of `source`, cut out as a section */
	isolate(
		source: string | MediaNode,
		options?: TrackedRegionOptions,
	): SectionNode;
}

/** A tracked object with its editing helpers, as vision hands it out. */
export type EditableObjectTrack = ObjectTrackSignals & TrackEditing;

function decorateTrackSignals<T extends ObjectTrackSignals>(
	track: T,
	source?: string | MediaNode,
): T {
	if (!track) return track;
	if (source && !track.source) {
		Object.defineProperty(track, "source", {
			value: source,
			enumerable: true,
			writable: true,
			configurable: true,
		});
	}
	if (typeof track.section !== "function") {
		Object.defineProperty(track, "section", {
			value: (
				sourceOrOptions?: string | MediaNode | SectionOptions,
				options?: SectionOptions,
			) => {
				if (
					typeof sourceOrOptions === "object" &&
					sourceOrOptions !== null &&
					!("kind" in sourceOrOptions) &&
					!("inputHandleId" in sourceOrOptions) &&
					!("src" in sourceOrOptions)
				) {
					const resolvedSource =
						(sourceOrOptions as SectionOptions).source ??
						(track.source as string | MediaNode | undefined) ??
						source;
					return Layer.section(
						resolvedSource as string | MediaNode,
						track,
						sourceOrOptions as SectionOptions,
					);
				}
				const resolvedSource =
					sourceOrOptions ??
					(track.source as string | MediaNode | undefined) ??
					source;
				return Layer.section(
					resolvedSource as string | MediaNode,
					track,
					options,
				);
			},
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	if (typeof track.blurEffect !== "function") {
		Object.defineProperty(track, "blurEffect", {
			value: (options?: Partial<BlurProps>) => new Blur({ track, ...options }),
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	if (typeof track.isolate !== "function") {
		Object.defineProperty(track, "isolate", {
			value: (sourceArg: string | MediaNode, options?: TrackedRegionOptions) =>
				Layer.section(sourceArg, track, options),
			enumerable: false,
			writable: true,
			configurable: true,
		});
	}
	return track;
}

const origVisionAttach = VisionNode.attach;
VisionNode.attach = function (
	source: Parameters<typeof origVisionAttach>[0],
	config?: Parameters<typeof origVisionAttach>[1],
	bundleOptions?: Parameters<typeof origVisionAttach>[2],
): ReturnType<typeof origVisionAttach> {
	const bundle = origVisionAttach.call(this, source, config, bundleOptions);
	if (bundle?.objects) {
		const src = source as string | MediaNode;
		const origGet = bundle.objects.get.bind(bundle.objects);
		bundle.objects.get = (id: number) => decorateTrackSignals(origGet(id), src);

		const origByCategory = bundle.objects.byCategory.bind(bundle.objects);
		bundle.objects.byCategory = (cat: string, rank?: number) =>
			decorateTrackSignals(origByCategory(cat, rank), src);

		if (bundle.objects.primary) {
			decorateTrackSignals(bundle.objects.primary, src);
		}
	}
	return bundle;
};

export {
	type AdvancedTextAnimator,
	AdvancedTextAnimatorBuilder,
	AdvancedTextAnimatorSchema,
	// Text Animations & After Effects Parity
	type AETextAnimator,
	AETextAnimatorSchema,
	type AnchorGrouping,
	AnchorGroupingSchema,
	type AnchorPreset,
	AnchorPresetSchema,
	type AnimatableGlyphProps,
	AnimatableGlyphPropsSchema,
	type AnimatableProp,
	type AnimationTrack,
	type ArcLengthLUTEntry,
	type AudioSpectrumTypography,
	AudioSpectrumTypographySchema,
	applyStaggerToChildren,
	type BlockNode,
	type BoxNode,
	BoxNodeSchema,
	buildPathLUT,
	CameraAnimation,
	type CameraDoF,
	type CameraLens,
	type CameraNode,
	CameraNodeSchema,
	type CameraShake,
	type CarrierHandoffConfig,
	CarrierHandoffConfigSchema,
	type CarrierState,
	type ChromaticGlitchConfig,
	ChromaticGlitchConfigSchema,
	type ColorSignalOptions,
	type ColorStop,
	ColorStopSchema,
	type CompositorProgramConfig,
	CompositorProgramSchema,
	type CompositorToProgramOptions,
	type CubicBezierSegment,
	CubicBezierSegmentSchema,
	calculateSequenceTimeline,
	collectNodeOps,
	compositorToProgram,
	computeAnchorPivotOffset,
	computeCarrierContinuity,
	computeLayout,
	computeLayoutSync,
	computeLineLeadingDisplacement,
	computeRangeSelectorWeight,
	computeStaggerDelay,
	type DynamicStrokeProperties,
	DynamicStrokePropertiesSchema,
	deterministicWigglyNoise,
	distanceToCurveParameter,
	type EaseRef,
	type EnhancedTextNode,
	EnhancedTextNodeSchema,
	type ExpressionEvaluationContext,
	type ExpressionSelector,
	ExpressionSelectorSchema,
	type ExtendedGlyphProperties,
	ExtendedGlyphPropertiesSchema,
	ellipseToCubicBeziers,
	evaluateAnimationAtFrame,
	evaluateCubicBezier,
	evaluateCubicBezierDerivative,
	evaluateExpressionSelector,
	evaluateMarqueeOffset,
	evaluateSelectorCombination,
	evaluateSkewMatrix,
	evaluateSpringProgress,
	evaluateTrackAtFrame,
	evaluateTypewriterState,
	evaluateVolumetricFormation,
	type FlexNode,
	FlexNodeSchema,
	type FromToOptions,
	type GlyphAnchorGrouping,
	GlyphAnchorGroupingSchema,
	type GlyphAnchorPoint,
	GlyphAnchorPointSchema,
	generateArcLengthLUT,
	generatePathSegments,
	getScramblePool,
	getShuffledOrder,
	type Keyframe,
	type KeyframeTuple,
	type KineticMarqueeConfig,
	KineticMarqueeConfigSchema,
	LayerAnimation,
	type LayoutNode,
	LayoutNodeSchema,
	type LightNode,
	LightNodeSchema,
	type LightType,
	LightTypeSchema,
	type LineSpacingDynamics,
	LineSpacingDynamicsSchema,
	type LongShadowConfig,
	LongShadowConfigSchema,
	type MaterialType,
	MaterialTypeSchema,
	type MediaNode,
	MediaNodeSchema,
	type Model3DNode,
	Model3DNodeSchema,
	type ParticleDissolveConfig,
	ParticleDissolveConfigSchema,
	type PathChainLUT,
	type PathChainLUTEntry,
	parseSvgPathToCubicBeziers,
	Scene,
	type SceneDefinition,
	SceneDefinitionSchema,
	type SceneOptions,
	type SceneTransitionType,
	SceneTransitionTypeSchema,
	type SelectorBasedOn,
	SelectorBasedOnSchema,
	type SelectorMode,
	SelectorModeSchema,
	type SelectorShape,
	SelectorShapeSchema,
	type SelectorUnits,
	SelectorUnitsSchema,
	Sequence,
	type SequenceOptions,
	type SequenceTimelineResult,
	type ShapeNode,
	ShapeNodeSchema,
	type SignalTrackOptions,
	type SkewProperties,
	SkewPropertiesSchema,
	type Spatial3DProperties,
	Spatial3DPropertiesSchema,
	type SpringOptions,
	type SpringPhysics,
	SpringPhysicsSchema,
	sampleAudioSpectrumScale,
	sampleCurveGeometry,
	samplePathChainGeometry,
	type TextAnchorConfig,
	TextAnchorConfigSchema,
	TextAnimator,
	TextAnimatorBuilder,
	TextAnimatorSchema,
	type TextCursorConfig,
	TextCursorConfigSchema,
	type TextCursorStyle,
	TextCursorStyleSchema,
	type TextNode,
	TextNodeSchema,
	TextPathBuilder,
	type TextPathOptions,
	TextPathOptionsSchema,
	type TextPathSource,
	TextPathSourceSchema,
	type TextRangeSelector,
	TextRangeSelectorSchema,
	type TextScrambleConfig,
	TextScrambleConfigSchema,
	type TextSelector,
	TextSelectorSchema,
	type TextSignalSelector,
	TextSignalSelectorSchema,
	TextSpanMarkSchema,
	TextSpanSchema,
	type TextWigglySelector,
	TextWigglySelectorSchema,
	type TrackSource,
	type TypewriterAnimator,
	TypewriterAnimatorSchema,
	type TypingCadence,
	TypingCadenceSchema,
	type VariableFontAxes,
	VariableFontAxesSchema,
	type Vec2,
	Vec2Schema,
	type VolumetricFormationConfig,
	VolumetricFormationConfigSchema,
	type VolumetricFormationMode,
	VolumetricFormationModeSchema,
	type WiggleOptions,
	waveToCubicBeziers,
} from "@framefields/compositions/program";
export * from "@framefields/core";
export * from "@framefields/renderers";
export {
	type AnimationClip3D,
	type AudioLatentData,
	AudioLatentEngine,
	AudioLatentTrackCache,
	AudioMeshDeformPipeline,
	type BlendMode,
	type Bone3D,
	Camera3D,
	EffectPipeline,
	ensureDevice,
	GlassPipeline,
	type GPULightData,
	inputStore,
	Light3D,
	type Light3DOptions,
	type LoadModelOptions,
	loadFBX,
	loadModel3D,
	loadOBJ,
	lutStore,
	type Material3D,
	type Mesh3DData,
	type Model3DData,
	MotionBlurPipeline,
	type NodeAnimationTrack3D,
	Path3D,
	parseFBX,
	parseMTL,
	parseOBJ,
	type RenderContextValue,
	Renderer2D,
	Renderer3D,
	ShadowPipeline,
	type Skeleton3D,
	SlugFontCache,
	SlugPipeline,
	SSAOPipeline,
	shaderStore,
	textureCache,
} from "@framefields/webgpu-renderers";
export {
	type ChartAnimationOptions,
	type ChartAxisOptions,
	type ChartCandle,
	type ChartDatum,
	type ChartOptions,
	type ChartPadding,
	type ChartSeries,
	type ChartSlice,
	type ChartType,
	type ChartX,
	DEFAULT_CHART_COLORS,
} from "./chart.js";
export {
	ApplyLUT,
	type ApplyLUTProps,
	AudioSignalExtractor,
	type AudioSignalExtractorProps,
	Blur,
	type BlurProps,
	ColorBalance,
	type ColorBalanceProps,
	ColorKey,
	type ColorKeyProps,
	Crop,
	type CropProps,
	Curves,
	type CurvesChannelPoint,
	type CurvesProps,
	CustomEffect,
	type DeflickerProps,
	DepthOfField,
	type DepthOfFieldProps,
	FilmGrain,
	type FilmGrainProps,
	GradientMap,
	type GradientMapProps,
	type GradientMapStop,
	type HalftoneDotShape,
	type HalftoneMode,
	HalftoneScreen,
	type HalftoneScreenProps,
	HighPass,
	type HighPassProps,
	type LevelChannel,
	Levels,
	type LevelsProps,
	Modulate,
	type ModulateProps,
	MotionBlur,
	type MotionBlurProps,
	PBRGlass,
	type PBRGlassProps,
	Relight3D,
	type Relight3DProps,
	SelectiveColor,
	type SelectiveColorAdjustment,
	type SelectiveColorProps,
	ShadowsHighlights,
	type ShadowsHighlightsProps,
	SSAO,
	type SSAOProps,
	TemporalDeflicker,
	TileOffset,
	type TileOffsetEdgeMode,
	type TileOffsetProps,
	UnsharpMask,
	type UnsharpMaskProps,
	Vignette,
	type VignetteProps,
	Vision,
	type VisionProps,
} from "./effects/index.js";
export {
	type Carousel3DOptions,
	type Cube3DOptions,
	type CubeFaceConfig,
	type CubeFaceInput,
	type ExtrudedText3DOptions,
	type Grid3DOptions,
	Layer3D,
	type Plane3DOptions,
	type Prism3DOptions,
	type Shape3DContainer,
	type Text3DOptions,
} from "./shapes3d.js";

export interface CompositionOptions {
	width: number;
	height: number;
	fps?: number;
	durationMs?: number;
	durationFrames?: number;
	backgroundColor?: string;
	fonts?: string[];
	signals?: Record<string, unknown>;
	/**
	 * Smooth the edges of 3D meshes (extruded text, models) with 4x MSAA.
	 * Default true; set false to save ~60-125 MB of GPU memory at 1080p.
	 */
	antialias3d?: boolean;
}

/**
 * Fluent builder for single clips and chained visual/audio effect pipelines.
 */
export class Media {
	public readonly virtualMedia: VirtualMediaData;

	constructor(source: MediaSourceInput, type: DataType = "Video") {
		this.virtualMedia = createVirtualMedia(source, type);
	}

	static video(source: MediaSourceInput, meta?: Partial<MediaMetadata>): Media {
		const m = new Media(source, "Video");
		if (meta) Object.assign(m.virtualMedia.metadata, meta);
		return m;
	}

	static image(source: MediaSourceInput, meta?: Partial<MediaMetadata>): Media {
		const m = new Media(source, "Image");
		if (meta) Object.assign(m.virtualMedia.metadata, meta);
		return m;
	}

	static audio(source: MediaSourceInput, meta?: Partial<MediaMetadata>): Media {
		const m = new Media(source, "Audio");
		if (meta) Object.assign(m.virtualMedia.metadata, meta);
		return m;
	}

	/**
	 * Appends any Effect instance or shader operation onto the current media AST.
	 */
	public apply<TProps extends object>(effect: Effect<TProps>): Media;
	public apply<
		TConfig extends Record<string, unknown> = Record<string, unknown>,
	>(op: string, config?: TConfig): Media;
	public apply(
		effectOrOp: Effect<object> | string,
		config: Record<string, unknown> = {},
	): Media {
		let opPayload: Record<string, unknown>;
		if (
			effectOrOp instanceof Effect ||
			(typeof effectOrOp === "object" &&
				effectOrOp !== null &&
				"op" in effectOrOp)
		) {
			opPayload = (effectOrOp as Effect<object>).toOperation();
		} else {
			opPayload = {
				op: effectOrOp,
				...config,
			};
		}

		const nextVM = appendOperation(this.virtualMedia, {
			...opPayload,
			dataType: this.virtualMedia.operation.dataType,
		} as MediaOperation);
		return new Media(nextVM);
	}

	/**
	 * Returns the underlying VirtualMediaData AST node ready for rendering.
	 */
	public toVirtualMedia(): VirtualMediaData {
		return this.virtualMedia;
	}

	/**
	 * Renders a single frame from this media pipeline to a PNG Buffer.
	 * Can render either by timestamp in milliseconds (`atMs`) or by frame index (`frame`).
	 */
	public async renderFrame(
		options: {
			atMs?: number;
			frame?: number;
			fps?: number;
			renderer?: HeadlessMediaRenderer;
		} = {},
	): Promise<Buffer> {
		const renderer = options.renderer ?? new HeadlessMediaRenderer();
		return renderer.renderFrame(this.virtualMedia, options);
	}

	get fps(): number | undefined {
		return this.virtualMedia.metadata?.fps ?? undefined;
	}

	get durationMs(): number | undefined {
		return this.virtualMedia.metadata?.durationMs ?? undefined;
	}

	get width(): number | undefined {
		return this.virtualMedia.metadata?.width ?? undefined;
	}

	get height(): number | undefined {
		return this.virtualMedia.metadata?.height ?? undefined;
	}

	/**
	 * Renders an image grid of sequential frames across a given frame or millisecond range.
	 * Ideal for automated visual inspection of animation motion, easing curves, and layout stability.
	 */
	public async renderFrameGrid(
		options: FrameGridOptions = {},
	): Promise<Buffer> {
		return renderFrameGrid(this, options);
	}

	/**
	 * Renders this media pipeline into an MP4/WebM video file with audio.
	 */
	public async renderVideo(
		outputPathOrOptions: string | RenderVideoOptions = {},
		options: RenderVideoOptions = {},
	): Promise<RenderVideoResult> {
		const opts =
			typeof outputPathOrOptions === "string"
				? { ...options, outputPath: outputPathOrOptions }
				: outputPathOrOptions;
		const renderer = opts.renderer ?? new HeadlessMediaRenderer();
		const result = await renderer.renderVideo(this.virtualMedia, opts);
		return deliverToOutputPath(result, opts.outputPath);
	}
}

/**
 * Copies a rendered temp file to `outputPath` and drops the temp, so the
 * returned `filePath` is where the video actually lives.
 */
async function deliverToOutputPath(
	result: RenderVideoResult,
	outputPath: string | undefined,
): Promise<RenderVideoResult> {
	if (!outputPath) return result;
	const target = path.resolve(outputPath);
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.copyFile(result.filePath, target);
	await result.cleanup();
	return { ...result, filePath: target, cleanup: async () => {} };
}

export interface RenderVideoOptions {
	codec?: string;
	audioCodec?: string;
	quality?: string;
	concurrency?: number;
	/**
	 * Depth of the DMA staging ring used to overlap GPU rendering with hardware
	 * encoding (default 2, clamped 2–8). A deeper ring hides more encoder
	 * latency at the cost of VRAM (~8.3MB/slot at 1080p RGBA). Also settable
	 * via `FRAMEFIELDS_RING_CAPACITY`.
	 */
	ringCapacity?: number;
	outputPath?: string;
	renderer?: HeadlessMediaRenderer;
	/**
	 * Check the output while it renders and return the findings as `qa`:
	 * dropped, black or frozen frames, loudness (LUFS), clipping, silence and
	 * document warnings such as truncated animations. `true` uses defaults;
	 * pass thresholds (e.g. `{ targetLufs: -14 }`) to tighten them.
	 */
	qa?: boolean | VideoQaOptions;
}

export interface RenderVideoResult {
	filePath: string;
	cleanup: () => Promise<void>;
	/** Present when rendered with `qa`; print it with `formatQaReport` */
	qa?: VideoQaReport;
}

export interface SubjectSandwichOptions {
	readonly source: string | MediaNode;
	readonly subject?: MaskTrackSignals | ObjectTrackSignals;
	readonly behind: readonly LayoutNode[];
	readonly feather?: number;
	readonly fit?: "cover" | "contain" | "fill";
	readonly variant?: VisionProps["variant"];
	readonly confidence?: number;
	readonly keyBackground?: boolean;
	readonly backgroundKeyThreshold?: number;
	readonly muted?: boolean;
	readonly volume?: number;
}

export interface SmartFramingOptions {
	readonly source: string | MediaNode;
	readonly targetAspect?: number;
	readonly sourceAspect?: number;
	readonly target: ObjectTrackSignals | MaskTrackSignals;
	readonly damping?: number;
	readonly leadHeadroom?: number;
	readonly fit?: "cover" | "contain" | "fill";
	readonly variant?: VisionProps["variant"];
	readonly muted?: boolean;
	readonly volume?: number;
}

export interface SubjectOutlineOptions {
	readonly source?: string | MediaNode;
	readonly color?: string;
	readonly width?: number;
	readonly blur?: number;
	readonly pulseSignal?: ProgrammaticSignal | Signal<number>;
	readonly muted?: boolean;
	readonly volume?: number;
}

/**
 * High-level programmatic builder for multi-layer Framefields compositions.
 */
export class Composition {
	public width: number;
	public height: number;
	public fps: number;
	public durationMs?: number;
	public backgroundColor: string;
	public antialias3d?: boolean;
	public fonts: string[];
	public children: LayoutNode[] = [];
	public audioTracks: MediaNode[] = [];
	public signals: Record<string, unknown> = {};
	private _frameHooks: Array<(ctx: FrameContext) => void> = [];
	private _visionConfig?: VisionProps;
	private _visionBundle?: VisionBundle;
	private _effects: unknown[] = [];

	/**
	 * Applies a whole-composition post-processing effect or vision pipeline.
	 */
	public apply(effect: unknown): this {
		if (effect instanceof Vision) {
			this.withVision(effect);
			return this;
		}
		this._effects.push(effect);
		return this;
	}

	/**
	 * Runs vision on the whole composition — the rendered frame (composition, blur, crop,
	 * anything upstream) is the inference input. Models are LAZY: nothing downloads until
	 * the first frame actually runs a task.
	 * Returns the reactive VisionBundle (objects / masks / pose / classes signals).
	 */
	public withVision(config: VisionProps | Vision = {}): VisionBundle {
		this._visionBundle ??= new VisionBundle({
			width: this.width,
			height: this.height,
			fps: this.fps,
		});
		const rawConfig =
			config instanceof Vision ? (config.config as VisionProps) : config;
		this._visionConfig = {
			...rawConfig,
			visionBundle: this._visionBundle,
		};
		return this._visionBundle;
	}

	/**
	 * One-shot, ffmpeg-free vision analysis of a media source.
	 *
	 * Decodes frames through the same mediabunny pipeline the renderer uses, runs the requested
	 * tasks lazily (only those models download), temporally tracks detections, and returns a
	 * zod-serializable report. The decoder is released and the runner closed on completion.
	 */
	public async analyzeVisionSequence(
		source: string,
		options: {
			tasks?: readonly VisionTask[];
			categories?: readonly string[];
			fps?: number;
			totalFrames?: number;
			pathStride?: number;
			includeMasks?: boolean;
			modelsDir?: string;
			baseUrl?: string;
			confidence?: number;
			variant?: VisionProps["variant"];
			/** Tracker box-association IoU. Default 0.25. */
			iouThreshold?: number;
		} = {},
	): Promise<VisionAnalysisReport> {
		const fps = options.fps ?? this.fps;
		const durationMs = this.durationMs ?? (await this.computeDuration());
		const totalFrames =
			options.totalFrames ?? Math.max(1, Math.round((durationMs / 1000) * fps));

		const runner = VisionRunner.create({
			modelsDir: options.modelsDir,
			baseUrl: options.baseUrl,
			...(options.confidence !== undefined
				? { confidence: options.confidence }
				: {}),
			...(options.variant !== undefined ? { variant: options.variant } : {}),
		});

		const decoder = mediaDecoderCache.getVideo(source, true);
		async function* frameSource(): AsyncGenerator<{
			data: Uint8Array;
			width: number;
			height: number;
		}> {
			for (let i = 0; i < totalFrames; i++) {
				const frame = await decoder.getFrame(i / fps);
				if (frame?.buffer && frame.width > 0 && frame.height > 0) {
					yield {
						data: frame.buffer,
						width: frame.width,
						height: frame.height,
					};
				}
			}
		}

		try {
			return await analyzeVisionFrames(frameSource(), {
				runner,
				source,
				fps,
				...(options.tasks !== undefined ? { tasks: options.tasks } : {}),
				...(options.categories !== undefined
					? { categories: options.categories }
					: {}),
				...(options.pathStride !== undefined
					? { pathStride: options.pathStride }
					: {}),
				...(options.includeMasks !== undefined
					? { includeMasks: options.includeMasks }
					: {}),
				...(options.iouThreshold !== undefined
					? { iouThreshold: options.iouThreshold }
					: {}),
			});
		} finally {
			runner.close();
			decoder.destroy();
		}
	}

	/**
	 * Game-engine per-frame lifecycle hook for the composition.
	 * Invoked before rendering each frame so scripts or agents can mutate properties and signals.
	 */
	public onRequestFrame(callback: (ctx: FrameContext) => void): this {
		this._frameHooks.push(callback);
		return this;
	}

	public notifyFrame(ctx: FrameContext): void {
		for (const hook of this._frameHooks) {
			hook(ctx);
		}
	}

	constructor(options: CompositionOptions) {
		this.width = options.width;
		this.height = options.height;
		this.fps = options.fps ?? 60;
		this.durationMs =
			options.durationMs ??
			(options.durationFrames !== undefined
				? (options.durationFrames / this.fps) * 1000
				: undefined);
		this.backgroundColor = options.backgroundColor ?? "#000000";
		this.antialias3d = options.antialias3d;
		this.fonts = options.fonts ?? [];
		this.signals = options.signals ?? {};
	}

	public static create(options: CompositionOptions): Composition {
		return new Composition(options);
	}

	public addSignal(name: string, signal: unknown): this {
		this.signals[name] = signal;
		return this;
	}

	public add(
		layerOrFirst:
			| LayoutNode
			| LayoutNode[]
			| TensorPipeline
			| VisionNode
			| { node: unknown },
		...rest: Array<
			| LayoutNode
			| LayoutNode[]
			| TensorPipeline
			| VisionNode
			| { node: unknown }
			| LayerAnimation
			| { tracks: AnimationTrack[] }
		>
	): this {
		if (layerOrFirst instanceof TensorPipeline) {
			this.children.push(layerOrFirst.toNode() as unknown as LayoutNode);
		} else if (layerOrFirst instanceof VisionNode) {
			this.children.push(layerOrFirst.toNode() as unknown as LayoutNode);
		} else if (
			layerOrFirst &&
			typeof layerOrFirst === "object" &&
			"node" in layerOrFirst
		) {
			this.add(
				(
					layerOrFirst as {
						node: LayoutNode | TensorPipeline | { node: unknown };
					}
				).node as LayoutNode,
				...rest,
			);
			return this;
		} else if (Array.isArray(layerOrFirst)) {
			for (const l of layerOrFirst) {
				this.add(l);
			}
		} else {
			const targetNode = layerOrFirst as LayoutNode;
			const animCandidate = rest[0];
			if (
				animCandidate &&
				!(animCandidate instanceof TensorPipeline) &&
				!Array.isArray(animCandidate) &&
				(animCandidate instanceof LayerAnimation || "tracks" in animCandidate)
			) {
				targetNode.animation =
					animCandidate instanceof LayerAnimation
						? animCandidate.toSpec()
						: animCandidate;
				this.children.push(targetNode);
				return this;
			}
			this.children.push(targetNode);
		}

		for (const item of rest) {
			if (item && !(item instanceof LayerAnimation) && !("tracks" in item)) {
				this.add(
					item as
						| LayoutNode
						| LayoutNode[]
						| TensorPipeline
						| { node: unknown },
				);
			}
		}

		return this;
	}

	public addAudio(track: MediaNode): this {
		this.audioTracks.push(track);
		return this;
	}

	/**
	 * Turnkey "Text Behind Subject" ("Sandwich") Primitive.
	 * Lowers into:
	 * 1. Bottom Layer: Full background video plate
	 * 2. Middle Layer: User-supplied `behind` nodes
	 * 3. Top Layer: Subject cutout video with continuous matte alpha registered at identical coordinates
	 */
	public addSubjectSandwich(options: SubjectSandwichOptions): this {
		const src =
			typeof options.source === "string"
				? options.source
				: (options.source.inputHandleId ?? "");
		const fit = options.fit ?? "cover";
		const feather = options.feather ?? 4;
		const featherVal = feather > 1 ? feather / 100 : feather;
		const variant = options.variant ?? "s";

		// 1. Bottom Layer: Full background video plate
		const bottomPlate = Layer.video(src, {
			width: this.width,
			height: this.height,
			position: "absolute",
			x: 0,
			y: 0,
			fit,
			muted: options.muted ?? false,
			volume: options.muted ? 0 : (options.volume ?? 1),
		});
		this.add(bottomPlate);

		// 2. Middle Layer: User-supplied `behind` nodes
		for (const node of options.behind) {
			this.add(node);
		}

		// 3. Top Layer: Subject cutout video with continuous matte alpha registered at identical coordinates
		const topPlate = Layer.video(src, {
			width: this.width,
			height: this.height,
			position: "absolute",
			x: 0,
			y: 0,
			fit,
			muted: true,
			volume: 0,
		}).withVision({
			mode: "matte",
			enableSegmentation: true,
			variant,
			confidence: options.confidence ?? 0.25,
			featherRadius: featherVal,
			keyBackground: options.keyBackground ?? true,
			backgroundKeyThreshold: options.backgroundKeyThreshold,
		});
		this.add(topPlate);

		return this;
	}

	/**
	 * Dynamic Smart Re-Framing (16:9 → 9:16 Auto-Crop).
	 * Automatically transforms landscape footage into vertical shorts/reels by framing the
	 * tracked subject with smooth camera physics and lead headroom.
	 */
	public addSmartFraming(options: SmartFramingOptions): this {
		const src =
			typeof options.source === "string"
				? options.source
				: (options.source.inputHandleId ?? "");
		const damping = Math.max(0, Math.min(0.99, options.damping ?? 0.8));
		const headroom = options.leadHeadroom ?? 0.18;
		const compW = this.width;
		const compH = this.height;

		const sourceAspect = options.sourceAspect ?? 16 / 9;
		const compAspect = compW / compH;

		// Calculate canvas coverage dimensions to avoid black bars during pan
		const plateWidth =
			compAspect < sourceAspect ? Math.round(compH * sourceAspect) : compW;
		const plateHeight =
			compAspect < sourceAspect ? compH : Math.round(compW / sourceAspect);

		const minOffsetX = compW - plateWidth; // <= 0
		const minOffsetY = compH - plateHeight; // <= 0

		const targetObj = options.target as unknown as {
			center?: {
				x?: ProgrammaticSignal;
				y?: ProgrammaticSignal;
				screenX?: ProgrammaticSignal;
				screenY?: ProgrammaticSignal;
			};
			bounds?: {
				x?: ProgrammaticSignal;
				y?: ProgrammaticSignal;
				width?: ProgrammaticSignal;
				height?: ProgrammaticSignal;
				centerX?: ProgrammaticSignal;
				centerY?: ProgrammaticSignal;
			};
		};

		const rawOffsetX = new ProgrammaticSignal(
			(ctx) => {
				if (minOffsetX >= 0) return 0;
				const normX = targetObj.center?.x
					? targetObj.center.x.get(ctx)
					: targetObj.bounds?.centerX
						? targetObj.bounds.centerX.get(ctx) / compW
						: targetObj.center?.screenX
							? targetObj.center.screenX.get(ctx) / compW
							: 0.5;
				const clampedNormX = Math.max(0, Math.min(1, normX));
				const targetPx = clampedNormX * plateWidth;
				const desired = compW / 2 - targetPx;
				return Math.max(minOffsetX, Math.min(0, desired));
			},
			{ fps: this.fps, label: "smart_framing_pan_x" },
		);

		const rawOffsetY = new ProgrammaticSignal(
			(ctx) => {
				if (minOffsetY >= 0) return 0;
				const normY = targetObj.center?.y
					? targetObj.center.y.get(ctx)
					: targetObj.bounds?.centerY
						? targetObj.bounds.centerY.get(ctx) / compH
						: targetObj.center?.screenY
							? targetObj.center.screenY.get(ctx) / compH
							: 0.5;
				const clampedNormY = Math.max(0, Math.min(1, normY));
				const targetPy = clampedNormY * plateHeight;
				const desired = compH * headroom - targetPy;
				return Math.max(minOffsetY, Math.min(0, desired));
			},
			{ fps: this.fps, label: "smart_framing_pan_y" },
		);

		// Damped camera smoothing
		const smoothOffsetX = new ProgrammaticSignal(
			(ctx) => {
				const targetFrame = ctx.frame;
				if (targetFrame <= 0) return rawOffsetX.get(ctx);
				let filtered = rawOffsetX.get({ ...ctx, frame: 0, time: 0 });
				const alpha = 1.0 - damping;
				for (let f = 1; f <= targetFrame; f++) {
					const val = rawOffsetX.get({ ...ctx, frame: f, time: f / ctx.fps });
					filtered = filtered + alpha * (val - filtered);
				}
				return filtered;
			},
			{ fps: this.fps, label: "smart_framing_smooth_x" },
		);

		const smoothOffsetY = new ProgrammaticSignal(
			(ctx) => {
				const targetFrame = ctx.frame;
				if (targetFrame <= 0) return rawOffsetY.get(ctx);
				let filtered = rawOffsetY.get({ ...ctx, frame: 0, time: 0 });
				const alpha = 1.0 - damping;
				for (let f = 1; f <= targetFrame; f++) {
					const val = rawOffsetY.get({ ...ctx, frame: f, time: f / ctx.fps });
					filtered = filtered + alpha * (val - filtered);
				}
				return filtered;
			},
			{ fps: this.fps, label: "smart_framing_smooth_y" },
		);

		const container = Layer.box({
			width: compW,
			height: compH,
			overflow: "hidden",
			position: "relative",
		});

		const videoPlate = Layer.video(src, {
			width: plateWidth,
			height: plateHeight,
			position: "absolute",
			x: smoothOffsetX as unknown as number,
			y: smoothOffsetY as unknown as number,
			fit: options.fit ?? "cover",
			muted: options.muted ?? false,
			volume: options.muted ? 0 : (options.volume ?? 1),
		});

		(container.children ??= []).push(videoPlate);
		this.add(container);
		return this;
	}

	/**
	 * Subject Contour Glow & Neon Outline.
	 * Strokes the silhouette boundary with a stylized bloom/glow and optional audio-reactive pulse.
	 */
	public addSubjectOutline(
		_subject: MaskTrackSignals | ObjectTrackSignals,
		options: SubjectOutlineOptions = {},
	): this {
		const blur = options.blur ?? 12;
		const compW = this.width;
		const compH = this.height;

		const pulse = options.pulseSignal;
		const baseOpacity = pulse
			? new ProgrammaticSignal(
					(ctx) => Math.max(0, Math.min(1, Number(pulse.get(ctx)) || 0)),
					{ fps: this.fps, label: "outline_pulse" },
				)
			: 1.0;

		const src =
			typeof options.source === "string"
				? options.source
				: (options.source?.inputHandleId ?? "");

		const outlineLayer = Layer.box({
			width: compW,
			height: compH,
			position: "absolute",
			x: 0,
			y: 0,
			opacity: baseOpacity as unknown as number,
		});

		if (src) {
			const maskVideo = Layer.video(src, {
				width: compW,
				height: compH,
				position: "absolute",
				x: 0,
				y: 0,
				fit: "cover",
				muted: true,
				volume: 0,
			}).withVision({
				mode: "mask",
				enableSegmentation: true,
			});
			(outlineLayer.children ??= []).push(maskVideo);
		}

		outlineLayer.apply(
			new Blur({
				strength: blur,
				blurType: "Gaussian",
			}),
		);

		this.add(outlineLayer);
		return this;
	}

	/**
	 * Creates an isolated, styled section of the composition or underlying source plate.
	 * Any WebGPU effects (Blur, FilmGrain, Curves, Vignette, etc.) can be applied to this section.
	 */
	public section(
		sourceOrTargetOrOptions?:
			| string
			| MediaNode
			| ObjectTrackSignals
			| SectionOptions,
		targetOrOptions?: ObjectTrackSignals | SectionOptions,
		options?: SectionOptions,
	): SectionNode {
		let source: string | MediaNode | undefined;
		let target: ObjectTrackSignals | undefined;
		let opts: SectionOptions = {};

		const isFirstTrack =
			sourceOrTargetOrOptions !== null &&
			typeof sourceOrTargetOrOptions === "object" &&
			"bounds" in sourceOrTargetOrOptions;

		const isFirstMedia =
			typeof sourceOrTargetOrOptions === "string" ||
			(sourceOrTargetOrOptions !== null &&
				typeof sourceOrTargetOrOptions === "object" &&
				("kind" in sourceOrTargetOrOptions ||
					"src" in sourceOrTargetOrOptions ||
					"inputHandleId" in sourceOrTargetOrOptions));

		if (
			isFirstMedia &&
			targetOrOptions &&
			typeof targetOrOptions === "object" &&
			"bounds" in targetOrOptions
		) {
			source = sourceOrTargetOrOptions as string | MediaNode;
			target = targetOrOptions as ObjectTrackSignals;
			opts = options ?? {};
		} else if (isFirstMedia && targetOrOptions) {
			source = sourceOrTargetOrOptions as string | MediaNode;
			opts = targetOrOptions as SectionOptions;
		} else if (isFirstTrack) {
			target = sourceOrTargetOrOptions as ObjectTrackSignals;
			opts = (targetOrOptions as SectionOptions) ?? {};
			source = opts.source ?? (target.source as string | MediaNode | undefined);
		} else if (
			sourceOrTargetOrOptions &&
			typeof sourceOrTargetOrOptions === "object"
		) {
			opts = sourceOrTargetOrOptions as SectionOptions;
			source = opts.source;
		}

		if (!source) {
			const mediaChild = this.children.find(
				(c) =>
					c.kind === "media" &&
					(c.dataType === "Video" || c.dataType === "Image"),
			) as MediaNode | undefined;
			if (mediaChild) {
				source = mediaChild;
			}
		}

		return Layer.section(source ?? "", target ?? opts, {
			compositionWidth: this.width,
			compositionHeight: this.height,
			...opts,
		});
	}

	/**
	 * Creates a section and immediately adds it to the composition layout tree.
	 */
	public addSection(
		sourceOrTargetOrOptions?:
			| string
			| MediaNode
			| ObjectTrackSignals
			| SectionOptions,
		targetOrOptions?: ObjectTrackSignals | SectionOptions,
		options?: SectionOptions,
	): SectionNode {
		const node = this.section(
			sourceOrTargetOrOptions,
			targetOrOptions,
			options,
		);
		this.add(node);
		return node;
	}

	/**
	 * Dynamically calculates composition duration from the longest media or animation layer.
	 */
	public async computeDuration(): Promise<number> {
		if (this.durationMs !== undefined) return this.durationMs;
		let maxDurationMs = 0;
		const mediaSources: string[] = [];

		for (const node of [...this.children, ...this.audioTracks]) {
			if (node.kind === "media") {
				const src = node.inputHandleId;
				if (
					typeof src === "string" &&
					(node.dataType === "Video" || node.dataType === "Audio")
				) {
					mediaSources.push(src);
				}
			}
			if (typeof node.durationFrames === "number") {
				const start = typeof node.startFrame === "number" ? node.startFrame : 0;
				const durMs = ((start + node.durationFrames) / this.fps) * 1000;
				if (durMs > maxDurationMs) maxDurationMs = durMs;
			}
		}

		for (const src of mediaSources) {
			try {
				const input = await inputStore.acquire(src);
				const sec = await input.computeDuration();
				if (Number.isFinite(sec) && sec > 0) {
					const ms = Math.round(sec * 1000);
					if (ms > maxDurationMs) maxDurationMs = ms;
				}
			} catch (_) {}
		}

		return maxDurationMs > 0 ? maxDurationMs : 5000;
	}

	public async registerFont(
		optionsOrFamilyOrSource: RegisterFontOptions | string,
		source?: string | Uint8Array,
	): Promise<this> {
		const reg = await FontManager.register(optionsOrFamilyOrSource, source);
		if (reg.filePath && !this.fonts.includes(reg.filePath)) {
			this.fonts.push(reg.filePath);
		}
		return this;
	}

	/** Sets the color emoji font; see {@link FontManager.registerEmojiFont}. */
	public async registerEmojiFont(source: string | Uint8Array): Promise<this> {
		await FontManager.registerEmojiFont(source);
		return this;
	}

	public toSpec(): CompositorProgramConfig {
		const layoutItems: LayoutNode[] = [...this.children, ...this.audioTracks];
		const registeredPaths = FontManager.getRegisteredFontPaths();
		const mergedFonts = Array.from(
			new Set([...this.fonts, ...registeredPaths]),
		);
		return {
			width: this.width,
			height: this.height,
			fps: this.fps,
			mode: "Video",
			backgroundColor: this.backgroundColor,
			...(this.antialias3d !== undefined && { antialias3d: this.antialias3d }),
			layout: layoutItems,
			fonts: mergedFonts,
			signals: this.signals,
			...(this._effects.length > 0 && { effects: this._effects }),
			...(this._visionConfig && { vision: this._visionConfig }),
			...(this._frameHooks.length > 0 && {
				onRequestFrame: (ctx: FrameContext) => this.notifyFrame(ctx),
			}),
		} as unknown as CompositorProgramConfig;
	}

	/**
	 * Compiles the composition into a VirtualMediaData AST ready for WebGPU rendering.
	 */
	public toVirtualMedia(
		options: Partial<CompositorToProgramOptions> = {},
	): VirtualMediaData {
		return compositorToProgram(this.toSpec(), {
			isVideoMode: true,
			fps: this.fps,
			durationMs: options.durationMs ?? this.durationMs,
			signals: options.signals ?? this.signals,
			...(this._effects.length > 0 && { effects: this._effects }),
			...(this._visionConfig && { vision: this._visionConfig }),
			...options,
		});
	}

	/**
	 * Compiles the composition into a VirtualMediaData AST with dynamically resolved duration.
	 */
	public async toVirtualMediaAsync(
		options: Partial<CompositorToProgramOptions> = {},
	): Promise<VirtualMediaData> {
		const durationMs =
			options.durationMs ?? this.durationMs ?? (await this.computeDuration());
		this.durationMs = durationMs;
		return compositorToProgram(this.toSpec(), {
			isVideoMode: true,
			fps: this.fps,
			durationMs,
			signals: options.signals ?? this.signals,
			...(this._effects.length > 0 && { effects: this._effects }),
			...(this._visionConfig && { vision: this._visionConfig }),
			...options,
		});
	}

	/**
	 * Renders a single frame from the composition to a PNG Buffer.
	 * Can render either by timestamp in milliseconds (`atMs`) or by frame index (`frame`).
	 */
	public async renderFrame(
		options: {
			atMs?: number;
			frame?: number;
			renderer?: HeadlessMediaRenderer;
		} = {},
	): Promise<Buffer> {
		if (this._frameHooks.length > 0) {
			const targetFrame =
				options.frame ??
				(options.atMs !== undefined
					? Math.round((options.atMs / 1000) * this.fps)
					: 0);
			this.notifyFrame({
				frame: targetFrame,
				fps: this.fps,
				time: this.fps > 0 ? targetFrame / this.fps : 0,
				duration: (this.durationMs ?? 0) / 1000,
				durationMs: this.durationMs ?? 0,
				progress:
					this.durationMs && this.durationMs > 0
						? Math.max(
								0,
								Math.min(
									1,
									((targetFrame / this.fps) * 1000) / this.durationMs,
								),
							)
						: 0,
				deltaTime: this.fps > 0 ? 1 / this.fps : 0,
			});
		}
		const renderer = options.renderer ?? new HeadlessMediaRenderer();
		return renderer.renderFrame(this.toVirtualMedia(), {
			fps: this.fps,
			...options,
		});
	}

	/**
	 * Renders an image grid of sequential frames across a given frame or millisecond range.
	 * Ideal for automated visual inspection of animation motion, easing curves, and layout stability.
	 */
	public async renderFrameGrid(
		options: FrameGridOptions = {},
	): Promise<Buffer> {
		return renderFrameGrid(this, options);
	}

	/**
	 * Renders this composition into an MP4/WebM video file with audio.
	 */
	public async renderVideo(
		outputPathOrOptions: string | RenderVideoOptions = {},
		options: RenderVideoOptions = {},
	): Promise<RenderVideoResult> {
		const opts =
			typeof outputPathOrOptions === "string"
				? { ...options, outputPath: outputPathOrOptions }
				: outputPathOrOptions;
		const renderer = opts.renderer ?? new HeadlessMediaRenderer();
		const result = await renderer.renderVideo(this.toVirtualMedia(), opts);
		return deliverToOutputPath(result, opts.outputPath);
	}
}

/**
 * Layer helpers for constructing composition nodes with clean URL/path strings.
 */

export type AnimatableNode<T extends LayoutNode> = T & {
	mask?: unknown;
	glass?: Record<string, unknown>;
	audioDeform?: MeshAudioDeformConfig | Record<string, unknown>;
	crop?: CropProps | Crop;
	vision?: Vision;
	relighting?: NormalRelightingOptions;
	deflicker?: DeflickerOptions;
	effects?: unknown[];
	blurRegions?: unknown[];
	[key: string]: unknown;
	animate(
		...anim: (
			| LayerAnimation
			| { tracks: AnimationTrack[] }
			| LayerAnimation[]
		)[]
	): AnimatableNode<T>;
	pinToLandmark(
		target:
			| LandmarkCoordinateSignals
			| {
					x: number;
					y: number;
					z?: number;
					screenX?: number;
					screenY?: number;
			  },
		options?: PinToLandmarkOptions,
	): AnimatableNode<T>;
	pinToObject(
		target:
			| ObjectTrackSignals
			| LandmarkCoordinateSignals
			| {
					x: number;
					y: number;
					z?: number;
					screenX?: number;
					screenY?: number;
			  },
		options?: PinToObjectOptions,
	): AnimatableNode<T>;
	withMask(mask: unknown): AnimatableNode<T>;
	withPbrGlass(options?: Record<string, unknown>): AnimatableNode<T>;
	deformWithAudio(
		config?: MeshAudioDeformConfig | Record<string, unknown>,
	): AnimatableNode<T>;
	withCrop(cropConfig: CropProps | Crop): AnimatableNode<T>;
	/** Runs vision on this node's rendered output (see `Vision` for options and modes). */
	withVision(config?: VisionProps | Vision): AnimatableNode<T>;
	withRelighting(options?: NormalRelightingOptions): AnimatableNode<T>;
	relight(options?: NormalRelightingOptions): AnimatableNode<T>;
	withDeflicker(options?: DeflickerOptions): AnimatableNode<T>;
	apply(effect: unknown): AnimatableNode<T>;
	withEffect(effect: unknown): AnimatableNode<T>;
	withEffects(effects: unknown[]): AnimatableNode<T>;
	blurRegion(
		trackTarget: ObjectTrackSignals,
		options?: Partial<BlurProps>,
	): AnimatableNode<T>;
	withBlurRegion(
		trackTarget: ObjectTrackSignals,
		options?: Partial<BlurProps>,
	): AnimatableNode<T>;
};

function withAnimation<T extends LayoutNode>(node: T): AnimatableNode<T> {
	const target = node as AnimatableNode<T>;
	Object.defineProperty(target, "animate", {
		value: (
			...anims: (
				| LayerAnimation
				| { tracks: AnimationTrack[] }
				| LayerAnimation[]
			)[]
		) => {
			const flatAnims = anims.flat();
			if (
				flatAnims.length > 1 ||
				(flatAnims.length === 1 && Array.isArray(anims[0]))
			) {
				const allTracks = flatAnims.flatMap((a) =>
					a instanceof LayerAnimation
						? a.tracks
						: ((a as { tracks?: AnimationTrack[] }).tracks ?? []),
				);
				target.animation = { tracks: allTracks };
			} else if (flatAnims.length === 1) {
				const anim = flatAnims[0];
				target.animation =
					anim instanceof LayerAnimation
						? anim.toSpec()
						: (anim as { tracks: AnimationTrack[] });
			}
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "pinToLandmark", {
		value: (
			landmarkTarget:
				| LandmarkCoordinateSignals
				| {
						x: number;
						y: number;
						z?: number;
						screenX?: number;
						screenY?: number;
				  },
			options?: PinToLandmarkOptions,
		) => {
			pinNodeToLandmark(
				target as unknown as { x?: unknown; y?: unknown; z?: unknown },
				landmarkTarget,
				options,
			);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "pinToObject", {
		value: (
			objectTarget:
				| ObjectTrackSignals
				| LandmarkCoordinateSignals
				| {
						x: number;
						y: number;
						z?: number;
						screenX?: number;
						screenY?: number;
				  },
			options?: PinToObjectOptions,
		) => {
			pinNodeToObject(
				target as unknown as {
					x?: unknown;
					y?: unknown;
					z?: unknown;
					width?: unknown;
					height?: unknown;
					opacity?: unknown;
				},
				objectTarget,
				options,
			);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withMask", {
		value: (mask: unknown) => {
			target.mask = mask;
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withPbrGlass", {
		value: (options?: Record<string, unknown>) => {
			target.glass = options ?? {};
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "deformWithAudio", {
		value: (config?: MeshAudioDeformConfig | Record<string, unknown>) => {
			target.audioDeform = config ?? {};
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withCrop", {
		value: (cropConfig: CropProps | Crop) => {
			target.crop =
				cropConfig instanceof Crop ? cropConfig : new Crop(cropConfig);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withVision", {
		value: (config?: VisionProps | Vision) => {
			target.vision = config instanceof Vision ? config : new Vision(config);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withRelighting", {
		value: (options?: NormalRelightingOptions) => {
			target.relighting = options ?? {};
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "relight", {
		value: (options?: NormalRelightingOptions) => {
			target.relighting = options ?? {};
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withDeflicker", {
		value: (options?: DeflickerOptions) => {
			target.deflicker = options ?? {};
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "apply", {
		value: (effect: unknown) => {
			if (!target.effects) {
				target.effects = [];
			}
			target.effects.push(effect);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withEffect", {
		value: (effect: unknown) => {
			if (!target.effects) {
				target.effects = [];
			}
			target.effects.push(effect);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withEffects", {
		value: (effects: unknown[]) => {
			if (!target.effects) {
				target.effects = [];
			}
			target.effects.push(...effects);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "section", {
		value: (
			targetOrOptions: ObjectTrackSignals | SectionOptions = {},
			options?: SectionOptions,
		) => {
			if (
				targetOrOptions !== null &&
				typeof targetOrOptions === "object" &&
				"bounds" in targetOrOptions
			) {
				return Layer.section(
					target as MediaNode,
					targetOrOptions as ObjectTrackSignals,
					options,
				);
			}
			return Layer.section(
				target as MediaNode,
				targetOrOptions as SectionOptions,
			);
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "blurRegion", {
		value: (trackTarget: ObjectTrackSignals, options?: Partial<BlurProps>) => {
			const blur = new Blur({
				track: trackTarget,
				strength: options?.strength ?? 25,
				shape: options?.shape ?? "ellipse",
				...options,
			});
			if (!target.effects) {
				target.effects = [];
			}
			target.effects.push(blur);
			return target;
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	Object.defineProperty(target, "withBlurRegion", {
		value: (trackTarget: ObjectTrackSignals, options?: Partial<BlurProps>) => {
			return (
				target as {
					blurRegion: (
						t: ObjectTrackSignals,
						o?: Partial<BlurProps>,
					) => unknown;
				}
			).blurRegion(trackTarget, options);
		},
		enumerable: false,
		writable: true,
		configurable: true,
	});

	return target;
}

export const Layer = {
	video: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("video"),
			kind: "media",
			inputHandleId: src,
			dataType: "Video",
			fit: options.fit ?? "cover",
			...options,
		}),
	image: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("img"),
			kind: "media",
			inputHandleId: src,
			dataType: "Image",
			fit: options.fit ?? "cover",
			...options,
		}),
	svg: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("svg"),
			kind: "media",
			inputHandleId: src,
			dataType: "SVG",
			fit: options.fit ?? "contain",
			...options,
		}),
	lottie: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("lottie"),
			kind: "media",
			inputHandleId: src,
			dataType: "Lottie",
			fit: options.fit ?? "contain",
			...options,
		}),
	audio: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("audio"),
			kind: "media",
			inputHandleId: src,
			dataType: "Audio",
			volume: options.volume ?? 1,
			...options,
		}),
	text: (
		contentOrOptions:
			| string
			| TextSpan[]
			| (string | TextSpan)[]
			| Partial<TextNode>,
		maybeOptions: Partial<TextNode> = {},
	): AnimatableNode<TextNode> => {
		const isArray = Array.isArray(contentOrOptions);
		const isObj =
			!isArray &&
			typeof contentOrOptions === "object" &&
			contentOrOptions !== null;
		const options = isObj
			? (contentOrOptions as Partial<TextNode>)
			: maybeOptions;

		let textContent = "";
		let spans: TextSpan[] | undefined = options.spans;

		if (isArray) {
			const normalized = normalizeTextSpans(
				contentOrOptions as (string | TextSpan)[],
			);
			textContent = normalized.text;
			spans = normalized.spans;
		} else if (isObj) {
			if (options.spans && !options.text) {
				const normalized = normalizeTextSpans(options.spans);
				textContent = normalized.text;
			} else {
				textContent = (options.text as string) ?? "";
			}
		} else {
			textContent =
				typeof contentOrOptions === "string"
					? contentOrOptions
					: String(contentOrOptions ?? "");
		}

		return withAnimation({
			id: options.id ?? autoId("text"),
			kind: "text",
			fontFamily:
				options.fontFamily ?? FontManager.getAll()[0]?.family ?? "Inter",
			fontSize: options.fontSize ?? 48,
			fill: options.fill ?? "#ffffff",
			...options,
			text: options.text ?? textContent,
			spans: options.spans ?? spans,
		});
	},
	caption: (
		src: string,
		options: Partial<MediaNode> = {},
	): AnimatableNode<MediaNode> =>
		withAnimation({
			id: options.id ?? autoId("caption"),
			kind: "media",
			inputHandleId: src,
			dataType: options.dataType ?? "Caption",
			fontFamily:
				options.fontFamily ?? FontManager.getAll()[0]?.family ?? "Inter",
			fontSize: options.fontSize ?? 48,
			fill: options.fill ?? "#ffffff",
			...options,
		}),
	shape: (
		shapeType:
			| "rect"
			| "circle"
			| "ellipse"
			| "polygon"
			| "star"
			| "arrow"
			| "path" = "rect",
		options: Partial<ShapeNode> = {},
	): AnimatableNode<ShapeNode> =>
		withAnimation({
			id: options.id ?? autoId("shape"),
			kind: "shape",
			shapeType: options.shapeType ?? shapeType,
			fillColor: options.fillColor ?? "#3b82f6",
			...options,
		}),
	flex: (options: Partial<FlexNode> = {}): AnimatableNode<FlexNode> =>
		withAnimation({
			id: options.id ?? autoId("flex"),
			kind: "flex",
			dir: options.dir ?? "column",
			children: options.children ?? [],
			...options,
		}),
	box: (options: Partial<BoxNode> = {}): AnimatableNode<BoxNode> =>
		withAnimation({
			id: options.id ?? autoId("box"),
			kind: "box",
			background: options.background ?? "transparent",
			children: options.children ?? [],
			...options,
		}),
	section: (
		source: string | MediaNode | Composition,
		targetOrOptions: ObjectTrackSignals | SectionOptions = {},
		options: SectionOptions = {},
	): SectionNode => {
		let realSource: string | MediaNode = source as string | MediaNode;
		if (
			source &&
			typeof source === "object" &&
			"toSpec" in source &&
			"children" in source
		) {
			const compMedia = (
				((source as Composition).children || []) as LayoutNode[]
			).find(
				(c) =>
					c.kind === "media" &&
					(c.dataType === "Video" || c.dataType === "Image"),
			) as MediaNode | undefined;
			if (compMedia) {
				realSource = compMedia;
			}
		}

		const isTracked =
			targetOrOptions !== null &&
			typeof targetOrOptions === "object" &&
			"bounds" in targetOrOptions;
		const opts: SectionOptions = isTracked
			? options
			: (targetOrOptions as SectionOptions);
		const target = isTracked
			? (targetOrOptions as ObjectTrackSignals)
			: undefined;

		const padding = opts.padding ?? 0;
		const src =
			typeof realSource === "string"
				? realSource
				: (realSource?.inputHandleId ??
					(realSource as { src?: string })?.src ??
					"");
		const dataType =
			typeof realSource === "object" && realSource?.dataType
				? realSource.dataType
				: "Video";
		const compW =
			(opts.compositionWidth as number) ??
			(opts.compWidth as number) ??
			(isTracked ? (opts.width as number) : undefined) ??
			1920;
		const compH =
			(opts.compositionHeight as number) ??
			(opts.compHeight as number) ??
			(isTracked ? (opts.height as number) : undefined) ??
			1080;

		const effList: Effect[] = Array.isArray(opts.effects)
			? ([...opts.effects] as Effect[])
			: opts.effects
				? [opts.effects as Effect]
				: [];

		const innerX = target
			? target.bounds.screenX.multiply(-1).add(padding)
			: typeof opts.x === "number"
				? -opts.x
				: opts.x &&
						typeof (opts.x as { multiply?: unknown }).multiply === "function"
					? (opts.x as { multiply: (n: number) => unknown }).multiply(-1)
					: 0;

		const innerY = target
			? target.bounds.screenY.multiply(-1).add(padding)
			: typeof opts.y === "number"
				? -opts.y
				: opts.y &&
						typeof (opts.y as { multiply?: unknown }).multiply === "function"
					? (opts.y as { multiply: (n: number) => unknown }).multiply(-1)
					: 0;

		const innerMedia = (
			dataType === "Image"
				? Layer.image(src, {
						position: "absolute",
						width: compW,
						height: compH,
						fit: opts.fit ?? "cover",
						x: innerX as number,
						y: innerY as number,
					})
				: Layer.video(src, {
						position: "absolute",
						width: compW,
						height: compH,
						fit: opts.fit ?? "cover",
						x: innerX as number,
						y: innerY as number,
					})
		).withEffects(effList);

		const boxWidth = target
			? target.bounds.screenWidth.add(padding * 2)
			: opts.width !== undefined
				? opts.width
				: compW;

		const boxHeight = target
			? target.bounds.screenHeight.add(padding * 2)
			: opts.height !== undefined
				? opts.height
				: compH;

		const boxChildren = [innerMedia, ...(opts.children ?? [])];

		const boxId =
			opts.id ??
			(target ? autoId(`section-track-${target.trackId}`) : autoId("section"));

		let box = Layer.box({
			id: boxId,
			position: (opts.position as "absolute" | "relative") ?? "absolute",
			width: boxWidth as number,
			height: boxHeight as number,
			x: target ? undefined : (opts.x as number),
			y: target ? undefined : (opts.y as number),
			borderRadius: opts.borderRadius ?? 0,
			borderColor: opts.borderColor,
			borderWidth: opts.borderWidth,
			opacity: (opts.opacity as number) ?? 1,
			overflow: "hidden",
			children: boxChildren,
		});

		if (target) {
			box = box.pinToObject(target, {
				anchor: "topLeft",
				offsetX: -padding,
				offsetY: -padding,
				hideWhenLost: opts.hideWhenLost ?? true,
				smoothFrames: opts.smoothFrames,
			});
		}

		const sectionNode = box as SectionNode;
		Object.defineProperty(sectionNode, "innerMedia", {
			value: innerMedia,
			enumerable: true,
			writable: false,
		});
		Object.defineProperty(sectionNode, "effects", {
			get: () => effList,
			enumerable: true,
		});
		Object.defineProperty(sectionNode, "addEffect", {
			value: (effect: Effect) => {
				effList.push(effect);
				innerMedia.effects = effList;
				return sectionNode;
			},
			enumerable: true,
			writable: false,
		});
		Object.defineProperty(sectionNode, "withEffect", {
			value: (effect: Effect) => sectionNode.addEffect(effect),
			enumerable: true,
			writable: false,
		});
		Object.defineProperty(sectionNode, "withEffects", {
			value: (effects: Effect[]) => {
				for (const eff of effects) {
					sectionNode.addEffect(eff);
				}
				return sectionNode;
			},
			enumerable: true,
			writable: false,
		});

		return sectionNode;
	},
	trackedRegion: (
		source: string | MediaNode,
		target: ObjectTrackSignals,
		options: TrackedRegionOptions = {},
	): SectionNode => {
		return Layer.section(source, target, options);
	},
	blurTrackedRegion: (
		source: string | MediaNode,
		target: ObjectTrackSignals,
		options: Partial<BlurProps> & {
			borderRadius?: number;
			padding?: number;
			borderColor?: string;
			borderWidth?: number;
		} = {},
	): SectionNode => {
		// Section styling is not a Blur prop; keep it out of the effect config.
		const { padding, borderRadius, borderColor, borderWidth, ...blurOptions } =
			options;
		return Layer.section(source, target, {
			padding: padding ?? 8,
			borderRadius: borderRadius ?? 12,
			borderColor,
			borderWidth,
			effects: [
				new Blur({
					strength: blurOptions.strength ?? 25,
					blurType: blurOptions.blurType ?? "Gaussian",
					...blurOptions,
				}),
			],
		});
	},
	/**
	 * A line, area, bar, scatter, candlestick, pie or donut chart. Returns a box
	 * of ordinary nodes (bars are boxes, lines and slices are path shapes,
	 * labels are text), so it positions, animates and composites like any layer.
	 * `props` applies to that box: position, id, timing, effects.
	 */
	chart: (
		options: ChartOptions,
		props: Partial<BoxNode> = {},
	): AnimatableNode<BoxNode> =>
		buildChart(options, props, FontManager.getAll()[0]?.family ?? "Inter"),
	camera: (options: Partial<CameraNode> = {}): AnimatableNode<CameraNode> =>
		withAnimation<CameraNode>({
			id: options.id ?? autoId("camera"),
			kind: "camera",
			mode: options.mode ?? "lookAt",
			pitch: options.pitch ?? 0,
			yaw: options.yaw ?? 0,
			roll: options.roll ?? 0,
			...options,
		}),
	light: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		withAnimation<LightNode>({
			id: options.id ?? autoId("light"),
			kind: "light",
			lightType: options.lightType ?? "point",
			color: options.color ?? "#ffffff",
			intensity: options.intensity ?? 1.0,
			...options,
		}),
	ambientLight: (
		color: string = "#ffffff",
		intensity: number = 0.5,
		options: Partial<LightNode> = {},
	): AnimatableNode<LightNode> => Light.ambient(color, intensity, options),
	directionalLight: (
		options: Partial<LightNode> = {},
	): AnimatableNode<LightNode> => Light.directional(options),
	pointLight: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		Light.point(options),
	spotLight: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		Light.spot(options),
	cube: (options: Cube3DOptions): AnimatableNode<BoxNode> =>
		Layer3D.cube(options),
	carousel3d: (options: Carousel3DOptions): AnimatableNode<BoxNode> =>
		Layer3D.carousel(options),
	plane3d: (options: Plane3DOptions): AnimatableNode<BoxNode> =>
		Layer3D.plane(options),
	prism3d: (options: Prism3DOptions): AnimatableNode<BoxNode> =>
		Layer3D.prism(options),
	model: (options: Partial<Model3DNode> = {}): AnimatableNode<Model3DNode> =>
		withAnimation({
			id: options.id ?? autoId("model3d"),
			kind: "model3d",
			is3D: options.is3D ?? true,
			modelFormat: options.modelFormat ?? "auto",
			loop: options.loop ?? true,
			scale: options.scale ?? 1.0,
			scaleX: options.scaleX ?? 1.0,
			scaleY: options.scaleY ?? 1.0,
			scaleZ: options.scaleZ ?? 1.0,
			opacity: options.opacity ?? 1.0,
			// material and twoSided stay unset unless given: the model's own
			// materials (toon, single-sided, …) decide, falling back to lit.
			...options,
		}),
	obj: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "obj",
			...options,
		}),
	fbx: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "fbx",
			...options,
		}),
	gltf: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "gltf",
			...options,
		}),
	glb: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "glb",
			...options,
		}),
	stl: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "stl",
			...options,
		}),
	ply: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "ply",
			...options,
		}),
	vox: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "vox",
			...options,
		}),
	threeDS: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "3ds",
			...options,
		}),
	off: (
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> =>
		Layer.model({
			src,
			modelFormat: "off",
			...options,
		}),
};

export const Light = {
	ambient: (
		color: string = "#ffffff",
		intensity: number = 0.5,
		options: Partial<LightNode> = {},
	): AnimatableNode<LightNode> =>
		withAnimation({
			id: options.id ?? autoId("light-ambient"),
			kind: "light",
			lightType: "ambient",
			color,
			intensity,
			...options,
		}),
	directional: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		withAnimation({
			id: options.id ?? autoId("light-directional"),
			kind: "light",
			lightType: "directional",
			color: options.color ?? "#ffffff",
			intensity: options.intensity ?? 1.0,
			x: options.x ?? 0,
			y: options.y ?? -1000,
			z: options.z ?? -1000,
			targetX: options.targetX ?? 0,
			targetY: options.targetY ?? 0,
			targetZ: options.targetZ ?? 0,
			...options,
		}),
	point: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		withAnimation({
			id: options.id ?? autoId("light-point"),
			kind: "light",
			lightType: "point",
			color: options.color ?? "#ffffff",
			intensity: options.intensity ?? 1.0,
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? -500,
			radius: options.radius ?? 1000,
			decay: options.decay ?? 1.0,
			...options,
		}),
	spot: (options: Partial<LightNode> = {}): AnimatableNode<LightNode> =>
		withAnimation({
			id: options.id ?? autoId("light-spot"),
			kind: "light",
			lightType: "spot",
			color: options.color ?? "#ffffff",
			intensity: options.intensity ?? 1.0,
			x: options.x ?? 0,
			y: options.y ?? -500,
			z: options.z ?? -1000,
			targetX: options.targetX ?? 0,
			targetY: options.targetY ?? 0,
			targetZ: options.targetZ ?? 0,
			angle: options.angle ?? 45,
			penumbra: options.penumbra ?? 0.2,
			radius: options.radius ?? 2000,
			decay: options.decay ?? 1.0,
			...options,
		}),
};

export {
	type PreviewCloseReason,
	type PreviewOptions,
	type PreviewSession,
	type PreviewSource,
	startPreview,
} from "./preview/index.js";
export {
	type AudioQaStats,
	computeGridLayout,
	type FrameGridOptions,
	type FrameGridRenderable,
	type FrameSamplePoint,
	formatQaReport,
	HeadlessMediaRenderer,
	HeadlessWebGPURenderer,
	type QaIssue,
	type QaSegment,
	renderFrameGrid,
	renderSemaphore,
	resolveSamplePoints,
	type VideoQaOptions,
	type VideoQaReport,
	type VideoQaStats,
} from "./renderer/index.js";

export function section(
	source: string | MediaNode | Composition,
	targetOrOptions: ObjectTrackSignals | SectionOptions = {},
	options: SectionOptions = {},
): SectionNode {
	return Layer.section(source, targetOrOptions, options);
}

export function blurRegion(
	sourceOrLayer: string | AnimatableNode<MediaNode>,
	target: ObjectTrackSignals,
	options: Partial<BlurProps> & {
		borderRadius?: number;
		padding?: number;
		borderColor?: string;
		borderWidth?: number;
	} = {},
): AnimatableNode<MediaNode> | AnimatableNode<BoxNode> {
	if (typeof sourceOrLayer === "object" && "blurRegion" in sourceOrLayer) {
		return (sourceOrLayer as AnimatableNode<MediaNode>).blurRegion(
			target,
			options,
		);
	}
	return Layer.blurTrackedRegion(sourceOrLayer as string, target, options);
}

export function editTrackedRegion(
	source: string | MediaNode,
	target: ObjectTrackSignals,
	options: TrackedRegionOptions = {},
): SectionNode {
	return Layer.section(source, target, options);
}

export const Effect = Object.assign(CoreEffect, {
	blur: (config?: BlurProps) => new Blur(config),
	vignette: (config?: VignetteProps) => new Vignette(config),
	colorBalance: (config?: ColorBalanceProps) => new ColorBalance(config),
	colorKey: (config?: ColorKeyProps) => new ColorKey(config),
	levels: (config?: LevelsProps) => new Levels(config),
	filmGrain: (config?: FilmGrainProps) => new FilmGrain(config),
	curves: (config?: CurvesProps) => new Curves(config),
	selectiveColor: (config?: SelectiveColorProps) => new SelectiveColor(config),
	gradientMap: (config?: GradientMapProps) => new GradientMap(config),
	shadowsHighlights: (config?: ShadowsHighlightsProps) =>
		new ShadowsHighlights(config),
	applyLut: (config?: ApplyLUTProps) => new ApplyLUT(config),
	unsharpMask: (config?: UnsharpMaskProps) => new UnsharpMask(config),
	highPass: (config?: HighPassProps) => new HighPass(config),
	halftoneScreen: (config?: HalftoneScreenProps) => new HalftoneScreen(config),
	tileOffset: (config?: TileOffsetProps) => new TileOffset(config),
	motionBlur: (config?: MotionBlurProps) => new MotionBlur(config),
	ssao: (config?: SSAOProps) => new SSAO(config),
	pbrGlass: (config?: PBRGlassProps) => new PBRGlass(config),
	depthOfField: (config?: DepthOfFieldProps) => new DepthOfField(config),
	crop: (config?: CropProps) => new Crop(config),
	vision: (config?: VisionProps) => new Vision(config),
	relight3d: (config?: Relight3DProps) => new Relight3D(config),
	modulate: (config?: ModulateProps) => new Modulate(config),
	deflicker: (config?: DeflickerProps) => new TemporalDeflicker(config),
	custom: (op: string, config: Record<string, unknown> = {}) =>
		new CustomEffect(op, config),
});

export type Effect<TConfig extends object = Record<string, unknown>> =
	CoreEffect<TConfig>;
