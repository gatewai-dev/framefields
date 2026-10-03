import {
	createOutputItemSchema,
	MultiOutputGenericSchema,
} from "@gitframes/node-sdk";
import { z } from "zod";

export const SignalMathOperationEnum = z.enum([
	"remap",
	"normalize",
	"add",
	"subtract",
	"multiply",
	"divide",
	"invert",
	"clamp",
	"power",
	"smoothstep",
	"custom",
]);
export type SignalMathOperation = z.infer<typeof SignalMathOperationEnum>;

export const SignalMathConfigSchema = z.object({
	operation: SignalMathOperationEnum.default("remap"),
	bValue: z.number().default(1.0),
	inMin: z.number().default(0.0),
	inMax: z.number().default(1.0),
	outMin: z.number().default(0.0),
	outMax: z.number().default(1.0),
	clampMin: z.number().default(0.0),
	clampMax: z.number().default(1.0),
	exponent: z.number().default(2.0),
	edge0: z.number().default(0.0),
	edge1: z.number().default(1.0),
	customWGSL: z.string().default(
		[
			"// Variables in scope:",
			"//   a: f32 (Signal A)",
			"//   b: f32 (Signal B or uniform bValue)",
			"//   a_min: f32, a_max: f32 (Signal A min/max stats)",
			"//   t: f32 (seconds), t_norm: f32 [0..1], frame: u32",
			"// Constants: PI, TAU, E",
			"return a;",
		].join("\n"),
	),
});

export type SignalMathConfig = z.infer<typeof SignalMathConfigSchema>;

export const SignalMathResultSchema = MultiOutputGenericSchema(
	createOutputItemSchema(z.literal("Signal"), z.record(z.string(), z.unknown())),
);

export type SignalMathResult = z.infer<typeof SignalMathResultSchema>;
