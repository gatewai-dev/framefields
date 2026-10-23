/**
 * `@framefields/components`: parametric motion components, bundled into and
 * exported from `framefields`. Named re-exports only: no registries and no
 * top-level calls, so every export tree-shakes on its own.
 */

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
	BasePropsSchema,
	type BuildContext,
	type BuildResult,
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
export type { Animatable, AnimatableMethods, Host } from "./core/host.js";
export { type ComponentMeta, defineMeta } from "./core/meta.js";
export {
	enterAnimation,
	exitAnimation,
	MOTION_PRESETS,
	type MotionOptions,
	type MotionPreset,
	type MotionPresetName,
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
