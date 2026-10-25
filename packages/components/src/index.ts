/**
 * `@framefields/components`: parametric motion components, bundled into and
 * exported from `framefields`. Named re-exports only: no registries and no
 * top-level calls, so every export tree-shakes on its own.
 */

export {
	type AnnotateCues,
	annotate,
	MARKS,
	type Mark,
} from "./annotate/index.js";
export {
	type AppFrameApi,
	type AppFrameCues,
	type AppFrameKind,
	appFrame,
} from "./app-frame/index.js";
export {
	BACKDROP_KINDS,
	type BackdropCues,
	type BackdropKind,
	backdrop,
	cosineKeys,
	slideKeys,
} from "./backdrop/index.js";
export {
	type BeforeAfterCues,
	beforeAfter,
} from "./before-after/index.js";
export {
	CALLOUT_SIDES,
	type CalloutCues,
	type CalloutSide,
	callout,
} from "./callout/index.js";
export {
	CAPTION_STYLES,
	type CaptionStyle,
	type CaptionsCues,
	captions,
	type Word,
} from "./captions/index.js";
export {
	type CardStackCues,
	cardStack,
} from "./card-stack/index.js";
export { type ChatThreadCues, chatThread } from "./chat-thread/index.js";
export {
	CODE_LANGS,
	type CodeBlockCues,
	type CodeLang,
	codeBlock,
	type Token,
	type TokenKind,
} from "./code-block/index.js";
export { tokenize } from "./code-block/tokenize.js";
export { type ConfettiCues, confetti } from "./confetti/index.js";
export {
	type AnalyzeOptions,
	type AudioLevels,
	analyzeChannels,
	audioLevelsSchema,
	bandEdges,
	resampleBands,
	smoothRelease,
} from "./core/audio.js";
export {
	type BakedKey,
	type BakeOptions,
	bakeFunction,
	bakeSamples,
	springAt,
	springKeys,
	springSettleFrames,
	springTrack,
} from "./core/bake.js";
export {
	contrastRatio,
	inkOn,
	isLight,
	luminance,
	mix,
	parseColor,
	type Rgba,
	transparent,
	withAlpha,
} from "./core/color.js";
export {
	after,
	type BaseProps,
	type BuildContext,
	type BuildResult,
	basePropsSchema,
	bind,
	type ComponentDefaults,
	type ComponentDefinition,
	type ComponentExtras,
	type ComponentNode,
	type Cue,
	type Cues,
	type CuesOf,
	defineComponent,
	offsetCues,
	type Placement,
	type ProjectDefaults,
	type PropsOf,
	type PulseOptions,
	pulseKeys,
	withDefaults,
} from "./core/contract.js";
export {
	type ArrowCurve,
	type ArrowGeometry,
	arrowPaths,
	boilKeys,
	boxPath,
	drawOnKeys,
	ellipsePath,
	type HandOptions,
	linePath,
	type Rect,
	squigglePath,
	wobblePoints,
} from "./core/draw.js";
export { type EaseFn, ease, evaluateEase } from "./core/ease.js";
export {
	constantExpression,
	evaluateGlyphExpression,
	type GlyphAnimator,
	type GlyphProps,
	type GlyphUnit,
	glyphAnimator,
	scheduleExpression,
	stepExpression,
	type UnitSchedule,
	windowExpression,
} from "./core/glyphs.js";
export type {
	Animatable,
	AnimatableMethods,
	CutoutOptions,
	ExtrudedTextOptions,
	GrainOptions,
	Host,
	LayerStyleConfig,
	MediaOptions,
	ParticleOptions,
} from "./core/host.js";
export {
	ascending,
	KeyBook,
	last,
	round,
	supersede,
	Track,
	valueAt,
} from "./core/keys.js";
export {
	type CanvasSize,
	SAFE_INSETS,
	type SafeInsets,
	safeArea,
} from "./core/layout.js";
export {
	type ComponentMeta,
	defineMeta,
	type FontNeed,
	type FontRole,
} from "./core/meta.js";
export {
	enterAnimation,
	exitAnimation,
	MOTION_PRESETS,
	type MotionOptions,
	type MotionPreset,
	type MotionPresetName,
	type MotionSize,
	type ResolvedMotion,
	resolveMotion,
} from "./core/motion.js";
export {
	type ArcPath,
	arcPath,
	catmullRom,
	dist,
	lerp2,
	toPathData,
	type Vec2,
} from "./core/path.js";
export { hashRng, hashString, type Rng, rng } from "./core/rng.js";
export {
	type ElevationLevel,
	elevate,
	elevationStyle,
	surfaceFill,
} from "./core/surface.js";
export {
	type Anchor,
	anchorPoint,
	boundsOf,
	type ResolvedTarget,
	resolveTarget,
	type Target,
	type TargetContext,
	type TargetNode,
	type TextLayout,
	targetPoint,
	textLayout,
} from "./core/targets.js";
export {
	findRange,
	lineShift,
	type MeasureFn,
	type MeasureOptions,
	type Metrics,
	rangeRects,
	type WordRange,
	wordRanges,
} from "./core/text.js";
export {
	defineTheme,
	type Elevation,
	type Spring,
	type SyntaxKind,
	type Theme,
	type ThemeInput,
	type ThemeName,
	themeFrames,
	themes,
} from "./core/theme.js";
export {
	beats,
	chain,
	cover,
	type FrameWindow,
	frameSpan,
	quantize,
	type StaggerOrder,
	scaleFrames,
	staggerOffsets,
	staggerRanks,
	toFrames,
	toSeconds,
	within,
} from "./core/timing.js";
export { typingFrames } from "./core/typing.js";
export {
	type CounterCues,
	type CounterFormat,
	counter,
} from "./counter/index.js";
export {
	DEVICES,
	type Device,
	type DeviceFrameApi,
	type DeviceFrameCues,
	deviceFrame,
} from "./device-frame/index.js";
export {
	type FocusZoomApi,
	type FocusZoomCues,
	type Followable,
	focusZoom,
} from "./focus-zoom/index.js";
export {
	LOGO_LAYOUTS,
	LOGO_STYLES,
	type LogoLayout,
	type LogoRevealCues,
	type LogoStyle,
	logoReveal,
} from "./logo-reveal/index.js";
export {
	LOWER_THIRD_LAYOUTS,
	type LowerThirdCues,
	type LowerThirdLayout,
	lowerThird,
} from "./lower-third/index.js";
export {
	METER_KINDS,
	type MeterCues,
	type MeterKind,
	meter,
} from "./meter/index.js";
export {
	CURSOR_STYLES,
	type CursorStyle,
	type MousePointerApi,
	type MousePointerCues,
	mousePointer,
	type Waypoint,
} from "./mouse-pointer/index.js";
export {
	type SelectionCues,
	type SelectionPointer,
	selection,
} from "./selection/index.js";
export { type SpotlightCues, spotlight } from "./spotlight/index.js";
export {
	type TerminalCues,
	type TerminalStep,
	terminal,
} from "./terminal/index.js";
export {
	EXIT_STYLES,
	type ExitStyle,
	REVEAL_STYLES,
	type RevealStyle,
	type TextRevealApi,
	type TextRevealCues,
	textReveal,
} from "./text-reveal/index.js";
export {
	TITLE_LAYOUTS,
	type TitleCardCues,
	type TitleLayout,
	titleCard,
} from "./title-card/index.js";
export {
	TOAST_CORNERS,
	TOAST_KINDS,
	type ToastCorner,
	type ToastKind,
	type ToastsCues,
	toasts,
} from "./toasts/index.js";
export {
	type PlannedTouch,
	planTouches,
	type TouchPointCues,
	touchPoint,
} from "./touch-point/index.js";
export {
	WAVEFORM_KINDS,
	type WaveformCues,
	type WaveformKind,
	waveform,
} from "./waveform/index.js";
export {
	WORD_SLOTS,
	WORD_TRANSITIONS,
	type WordCycleCues,
	type WordSlot,
	type WordTransition,
	wordCycle,
} from "./word-cycle/index.js";
