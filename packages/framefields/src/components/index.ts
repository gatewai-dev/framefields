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
	annotate,
	appFrame,
	type BaseProps,
	bind,
	type ComponentDefinition,
	type ComponentExtras,
	type Cues,
	callout,
	captions,
	chatThread,
	codeBlock,
	confetti,
	counter,
	focusZoom,
	lowerThird,
	meter,
	mousePointer,
	spotlight,
	terminal,
	textReveal,
	titleCard,
	toasts,
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
export function bindComponent<
	S extends z.ZodRawShape,
	C extends Cues,
	E extends object = object,
>(
	definition: ComponentDefinition<S, C, E>,
): (props: z.input<z.ZodObject<S>> & BaseProps) => ComponentNode<C> & E {
	return bind(host, definition) as never;
}

/** An animated pointer that travels, clicks, drags and changes shape, with a cue for every click. */
export const MousePointer = /* @__PURE__ */ bindComponent(mousePointer);

/** Window chrome (desktop window, browser, terminal) around any content; `at(x, y)` points into it. */
export const AppFrame = /* @__PURE__ */ bindComponent(appFrame);

/** A camera over 2D content that pushes in on clicks or shots and eases back out. */
export const FocusZoom = /* @__PURE__ */ bindComponent(focusZoom);

/** Text that animates in and out by character, word or line, ending on exactly the static text. */
export const TextReveal = /* @__PURE__ */ bindComponent(textReveal);

/** A number that counts to its value on odometer reels, format-aware. */
export const Counter = /* @__PURE__ */ bindComponent(counter);

/** Marks that draw on to point at something: underline, circle, arrow, highlight … hand-drawn or clean. */
export const Annotate = /* @__PURE__ */ bindComponent(annotate);

/** Word-timed captions in published styles, each word on its exact frame, optionally behind the speaker. */
export const Captions = /* @__PURE__ */ bindComponent(captions);

/** A scripted shell session: typed commands, streaming output, spinners, progress and scrolling. */
export const Terminal = /* @__PURE__ */ bindComponent(terminal);

/** Code on screen: syntax colours, typing, a focus band and diffs where kept lines glide. */
export const CodeBlock = /* @__PURE__ */ bindComponent(codeBlock);

/** Kicker, headline, rule and sub-line in designed layouts, on one timeline. */
export const TitleCard = /* @__PURE__ */ bindComponent(titleCard);

/** A name-and-role bar for interviews and talks that slides in and leaves on its own. */
export const LowerThird = /* @__PURE__ */ bindComponent(lowerThird);

/** Progress and scores: ring, arc, bar, segments or stars, filling with its counter. */
export const Meter = /* @__PURE__ */ bindComponent(meter);

/** A messaging conversation: springy bubbles, typing dots, reactions and auto-scroll. */
export const ChatThread = /* @__PURE__ */ bindComponent(chatThread);

/** Notifications arriving into a corner stack that compresses as it grows. */
export const Toasts = /* @__PURE__ */ bindComponent(toasts);

/** A label with a leader line pinned to a point or a moving tracked object. */
export const Callout = /* @__PURE__ */ bindComponent(callout);

/** Dims the frame except a region that glides between targets. */
export const Spotlight = /* @__PURE__ */ bindComponent(spotlight);

/** GPU confetti bursts: paper, ribbons and sparkles that fall and can settle. */
export const Confetti = /* @__PURE__ */ bindComponent(confetti);

export {
	type Anchor,
	type AnnotateCues,
	type AppFrameApi,
	type AppFrameCues,
	type AppFrameKind,
	type ArcPath,
	type ArrowCurve,
	type ArrowGeometry,
	anchorPoint,
	arcPath,
	arrowPaths,
	type BakedKey,
	type BakeOptions,
	type BaseProps,
	type BuildContext,
	type BuildResult,
	bakeFunction,
	bakeSamples,
	basePropsSchema,
	beats,
	boilKeys,
	boundsOf,
	boxPath,
	CALLOUT_SIDES,
	CAPTION_STYLES,
	type CalloutCues,
	type CalloutSide,
	type CaptionStyle,
	type CaptionsCues,
	type ChatThreadCues,
	CODE_LANGS,
	type CodeBlockCues,
	type CodeLang,
	type ComponentDefaults,
	type ComponentDefinition,
	type ComponentExtras,
	type ComponentMeta,
	type ConfettiCues,
	type CounterCues,
	type CounterFormat,
	CURSOR_STYLES,
	type Cue,
	type Cues,
	type CuesOf,
	type CursorStyle,
	type CutoutOptions,
	catmullRom,
	chain,
	constantExpression,
	contrastRatio,
	cover,
	defineComponent,
	defineMeta,
	defineTheme,
	dist,
	drawOnKeys,
	type EaseFn,
	EXIT_STYLES,
	type ExitStyle,
	ease,
	ellipsePath,
	enterAnimation,
	evaluateEase,
	evaluateGlyphExpression,
	exitAnimation,
	type FocusZoomApi,
	type FocusZoomCues,
	type Followable,
	type FrameWindow,
	findRange,
	frameSpan,
	type GlyphAnimator,
	type GlyphProps,
	type GlyphUnit,
	glyphAnimator,
	type HandOptions,
	hashRng,
	hashString,
	LOWER_THIRD_LAYOUTS,
	type LowerThirdCues,
	type LowerThirdLayout,
	lerp2,
	linePath,
	lineShift,
	MARKS,
	type Mark,
	METER_KINDS,
	type MeasureOptions,
	type MeterCues,
	type MeterKind,
	type Metrics,
	MOTION_PRESETS,
	type MotionOptions,
	type MotionPreset,
	type MotionPresetName,
	type MotionSize,
	type MousePointerApi,
	type MousePointerCues,
	offsetCues,
	type ParticleOptions,
	type Placement,
	type PropsOf,
	type PulseOptions,
	pulseKeys,
	quantize,
	REVEAL_STYLES,
	type Rect,
	type ResolvedMotion,
	type ResolvedTarget,
	type RevealStyle,
	type Rng,
	rangeRects,
	resolveMotion,
	resolveTarget,
	rng,
	type SpotlightCues,
	type StaggerOrder,
	scaleFrames,
	scheduleExpression,
	springAt,
	springKeys,
	springSettleFrames,
	springTrack,
	squigglePath,
	staggerOffsets,
	staggerRanks,
	stepExpression,
	type Target,
	type TargetContext,
	type TerminalCues,
	type TerminalStep,
	type TextRevealApi,
	type TextRevealCues,
	type Theme,
	type ThemeInput,
	type ThemeName,
	TITLE_LAYOUTS,
	type TitleCardCues,
	type TitleLayout,
	TOAST_CORNERS,
	TOAST_KINDS,
	type ToastCorner,
	type ToastKind,
	type ToastsCues,
	type Token,
	type TokenKind,
	targetPoint,
	themeFrames,
	themes,
	toFrames,
	tokenize,
	toPathData,
	toSeconds,
	typingFrames,
	type UnitSchedule,
	type Vec2,
	type Waypoint,
	type Word,
	type WordRange,
	windowExpression,
	within,
	wobblePoints,
	wordRanges,
} from "@framefields/components";
