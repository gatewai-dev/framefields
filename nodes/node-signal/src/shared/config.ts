import { SignalResultSchema } from "@gitframes/node-sdk";
import { z } from "zod";

// ---------------------------------------------------------------------------
// WGSL scalar/vector output types a signal fn can produce
// ---------------------------------------------------------------------------
export const WGSL_OUTPUT_TYPES = ["f32"] as const;
export type WGSLOutputType = (typeof WGSL_OUTPUT_TYPES)[number];

export const WGSL_PARAM_TYPES = [
	"f32",
	"i32",
	"u32",
	"vec2f",
	"vec3f",
	"vec4f",
] as const;
export type WGSLParamType = (typeof WGSL_PARAM_TYPES)[number];

// ---------------------------------------------------------------------------
// A user-defined uniform passed into the generated WGSL function
// ---------------------------------------------------------------------------
export const FnParamSchema = z.object({
	/** Must be a valid WGSL identifier */
	name: z
		.string()
		.regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, "Must be a valid WGSL identifier"),
	type: z.enum(WGSL_PARAM_TYPES),
	/** Default scalar value (scalar only; vec components share the same default) */
	defaultValue: z.number(),
});
export type FnParam = z.infer<typeof FnParamSchema>;

// ---------------------------------------------------------------------------
// Signal node config
// ---------------------------------------------------------------------------
export const SignalNodeConfigSchema = z
	.object({
		// ── Uniform parameters ──
		amplitude: z.number().min(0).default(1),
		frequency: z.number().min(0).default(1),
		phase: z
			.number()
			.min(-2 * Math.PI)
			.max(2 * Math.PI)
			.default(0),
		offset: z.number().default(0),
		amplitudeMin: z.number().default(-1),
		amplitudeMax: z.number().default(1),
		spatialScale: z.number().min(0).default(1),
		spatialSpeed: z.number().default(1),
		fmAmplitude: z.number().min(0).default(1),
		fmFrequency: z.number().min(0).default(0.5),
		gateEnabled: z.boolean().default(false),
		gateStartFrame: z.number().int().min(0).default(0),
		gateEndFrame: z.number().int().min(0).default(100),
		gateIdleValue: z.number().default(0.0),
		envelopeUseFrame: z.boolean().default(true),

		// ── Codegen parameters ──
		baseEnabled: z.boolean().default(true),
		baseType: z
			.enum([
				"sine",
				"triangle",
				"sawtooth",
				"square",
				"constant",
				"noise_smooth",
				"noise_white",
				"pulse",
				"bounce",
				"staircase",
				"custom",
			])
			.default("sine"),
		fmEnabled: z.boolean().default(false),
		envelopeEnabled: z.boolean().default(false),
		envelopeFamily: z
			.enum([
				"linear",
				"sine",
				"quad",
				"cubic",
				"quart",
				"quint",
				"expo",
				"circ",
				"back",
				"elastic",
				"bounce",
				"smoothstep",
				"smootherstep",
			])
			.default("sine"),
		envelopeMode: z.enum(["in", "out", "in_out"]).default("in_out"),
		envelopePattern: z
			.enum(["ramp_up", "ramp_down", "bell", "loop"])
			.default("ramp_up"),
		envelopeCycles: z.number().int().min(1).default(2),

		// ── Function (WGSL) parameters ───────────────────────────────────────
		/**
		 * Full function body.
		 * Bindings always in scope:
		 *   t     : f32   — time in seconds
		 *   x,y,z : f32   — normalised spatial coords [0,1]
		 *   i     : u32   — linear element index
		 *   n     : u32   — total element count
		 *   frame : u32   — current frame number
		 *   PI, TAU, E    — f32 constants
		 */
		fnBody: z
			.string()
			.default(
				[
					"// Bindings: t: f32 | x y z: f32 | i n frame: u32",
					"// Constants: PI, TAU, E",
					"return u.amplitude * sin(t * u.frequency * TAU + u.phase) + u.offset;",
				].join("\n"),
			),

		/** Return type of the generated WGSL function. */
		fnOutputType: z.enum(WGSL_OUTPUT_TYPES).default("f32"),

		/**
		 * User-defined uniforms that appear as additional parameters after the
		 * built-in bindings in the generated function signature.
		 * Downstream WebGPU processors must bind them as a uniform buffer.
		 */
		fnParams: z.array(FnParamSchema).default([]),
		previewMode: z.enum(["pattern", "cartesian", "3d"]).default("cartesian"),
	})
	.superRefine((data, ctx) => {
		if (data.amplitudeMax <= data.amplitudeMin) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["amplitudeMax"],
				message: "amplitudeMax must be greater than amplitudeMin",
			});
		}
		if (data.gateEndFrame <= data.gateStartFrame) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["gateEndFrame"],
				message: "gateEndFrame must be greater than gateStartFrame",
			});
		}
	});

export type SignalNodeConfig = z.infer<typeof SignalNodeConfigSchema>;
export type SignalNodeResult = z.infer<typeof SignalResultSchema>;
export { SignalResultSchema };
