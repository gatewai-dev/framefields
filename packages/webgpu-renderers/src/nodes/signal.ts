/// <reference types="webgpu" />
import type { RenderContextValue } from "../render-context.js";
import { signalRegistry } from "../signals/signal-registry.js";
import type { SignalNodeProps } from "./types.js";

export const STATIC_SIGNAL_PREVIEW_SHADER = `
struct SignalUniforms {
	amplitude        : f32,
	offset           : f32,
	previewMode      : f32,
	time             : f32,
	width            : f32,
	height           : f32,
	amplitudeMin     : f32,
	amplitudeMax     : f32,
	duration         : f32,
	pad0             : f32,
	pad1             : f32,
	pad2             : f32,
};

@group(0) @binding(0) var<uniform> u : SignalUniforms;
@group(1) @binding(0) var signalTex  : texture_2d<f32>;

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
	var pos = array<vec2<f32>, 4>(
		vec2<f32>(-1.0, 1.0),
		vec2<f32>(1.0, 1.0),
		vec2<f32>(-1.0, -1.0),
		vec2<f32>(1.0, -1.0)
	);
	var uv = array<vec2<f32>, 4>(
		vec2<f32>(0.0, 0.0),
		vec2<f32>(1.0, 0.0),
		vec2<f32>(0.0, 1.0),
		vec2<f32>(1.0, 1.0)
	);
	return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	// Prevent compiler optimization/stripping of uniforms by reading all variables
	let dummy_use = u.previewMode + u.width + u.height + u.duration;
	let col_offset = vec3<f32>(dummy_use * 1e-10);

	// Dark background
	var col = vec3<f32>(0.07, 0.07, 0.08) + col_offset;

	let range = max(1e-4, u.amplitudeMax - u.amplitudeMin);
	let zero_norm = clamp(select((0.0 - u.amplitudeMin) / range, 0.5, range <= 1e-4), 0.0, 1.0);
	let y_zero = 0.5 - (zero_norm - 0.5) * 0.76;

	// Grid Lines
	let grid_scroll = u.time * 0.1;
	let uv10 = vec2<f32>(in.uv.x - grid_scroll, in.uv.y) * 10.0;
	let fw10 = fwidth(uv10);
	let gf   = abs(fract(uv10 - 0.5) - 0.5) / fw10;
	let fine = 1.0 - clamp(min(gf.x, gf.y), 0.0, 1.0);
	col = mix(col, vec3<f32>(0.12, 0.12, 0.14), fine * 0.4);

	let uv5 = vec2<f32>(in.uv.x - grid_scroll, in.uv.y) * 5.0;
	let fw5 = fwidth(uv5);
	let gc  = abs(fract(uv5 - 0.5) - 0.5) / fw5;
	let coarse = 1.0 - clamp(min(gc.x, gc.y), 0.0, 1.0);
	col = mix(col, vec3<f32>(0.16, 0.16, 0.19), coarse * 0.5);

	// Zero axis
	let axis_d  = abs(in.uv.y - y_zero);
	let axis_fw = fwidth(in.uv.y);
	let axis_px = 1.0 - smoothstep(0.0, axis_fw * 1.5, axis_d);

	// Playhead position fixed at center 0.5 (where t == current frame time)
	let playhead_x = 0.5;

	// Dimmer zero axis in the future (x > playhead_x)
	let axis_strength = select(0.3, 0.65, in.uv.x <= playhead_x);
	col = mix(col, vec3<f32>(0.24, 0.24, 0.28), axis_px * axis_strength);

	// Direct fetch without sampler: works unconditionally on all devices and rgba32float textures
	let tex_dim = textureDimensions(signalTex);
	let x_coord = clamp(u32(clamp(in.uv.x, 0.0, 1.0) * f32(tex_dim.x)), 0u, max(tex_dim.x, 1u) - 1u);
	let raw_sample = textureLoad(signalTex, vec2<u32>(x_coord, 0u), 0);
	var signal_val = raw_sample.r;
	if (u.previewMode == 1.0) {
		signal_val = raw_sample.g; // beat channel
	} else if (u.previewMode == 2.0) {
		signal_val = raw_sample.b; // bass channel
	} else if (u.previewMode == 3.0) {
		signal_val = raw_sample.a; // energy channel
	}

	// Normalize the mapped signal value back to [0, 1] using min/max bounds
	let norm_val = select((signal_val - u.amplitudeMin) / range, 0.5, range == 0.0);

	// Scale and offset waveform plot to fit viewport
	let y_plot = 0.5 - (norm_val - 0.5) * 0.76;
	let dist   = abs(in.uv.y - y_plot);

	// Semi-transparent fill under the curve (more prominent in the past, very faint in the future)
	let fill_lo    = min(y_plot, y_zero);
	let fill_hi    = max(y_plot, y_zero);
	let in_fill    = step(fill_lo, in.uv.y) * step(in.uv.y, fill_hi);
	let fill_alpha = select(0.04, 0.12, in.uv.x <= playhead_x);
	col = mix(col, vec3<f32>(0.0, 0.72, 1.0), in_fill * fill_alpha);

	// Crisp Curve Line
	let core_fw = fwidth(in.uv.y);
	let core    = 1.0 - smoothstep(0.5 * core_fw, 2.0 * core_fw, dist);
	let curve_color = mix(vec3<f32>(0.3, 0.5, 0.6), vec3<f32>(0.0, 0.72, 1.0), select(0.5, 1.0, in.uv.x <= playhead_x));
	col = mix(col, curve_color, core * 0.95);

	// Playhead line at playhead_x
	let playhead_d = abs(in.uv.x - playhead_x);
	let playhead_fw = fwidth(in.uv.x);
	
	// Soft glow around playhead
	let glow = exp(-30.0 * playhead_d);
	col = mix(col, vec3<f32>(1.0, 0.3, 0.2), glow * 0.2);
	
	// Sharp playhead line
	let playhead_line = 1.0 - smoothstep(0.0, playhead_fw * 1.5, playhead_d);
	col = mix(col, vec3<f32>(1.0, 0.35, 0.25), playhead_line * 0.95);

	return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

const devicePipelineCache = new WeakMap<
	GPUDevice,
	Map<string, GPURenderPipeline>
>();
const uniformData = new Float32Array(12); // padded to 48 bytes (divisible by 16)

function getDevicePipelines(device: GPUDevice): Map<string, GPURenderPipeline> {
	let cache = devicePipelineCache.get(device);
	if (!cache) {
		cache = new Map();
		devicePipelineCache.set(device, cache);
	}
	return cache;
}

export async function drawSignalNode(
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	pass: GPURenderPassEncoder,
	props: SignalNodeProps,
): Promise<void> {
	const config = props.signalConfig;
	if (!config) return;

	const cfgRecord = config as Record<string, unknown>;
	const nodeId =
		(typeof props.nodeId === "string" && props.nodeId) ||
		(typeof cfgRecord.nodeId === "string" && (cfgRecord.nodeId as string)) ||
		"preview";
	const frame = props.frame ?? 0;
	const fps = props.fps ?? 24;
	const width = props.width ?? 512;
	const height = props.height ?? 512;

	const elapsedMs =
		props.elapsedMs !== undefined ? props.elapsedMs : (frame / fps) * 1000;
	let durationMs = props.durationMs !== undefined ? props.durationMs : 0;
	const cfgDuration =
		typeof (config as { durationMs?: unknown })?.durationMs === "number"
			? (config as { durationMs: number }).durationMs
			: 0;
	if (!durationMs && cfgDuration) {
		durationMs = cfgDuration;
	}
	let durationSec = durationMs / 1000;
	const isMathNode =
		config.type === "signal_math" ||
		Boolean(cfgRecord.operation) ||
		cfgRecord.op === "SignalMath";
	const isGateNode = config.type === "gate" || cfgRecord.op === "SignalGate";

	if (durationSec <= 0) {
		const mathSigA = cfgRecord.signalA as Record<string, unknown> | undefined;
		const gateSrcSig = cfgRecord.sourceSignal as
			| Record<string, unknown>
			| undefined;
		const regDuration =
			signalRegistry.getDuration?.(ctx.device, nodeId, props.renderId) ||
			(isMathNode && mathSigA?.nodeId
				? signalRegistry.getDuration?.(
						ctx.device,
						mathSigA.nodeId as string,
						props.renderId,
					)
				: undefined) ||
			(isGateNode && gateSrcSig?.nodeId
				? signalRegistry.getDuration?.(
						ctx.device,
						gateSrcSig.nodeId as string,
						props.renderId,
					)
				: undefined);
		if (regDuration && regDuration > 0) {
			durationSec = regDuration;
		}
	}
	const elapsedTimeSec = elapsedMs / 1000;

	await signalRegistry.ensureAudioSourcesExtracted(
		ctx.device,
		config,
		fps,
		props.renderId,
	);
	// Resolve the dynamic 2D evaluated signal texture view centered at baseTime
	const signalView = signalRegistry.getOrCreate2DTextureView(
		ctx.device,
		encoder,
		nodeId,
		elapsedTimeSec,
		durationSec,
		config,
		width,
		height,
		props.renderId,
		frame,
		fps,
	);

	const pipelines = getDevicePipelines(ctx.device);
	const cacheKey = `preview_${ctx.renderer.format}`;
	let pipeline = pipelines.get(cacheKey);

	if (!pipeline) {
		const shaderModule = ctx.device.createShaderModule({
			label: `signal_preview_static.wgsl`,
			code: STATIC_SIGNAL_PREVIEW_SHADER,
		});

		pipeline = ctx.device.createRenderPipeline({
			label: `SignalPreviewPipeline_static`,
			layout: "auto",
			vertex: {
				module: shaderModule,
				entryPoint: "vs",
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fs",
				targets: [{ format: ctx.renderer.format }],
			},
			primitive: { topology: "triangle-strip" },
		});

		pipelines.set(cacheKey, pipeline);
	}

	let previewModeInt = 0;
	if (!isMathNode && !isGateNode) {
		const cfgObj = config as Record<string, unknown>;
		if (typeof cfgObj.channelIndex === "number") {
			previewModeInt = cfgObj.channelIndex;
		} else if (
			cfgObj.channel === "beat" ||
			cfgObj.extractionMode === "transient_beat" ||
			nodeId.endsWith("_beat")
		) {
			previewModeInt = 1;
		} else if (
			cfgObj.channel === "bass" ||
			cfgObj.extractionMode === "bass" ||
			cfgObj.extractionMode === "sub_bass" ||
			nodeId.endsWith("_bass")
		) {
			previewModeInt = 2;
		} else if (
			cfgObj.channel === "energy" ||
			cfgObj.extractionMode === "rms_envelope" ||
			nodeId.endsWith("_energy")
		) {
			previewModeInt = 3;
		}
	}

	const calculatedStats =
		signalRegistry.getStats?.(nodeId) ??
		(typeof cfgRecord.nodeId === "string"
			? signalRegistry.getStats?.(cfgRecord.nodeId as string)
			: undefined);
	const minVal: number =
		typeof calculatedStats?.min === "number"
			? calculatedStats.min
			: typeof cfgRecord.amplitudeMin === "number"
				? cfgRecord.amplitudeMin
				: (props.offset ?? 0) - (props.amplitude ?? 1);
	const maxVal: number =
		typeof calculatedStats?.max === "number"
			? calculatedStats.max
			: typeof cfgRecord.amplitudeMax === "number"
				? cfgRecord.amplitudeMax
				: (props.offset ?? 0) + (props.amplitude ?? 1);

	uniformData[0] = props.amplitude ?? 1.0;
	uniformData[1] = props.offset ?? 0.0;
	uniformData[2] = previewModeInt;
	uniformData[3] = elapsedTimeSec;
	uniformData[4] = width;
	uniformData[5] = height;
	uniformData[6] = minVal;
	uniformData[7] = maxVal;
	uniformData[8] = durationSec;
	uniformData[9] = 0.0;
	uniformData[10] = 0.0;
	uniformData[11] = 0.0;

	const uBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	const bindGroup0 = ctx.device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [
			{
				binding: 0,
				resource: { buffer: uBuffer },
			},
		],
	});

	const bindGroup1 = ctx.device.createBindGroup({
		layout: pipeline.getBindGroupLayout(1),
		entries: [
			{
				binding: 0,
				resource: signalView,
			},
		],
	});

	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup0);
	pass.setBindGroup(1, bindGroup1);
	pass.draw(4);
}
