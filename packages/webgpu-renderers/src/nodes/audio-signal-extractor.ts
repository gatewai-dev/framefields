/// <reference types="webgpu" />
import type { RenderContextValue } from "../render-context.js";
import { signalRegistry } from "../signals/signal-registry.js";
import type { AudioSignalExtractorNodeProps } from "./types.js";

export const STATIC_AUDIO_SIGNAL_PREVIEW_SHADER = `
struct AudioSignalUniforms {
	sensitivity     : f32,
	time            : f32,
	width           : f32,
	height          : f32,
	previewMode     : f32, // 0=envelope, 1=beat_markers, 2=waveform
	hasBeatSignal   : f32,
	calcMin         : f32,
	calcMax         : f32,
};

@group(0) @binding(0) var<uniform> u : AudioSignalUniforms;
@group(1) @binding(0) var signalTex  : texture_2d<f32>;
@group(1) @binding(1) var sigSamp    : sampler;

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
	let dummy_use = u.width + u.height + u.previewMode;
	let col_offset = vec3<f32>(dummy_use * 1e-10);

	// Dark sleek studio background
	var col = vec3<f32>(0.07, 0.07, 0.08) + col_offset;

	let y_zero = 0.85;

	// Grid Lines
	let grid_scroll = u.time * 0.05;
	let uv10 = vec2<f32>(in.uv.x - grid_scroll, in.uv.y) * 10.0;
	let fw10 = fwidth(uv10);
	let fine = 1.0 - clamp(min(abs(fract(uv10.x - 0.5) - 0.5) / fw10.x, abs(fract(uv10.y - 0.5) - 0.5) / fw10.y), 0.0, 1.0);
	col = mix(col, vec3<f32>(0.12, 0.12, 0.14), fine * 0.35);

	// Baseline Axis
	let axis_d = abs(in.uv.y - y_zero);
	let axis_fw = fwidth(in.uv.y);
	let axis_px = 1.0 - smoothstep(0.0, axis_fw * 1.5, axis_d);
	col = mix(col, vec3<f32>(0.22, 0.22, 0.26), axis_px * 0.6);

	// Sample 4-channel audio signal texture
	let sigSample = textureSampleLevel(signalTex, sigSamp, vec2<f32>(in.uv.x, 0.5), 0.0);
	let primVal = sigSample.r;
	let beatVal = sigSample.g;
	let bassVal = sigSample.b;
	let nrgVal  = sigSample.a;

	let range = max(1e-4, u.calcMax - u.calcMin);

	// Normalize primary curve using calculation min and max
	let norm_prim = clamp((primVal - u.calcMin) / range, 0.0, 1.0);
	let y_prim = 0.85 - norm_prim * 0.70;

	// Normalize secondary energy background fill
	let norm_nrg = clamp((nrgVal - u.calcMin) / range, 0.0, 1.0);
	let y_nrg = 0.85 - norm_nrg * 0.70;

	// 1. Soft RMS background fill under energy curve
	let fill_lo = min(y_nrg, y_zero);
	let fill_hi = max(y_nrg, y_zero);
	let in_fill = step(fill_lo, in.uv.y) * step(in.uv.y, fill_hi);
	col = mix(col, vec3<f32>(0.0, 0.45, 0.7), in_fill * 0.08);

	// 2. Beat transient markers / glow bars
	if (u.hasBeatSignal > 0.5 && beatVal > 0.1) {
		let beat_height = 0.85 - (beatVal * 0.70);
		if (in.uv.y >= beat_height && in.uv.y <= y_zero) {
			let beat_glow = exp(-4.0 * abs(in.uv.y - beat_height));
			col = mix(col, vec3<f32>(1.0, 0.55, 0.1), beatVal * 0.15 * beat_glow);
		}
	}

	// 3. Crisp Primary Curve Line
	let dist_prim = abs(in.uv.y - y_prim);
	let core_fw = fwidth(in.uv.y);
	let core = 1.0 - smoothstep(0.5 * core_fw, 2.2 * core_fw, dist_prim);
	let curve_color = select(vec3<f32>(0.0, 0.75, 1.0), vec3<f32>(0.2, 0.85, 0.5), primVal == bassVal);
	col = mix(col, curve_color, core * 0.95);

	// 4. Playhead cursor line at center (uv.x = 0.5)
	let playhead_d = abs(in.uv.x - 0.5);
	let playhead_fw = fwidth(in.uv.x);
	let glow = exp(-28.0 * playhead_d);
	col = mix(col, vec3<f32>(1.0, 0.3, 0.2), glow * 0.2);
	let playhead_line = 1.0 - smoothstep(0.0, playhead_fw * 1.5, playhead_d);
	col = mix(col, vec3<f32>(1.0, 0.35, 0.25), playhead_line * 0.9);

	return vec4<f32>(clamp(col, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;

const devicePipelineCache = new WeakMap<
	GPUDevice,
	Map<string, GPURenderPipeline>
>();
const uniformData = new Float32Array(8);

function getDevicePipelines(device: GPUDevice): Map<string, GPURenderPipeline> {
	let cache = devicePipelineCache.get(device);
	if (!cache) {
		cache = new Map();
		devicePipelineCache.set(device, cache);
	}
	return cache;
}

export async function drawAudioSignalExtractorNode(
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	pass: GPURenderPassEncoder,
	props: AudioSignalExtractorNodeProps,
): Promise<void> {
	const config = props.signalConfig as Record<string, unknown> | undefined;
	const nodeId =
		props.nodeId ?? (config?.nodeId as string) ?? "audio-extractor";
	const frame = props.frame ?? 0;
	const fps = props.fps ?? 24;
	const width = props.width ?? 512;
	const height = props.height ?? 512;

	const elapsedMs =
		props.elapsedMs !== undefined ? props.elapsedMs : (frame / fps) * 1000;
	const durationMs = props.durationMs !== undefined ? props.durationMs : 0;
	const elapsedTimeSec = elapsedMs / 1000;
	const durationSec = durationMs / 1000;

	// Resolve dynamic 2D evaluated moving window signal texture view centered at baseTime
	const signalView = signalRegistry.getOrCreate2DTextureView(
		ctx.device,
		encoder,
		nodeId,
		elapsedTimeSec,
		durationSec,
		config ?? props,
		width,
		height,
		props.renderId,
		frame,
		fps,
	);

	const pipelines = getDevicePipelines(ctx.device);
	const cacheKey = `audio_preview_${ctx.renderer.format}`;
	let pipeline = pipelines.get(cacheKey);

	if (!pipeline) {
		const shaderModule = ctx.device.createShaderModule({
			label: "audio_signal_preview.wgsl",
			code: STATIC_AUDIO_SIGNAL_PREVIEW_SHADER,
		});

		pipeline = ctx.device.createRenderPipeline({
			label: "AudioSignalPreviewPipeline",
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

	const sensitivity =
		typeof config?.sensitivity === "number"
			? config.sensitivity
			: (props.sensitivity ?? 1.0);
	const hasBeat =
		props.extractionMode === "transient_beat" ||
		config?.extractionMode === "transient_beat"
			? 1.0
			: 0.0;

	const calculatedStats =
		signalRegistry.getStats(nodeId) ??
		(config?.nodeId
			? signalRegistry.getStats(config.nodeId as string)
			: undefined);
	const minVal = calculatedStats?.min ?? 0.0;
	const maxVal = calculatedStats?.max ?? 1.0;

	uniformData[0] = sensitivity;
	uniformData[1] = elapsedTimeSec;
	uniformData[2] = width;
	uniformData[3] = height;
	uniformData[4] = 0.0; // previewMode
	uniformData[5] = hasBeat;
	uniformData[6] = minVal;
	uniformData[7] = maxVal;

	const uBuffer = ctx.renderer.getTemporaryBuffer(uniformData);
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const bindGroup0 = ctx.device.createBindGroup({
		layout: pipeline.getBindGroupLayout(0),
		entries: [{ binding: 0, resource: { buffer: uBuffer } }],
	});

	const bindGroup1 = ctx.device.createBindGroup({
		layout: pipeline.getBindGroupLayout(1),
		entries: [
			{ binding: 0, resource: signalView },
			{ binding: 1, resource: sampler },
		],
	});

	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup0);
	pass.setBindGroup(1, bindGroup1);
	pass.draw(4);
}
