/**
 * wgsl.ts — WGSL signal function codegen
 *
 * Turns a SignalNodeConfig (fn mode) into:
 *   1. A ready-to-embed WGSL snippet  (for WebGPU compute/render pipelines)
 *
 * Generated function signature (canonical form):
 *
 *   fn signal_<nodeId>(
 *     t: f32,       // time in seconds
 *     x: f32,       // normalised x coord [0,1]
 *     y: f32,       // normalised y coord [0,1]
 *     z: f32,       // normalised z coord [0,1]
 *     i: u32,       // linear element index
 *     n: u32,       // total element count
 *     frame: u32,   // current frame number
 *     ...userParams // user-defined uniforms
 *   ) -> <outputType>
 */

import type {
	EasingFamily,
	EasingMode,
	EnvelopePattern,
	FnParam,
	SignalNodeConfig,
	UniformBufferLayout,
	WGSLOutputType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WGSL_CONSTANTS = `\
const PI:  f32 = ${Math.PI}f;
const TAU: f32 = ${Math.PI * 2}f;
const E:   f32 = ${Math.E}f;`;

/** Built-in parameter list prepended before user params. */
const BASE_PARAMS: readonly string[] = [
	"t: f32",
	"x: f32",
	"y: f32",
	"z: f32",
	"i: u32",
	"n: u32",
	"frame: u32",
	"color: vec4f",
	"t_elapsed: f32",
	"duration: f32",
];

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface WGSLSignalFn {
	/** WGSL identifier, safe to paste into any shader. */
	name: string;
	/** Full ready-to-embed WGSL text (constants + fn declaration). */
	wgsl: string;
	/** The fn signature line only — useful for downstream shader templates. */
	signature: string;
	/** Return type of the function. */
	outputType: WGSLOutputType;
	/** User-defined param descriptors (mirrors config.fnParams). */
	params: FnParam[];
	/**
	 * True when the source compiled without any syntactic red-flags.
	 * (Basic heuristic — real validation must happen in the WebGPU device.)
	 */
	valid: boolean;
	/** Human-readable warning if `valid` is false. */
	validationWarning?: string;
}

// ---------------------------------------------------------------------------
// buildWGSLSignalFn
// ---------------------------------------------------------------------------

export function buildWGSLSignalFn(
	config: SignalNodeConfig,
	/** Node id — used to produce a unique fn name. */
	nodeId: string,
): WGSLSignalFn {
	const name = sanitizeName(nodeId);
	const outputType = config.fnOutputType || "f32";

	const params = config.fnParams ?? [];
	const customArgs = params.map((p) => `${p.name}: ${p.type}`);
	const allArgs = [...BASE_PARAMS, ...customArgs].join(", ");
	const signature = `fn ${name}(${allArgs}) -> ${outputType}`;

	// Dynamic codegen or custom fallback
	let bodyToCompile = config.fnBody ?? "";

	let resolvedConfig = { ...config };
	if (!config.baseType || config.baseType === "custom") {
		// Attempt to parse visual builder state from comment block header
		const parsed = parseStateFromFnBody(config.fnBody ?? "", config);
		if (parsed.baseType) {
			resolvedConfig = { ...config, ...parsed };
		}
	}

	if (resolvedConfig.baseType && resolvedConfig.baseType !== "custom") {
		bodyToCompile = generateWGSLFromConfig(resolvedConfig);
	}

	// Build body ──────────────────────────────────────────────────────────────
	const rawBody = bodyToCompile
		.split("\n")
		.map((line) => `    ${line}`)
		.join("\n");

	// Validate (heuristic only) ───────────────────────────────────────────────
	const { valid, validationWarning } = heuristicValidate(rawBody, outputType);

	let finalBody = rawBody;
	if (
		!valid &&
		validationWarning === "Function body has no return statement."
	) {
		if (outputType === "vec2f") finalBody += "\n    return vec2<f32>(0.0);";
		else if (outputType === "vec3f")
			finalBody += "\n    return vec3<f32>(0.0);";
		else if (outputType === "vec4f")
			finalBody += "\n    return vec4<f32>(0.0);";
		else finalBody += "\n    return 0.0;";
	}

	const wgsl = [WGSL_CONSTANTS, "", `${signature} {`, finalBody, `}`].join(
		"\n",
	);

	return {
		name,
		wgsl,
		signature,
		outputType,
		params,
		valid,
		validationWarning,
	};
}

export interface EvalContext {
	t: number;
	x: number;
	y: number;
	z: number;
	i: number;
	n: number;
	frame: number;
	color: [number, number, number, number];
	params: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Easing Curve codegen helpers
// ---------------------------------------------------------------------------

function emitBounceOut(xVar: string, id: string): string {
	return [
		`  let ${id}_n1: f32 = 7.5625;`,
		`  let ${id}_d1: f32 = 2.75;`,
		`  let ${id}_r1: f32 = ${id}_n1 * (${xVar}) * (${xVar});`,
		`  let ${id}_x2: f32 = (${xVar}) - 1.5 / ${id}_d1;`,
		`  let ${id}_r2: f32 = ${id}_n1 * ${id}_x2 * ${id}_x2 + 0.75;`,
		`  let ${id}_x3: f32 = (${xVar}) - 2.25 / ${id}_d1;`,
		`  let ${id}_r3: f32 = ${id}_n1 * ${id}_x3 * ${id}_x3 + 0.9375;`,
		`  let ${id}_x4: f32 = (${xVar}) - 2.625 / ${id}_d1;`,
		`  let ${id}_r4: f32 = ${id}_n1 * ${id}_x4 * ${id}_x4 + 0.984375;`,
		`  let ${id}_s1: f32 = select(${id}_r4, ${id}_r3, (${xVar}) < 2.5 / ${id}_d1);`,
		`  let ${id}_s2: f32 = select(${id}_s1, ${id}_r2, (${xVar}) < 2.0 / ${id}_d1);`,
		`  let ${id}: f32 = select(${id}_s2, ${id}_r1, (${xVar}) < 1.0 / ${id}_d1);`,
	].join("\n");
}

function emitEaseIn(family: EasingFamily, x: string, id: string): string {
	switch (family) {
		case "linear":
			return `  let ${id}: f32 = ${x};`;
		case "smoothstep":
			return `  let ${id}: f32 = (${x}) * (${x}) * (3.0 - 2.0 * (${x}));`;
		case "smootherstep":
			return `  let ${id}: f32 = (${x}) * (${x}) * (${x}) * ((${x}) * ((${x}) * 6.0 - 15.0) + 10.0);`;
		case "sine":
			return `  let ${id}: f32 = 1.0 - cos((${x}) * PI * 0.5);`;
		case "quad":
			return `  let ${id}: f32 = (${x}) * (${x});`;
		case "cubic":
			return `  let ${id}: f32 = (${x}) * (${x}) * (${x});`;
		case "quart":
			return `  let ${id}: f32 = pow(${x}, 4.0);`;
		case "quint":
			return `  let ${id}: f32 = pow(${x}, 5.0);`;
		case "expo":
			return `  let ${id}: f32 = select(pow(2.0, 10.0 * (${x}) - 10.0), 0.0, (${x}) <= 0.0001);`;
		case "circ":
			return `  let ${id}: f32 = 1.0 - sqrt(clamp(1.0 - (${x}) * (${x}), 0.0, 1.0));`;
		case "back":
			return [
				`  let ${id}_c1: f32 = 1.70158;`,
				`  let ${id}_c3: f32 = ${id}_c1 + 1.0;`,
				`  let ${id}: f32 = ${id}_c3 * (${x}) * (${x}) * (${x}) - ${id}_c1 * (${x}) * (${x});`,
			].join("\n");
		case "elastic":
			return [
				`  let ${id}_c4: f32 = (2.0 * PI) / 3.0;`,
				`  let ${id}_raw: f32 = -pow(2.0, 10.0 * (${x}) - 10.0) * sin(((${x}) * 10.0 - 10.75) * ${id}_c4);`,
				`  let ${id}_lo: f32 = select(${id}_raw, 0.0, (${x}) <= 0.0001);`,
				`  let ${id}: f32 = select(${id}_lo, 1.0, (${x}) >= 0.9999);`,
			].join("\n");
		case "bounce": {
			const bx = `${id}_bx`;
			const bo = `${id}_bo`;
			return [
				`  let ${bx}: f32 = 1.0 - (${x});`,
				emitBounceOut(bx, bo),
				`  let ${id}: f32 = 1.0 - ${bo};`,
			].join("\n");
		}
	}
}

function emitEase(
	family: EasingFamily,
	mode: EasingMode,
	xExpr: string,
	id: string,
): string {
	if (
		family === "linear" ||
		family === "smoothstep" ||
		family === "smootherstep"
	) {
		return emitEaseIn(family, xExpr, id);
	}
	if (mode === "in") {
		return emitEaseIn(family, xExpr, id);
	}
	if (mode === "out") {
		const srcId = `${id}_src`;
		return [
			emitEaseIn(family, `1.0 - (${xExpr})`, srcId),
			`  let ${id}: f32 = 1.0 - ${srcId};`,
		].join("\n");
	}
	// in_out
	const inId = `${id}_in`;
	const outId = `${id}_out`;
	return [
		emitEaseIn(family, `(${xExpr}) * 2.0`, inId),
		emitEaseIn(family, `2.0 - (${xExpr}) * 2.0`, outId),
		`  let ${id}: f32 = select(1.0 - ${outId} * 0.5, ${inId} * 0.5, (${xExpr}) < 0.5);`,
	].join("\n");
}

// ---------------------------------------------------------------------------
// generateWGSLFromConfig codegen logic
// ---------------------------------------------------------------------------

export function generateWGSLFromConfig(config: SignalNodeConfig): string {
	const parts: string[] = [];

	// 1. FM Modulator block
	const baseEnabled = config.baseEnabled ?? true;
	const fmEnabled = config.fmEnabled ?? false;
	if (baseEnabled && fmEnabled) {
		const fmAmp = (config.fmAmplitude ?? 1.0).toFixed(5);
		const fmFreq = (config.fmFrequency ?? 0.5).toFixed(5);
		parts.push("  // Frequency Modulation");
		parts.push(`  let modulator = sin(t * ${fmFreq} * TAU) * ${fmAmp};`);
		parts.push("  let t_mod = t + modulator;");
	} else {
		parts.push("  let t_mod = t;");
	}

	// 2. Base Waveform calculation
	parts.push("  // Base Waveform");
	if (!baseEnabled) {
		parts.push("  var val: f32 = 0.0;");
	} else {
		const baseType = config.baseType ?? "sine";
		if (baseType === "noise_smooth") {
			parts.push("  let noise_t = t_mod * u.frequency + u.phase;");
			parts.push("  let noise_i = floor(noise_t);");
			parts.push("  let noise_f = fract(noise_t);");
			parts.push("  let noise_u = noise_f * noise_f * (3.0 - 2.0 * noise_f);");
			parts.push("  let n0 = fract(sin(noise_i * 12.9898) * 43758.5453);");
			parts.push(
				"  let n1 = fract(sin((noise_i + 1.0) * 12.9898) * 43758.5453);",
			);
			parts.push("  let noise_val = mix(n0, n1, noise_u) * 2.0 - 1.0;");
		} else if (baseType === "noise_white") {
			parts.push(
				"  let noise_val = fract(sin(t_mod * 12.9898 + u.phase) * 43758.5453) * 2.0 - 1.0;",
			);
		} else if (baseType === "pulse") {
			parts.push(
				"  let pulse_duty = select(clamp(u.phase, 0.01, 0.99), 0.5, u.phase == 0.0);",
			);
			parts.push(
				"  let pulse_val = select(-1.0, 1.0, fract(t_mod * u.frequency) < pulse_duty);",
			);
		} else if (baseType === "bounce") {
			parts.push(
				"  let bounce_val = abs(sin(t_mod * u.frequency * PI + u.phase));",
			);
		} else if (baseType === "staircase") {
			parts.push(
				"  let stair_val = floor(fract(t_mod * u.frequency + u.phase / TAU) * 8.0) / 7.0 * 2.0 - 1.0;",
			);
		}

		let baseExpr = "";
		switch (baseType) {
			case "sine":
				baseExpr =
					"u.amplitude * sin(t_mod * u.frequency * TAU + u.phase) + u.offset";
				break;
			case "triangle":
				baseExpr =
					"u.amplitude * (2.0 * abs(2.0 * fract(t_mod * u.frequency + u.phase / TAU) - 1.0) - 1.0) + u.offset";
				break;
			case "sawtooth":
				baseExpr =
					"u.amplitude * (2.0 * (t_mod * u.frequency + u.phase / TAU - floor(t_mod * u.frequency + u.phase / TAU + 0.5))) + u.offset";
				break;
			case "square":
				baseExpr =
					"u.amplitude * sign(sin(t_mod * u.frequency * TAU + u.phase)) + u.offset";
				break;
			case "constant":
				baseExpr = "u.offset";
				break;
			case "noise_smooth":
				baseExpr = "u.amplitude * noise_val + u.offset";
				break;
			case "noise_white":
				baseExpr = "u.amplitude * noise_val + u.offset";
				break;
			case "pulse":
				baseExpr = "u.amplitude * pulse_val + u.offset";
				break;
			case "bounce":
				baseExpr = "u.amplitude * bounce_val + u.offset";
				break;
			case "staircase":
				baseExpr = "u.amplitude * stair_val + u.offset";
				break;
			default:
				baseExpr =
					"u.amplitude * sin(t_mod * u.frequency * TAU + u.phase) + u.offset";
				break;
		}

		parts.push(`  var val: f32 = ${baseExpr};`);
	}

	// 3. Time Envelope (Easing)
	const envelopeEnabled = config.envelopeEnabled ?? false;
	const gateEnabled = config.gateEnabled ?? false;
	if (envelopeEnabled) {
		parts.push("  // Time Envelope");
		const gateStartFrame = config.gateStartFrame ?? 0;
		const gateEndFrame = config.gateEndFrame ?? 100;
		const envelopeUseFrame = config.envelopeUseFrame ?? true;
		if (envelopeUseFrame && gateEnabled) {
			parts.push(
				`  let progress = select(0.0, clamp((f32(frame) - ${gateStartFrame.toFixed(1)}) / (${gateEndFrame.toFixed(1)} - ${gateStartFrame.toFixed(1)}), 0.0, 1.0), ${gateEndFrame}u > ${gateStartFrame}u);`,
			);
		} else {
			parts.push(
				"  let progress = select(0.0, clamp(t_elapsed / duration, 0.0, 1.0), duration > 0.0);",
			);
		}

		const family = config.envelopeFamily ?? "sine";
		const mode = config.envelopeMode ?? "in_out";
		const pattern = config.envelopePattern ?? "ramp_up";
		const cycles = config.envelopeCycles ?? 2;

		if (pattern === "bell" || pattern === "loop") {
			if (pattern === "loop") {
				const loopCount = Math.max(1, cycles).toFixed(1);
				parts.push(`  let env_loop: f32 = fract(progress * ${loopCount});`);
				parts.push("  let env_folded: f32 = 1.0 - abs(env_loop * 2.0 - 1.0);");
			} else {
				parts.push("  let env_folded: f32 = 1.0 - abs(progress * 2.0 - 1.0);");
			}
			parts.push(emitEase(family, mode, "env_folded", "env_eased"));
			parts.push("  let env_factor: f32 = env_eased;");
		} else {
			parts.push(emitEase(family, mode, "progress", "env_eased"));
			parts.push(
				pattern === "ramp_up"
					? "  let env_factor: f32 = env_eased;"
					: "  let env_factor: f32 = 1.0 - env_eased;",
			);
		}

		parts.push("  val = mix(u.offset - u.amplitude, val, env_factor);");
	}

	// 4. Time Gate
	if (gateEnabled) {
		const gateStartFrame = config.gateStartFrame ?? 0;
		const gateEndFrame = config.gateEndFrame ?? 100;
		const gateIdleValue = config.gateIdleValue ?? 0.0;
		parts.push("  // Time Gate");
		parts.push(
			`  if (frame < ${gateStartFrame}u || frame > ${gateEndFrame}u) {`,
		);
		parts.push(`    val = ${gateIdleValue.toFixed(5)};`);
		parts.push("  }");
	}

	parts.push("");
	parts.push("  return val;");

	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Legacy Parser Heuristics
// ---------------------------------------------------------------------------

const LEGACY_ENVELOPE_MAP = {
	fade_in: {
		family: "linear" as const,
		mode: "in" as const,
		pattern: "ramp_up" as const,
	},
	fade_out: {
		family: "linear" as const,
		mode: "in" as const,
		pattern: "ramp_down" as const,
	},
	ping_pong: {
		family: "linear" as const,
		mode: "in" as const,
		pattern: "bell" as const,
	},
	expo_decay: {
		family: "expo" as const,
		mode: "in" as const,
		pattern: "ramp_down" as const,
	},
	smooth_in: {
		family: "smoothstep" as const,
		mode: "in" as const,
		pattern: "ramp_up" as const,
	},
	smooth_out: {
		family: "smoothstep" as const,
		mode: "in" as const,
		pattern: "ramp_down" as const,
	},
	sine_bell: {
		family: "sine" as const,
		mode: "in" as const,
		pattern: "bell" as const,
	},
	spring: {
		family: "elastic" as const,
		mode: "out" as const,
		pattern: "ramp_up" as const,
	},
};

function migrateLegacyEnvelope(legacyType?: string): {
	family: EasingFamily;
	mode: EasingMode;
	pattern: EnvelopePattern;
} {
	if (legacyType && legacyType in LEGACY_ENVELOPE_MAP) {
		return LEGACY_ENVELOPE_MAP[legacyType as keyof typeof LEGACY_ENVELOPE_MAP];
	}
	return { family: "sine", mode: "in_out", pattern: "ramp_up" };
}

export function parseStateFromFnBody(
	fnBody: string,
	config?: Partial<SignalNodeConfig>,
): Partial<SignalNodeConfig> {
	const match = fnBody.match(/\/\* SIGNAL_BUILDER_STATE:\s*([\s\S]*?)\s*\*\//);
	if (match) {
		try {
			const parsed = JSON.parse(match[1]);

			const envIsV2 = !!parsed.envelope?.family;
			const migrated = envIsV2
				? {
						family: parsed.envelope.family as EasingFamily,
						mode: parsed.envelope.mode ?? "in",
						pattern: parsed.envelope.pattern ?? "ramp_up",
					}
				: migrateLegacyEnvelope(parsed.envelope?.type);

			return {
				baseEnabled: parsed.base?.enabled ?? true,
				baseType: parsed.base?.type ?? "sine",
				fmEnabled: parsed.fm?.enabled ?? false,
				fmAmplitude: config?.fmAmplitude ?? parsed.fm?.amplitude ?? 1.0,
				fmFrequency: config?.fmFrequency ?? parsed.fm?.frequency ?? 0.5,
				envelopeEnabled: parsed.envelope?.enabled ?? false,
				envelopeFamily: migrated.family,
				envelopeMode: migrated.mode,
				envelopePattern: migrated.pattern,
				envelopeCycles: envIsV2 ? (parsed.envelope?.cycles ?? 2) : 2,
				envelopeUseFrame:
					config?.envelopeUseFrame ?? parsed.envelope?.useFrame ?? true,
				gateEnabled: config?.gateEnabled ?? parsed.gate?.enabled ?? false,
				gateStartFrame: config?.gateStartFrame ?? parsed.gate?.startFrame ?? 0,
				gateEndFrame: config?.gateEndFrame ?? parsed.gate?.endFrame ?? 100,
				gateIdleValue: config?.gateIdleValue ?? parsed.gate?.idleValue ?? 0.0,
			};
		} catch (e) {
			// Fall through
		}
	}
	return {};
}

// ---------------------------------------------------------------------------
// Uniform Buffer Layout Helpers
// ---------------------------------------------------------------------------

export function buildUniformBufferLayout(
	fn: WGSLSignalFn,
	group = 0,
	binding = 0,
): UniformBufferLayout | null {
	if (fn.params.length === 0) return null;

	const structName = `SignalParams_${fn.name}`;
	const fields = fn.params.map((p) => `    ${p.name}: ${p.type},`).join("\n");

	const structWGSL = `struct ${structName} {\n${fields}\n}`;
	const bindingWGSL = `@group(${group}) @binding(${binding}) var<uniform> signal_params: ${structName};`;

	const byteSize = fn.params.reduce((acc, p) => {
		const componentSizes: Record<string, number> = {
			f32: 4,
			i32: 4,
			u32: 4,
			vec2f: 8,
			vec3f: 16,
			vec4f: 16,
		};
		return acc + (componentSizes[p.type] ?? 4);
	}, 0);

	return { structWGSL, bindingWGSL, byteSize };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sanitizeName(nodeId: string): string {
	return `signal_${nodeId.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function heuristicValidate(
	body: string,
	outputType: WGSLOutputType,
): { valid: boolean; validationWarning?: string } {
	const hasReturn = /\breturn\b/.test(body);
	if (!hasReturn) {
		return {
			valid: false,
			validationWarning: "Function body has no return statement.",
		};
	}

	const vecReturn = /\breturn\s+vec(\d)f?\(/.exec(body);
	if (vecReturn) {
		const dims = parseInt(vecReturn[1], 10);
		if (outputType === "f32") {
			return {
				valid: false,
				validationWarning: `Returning vec${dims}f but output type is f32.`,
			};
		}
	}

	return { valid: true };
}
