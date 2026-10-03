/**
 * @file packages/webgpu-renderers/src/text-animations/advanced-types.ts
 * Data contracts and Zod schemas for Advanced Motion Design & After Effects Extended Typography Engine.
 */

import { z } from "zod";

// ==============================================================================================
// 1. ANCHOR POINT GROUPING & CUSTOM PIVOT ALIGNMENT
// ==============================================================================================

export const AnchorGroupingSchema = z.enum([
	"character",
	"word",
	"line",
	"all",
]);
export type AnchorGrouping = z.infer<typeof AnchorGroupingSchema>;

export const AnchorPresetSchema = z.enum([
	"center",
	"baseline",
	"bottom_left",
	"bottom_center",
	"bottom_right",
	"top_left",
	"top_center",
	"top_right",
	"custom",
]);
export type AnchorPreset = z.infer<typeof AnchorPresetSchema>;

export const TextAnchorConfigSchema = z.object({
	/** Grouping scope */
	grouping: AnchorGroupingSchema.default("character"),
	/** Preset pivot location */
	preset: AnchorPresetSchema.default("center"),
	/** Normalized horizontal anchor point (0 = left, 0.5 = center, 1 = right) */
	anchorX: z.number().default(0.5),
	/** Normalized vertical anchor point (0 = top, 0.5 = middle, 1 = baseline/bottom) */
	anchorY: z.number().default(0.5),
	/** Pixel offset added to the calculated anchor point */
	offsetX: z.number().default(0),
	offsetY: z.number().default(0),
});
export type TextAnchorConfig = z.infer<typeof TextAnchorConfigSchema>;

// ==============================================================================================
// 2. DIRECTIONAL SKEW & SKEW AXIS
// ==============================================================================================

export const SkewPropertiesSchema = z.object({
	/** Skew angle in degrees (-90 to +90). Positive shears to the right. */
	skew: z.number().min(-90).max(90),
	/** Skew axis angle in degrees (0 to 360). 0 = horizontal shear, 90 = vertical shear. */
	skewAxis: z.number().default(0),
});
export type SkewProperties = z.infer<typeof SkewPropertiesSchema>;

// ==============================================================================================
// 3. DYNAMIC LINE SPACING (LEADING) & LINE ANCHORS
// ==============================================================================================

export const LineSpacingDynamicsSchema = z.object({
	/** Additional inter-line leading offset in pixels (can be negative for overlap). */
	lineSpacing: z.number(),
	/**
	 * Normalized line anchor defining the stationary pivot line:
	 * 0.0 = Top line remains stationary, subsequent lines push downwards.
	 * 0.5 = Center line remains stationary, lines expand outward symmetrically (accordion).
	 * 1.0 = Bottom line remains stationary, upper lines push upwards.
	 */
	lineAnchor: z.number().min(0).max(1).default(0),
});
export type LineSpacingDynamics = z.infer<typeof LineSpacingDynamicsSchema>;

// ==============================================================================================
// 4. PER-CHARACTER 3D SPATIAL DEPTH & VOLUMETRIC FORMATIONS
// ==============================================================================================

export const VolumetricFormationModeSchema = z.enum([
	"planar", // Individual translateZ camera depth offset
	"vortex", // Logarithmic spiral into the screen along Z axis
	"cylinder", // Cylindrical drum carousel around horizontal or vertical axis
	"helix", // 3D corkscrew DNA helix twisting along an axis
]);
export type VolumetricFormationMode = z.infer<
	typeof VolumetricFormationModeSchema
>;

export const VolumetricFormationConfigSchema = z.object({
	mode: VolumetricFormationModeSchema.default("planar"),
	/** Radius for cylinder / vortex / helix in pixels */
	radius: z.number().default(300),
	/** Pitch / axial spacing per revolution for helix / vortex in pixels */
	pitch: z.number().default(120),
	/** Total angular rotation across all characters in degrees */
	totalAngle: z.number().default(360),
	/** Cylinder rotation axis */
	axis: z.enum(["x", "y", "z"]).default("y"),
	/** Perspective distance in pixels (defaults to 1200) */
	perspective: z.number().positive().default(1200),
});
export type VolumetricFormationConfig = z.infer<
	typeof VolumetricFormationConfigSchema
>;

export const Spatial3DPropertiesSchema = z.object({
	/** Translation along the camera Z axis (pixels; positive = towards camera) */
	translateZ: z.number().optional(),
	/** Rotation around the 3D X axis in degrees (flip-down pitch) */
	rotationX: z.number().optional(),
	/** Rotation around the 3D Y axis in degrees (card-turn yaw) */
	rotationY: z.number().optional(),
	/** Rotation around the 3D Z axis in degrees (planar roll) */
	rotationZ: z.number().optional(),
	/** Volumetric 3D arrangement configuration */
	formation: VolumetricFormationConfigSchema.optional(),
});
export type Spatial3DProperties = z.infer<typeof Spatial3DPropertiesSchema>;

// ==============================================================================================
// 5. INERTIAL SPRING & ELASTIC BOUNCE PHYSICS
// ==============================================================================================

export const SpringPhysicsSchema = z.object({
	/** Spring stiffness constant (k > 0). Higher values oscillate faster. Default: 180. */
	stiffness: z.number().positive().default(180),
	/** Damping coefficient (c > 0). Controls energy dissipation. Default: 12. */
	damping: z.number().positive().default(12),
	/** Mass of each glyph (m > 0). Heavier glyphs have more inertia. Default: 1.0. */
	mass: z.number().positive().default(1.0),
	/** Initial velocity imparted on the glyph upon selector contact. Default: 0. */
	initialVelocity: z.number().default(0),
	/** Optional elastic overshoot factor multiplier (> 1 boosts bounce). Default: 1.0. */
	overshootMultiplier: z.number().min(0.5).max(3.0).default(1.0),
});
export type SpringPhysics = z.infer<typeof SpringPhysicsSchema>;

// ==============================================================================================
// 6. EXPRESSION SELECTORS (PROGRAMMATIC PER-GLYPH EVALUATION)
// ==============================================================================================

export interface ExpressionEvaluationContext {
	/** 0-based index of the current character */
	charIndex: number;
	/** 0-based index of the current word */
	wordIndex: number;
	/** 0-based index of the current line */
	lineIndex: number;
	/** Total count of characters in paragraph */
	totalChars: number;
	/** Total count of words in paragraph */
	totalWords: number;
	/** Total count of lines in paragraph */
	totalLines: number;
	/** Current timeline frame number */
	frame: number;
	/** Timeline frame rate */
	fps: number;
	/** Current timeline timestamp in seconds */
	time: number;
	/** Bound reactive signals map */
	signals?: Record<string, unknown>;
}

export const ExpressionSelectorSchema = z.object({
	type: z.literal("expression"),
	name: z.string().optional(),
	/**
	 * Mathematical formula expression string.
	 * Available variables: textIndex, textTotal, wordIndex, wordTotal, lineIndex, lineTotal, time, frame, fps, sin, cos, abs, min, max, clamp, noise.
	 */
	expression: z.string(),
	/** Selection combination mode with prior selectors in stack */
	mode: z
		.enum(["add", "subtract", "intersect", "min", "max", "difference"])
		.default("add"),
	/** Amount multiplier applied to output weight */
	amount: z.number().default(1.0),
});
export type ExpressionSelector = z.infer<typeof ExpressionSelectorSchema>;

// ==============================================================================================
// 7. DYNAMIC STROKE & WIREFRAME EXPANSION
// ==============================================================================================

export const DynamicStrokePropertiesSchema = z.object({
	/** Stroke outline thickness in pixels */
	strokeWidth: z.number().min(0).default(0),
	/** Stroke outline color in hex/rgb */
	strokeColor: z.string().default("#ffffff"),
	/** Stroke alignment relative to glyph boundary */
	strokeAlign: z.enum(["center", "inside", "outside"]).default("center"),
	/** Fill opacity (0 = transparent wireframe, 1 = fully filled solid) */
	fillOpacity: z.number().min(0).max(1).default(1.0),
	/** Dashed stroke pattern: [dashLength, gapLength] in pixels */
	dashArray: z.tuple([z.number(), z.number()]).optional(),
	/** Dashed stroke animated offset in pixels */
	dashOffset: z.number().default(0),
});
export type DynamicStrokeProperties = z.infer<
	typeof DynamicStrokePropertiesSchema
>;

// ==============================================================================================
// 8. INFINITE KINETIC MARQUEE & CYLINDRICAL DRUM (SLOT MACHINE)
// ==============================================================================================

export const KineticMarqueeConfigSchema = z.object({
	/** Motion flow direction */
	direction: z.enum(["left", "right", "up", "down"]).default("left"),
	/** Continuous scroll velocity in pixels per second */
	velocity: z.number().default(120),
	/** Seamless loop wrapping within container bounds */
	loop: z.boolean().default(true),
	/** Gap between looping text duplicates in pixels */
	repeatGap: z.number().default(80),
	/**
	 * Slot Machine / Drum Snap:
	 * When enabled, scrolling decelerates and snaps to discrete character or word boundaries.
	 */
	snap: z
		.object({
			enabled: z.boolean().default(false),
			/** Granularity of snap stops */
			granularity: z.enum(["character", "word", "line"]).default("word"),
			/** Target stop index */
			stopIndex: z.number().default(0),
			/** Deceleration easing curve name */
			decelEase: z.string().default("cubic.out"),
		})
		.optional(),
});
export type KineticMarqueeConfig = z.infer<typeof KineticMarqueeConfigSchema>;

// ==============================================================================================
// 9. KINETIC VARIABLE FONT AXIS MODULATION
// ==============================================================================================

export const VariableFontAxesSchema = z.object({
	/** Weight axis ('wght'): 100 (Thin) to 900 (Black) */
	weight: z.number().min(100).max(1000).optional(),
	/** Width axis ('wdth'): 50% (Ultra-Condensed) to 200% (Ultra-Expanded) */
	width: z.number().min(50).max(200).optional(),
	/** Slant axis ('slnt'): -15 to +15 degrees */
	slant: z.number().min(-25).max(25).optional(),
	/** Italic binary axis ('ital'): 0 or 1 */
	italic: z.number().min(0).max(1).optional(),
	/** Optical size axis ('opsz'): 6 to 72 points */
	opticalSize: z.number().min(6).max(144).optional(),
});
export type VariableFontAxes = z.infer<typeof VariableFontAxesSchema>;

// ==============================================================================================
// 10. HIGH-END GPU & SHADER-NATIVE TYPOGRAPHY (VFX PAYLOAD)
// ==============================================================================================

export const ChromaticGlitchConfigSchema = z.object({
	/** Horizontal red-channel displacement offset in pixels */
	redShiftX: z.number().default(0),
	/** Vertical red-channel displacement offset in pixels */
	redShiftY: z.number().default(0),
	/** Horizontal blue-channel displacement offset in pixels */
	blueShiftX: z.number().default(0),
	/** Vertical blue-channel displacement offset in pixels */
	blueShiftY: z.number().default(0),
	/** Random slice scanline displacement probability per frame (0 to 1) */
	sliceProbability: z.number().min(0).max(1).default(0),
	/** Maximum slice pixel displacement */
	sliceAmplitude: z.number().default(0),
});
export type ChromaticGlitchConfig = z.infer<typeof ChromaticGlitchConfigSchema>;

export const AudioSpectrumTypographySchema = z.object({
	/** Audio stem or FFT signal registry channel name */
	signalChannel: z.string(),
	/** Minimum audio frequency in Hz mapped to the first glyph */
	minFreqHz: z.number().default(60),
	/** Maximum audio frequency in Hz mapped to the last glyph */
	maxFreqHz: z.number().default(16000),
	/** Scale axis to modulate */
	scaleAxis: z.enum(["scaleY", "scaleX", "scale", "y"]).default("scaleY"),
	/** Minimum scale factor at silence */
	minScale: z.number().default(0.2),
	/** Maximum scale factor at peak magnitude */
	maxScale: z.number().default(2.5),
	/** Peak decay smoothing (0 = instantaneous, 0.9 = long decay) */
	peakDecay: z.number().min(0).max(0.99).default(0.8),
});
export type AudioSpectrumTypography = z.infer<
	typeof AudioSpectrumTypographySchema
>;

export const LongShadowConfigSchema = z.object({
	/** Projection angle in degrees (e.g. 45 = bottom-right, 135 = bottom-left) */
	angle: z.number().default(45),
	/** Shadow extrusion length in pixels */
	length: z.number().min(0).default(0),
	/** Shadow color in hex/rgb */
	color: z.string().default("#000000"),
	/** Shadow start opacity (0 to 1) */
	startOpacity: z.number().min(0).max(1).default(0.8),
	/** Shadow terminal opacity (0 to 1, default 0 for soft fade) */
	endOpacity: z.number().min(0).max(1).default(0.0),
	/** Number of extrusion shadow slices (higher = smoother, 4 to 64) */
	steps: z.number().int().min(4).max(64).default(16),
});
export type LongShadowConfig = z.infer<typeof LongShadowConfigSchema>;

export const ParticleDissolveConfigSchema = z.object({
	/** Dissolution progress (0 = solid glyph, 1 = fully disintegrated into particles) */
	progress: z.number().min(0).max(1).default(0),
	/** Dispersal directional angle in degrees (e.g. 90 = drifting upwards) */
	dispersalAngle: z.number().default(90),
	/** Maximum dispersal displacement distance in pixels */
	maxDisplacement: z.number().default(120),
	/** Turbulence noise frequency for erratic particle paths */
	turbulence: z.number().default(0.5),
	/** Particle size in pixels */
	particleSize: z.number().default(2.0),
});
export type ParticleDissolveConfig = z.infer<
	typeof ParticleDissolveConfigSchema
>;

// ==============================================================================================
// 11. UNIFIED EXTENDED ANIMATOR PROPERTY CONTRACT
// ==============================================================================================

export const ExtendedGlyphPropertiesSchema = z.object({
	// Spatial 2D & 3D
	x: z.number().optional(),
	y: z.number().optional(),
	translateZ: z.number().optional(),
	scale: z.number().optional(),
	scaleX: z.number().optional(),
	scaleY: z.number().optional(),
	rotation: z.number().optional(),
	rotationX: z.number().optional(),
	rotationY: z.number().optional(),
	rotationZ: z.number().optional(),
	skew: z.number().optional(),
	skewAxis: z.number().optional(),

	// Typography & Metrics
	tracking: z.number().optional(),
	lineSpacing: z.number().optional(),
	lineAnchor: z.number().optional(),
	anchor: TextAnchorConfigSchema.optional(),

	// Optical & Material
	opacity: z.number().optional(),
	blur: z.number().optional(),
	fillColor: z.string().optional(),
	stroke: DynamicStrokePropertiesSchema.optional(),

	// Variable Fonts
	variableAxes: VariableFontAxesSchema.optional(),

	// GPU Shader VFX
	chromaticGlitch: ChromaticGlitchConfigSchema.optional(),
	longShadow: LongShadowConfigSchema.optional(),
	particleDissolve: ParticleDissolveConfigSchema.optional(),
	audioSpectrum: AudioSpectrumTypographySchema.optional(),

	// Dynamics & Physics
	spring: SpringPhysicsSchema.optional(),
});
export type ExtendedGlyphProperties = z.infer<
	typeof ExtendedGlyphPropertiesSchema
>;

export const AdvancedTextAnimatorSchema = z.object({
	name: z.string().default("AdvancedAnimator"),
	selectors: z.array(z.record(z.string(), z.unknown())).default([]),
	props: ExtendedGlyphPropertiesSchema,
});
export type AdvancedTextAnimator = z.infer<typeof AdvancedTextAnimatorSchema>;
