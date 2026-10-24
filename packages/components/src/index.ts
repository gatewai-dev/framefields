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
	CAPTION_STYLES,
	type CaptionStyle,
	type CaptionsCues,
	captions,
	type Word,
} from "./captions/index.js";
export {
	type BakedKey,
	type BakeOptions,
	bakeFunction,
	bakeSamples,
	springAt,
	springSettleFrames,
} from "./core/bake.js";
export {
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
	type PropsOf,
	type PulseOptions,
	pulseKeys,
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
	Host,
	LayerStyleConfig,
	MediaOptions,
} from "./core/host.js";
export { type ComponentMeta, defineMeta } from "./core/meta.js";
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
	type Anchor,
	anchorPoint,
	boundsOf,
	type ResolvedTarget,
	resolveTarget,
	type Target,
	type TargetContext,
	targetPoint,
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
	contrastRatio,
	defineTheme,
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
	type FocusZoomApi,
	type FocusZoomCues,
	type Followable,
	focusZoom,
} from "./focus-zoom/index.js";
export {
	CURSOR_STYLES,
	type CursorStyle,
	type MousePointerApi,
	type MousePointerCues,
	mousePointer,
	type Waypoint,
} from "./mouse-pointer/index.js";
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
