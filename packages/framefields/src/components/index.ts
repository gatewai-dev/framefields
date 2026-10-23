/**
 * `framefields/components`: the component library and the toolkit for
 * building components. Components are also exported from the `framefields`
 * root; this subpath adds the authoring toolkit (timing, paths, strokes,
 * targets, baking).
 *
 * Each component is bound to the framefields host with a PURE call, so
 * bundlers drop every component that isn't imported.
 */

import {
	type BaseProps,
	bind,
	type ComponentDefinition,
	type ComponentExtras,
	type Cues,
} from "@framefields/components";
import type { BoxNode } from "@framefields/compositions/program";
import type { z } from "zod";
import type { AnimatableNode } from "../index.js";
import { host } from "./host.js";

/** A component's root: a normal framefields box layer plus cues, span and parts. */
export type ComponentNode<C extends Cues = Cues> = AnimatableNode<BoxNode> &
	ComponentExtras<C>;

/**
 * Bind a component definition to framefields, producing its factory. Use it
 * for your own components built with `defineComponent`.
 */
export function bindComponent<S extends z.ZodRawShape, C extends Cues>(
	definition: ComponentDefinition<S, C>,
): (props: z.input<z.ZodObject<S>> & BaseProps) => ComponentNode<C> {
	return bind(host, definition) as never;
}

export {
	type Anchor,
	type ArcPath,
	type ArrowCurve,
	type ArrowGeometry,
	anchorPoint,
	arcPath,
	arrowPaths,
	type BakedKey,
	type BakeOptions,
	type BaseProps,
	BasePropsSchema,
	type BuildContext,
	type BuildResult,
	bakeFunction,
	bakeSamples,
	beats,
	boilKeys,
	boundsOf,
	boxPath,
	type ComponentDefaults,
	type ComponentDefinition,
	type ComponentExtras,
	type ComponentMeta,
	type Cue,
	type Cues,
	type CuesOf,
	catmullRom,
	chain,
	contrastRatio,
	cover,
	defineComponent,
	defineMeta,
	defineTheme,
	dist,
	drawOnKeys,
	type EaseFn,
	ease,
	ellipsePath,
	enterAnimation,
	evaluateEase,
	exitAnimation,
	type FrameWindow,
	findRange,
	frameSpan,
	type HandOptions,
	hashRng,
	hashString,
	lerp2,
	linePath,
	type MeasureOptions,
	type Metrics,
	MOTION_PRESETS,
	type MotionOptions,
	type MotionPreset,
	type MotionPresetName,
	offsetCues,
	type PropsOf,
	type PulseOptions,
	pulseKeys,
	quantize,
	type Rect,
	type ResolvedMotion,
	type ResolvedTarget,
	type Rng,
	rangeRects,
	resolveMotion,
	resolveTarget,
	rng,
	type StaggerOrder,
	scaleFrames,
	springAt,
	springSettleFrames,
	squigglePath,
	staggerOffsets,
	staggerRanks,
	type Target,
	type TargetContext,
	type Theme,
	type ThemeInput,
	type ThemeName,
	targetPoint,
	themeFrames,
	themes,
	toFrames,
	toPathData,
	toSeconds,
	type Vec2,
	type WordRange,
	within,
	wobblePoints,
	wordRanges,
} from "@framefields/components";
