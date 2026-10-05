/**
 * Compositor program document v2 — THE single source of truth for a
 * composition (spec: `nodes/node-compositor/SKILL.md`).
 *
 * The config IS a tree of HTML-like layout nodes (`layout`), replacing the
 * v1 flat `layers[]`. No `layers`, no `layerUpdates`, no aliases: the tree
 * is what agents write, what the editor edits, what the renderer renders.
 *
 * Design rules (hard):
 *  - strict zod, `.strict()` everywhere; unknown keys are rejected by the
 *    pre-parse scan in `validate.ts` (zod alone would silently strip them)
 *  - recursive container fields use `z.lazy`; leaf kinds are plain objects
 *  - every field that can animate is in `AnimatablePropSchema`
 *  - no backwards compatibility: v1 shapes fail fast with E-codes
 */

import type {
	MeshAudioDeformConfig,
	TextSpan,
	TextSpanMark,
} from "@framefields/core";
import { ColorSchema } from "@framefields/node-sdk";
export type { TextSpan, TextSpanMark };

import { z } from "zod";
import {
	type AdvancedTextAnimator,
	AdvancedTextAnimatorSchema,
	type AETextAnimator,
	AETextAnimatorSchema,
	type KineticMarqueeConfig,
	KineticMarqueeConfigSchema,
	type TextPathOptions,
	TextPathOptionsSchema,
	type TypewriterAnimator,
	TypewriterAnimatorSchema,
} from "./text-animations/index.js";

export * from "./text-animations/index.js";

// ── shared leaf primitives ────────────────────────────────────────────

/** number px | "auto" (intrinsic) | "fit" (shrink-wrap) | "fill" (parent extent). */
export const SizeSpecSchema = z.union([
	z.number().min(0),
	z.enum(["auto", "fit", "fill"]),
	z.custom<unknown>(),
]);
export type SizeSpec = z.infer<typeof SizeSpecSchema>;

export const ShapeTypeSchema = z.enum([
	"rect",
	"circle",
	"ellipse",
	"polygon",
	"star",
	"arrow",
	"path",
]);
export type ShapeType = z.infer<typeof ShapeTypeSchema>;

export const AnimatablePropSchema = z.enum([
	"x",
	"y",
	"scale",
	"rotation",
	"opacity",
	"width",
	"height",
	"volume",
	"hidden",
	"muted",
	"gap",
	"padding",
	"borderRadius",
	"fontSize",
	"text",
	"fill",
	"color",
	"letterSpacing",
	// Vector Shape & Stroke properties
	"trimStart",
	"trimEnd",
	"trimOffset",
	"strokeWidth",
	"strokeDashOffset",
	"cornerRadius",
	"starInnerRadiusRatio",
	"fillColor",
	"strokeColor",
	"borderColor",
	"borderWidth",
	"motionBlurShutter",
	// Kinetic Typography properties
	"rangeStart",
	"rangeEnd",
	"offset",
	"animatorRangeStart",
	"animatorRangeEnd",
	"animatorOffset",
	// Path-following text properties
	"firstMargin",
	"lastMargin",
	"baselineShift",
	// 3D Perspective & Transform properties
	"rotateX",
	"rotateY",
	"rotateZ",
	"perspective",
	"translateZ",
	"perspectiveOriginX",
	"perspectiveOriginY",
	// 3D Camera & Scene properties
	"cameraX",
	"cameraY",
	"cameraZ",
	"targetX",
	"targetY",
	"targetZ",
	"cameraPitch",
	"cameraYaw",
	"cameraRoll",
	"cameraFov",
	"cameraZoom",
	"focalLength",
	"focusDistance",
	"fStop",
	"maxBlurRadius",
	"shakeTranslation",
	"shakeRotation",
	"orbitRadius",
	"orbitAzimuth",
	"orbitElevation",
	"z",
	"scaleZ",
	// 3D Lighting & Material properties
	"intensity",
	"angle",
	"radius",
	"penumbra",
	"decay",
	"shininess",
	"roughness",
	"specularIntensity",
	"ambientIntensity",
	"metallic",
	"ior",
	"dispersion",
	"transmission",
	"fresnelPower",
	"envIntensity",
	// 3D Model & Animation properties
	"animationProgress",
	"animationTime",
	"animationSpeed",
	"wireframe",
	"scaleX",
	"scaleY",
]);
export type AnimatableProp = z.infer<typeof AnimatablePropSchema>;

export const MaterialTypeSchema = z.enum([
	"lit",
	"unlit",
	"toon",
	"glass",
	"acrylic",
	"frosted",
	"metallic",
]);
export type MaterialType = z.infer<typeof MaterialTypeSchema>;

export const EXTENDED_3D_ANIMATABLE_PROPS = [
	"rotateX",
	"rotateY",
	"rotateZ",
	"perspective",
	"translateZ",
	"perspectiveOriginX",
	"perspectiveOriginY",
	"cameraX",
	"cameraY",
	"cameraZ",
	"targetX",
	"targetY",
	"targetZ",
	"cameraPitch",
	"cameraYaw",
	"cameraRoll",
	"cameraFov",
	"cameraZoom",
	"focalLength",
	"focusDistance",
	"fStop",
	"maxBlurRadius",
	"shakeTranslation",
	"shakeRotation",
	"orbitRadius",
	"orbitAzimuth",
	"orbitElevation",
	"z",
	"scaleZ",
	"intensity",
	"angle",
	"radius",
	"penumbra",
	"decay",
	"shininess",
	"roughness",
	"specularIntensity",
	"ambientIntensity",
	"metallic",
] as const;
export type Extended3DAnimatableProp =
	(typeof EXTENDED_3D_ANIMATABLE_PROPS)[number];

export const SignalColorModeSchema = z.enum([
	"interpolate",
	"hueRotate",
	"threshold",
]);
export type SignalColorMode = z.infer<typeof SignalColorModeSchema>;

export const EaseRefSchema = z
	.object({
		name: z.enum([
			"none",
			"power1",
			"power2",
			"power3",
			"sine",
			"circ",
			"expo",
			"back",
			"elastic",
			"bounce",
			"spring",
			"cubic",
			"hold",
		]),
		dir: z.enum(["in", "out", "inOut"]),
		params: z.array(z.number()).optional(),
	})
	.strict()
	.superRefine((data, ctx) => {
		if (data.name === "spring" && data.params) {
			const [damping, stiffness, mass] = data.params;
			if (damping !== undefined && damping <= 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Spring damping must be greater than 0.",
					path: ["params", 0],
				});
			}
			if (stiffness !== undefined && stiffness <= 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Spring stiffness must be greater than 0.",
					path: ["params", 1],
				});
			}
			if (mass !== undefined && mass <= 0) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: "Spring mass must be greater than 0.",
					path: ["params", 2],
				});
			}
		}
	});
export type EaseRef = z.infer<typeof EaseRefSchema>;

export const KeyframeSchema = z
	.object({
		id: z.string().min(1),
		frame: z.number().int().min(0),
		value: z.union([z.number(), z.boolean(), z.string()]),
		ease: EaseRefSchema.optional(),
		presetGroupId: z.string().optional(),
		presetType: z.string().optional(),
		spatialTangentIn: z.object({ x: z.number(), y: z.number() }).optional(),
		spatialTangentOut: z.object({ x: z.number(), y: z.number() }).optional(),
	})
	.strict();
export type Keyframe = z.infer<typeof KeyframeSchema>;

export const SignalModeSchema = z.enum(["continuous", "accumulate"]);
export type SignalMode = z.infer<typeof SignalModeSchema>;

const RawTrackSourceSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("keyframe"),
	}),
	z.object({
		type: z.literal("signal"),
		inputHandleId: z.string(),
		multiplier: z.number().default(1.0),
		offset: z.number().default(0.0),
		smoothingWindowFrames: z.number().min(0).default(0),
		colorMode: SignalColorModeSchema.optional(),
		colorA: z.string().optional(),
		colorB: z.string().optional(),
		colorThreshold: z.number().optional(),
		signalMode: SignalModeSchema.optional(),
		threshold: z.number().optional(),
		accumulateThreshold: z.number().optional(),
		debounceFrames: z.number().int().min(0).optional(),
		channel: z.string().optional(),
	}),
	z.object({
		type: z.literal("wiggle"),
		frequency: z.number().default(2.0),
		amplitude: z.number().default(50.0),
		octaves: z.number().int().min(1).max(4).default(1),
		seed: z.number().default(1234),
	}),
	z.object({
		type: z.literal("springOvershoot"),
		damping: z.number().default(12),
		stiffness: z.number().default(180),
		mass: z.number().default(1),
	}),
]);

export const TrackSourceSchema = z.preprocess((val: unknown) => {
	if (!val || typeof val !== "object") return val;
	const obj = val as Record<string, unknown>;
	if (obj.type === "signal") {
		const thresh =
			typeof obj.threshold === "number"
				? obj.threshold
				: typeof obj.accumulateThreshold === "number"
					? obj.accumulateThreshold
					: 0.15;
		return {
			type: "signal",
			inputHandleId: obj.inputHandleId ?? obj.handleId,
			multiplier: obj.multiplier ?? obj.amplitude ?? 1.0,
			offset: obj.offset ?? 0.0,
			smoothingWindowFrames: obj.smoothingWindowFrames ?? obj.smoothing ?? 0,
			colorMode: obj.colorMode,
			colorA: obj.colorA,
			colorB: obj.colorB,
			colorThreshold: obj.colorThreshold,
			signalMode: obj.signalMode ?? "continuous",
			threshold: thresh,
			accumulateThreshold: thresh,
			debounceFrames: obj.debounceFrames ?? 2,
			channel: typeof obj.channel === "string" ? obj.channel : "primary",
		};
	}
	return val;
}, RawTrackSourceSchema) as unknown as typeof RawTrackSourceSchema;
export type TrackSource = z.infer<typeof RawTrackSourceSchema>;
export type SignalTrackSource = Extract<TrackSource, { type: "signal" }>;

const animationInvariants = (
	anim: {
		tracks?: Array<{
			prop: string;
			source?: { type: string };
			keyframes?: Array<{ value: unknown; frame: number }>;
		}>;
	},
	ctx: z.RefinementCtx,
) => {
	if (!anim?.tracks) return;
	let totalKeyframes = 0;
	for (let tIdx = 0; tIdx < anim.tracks.length; tIdx++) {
		const track = anim.tracks[tIdx];
		const keyframes = track.keyframes ?? [];
		totalKeyframes += keyframes.length;

		const isKeyframeSource = !track.source || track.source.type === "keyframe";
		if (isKeyframeSource && keyframes.length < 1) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				message: `Track for property '${track.prop}' must have at least 1 keyframe.`,
				path: ["tracks", tIdx, "keyframes"],
			});
		}

		const isDiscrete = track.prop === "hidden" || track.prop === "muted";
		const isColor =
			track.prop === "fillColor" ||
			track.prop === "strokeColor" ||
			track.prop === "fill" ||
			track.prop === "color";
		for (let kIdx = 0; kIdx < keyframes.length; kIdx++) {
			const kf = keyframes[kIdx];
			if (kIdx > 0) {
				const prevKf = keyframes[kIdx - 1];
				if (kf.frame < prevKf.frame) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Keyframes must be sorted in ascending order of frame.",
						path: ["tracks", tIdx, "keyframes", kIdx],
					});
				} else if (kf.frame === prevKf.frame) {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: "Duplicate keyframes at the same frame are not allowed.",
						path: ["tracks", tIdx, "keyframes", kIdx],
					});
				}
			}
			const valType = typeof kf.value;
			if (isDiscrete) {
				if (valType !== "boolean") {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Keyframe value for discrete property '${track.prop}' must be a boolean.`,
						path: ["tracks", tIdx, "keyframes", kIdx, "value"],
					});
				}
			} else if (isColor) {
				if (valType !== "string") {
					ctx.addIssue({
						code: z.ZodIssueCode.custom,
						message: `Keyframe value for color property '${track.prop}' must be a string.`,
						path: ["tracks", tIdx, "keyframes", kIdx, "value"],
					});
				}
			} else if (
				valType !== "number" ||
				Number.isNaN(kf.value as number) ||
				!Number.isFinite(kf.value as number)
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Keyframe value for numeric property '${track.prop}' must be a finite number.`,
					path: ["tracks", tIdx, "keyframes", kIdx, "value"],
				});
			} else if (
				(track.prop === "volume" ||
					track.prop === "trimStart" ||
					track.prop === "trimEnd") &&
				((kf.value as number) < 0 || (kf.value as number) > 1)
			) {
				ctx.addIssue({
					code: z.ZodIssueCode.custom,
					message: `Keyframe value for property '${track.prop}' must be between 0 and 1.`,
					path: ["tracks", tIdx, "keyframes", kIdx, "value"],
				});
			}
		}
	}
	if (totalKeyframes > 128) {
		ctx.addIssue({
			code: z.ZodIssueCode.custom,
			message: `Total keyframes across all tracks (${totalKeyframes}) exceeds the limit of 128.`,
			path: ["tracks"],
		});
	}
};

export const AnimationTrackSchema = z
	.object({
		id: z.string().min(1),
		prop: AnimatablePropSchema,
		source: TrackSourceSchema.optional(),
		keyframes: z.array(KeyframeSchema).default([]),
		repeat: z.number().int().optional(),
		yoyo: z.boolean().optional(),
		durationFrames: z.number().int().min(1).optional(),
	})
	.strict();
export type AnimationTrack = z.infer<typeof AnimationTrackSchema>;

export const LayerAnimationSchema = z
	.object({
		tracks: z.array(AnimationTrackSchema).max(24),
	})
	.strict()
	.superRefine(animationInvariants);
export type LayerAnimationSpec = z.infer<typeof LayerAnimationSchema>;

// ── layout node tree ──────────────────────────────────────────────────
// Hand-written interfaces anchor the mutual recursion (schema + type).
// Container `children` fields use z.lazy closures; the union schema is
// cast to z.ZodType<LayoutNode> — the documented pattern (zod-recursion).

const BaseNodeFields = {
	id: z.string().min(1),
	/** Graph binding — which connected input this node renders (for text/media nodes). */
	inputHandleId: z.string().optional(),
	/** "absolute" = out of flow, placed at x/y of the parent's content box. */
	position: z.enum(["relative", "absolute"]).default("relative"),
	x: z.union([z.number(), z.custom<unknown>()]).default(0),
	y: z.union([z.number(), z.custom<unknown>()]).default(0),
	width: SizeSpecSchema.optional(),
	height: SizeSpecSchema.optional(),
	/** Main-axis leftover share on the parent flex. */
	grow: z.number().min(0).optional(),
	/** Flex shrink factor (Yoga). Defaults to 1 in Yoga when unset. */
	flexShrink: z.number().min(0).optional(),
	/** Flex basis in px (Yoga). */
	flexBasis: z.number().min(0).optional(),
	/** Per-child cross-axis override (Yoga alignSelf). */
	alignSelf: z
		.enum(["auto", "start", "center", "end", "stretch", "baseline"])
		.optional(),
	/** Intrinsic aspect ratio (width / height). */
	aspectRatio: z.number().positive().optional(),
	zIndex: z.number().int().default(0),
	hidden: z.boolean().default(false),
	opacity: z.number().min(0).max(1).default(1),
	blendMode: z.string().optional(),
	/** Per-node WebGPU effect chain (`layer.withEffect(s)`); resolved to operations in to-virtual-media. */
	effects: z.array(z.unknown()).optional(),
	rotation: z.number().default(0),
	scale: z.number().min(0).default(1),
	/** Transform pivot, 0–1 fraction of the node box (0.5 = center). */
	anchorX: z.number().min(0).max(1).default(0.5),
	anchorY: z.number().min(0).max(1).default(0.5),
	/** Clip timing — frames, clip-relative. */
	startFrame: z.number().int().min(0).default(0),
	durationFrames: z.number().int().min(1).optional(),
	/** Directional velocity motion blur shutter angle (0..360, e.g. 180). */
	motionBlurShutter: z.number().min(0).max(360).optional(),
	/** 3D rotation around horizontal X axis in degrees. Range: [-180, 180], default: 0 */
	rotateX: z.number().default(0),
	/** 3D rotation around vertical Y axis in degrees. Range: [-180, 180], default: 0 */
	rotateY: z.number().default(0),
	/** 3D rotation around depth Z axis in degrees. Range: [-360, 360], default: 0 */
	rotateZ: z.number().default(0),
	/** Perspective viewing distance in pixels (0 = orthographic / disabled). */
	perspective: z.number().min(0).default(0),
	/** Perspective origin X anchor (0..1, default 0.5). */
	perspectiveOriginX: z.number().default(0.5),
	/** Perspective origin Y anchor (0..1, default 0.5). */
	perspectiveOriginY: z.number().default(0.5),
	/** Translation along depth Z axis in pixels. */
	translateZ: z.number().default(0),
	/** Backface visibility when rotated > 90deg away from camera. */
	backfaceVisibility: z.enum(["visible", "hidden"]).default("visible"),
	/** Transform rendering style (flat buffer vs shared 3D space). */
	transformStyle: z.enum(["flat", "preserve-3d"]).default("flat"),
	/** Whether this layer lives in unified 3D camera space. */
	is3D: z.boolean().default(false),
	/** 3D position Z in pixels. */
	z: z.union([z.number(), z.custom<unknown>()]).default(0),
	/** 3D scale along Z axis. */
	scaleZ: z.number().default(1.0),
	/** Render both front and back faces in 3D passes. */
	twoSided: z.boolean().default(true),
	/** Material shading mode ("lit" | "unlit" | "glass" | "acrylic" | "frosted" | "metallic"). Default "lit". */
	material: MaterialTypeSchema.default("lit"),
	/** Index of Refraction for glass/acrylic (1.0..3.0, default 1.49). */
	ior: z.number().min(1.0).max(3.0).optional(),
	/** Surface roughness factor [0, 1]. */
	roughness: z.number().min(0).max(1).optional(),
	/** Specular shininess / glossiness exponent for Blinn-Phong shading (default 32.0). */
	shininess: z.number().min(1).max(512).default(32.0),
	/** Specular highlight intensity multiplier [0, 10] (default 0.5). */
	specularIntensity: z.number().min(0).default(0.5),
	/** Metallic factor [0, 1]. */
	metallic: z.number().min(0).max(1).optional(),
	/** Ambient light reflection multiplier [0, 10] (default 1.0). */
	ambientIntensity: z.number().min(0).default(1.0),
	/** Glass transmission transparency factor [0, 1]. */
	transmission: z.number().min(0).max(1).optional(),
	/** Chromatic dispersion coefficient for glass refraction bevels. */
	dispersion: z.number().min(0).max(1.0).optional(),
	/** Fresnel rim grazing highlight power [1, 10]. */
	fresnelPower: z.number().min(1.0).max(10.0).optional(),
	/** Environment reflection intensity [0, 10]. */
	envIntensity: z.number().min(0).max(10.0).optional(),
	/** Per-node motion: tracks keyed by node id. */
	animation: LayerAnimationSchema.default({ tracks: [] }),
	/** Vision configuration or effect attached directly to the node. */
	vision: z.unknown().optional(),
	/** Relighting configuration attached directly to the node. */
	relighting: z.unknown().optional(),
} as const;

export interface CompositionNodeBase {
	id: string;
	inputHandleId?: string;
	position?: "relative" | "absolute";
	x?: number | unknown;
	y?: number | unknown;
	width?: SizeSpec;
	height?: SizeSpec;
	grow?: number;
	flexShrink?: number;
	flexBasis?: number;
	alignSelf?: "auto" | "start" | "center" | "end" | "stretch" | "baseline";
	aspectRatio?: number;
	zIndex?: number;
	hidden?: boolean;
	opacity?: number;
	blendMode?: string;
	rotation?: number;
	scale?: number;
	anchorX?: number;
	anchorY?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	perspective?: number;
	perspectiveOriginX?: number;
	perspectiveOriginY?: number;
	translateZ?: number;
	backfaceVisibility?: "visible" | "hidden";
	transformStyle?: "flat" | "preserve-3d";
	is3D?: boolean;
	z?: number | unknown;
	scaleZ?: number;
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	startFrame?: number;
	durationFrames?: number;
	motionBlurShutter?: number;
	animation?: LayerAnimationSpec;
	vision?: unknown;
	relighting?: unknown;
}

export interface FlexNode extends CompositionNodeBase {
	kind: "flex";
	dir?: "row" | "column";
	gap?: number;
	padding?: number;
	justify?: "start" | "center" | "end" | "space-between" | "space-around";
	align?: "start" | "center" | "end" | "stretch";
	wrap?: boolean;
	staggerFrames?: number;
	staggerDirection?: "forward" | "reverse" | "center-out";
	overflow?: "visible" | "hidden";
	background?: string;
	borderRadius?: number;
	borderColor?: string;
	borderWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	strokeRadius?: number;
	children?: LayoutNode[];
}

export interface BlockNode extends CompositionNodeBase {
	kind: "block";
	gap?: number;
	padding?: number;
	align?: "start" | "center" | "end" | "stretch";
	staggerFrames?: number;
	staggerDirection?: "forward" | "reverse" | "center-out";
	overflow?: "visible" | "hidden";
	background?: string;
	borderRadius?: number;
	borderColor?: string;
	borderWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	strokeRadius?: number;
	children?: LayoutNode[];
}

export interface BoxNode extends CompositionNodeBase {
	kind: "box";
	background?: string;
	borderRadius?: number;
	padding?: number;
	staggerFrames?: number;
	staggerDirection?: "forward" | "reverse" | "center-out";
	overflow?: "visible" | "hidden";
	borderColor?: string;
	borderWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	strokeRadius?: number;
	children?: LayoutNode[];
}

export const TextShadowSchema = z
	.object({
		color: ColorSchema,
		offset: z
			.object({
				x: z.number(),
				y: z.number(),
			})
			.optional(),
		blurRadius: z.number().min(0).optional(),
	})
	.strict();
export type TextShadow = z.infer<typeof TextShadowSchema>;

export const TextAnimatorTransformSchema = z
	.object({
		x: z.number().optional(),
		y: z.number().optional(),
		scale: z.number().optional(),
		scaleX: z.number().optional(),
		scaleY: z.number().optional(),
		rotation: z.number().optional(),
		rotationX: z.number().optional(),
		rotationY: z.number().optional(),
		opacity: z.number().optional(),
		blur: z.number().optional(),
		color: z.string().optional(),
	})
	.strict();
export type TextAnimatorTransform = z.infer<typeof TextAnimatorTransformSchema>;

export const TextAnimatorSchema = z.object({
	id: z.string(),
	unit: z.enum(["character", "word", "line"]).default("character"),
	rangeStart: z.number().min(0).max(1).default(0),
	rangeEnd: z.number().min(0).max(1).default(1),
	offset: z.number().min(-1).max(1).default(0),
	easing: z.string().default("power2.out"),
	transform: TextAnimatorTransformSchema.optional(),
});
export type TextAnimator = z.infer<typeof TextAnimatorSchema>;

export const TextAnimator = {
	/**
	 * Per-character staggered wave rise with baseline tilt and fade.
	 */
	waveRise(
		options: {
			id?: string;
			unit?: "character" | "word" | "line";
			y?: number;
			rotationX?: number;
			opacity?: number;
			blur?: number;
			easing?: string;
			rangeStart?: number;
			rangeEnd?: number;
			offset?: number;
		} = {},
	): TextAnimator {
		return {
			id: options.id ?? "wave-rise",
			unit: options.unit ?? "character",
			rangeStart: options.rangeStart ?? 0,
			rangeEnd: options.rangeEnd ?? 1,
			offset: options.offset ?? -1,
			easing: options.easing ?? "power2.out",
			transform: {
				y: options.y ?? 40,
				rotationX: options.rotationX ?? 45,
				opacity: options.opacity ?? 0,
				blur: options.blur ?? 0,
			},
		};
	},

	/**
	 * Per-word or per-character pop / scale bounce.
	 */
	wordPop(
		options: { id?: string; scale?: number; y?: number; easing?: string } = {},
	): TextAnimator {
		return {
			id: options.id ?? "word-pop",
			unit: "word",
			rangeStart: 0,
			rangeEnd: 1,
			offset: -1,
			easing: options.easing ?? "back.out(1.6)",
			transform: {
				scale: options.scale ?? 0,
				y: options.y ?? 20,
				opacity: 0,
			},
		};
	},

	/**
	 * Per-character cinematic optical blur to crisp reveal.
	 */
	blurIn(
		options: {
			id?: string;
			unit?: "character" | "word";
			blur?: number;
			y?: number;
			opacity?: number;
			easing?: string;
		} = {},
	): TextAnimator {
		return {
			id: options.id ?? "blur-in",
			unit: options.unit ?? "character",
			rangeStart: 0,
			rangeEnd: 1,
			offset: -1,
			easing: options.easing ?? "power3.out",
			transform: {
				blur: options.blur ?? 16,
				y: options.y ?? 20,
				opacity: options.opacity ?? 0,
			},
		};
	},

	/**
	 * 3D letter flip (like airport split-flap display or 3D letter roll).
	 */
	flip3D(
		options: {
			id?: string;
			unit?: "character" | "word";
			rotationX?: number;
			easing?: string;
		} = {},
	): TextAnimator {
		return {
			id: options.id ?? "flip-3d",
			unit: options.unit ?? "character",
			rangeStart: 0,
			rangeEnd: 1,
			offset: -1,
			easing: options.easing ?? "back.out(1.4)",
			transform: {
				rotationX: options.rotationX ?? 90,
				opacity: 0,
			},
		};
	},

	/**
	 * Color sweep passing across glyphs/words.
	 */
	colorSweep(options: {
		id?: string;
		color: string;
		unit?: "character" | "word";
		easing?: string;
	}): TextAnimator {
		return {
			id: options.id ?? "color-sweep",
			unit: options.unit ?? "character",
			rangeStart: 0,
			rangeEnd: 0.5,
			offset: -0.5,
			easing: options.easing ?? "power2.inOut",
			transform: {
				color: options.color,
			},
		};
	},
};

export interface TextNode extends CompositionNodeBase {
	kind: "text";
	text?: string;
	spans?: TextSpan[];
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: number | string;
	fontStyle?: string;
	fill?: string;
	align?: "start" | "center" | "end";
	verticalAlign?: "top" | "middle" | "bottom";
	lineHeight?: number;
	letterSpacing?: number;
	background?: string;
	borderRadius?: number;
	padding?: number;
	stroke?: string;
	strokeWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	textShadow?: string;
	shadows?: TextShadow[];
	pathOptions?: TextPathOptions;
	typewriter?: TypewriterAnimator;
	marquee?: KineticMarqueeConfig;
	animators?: (TextAnimator | AETextAnimator | AdvancedTextAnimator)[];
}

export interface MediaNode extends CompositionNodeBase {
	kind: "media";
	inputHandleId: string;
	dataType?: string;
	fit?: "cover" | "contain" | "fill" | "none";
	borderRadius?: number;
	borderColor?: string;
	borderWidth?: number;
	strokeAlign?: "inside" | "center" | "outside";
	strokeRadius?: number;
	volume?: number;
	muted?: boolean;
	/** Source in-point: seconds into the clip that play at the layer's startFrame. */
	trimStartSec?: number;
	// Caption styling
	fontFamily?: string;
	fontSize?: number;
	fontWeight?: number | string;
	fontStyle?: string;
	fill?: string;
	align?: "start" | "center" | "end";
	verticalAlign?: "top" | "middle" | "bottom";
	lineHeight?: number;
	letterSpacing?: number;
	background?: string;
	padding?: number;
	stroke?: string;
	strokeWidth?: number;
	textShadow?: string;
	shadows?: TextShadow[];
	maxWidth?: number;
}

export interface ShapeNode extends CompositionNodeBase {
	kind: "shape";
	shapeType?: ShapeType;
	borderRadius?: number;
	radiusTL?: number;
	radiusTR?: number;
	radiusBR?: number;
	radiusBL?: number;
	polygonSides?: number;
	starPoints?: number;
	starInnerRadiusRatio?: number;
	arrowHeadWidth?: number;
	arrowHeadLength?: number;
	arrowShaftWidth?: number;
	d?: string;
	fillType?: "solid" | "linear" | "radial" | "none";
	fillColor?: string;
	gradientEndColor?: string;
	gradientAngle?: number;
	strokeColor?: string;
	strokeWidth?: number;
	strokeDashArray?: string;
	strokeDashOffset?: number;
	strokeLineCap?: "butt" | "round" | "square";
	strokeLineJoin?: "miter" | "round" | "bevel";
	strokeAlign?: "inside" | "center" | "outside";
	trimStart?: number;
	trimEnd?: number;
	trimOffset?: number;
}

export const CameraLensSchema = z
	.object({
		focalLength: z.number().min(5).max(500).default(50),
		fov: z.number().min(5).max(160).optional(),
		sensorWidth: z.number().default(36),
		near: z.number().min(0.1).default(1),
		far: z.number().min(10).default(50000),
		zoom: z.number().min(0.01).default(1.0),
	})
	.strict();

export type CameraLens = z.infer<typeof CameraLensSchema>;

export const CameraDoFSchema = z
	.object({
		enabled: z.boolean().default(false),
		focusDistance: z.number().min(1).default(1000),
		fStop: z.number().min(0.5).max(64).default(2.8),
		maxBlurRadius: z.number().min(0).max(128).default(32),
		apertureBlades: z.number().int().min(0).max(12).default(0),
		anamorphicRatio: z.number().min(0.5).max(3.0).default(1.0),
	})
	.strict();

/** Depth of field as authored: fields with schema defaults may be left out. */
export type CameraDoF = z.input<typeof CameraDoFSchema>;

export const CameraShakeSchema = z
	.object({
		translationAmplitude: z.number().min(0).default(0),
		rotationAmplitude: z.number().min(0).default(0),
		frequency: z.number().min(0.1).max(60).default(2.5),
		octaves: z.number().int().min(1).max(6).default(3),
		seed: z.number().default(42),
	})
	.strict();

export type CameraShake = z.infer<typeof CameraShakeSchema>;

export interface CameraNode {
	id: string;
	kind: "camera";
	mode?: "lookAt" | "free" | "orbit";
	x?: number;
	y?: number;
	z?: number;
	targetX?: number;
	targetY?: number;
	targetZ?: number;
	pitch?: number;
	yaw?: number;
	roll?: number;
	lens?: CameraLens;
	dof?: CameraDoF;
	shake?: CameraShake;
	startFrame?: number;
	durationFrames?: number;
	animation?: LayerAnimationSpec;
}

export const CameraNodeSchema: z.ZodType<CameraNode> = z
	.object({
		id: z.string().min(1),
		kind: z.literal("camera"),
		mode: z.enum(["lookAt", "free", "orbit"]).default("lookAt"),
		x: z.number().optional(),
		y: z.number().optional(),
		z: z.number().optional(),
		targetX: z.number().optional(),
		targetY: z.number().optional(),
		targetZ: z.number().optional(),
		pitch: z.number().default(0),
		yaw: z.number().default(0),
		roll: z.number().default(0),
		lens: CameraLensSchema.optional(),
		dof: CameraDoFSchema.optional(),
		shake: CameraShakeSchema.optional(),
		startFrame: z.number().int().min(0).default(0),
		durationFrames: z.number().int().min(1).optional(),
		animation: LayerAnimationSchema.default({ tracks: [] }),
	})
	.strict() as unknown as z.ZodType<CameraNode>;

export type LightType = "ambient" | "directional" | "point" | "spot";
export const LightTypeSchema = z.enum([
	"ambient",
	"directional",
	"point",
	"spot",
]);

export interface LightNode {
	id: string;
	kind: "light";
	lightType?: LightType;
	color?: string;
	intensity?: number;
	x?: number;
	y?: number;
	z?: number;
	targetX?: number;
	targetY?: number;
	targetZ?: number;
	direction?: [number, number, number];
	radius?: number;
	decay?: number;
	angle?: number;
	penumbra?: number;
	startFrame?: number;
	durationFrames?: number;
	animation?: LayerAnimationSpec;
}

export const LightNodeSchema: z.ZodType<LightNode> = z
	.object({
		id: z.string().min(1),
		kind: z.literal("light"),
		lightType: LightTypeSchema.default("directional"),
		color: ColorSchema.default("#ffffff"),
		intensity: z.number().default(1.0),
		x: z.number().optional(),
		y: z.number().optional(),
		z: z.number().optional(),
		targetX: z.number().optional(),
		targetY: z.number().optional(),
		targetZ: z.number().optional(),
		direction: z.tuple([z.number(), z.number(), z.number()]).optional(),
		radius: z.number().min(0).default(1000),
		decay: z.number().min(0).default(2.0),
		angle: z.number().min(0).max(180).default(45),
		penumbra: z.number().min(0).max(1).default(0.2),
		startFrame: z.number().int().min(0).default(0),
		durationFrames: z.number().int().min(1).optional(),
		animation: LayerAnimationSchema.default({ tracks: [] }),
	})
	.strict() as unknown as z.ZodType<LightNode>;

export interface Model3DNode {
	id: string;
	kind: "model3d";
	src?: string;
	modelFormat?:
		| "obj"
		| "fbx"
		| "gltf"
		| "glb"
		| "stl"
		| "ply"
		| "vox"
		| "3ds"
		| "off"
		| "auto";
	modelData?: unknown;
	animationName?: string;
	animationProgress?: number;
	animationTime?: number;
	animationSpeed?: number;
	loop?: boolean;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
	color?: string;
	colorTint?: string;
	opacity?: number;
	twoSided?: boolean;
	wireframe?: boolean;
	is3D?: boolean;
	texture?: string;
	center?: boolean;
	normalizeSize?: number;
	startFrame?: number;
	durationFrames?: number;
	animation?: LayerAnimationSpec;
	audioDeform?: MeshAudioDeformConfig;
	text3dOptions?: unknown;
}

export type LayoutNode =
	| FlexNode
	| BlockNode
	| BoxNode
	| TextNode
	| MediaNode
	| ShapeNode
	| CameraNode
	| LightNode
	| Model3DNode;

export const containerChildren = (): z.ZodType<LayoutNode[]> =>
	z.array(z.lazy((): z.ZodType<LayoutNode> => LayoutNodeSchema));

export const FlexNodeSchema: z.ZodType<FlexNode> = z
	.object({
		...BaseNodeFields,
		kind: z.literal("flex"),
		dir: z.enum(["row", "column"]).default("row"),
		gap: z.number().min(0).default(0),
		padding: z.number().min(0).default(0),
		justify: z
			.enum(["start", "center", "end", "space-between", "space-around"])
			.default("start"),
		align: z.enum(["start", "center", "end", "stretch"]).default("start"),
		wrap: z.boolean().default(false),
		staggerFrames: z.number().min(0).default(0),
		staggerDirection: z
			.enum(["forward", "reverse", "center-out"])
			.default("forward"),
		overflow: z.enum(["visible", "hidden"]).default("hidden"),
		background: ColorSchema.optional(),
		borderRadius: z.number().min(0).optional(),
		borderColor: ColorSchema.optional(),
		borderWidth: z.number().min(0).optional(),
		strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
		strokeRadius: z.number().min(0).optional(),
		children: containerChildren().optional(),
	})
	.strict() as unknown as z.ZodType<FlexNode>;

export const BlockNodeSchema: z.ZodType<BlockNode> = z
	.object({
		...BaseNodeFields,
		kind: z.literal("block"),
		gap: z.number().min(0).default(0),
		padding: z.number().min(0).default(0),
		align: z.enum(["start", "center", "end", "stretch"]).default("start"),
		staggerFrames: z.number().min(0).default(0),
		staggerDirection: z
			.enum(["forward", "reverse", "center-out"])
			.default("forward"),
		overflow: z.enum(["visible", "hidden"]).default("hidden"),
		background: ColorSchema.optional(),
		borderRadius: z.number().min(0).optional(),
		borderColor: ColorSchema.optional(),
		borderWidth: z.number().min(0).optional(),
		strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
		strokeRadius: z.number().min(0).optional(),
		children: containerChildren().optional(),
	})
	.strict() as unknown as z.ZodType<BlockNode>;

export const BoxNodeSchema: z.ZodType<BoxNode> = z
	.object({
		...BaseNodeFields,
		kind: z.literal("box"),
		/** Fill color of the rectangle (DSL `fill:` on box). */
		background: ColorSchema,
		borderRadius: z.number().min(0).optional(),
		padding: z.number().min(0).default(0),
		staggerFrames: z.number().min(0).default(0),
		staggerDirection: z
			.enum(["forward", "reverse", "center-out"])
			.default("forward"),
		overflow: z.enum(["visible", "hidden"]).default("hidden"),
		borderColor: ColorSchema.optional(),
		borderWidth: z.number().min(0).optional(),
		strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
		strokeRadius: z.number().min(0).optional(),
		children: containerChildren().optional(),
	})
	.strict() as unknown as z.ZodType<BoxNode>;

export const TextSpanMarkSchema = z
	.object({
		background: ColorSchema,
		borderRadius: z.number().min(0).optional(),
		paddingX: z.number().min(0).optional(),
		paddingY: z.number().min(0).optional(),
	})
	.strict();

export const TextSpanSchema = z
	.object({
		text: z.union([
			z.string(),
			z.custom<{ get: (ctx?: unknown) => string }>((v) =>
				Boolean(v && typeof v === "object" && "get" in v),
			),
		]),
		fontFamily: z.string().optional(),
		fontSize: z
			.union([
				z.number().positive(),
				z.custom<{ get: (ctx?: unknown) => number }>((v) =>
					Boolean(v && typeof v === "object" && "get" in v),
				),
			])
			.optional(),
		fontWeight: z.union([z.number().int(), z.string()]).optional(),
		fontStyle: z.enum(["normal", "italic"]).optional(),
		fill: z
			.union([
				ColorSchema,
				z.custom<{ get: (ctx?: unknown) => string }>((v) =>
					Boolean(v && typeof v === "object" && "get" in v),
				),
			])
			.optional(),
		letterSpacing: z.number().optional(),
		baselineShift: z.number().optional(),
		opacity: z
			.union([
				z.number().min(0).max(1),
				z.custom<{ get: (ctx?: unknown) => number }>((v) =>
					Boolean(v && typeof v === "object" && "get" in v),
				),
			])
			.optional(),
		mark: TextSpanMarkSchema.optional(),
	})
	.strict();

const TextFields = {
	text: z.string().default(""),
	spans: z.array(TextSpanSchema).optional(),
	fontFamily: z.string().optional(),
	fontSize: z.number().positive().optional(),
	fontWeight: z.union([z.number().int(), z.string()]).optional(),
	fontStyle: z.string().optional(),
	/** Text color (v1 name kept). */
	fill: ColorSchema,
	align: z.enum(["start", "center", "end"]).optional(),
	verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
	lineHeight: z.number().positive().optional(),
	letterSpacing: z.number().optional(),
	background: ColorSchema,
	borderRadius: z.number().min(0).optional(),
	padding: z.number().min(0).optional(),
	stroke: ColorSchema,
	strokeWidth: z.number().min(0).optional(),
	strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
	textShadow: z.string().optional(),
	shadows: z.array(TextShadowSchema).optional(),
	pathOptions: TextPathOptionsSchema.optional(),
	typewriter: TypewriterAnimatorSchema.optional(),
	marquee: KineticMarqueeConfigSchema.optional(),
	animators: z
		.array(
			z.union([
				TextAnimatorSchema,
				AETextAnimatorSchema,
				AdvancedTextAnimatorSchema,
			]),
		)
		.optional(),
} as const;

export const TextNodeSchema: z.ZodType<TextNode> = z
	.object({
		...BaseNodeFields,
		...TextFields,
		kind: z.literal("text"),
	})
	.strict() as unknown as z.ZodType<TextNode>;

export const MediaNodeSchema: z.ZodType<MediaNode> = z
	.object({
		...BaseNodeFields,
		kind: z.literal("media"),
		/** Graph binding — which connected input this node renders. */
		inputHandleId: z.string().min(1),
		dataType: z.string().optional(),
		fit: z.enum(["cover", "contain", "fill", "none"]).default("contain"),
		borderRadius: z.number().min(0).optional(),
		borderColor: ColorSchema.optional(),
		borderWidth: z.number().min(0).optional(),
		strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
		strokeRadius: z.number().min(0).optional(),
		volume: z.number().min(0).max(1).default(1),
		muted: z.boolean().default(false),
		trimStartSec: z.number().min(0).optional(),
		// Caption styling
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
		fontWeight: z.union([z.number().int(), z.string()]).optional(),
		fontStyle: z.string().optional(),
		fill: ColorSchema,
		align: z.enum(["start", "center", "end"]).optional(),
		verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
		lineHeight: z.number().positive().optional(),
		letterSpacing: z.number().optional(),
		background: ColorSchema,
		padding: z.number().min(0).optional(),
		stroke: ColorSchema,
		strokeWidth: z.number().min(0).optional(),
		textShadow: z.string().optional(),
		shadows: z.array(TextShadowSchema).optional(),
		maxWidth: z.number().optional(),
	})
	.strict() as unknown as z.ZodType<MediaNode>;

export const ShapeFields = {
	shapeType: ShapeTypeSchema.default("rect"),
	borderRadius: z.number().min(0).optional(),
	radiusTL: z.number().min(0).optional(),
	radiusTR: z.number().min(0).optional(),
	radiusBR: z.number().min(0).optional(),
	radiusBL: z.number().min(0).optional(),
	polygonSides: z.number().int().min(3).max(64).optional(),
	starPoints: z.number().int().min(3).max(64).optional(),
	starInnerRadiusRatio: z.number().min(0.01).max(0.99).optional(),
	arrowHeadWidth: z.number().min(0).optional(),
	arrowHeadLength: z.number().min(0).optional(),
	arrowShaftWidth: z.number().min(1).optional(),
	d: z.string().optional(),
	fillType: z.enum(["solid", "linear", "radial", "none"]).default("solid"),
	fillColor: ColorSchema.default("#3b82f6"),
	gradientEndColor: ColorSchema.optional(),
	gradientAngle: z.number().default(0),
	strokeColor: ColorSchema.default("#ffffff"),
	strokeWidth: z.number().min(0).default(0),
	strokeDashArray: z.string().optional(),
	strokeDashOffset: z.number().default(0),
	strokeLineCap: z.enum(["butt", "round", "square"]).default("round"),
	strokeLineJoin: z.enum(["miter", "round", "bevel"]).default("round"),
	strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
	trimStart: z.number().min(0).max(1).default(0),
	trimEnd: z.number().min(0).max(1).default(1),
	trimOffset: z.number().default(0),
} as const;

export const ShapeNodeSchema: z.ZodType<ShapeNode> = z
	.object({
		...BaseNodeFields,
		...ShapeFields,
		kind: z.literal("shape"),
	})
	.strict() as unknown as z.ZodType<ShapeNode>;

export const ColorStopSchema = z.object({
	offset: z.number().min(0).max(1),
	color: z.string(),
});
export type ColorStop = z.infer<typeof ColorStopSchema>;

export const Model3DNodeSchema: z.ZodType<Model3DNode> = z
	.object({
		...BaseNodeFields,
		kind: z.literal("model3d"),
		src: z.string().default(""),
		modelFormat: z
			.enum([
				"obj",
				"fbx",
				"gltf",
				"glb",
				"stl",
				"ply",
				"vox",
				"3ds",
				"off",
				"auto",
			])
			.default("auto"),
		modelData: z.unknown().optional(),
		animationName: z.string().optional(),
		animationProgress: z.number().min(0).max(1).default(0),
		animationTime: z.number().min(0).default(0),
		animationSpeed: z.number().default(1.0),
		loop: z.boolean().default(true),
		wireframe: z.boolean().default(false),
		texture: z.string().optional(),
		center: z.boolean().optional(),
		normalizeSize: z.number().optional(),
		scaleX: z.number().default(1.0),
		scaleY: z.number().default(1.0),
		audioDeform: z.record(z.string(), z.unknown()).optional(),
		text3dOptions: z.unknown().optional(),
	})
	.strict() as unknown as z.ZodType<Model3DNode>;

export const LayoutNodeSchema = z.lazy(() =>
	z.union([
		FlexNodeSchema,
		BlockNodeSchema,
		BoxNodeSchema,
		TextNodeSchema,
		MediaNodeSchema,
		ShapeNodeSchema,
		CameraNodeSchema,
		LightNodeSchema,
		Model3DNodeSchema,
	]),
) as unknown as z.ZodType<LayoutNode>;

// ── the program document ──────────────────────────────────────────────

export const CompositorProgramSchema = z
	.object({
		width: z.number().int().min(1).max(4096),
		height: z.number().int().min(1).max(4096),
		backgroundColor: ColorSchema,
		volume: z.number().min(0).max(1).default(1),
		fps: z.number().int().min(1).max(120).default(24),
		mode: z.enum(["Video", "Image"]).default("Video"),
		/**
		 * Multisample the 3D pass (4 samples per pixel) so mesh edges are smooth.
		 * Default true; false saves the extra target memory (~60-125 MB at 1080p).
		 */
		antialias3d: z.boolean().optional(),
		layout: z.array(LayoutNodeSchema).default([]),
		fonts: z.array(z.string()).optional(),
		signals: z.record(z.string(), z.unknown()).optional(),
		/** Composition-wide effect chain (`comp.apply(effect)`); resolved to operations downstream. */
		effects: z.array(z.unknown()).optional(),
		/** Composition-wide vision config or bundle. */
		vision: z.unknown().optional(),
		/** Per-frame notification hook. */
		onRequestFrame: z.custom<unknown>().optional(),
	})
	.strict();

export type CompositorProgramConfig = z.infer<typeof CompositorProgramSchema>;
