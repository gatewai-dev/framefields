export type WGSLOutputType = "f32" | "vec2f" | "vec3f" | "vec4f";
export type WGSLParamType = "f32" | "i32" | "u32" | "vec2f" | "vec3f" | "vec4f";

export interface FnParam {
	name: string;
	type: WGSLParamType;
	defaultValue: number;
}

export type EasingFamily =
	| "linear"
	| "sine"
	| "quad"
	| "cubic"
	| "quart"
	| "quint"
	| "expo"
	| "circ"
	| "back"
	| "elastic"
	| "bounce"
	| "smoothstep"
	| "smootherstep";
export type EasingMode = "in" | "out" | "in_out";
export type EnvelopePattern = "ramp_up" | "ramp_down" | "bell" | "loop";

export interface SignalNodeConfig {
	amplitude?: number;
	frequency?: number;
	phase?: number;
	offset?: number;
	amplitudeMin?: number;
	amplitudeMax?: number;
	spatialScale?: number;
	spatialSpeed?: number;
	fmAmplitude?: number;
	fmFrequency?: number;
	gateEnabled?: boolean;
	gateStartFrame?: number;
	gateEndFrame?: number;
	gateIdleValue?: number;
	envelopeUseFrame?: boolean;

	fnBody?: string;
	fnOutputType?: WGSLOutputType;
	fnParams?: FnParam[];
	previewMode?: "pattern" | "cartesian" | "3d";

	// Codegen options
	baseEnabled?: boolean;
	baseType?:
		| "sine"
		| "triangle"
		| "sawtooth"
		| "square"
		| "constant"
		| "noise_smooth"
		| "noise_white"
		| "pulse"
		| "bounce"
		| "staircase"
		| "custom";
	fmEnabled?: boolean;
	envelopeEnabled?: boolean;
	envelopeFamily?: EasingFamily;
	envelopeMode?: EasingMode;
	envelopePattern?: EnvelopePattern;
	envelopeCycles?: number;
}

export interface UniformBufferLayout {
	structWGSL: string;
	bindingWGSL: string;
	byteSize: number;
}
