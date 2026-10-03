/**
 * @file packages/compositions/src/program/text-animations/types.ts
 * Data contracts and Zod schemas for After Effects Parity Text Animation Engine.
 */

import { z } from "zod";

// ==============================================================================================
// 1. PATH-FOLLOWING TEXT DATA CONTRACTS & SCHEMAS
// ==============================================================================================

export const Vec2Schema = z.object({
	x: z.number(),
	y: z.number(),
});
export type Vec2 = z.infer<typeof Vec2Schema>;

export const CubicBezierSegmentSchema = z.object({
	p0: Vec2Schema,
	p1: Vec2Schema,
	p2: Vec2Schema,
	p3: Vec2Schema,
});
export type CubicBezierSegment = z.infer<typeof CubicBezierSegmentSchema>;

export const TextPathSourceSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("svg"),
		d: z.string().min(1, "SVG path string cannot be empty"),
	}),
	z.object({
		type: z.literal("bezier"),
		segments: z.array(CubicBezierSegmentSchema).min(1),
	}),
	z.object({
		type: z.literal("ellipse"),
		cx: z.number(),
		cy: z.number(),
		rx: z.number().positive(),
		ry: z.number().positive(),
		startAngleDeg: z.number().default(0),
		endAngleDeg: z.number().default(360),
	}),
	z.object({
		type: z.literal("wave"),
		startX: z.number(),
		startY: z.number(),
		length: z.number().positive(),
		amplitude: z.number(),
		frequency: z.number().positive(),
		phaseDeg: z.number().default(0),
	}),
]);
export type TextPathSource = z.infer<typeof TextPathSourceSchema>;

export const TextPathOptionsSchema = z.object({
	path: TextPathSourceSchema,
	firstMargin: z.number().default(0),
	lastMargin: z.number().default(0),
	reversePath: z.boolean().default(false),
	perpendicularToPath: z.boolean().default(true),
	forceAlignment: z.boolean().default(false),
	loop: z.boolean().default(false),
	baselineOffset: z
		.enum(["baseline", "center", "ascender", "descender"])
		.default("baseline"),
	baselineShift: z.number().default(0),
});
export type TextPathOptions = z.infer<typeof TextPathOptionsSchema>;

// ==============================================================================================
// 2. TYPEWRITER & DISCRETE REVEAL SCHEMAS
// ==============================================================================================

export const TextCursorStyleSchema = z.enum([
	"bar",
	"underscore",
	"block",
	"custom",
]);
export type TextCursorStyle = z.infer<typeof TextCursorStyleSchema>;

export const TextCursorConfigSchema = z.object({
	enabled: z.boolean().default(true),
	style: TextCursorStyleSchema.default("bar"),
	customChar: z.string().default("|"),
	color: z.string().optional(),
	blinkFrequency: z.number().min(0).default(2.0),
	hideOnComplete: z.boolean().default(false),
	width: z.number().positive().default(2.5),
	spacing: z.number().default(3.0),
});
export type TextCursorConfig = z.infer<typeof TextCursorConfigSchema>;

export const TypingCadenceSchema = z.discriminatedUnion("mode", [
	z.object({
		mode: z.literal("constant"),
	}),
	z.object({
		mode: z.literal("human"),
		jitter: z.number().min(0).max(1).default(0.35),
		commaPauseMultiplier: z.number().min(1).default(3.0),
		sentencePauseMultiplier: z.number().min(1).default(5.5),
		paragraphPauseMultiplier: z.number().min(1).default(7.0),
	}),
]);
export type TypingCadence = z.infer<typeof TypingCadenceSchema>;

export const TextScrambleConfigSchema = z.object({
	enabled: z.boolean().default(false),
	charset: z
		.enum(["ascii", "alphanumeric", "matrix", "binary", "hex", "custom"])
		.default("alphanumeric"),
	customCharset: z.string().optional(),
	scrambleFramesPerChar: z.number().int().min(1).default(8),
	highlightProbability: z.number().min(0).max(1).default(0.25),
	scrambleColor: z.string().optional(),
});
export type TextScrambleConfig = z.infer<typeof TextScrambleConfigSchema>;

export const TypewriterAnimatorSchema = z.object({
	granularity: z.enum(["character", "word", "line"]).default("character"),
	cursor: TextCursorConfigSchema.default({
		enabled: true,
		style: "bar",
		customChar: "|",
		blinkFrequency: 2.0,
		hideOnComplete: false,
		width: 2.5,
		spacing: 3.0,
	}),
	cadence: TypingCadenceSchema.default({
		mode: "human",
		jitter: 0.35,
		commaPauseMultiplier: 3.0,
		sentencePauseMultiplier: 5.5,
		paragraphPauseMultiplier: 7.0,
	}),
	scramble: TextScrambleConfigSchema.default({
		enabled: false,
		charset: "alphanumeric",
		scrambleFramesPerChar: 8,
		highlightProbability: 0.25,
	}),
	soundSync: z.boolean().default(false),
});
export type TypewriterAnimator = z.infer<typeof TypewriterAnimatorSchema>;

// ==============================================================================================
// 3. AFTER EFFECTS PROCEDURAL SELECTORS
// ==============================================================================================

export const SelectorBasedOnSchema = z.enum([
	"characters",
	"characters_excluding_spaces",
	"words",
	"lines",
]);
export type SelectorBasedOn = z.infer<typeof SelectorBasedOnSchema>;

export const SelectorUnitsSchema = z.enum(["percentage", "index"]);
export type SelectorUnits = z.infer<typeof SelectorUnitsSchema>;

export const SelectorShapeSchema = z.enum([
	"square",
	"ramp_up",
	"ramp_down",
	"triangle",
	"round",
	"smooth",
]);
export type SelectorShape = z.infer<typeof SelectorShapeSchema>;

export const SelectorModeSchema = z.enum([
	"add",
	"subtract",
	"intersect",
	"min",
	"max",
	"difference",
]);
export type SelectorMode = z.infer<typeof SelectorModeSchema>;

export const TextRangeSelectorSchema = z.object({
	type: z.literal("range"),
	start: z.number().default(0),
	end: z.number().default(1),
	offset: z.number().default(0),
	units: SelectorUnitsSchema.default("percentage"),
	basedOn: SelectorBasedOnSchema.default("characters"),
	shape: SelectorShapeSchema.default("square"),
	mode: SelectorModeSchema.default("add"),
	amount: z.number().min(-1).max(1).default(1),
	easeHigh: z.number().min(-1).max(1).default(0),
	easeLow: z.number().min(-1).max(1).default(0),
	randomizeOrder: z.boolean().default(false),
	randomSeed: z.number().int().default(12345),
});
export type TextRangeSelector = z.infer<typeof TextRangeSelectorSchema>;

export const TextWigglySelectorSchema = z.object({
	type: z.literal("wiggly"),
	wigglesPerSecond: z.number().positive().default(2.0),
	correlation: z.number().min(0).max(1).default(0.5),
	temporalPhaseDeg: z.number().default(0),
	spatialPhaseDeg: z.number().default(0),
	minAmount: z.number().min(-1).max(1).default(-1.0),
	maxAmount: z.number().min(-1).max(1).default(1.0),
	randomSeed: z.number().int().default(42),
	basedOn: SelectorBasedOnSchema.default("characters"),
	mode: SelectorModeSchema.default("intersect"),
});
export type TextWigglySelector = z.infer<typeof TextWigglySelectorSchema>;

export const TextSignalSelectorSchema = z.object({
	type: z.literal("signal"),
	signalId: z.string(),
	multiplier: z.number().default(1.0),
	offset: z.number().default(0.0),
	phaseSpread: z.number().default(0.0),
	basedOn: SelectorBasedOnSchema.default("characters"),
	mode: SelectorModeSchema.default("add"),
});
export type TextSignalSelector = z.infer<typeof TextSignalSelectorSchema>;

export const TextSelectorSchema = z.discriminatedUnion("type", [
	TextRangeSelectorSchema,
	TextWigglySelectorSchema,
	TextSignalSelectorSchema,
]);
export type TextSelector = z.infer<typeof TextSelectorSchema>;

// ==============================================================================================
// 4. ANIMATABLE GLYPH PROPERTIES (TRANSFORM PAYLOAD)
// ==============================================================================================

export const AnimatableGlyphPropsSchema = z.object({
	x: z.number().optional(),
	y: z.number().optional(),
	z: z.number().optional(),
	scale: z.number().optional(),
	scaleX: z.number().optional(),
	scaleY: z.number().optional(),
	rotation: z.number().optional(),
	rotationX: z.number().optional(),
	rotationY: z.number().optional(),
	skew: z.number().optional(),
	skewAxis: z.number().optional(),
	tracking: z.number().optional(),
	lineSpacing: z.number().optional(),
	opacity: z.number().min(0).max(1).optional(),
	fillColor: z.string().optional(),
	strokeColor: z.string().optional(),
	strokeWidth: z.number().min(0).optional(),
	blur: z.number().min(0).optional(),
	characterOffset: z.number().int().optional(),
});
export type AnimatableGlyphProps = z.infer<typeof AnimatableGlyphPropsSchema>;

export const GlyphAnchorGroupingSchema = z.enum([
	"character",
	"word",
	"line",
	"all",
]);
export type GlyphAnchorGrouping = z.infer<typeof GlyphAnchorGroupingSchema>;

export const GlyphAnchorPointSchema = z.object({
	grouping: GlyphAnchorGroupingSchema.default("character"),
	anchorX: z.number().default(0.5),
	anchorY: z.number().default(0.8),
});
export type GlyphAnchorPoint = z.infer<typeof GlyphAnchorPointSchema>;

export const AETextAnimatorSchema = z.object({
	name: z.string().default("Animator"),
	selectors: z.array(TextSelectorSchema).min(1),
	props: AnimatableGlyphPropsSchema,
	anchor: GlyphAnchorPointSchema.default({
		grouping: "character",
		anchorX: 0.5,
		anchorY: 0.8,
	}),
});
export type AETextAnimator = z.infer<typeof AETextAnimatorSchema>;

export const EnhancedTextNodeSchema = z.object({
	text: z.string(),
	fontFamily: z.string().default("Inter"),
	fontSize: z.number().positive().default(24),
	fontWeight: z.union([z.number(), z.string()]).default(400),
	fill: z.string().default("#ffffff"),
	letterSpacing: z.number().default(0),
	lineHeight: z.number().positive().default(1.2),
	textAlign: z.enum(["left", "center", "right"]).default("left"),
	pathOptions: TextPathOptionsSchema.optional(),
	typewriter: TypewriterAnimatorSchema.optional(),
	animators: z.array(AETextAnimatorSchema).default([]),
});
export type EnhancedTextNode = z.infer<typeof EnhancedTextNodeSchema>;
