/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { parseColor, signalRegistry } from "@framefields/webgpu-renderers";
import type { GradientMapOperation, GradientStop } from "../shared/config.js";

type GradientMapSignalData = SignalData & { nodeId?: string };

interface GradientMapOp extends GradientMapOperation {
	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: {
				type: string;
				data: unknown;
			} | null;
		}
	>;
}

interface DeviceGradientMapResources {
	pipeline: GPURenderPipeline;
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	signalLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<
	GPUDevice,
	DeviceGradientMapResources
>();

const WGSL_GRADIENT_MAP_SHADER = `
struct GradientStop {
	pos : vec4<f32>,
	col : vec4<f32>,
};

struct GradientMapUniforms {
	numStops      : f32,
	isSmooth      : f32,
	dither        : f32,
	opacity       : f32,

	hasOpacitySig : f32,
	pad0          : f32,
	pad1          : f32,
	pad2          : f32,

	stops         : array<GradientStop, 16>,
};

@group(0) @binding(0) var<uniform> u : GradientMapUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;
@group(2) @binding(0) var opacitySigTex : texture_2d<f32>;
@group(2) @binding(1) var signalSamp    : sampler;

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

fn ditherNoise(pos: vec2<f32>) -> f32 {
	let p = fract(pos * vec2<f32>(0.1031, 0.1030));
	let d = dot(p, p.yx + 33.33);
	return fract((p.x + p.y) * d) - 0.5;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let color = textureSampleLevel(tex, samp, in.uv, 0.0);
	if (color.a <= 0.00001) {
		return color;
	}

	let alpha = color.a;
	let rgb = color.rgb / max(alpha, 0.0001);

	// ITU-R BT.709 Luminance
	var lum = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));

	if (u.dither > 0.5) {
		let d = ditherNoise(in.pos.xy) * (1.0 / 255.0);
		lum = clamp(lum + d, 0.0, 1.0);
	} else {
		lum = clamp(lum, 0.0, 1.0);
	}

	let count = i32(clamp(u.numStops, 2.0, 16.0));
	var gradColor = u.stops[0].col.rgb;

	if (lum <= u.stops[0].pos.x) {
		gradColor = u.stops[0].col.rgb;
	} else if (lum >= u.stops[count - 1].pos.x) {
		gradColor = u.stops[count - 1].col.rgb;
	} else {
		for (var i = 0; i < 15; i = i + 1) {
			if (i >= count - 1) {
				break;
			}
			let p0 = u.stops[i].pos.x;
			let p1 = u.stops[i + 1].pos.x;

			if (lum >= p0 && lum <= p1) {
				let range = max(p1 - p0, 1e-5);
				let t = clamp((lum - p0) / range, 0.0, 1.0);
				if (u.isSmooth > 0.5) {
					gradColor = mix(u.stops[i].col.rgb, u.stops[i + 1].col.rgb, t);
				} else {
					gradColor = u.stops[i].col.rgb;
				}
				break;
			}
		}
	}

	var opacity = u.opacity;
	if (u.hasOpacitySig > 0.5) {
		opacity = textureSampleLevel(opacitySigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	opacity = clamp(opacity, 0.0, 1.0);

	let finalRgb = mix(rgb, gradColor, opacity);
	return vec4<f32>(finalRgb * alpha, alpha);
}
`;

function getGradientMapResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): DeviceGradientMapResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const uniformLayout = device.createBindGroupLayout({
		label: "GradientMapUniformLayout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const textureLayout = device.createBindGroupLayout({
		label: "GradientMapTextureLayout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	const signalLayout = device.createBindGroupLayout({
		label: "GradientMapSignalLayout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	const module = device.createShaderModule({
		label: "GradientMapShaderModule",
		code: WGSL_GRADIENT_MAP_SHADER,
	});

	const pipeline = device.createRenderPipeline({
		label: "GradientMapPipeline",
		layout: device.createPipelineLayout({
			bindGroupLayouts: [uniformLayout, textureLayout, signalLayout],
		}),
		vertex: { module, entryPoint: "vs" },
		fragment: { module, entryPoint: "fs", targets: [{ format }] },
		primitive: { topology: "triangle-strip" },
	});

	res = {
		pipeline,
		uniformLayout,
		textureLayout,
		signalLayout,
	};
	deviceResourceCache.set(device, res);
	return res;
}

const uniformBufferData = new Float32Array(136);

export const GradientMapWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		encoder,
		pass,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		props,
		drawChild,
	} = args;

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;

	const op = props.virtualMedia?.operation as unknown as
		| GradientMapOp
		| undefined;

	if (op?.op !== "GradientMap" || !props.virtualMedia?.children?.[0]) return;

	pass.end();

	const childMedia = props.virtualMedia.children[0];
	const width = targetWidth;
	const height = targetHeight;

	const tmpTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	const childPass = ctx.renderer.beginFrame(
		encoder,
		tmpView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
		},
		tmpView,
		tmpTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// Parse stops
	const rawStops: GradientStop[] = Array.isArray(op.stops)
		? op.stops
		: [
				{ position: 0.0, color: "#000000" },
				{ position: 1.0, color: "#ffffff" },
			];

	const sortedStops = [...rawStops].sort((a, b) => a.position - b.position);
	const numStops = Math.min(Math.max(sortedStops.length, 2), 16);

	// Resolve opacity signal
	const opacityHandleId = op.opacityHandleId;
	const opacitySignalInput = opacityHandleId
		? op.inputs?.[opacityHandleId]
		: null;

	const hasOpacitySig = !!(
		opacitySignalInput?.connectionValid &&
		opacitySignalInput.outputItem?.type === "Signal"
	);
	const opacitySigData = (
		hasOpacitySig ? opacitySignalInput?.outputItem?.data : null
	) as GradientMapSignalData | null;

	let opacityVal = Number(op.opacity ?? 1.0);
	if (
		!hasOpacitySig &&
		opacitySignalInput?.connectionValid &&
		opacitySignalInput.outputItem?.type === "Number"
	) {
		opacityVal = Number(opacitySignalInput.outputItem.data ?? 1.0);
	}

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	let opacityView: GPUTextureView;
	if (hasOpacitySig && opacitySigData) {
		opacityView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			opacitySigData.nodeId ?? "gradient_map_opacity",
			elapsedSeconds,
			durationSeconds,
			opacitySigData,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		opacityView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	// Build uniform data (136 floats = 544 bytes)
	uniformBufferData.fill(0);
	uniformBufferData[0] = numStops;
	uniformBufferData[1] = op.smooth === false ? 0.0 : 1.0;
	uniformBufferData[2] = op.dither === false ? 0.0 : 1.0;
	uniformBufferData[3] = opacityVal;
	uniformBufferData[4] = hasOpacitySig ? 1.0 : 0.0;
	uniformBufferData[5] = 0.0;
	uniformBufferData[6] = 0.0;
	uniformBufferData[7] = 0.0;

	for (let i = 0; i < 16; i++) {
		const stop = sortedStops[Math.min(i, numStops - 1)];
		const baseIdx = 8 + i * 8;
		const parsed = parseColor(stop.color);
		// pos: vec4<f32>
		uniformBufferData[baseIdx + 0] = stop.position;
		uniformBufferData[baseIdx + 1] = 0.0;
		uniformBufferData[baseIdx + 2] = 0.0;
		uniformBufferData[baseIdx + 3] = 0.0;
		// col: vec4<f32>
		uniformBufferData[baseIdx + 4] = parsed.r;
		uniformBufferData[baseIdx + 5] = parsed.g;
		uniformBufferData[baseIdx + 6] = parsed.b;
		uniformBufferData[baseIdx + 7] = parsed.a;
	}

	const { pipeline, uniformLayout, textureLayout, signalLayout } =
		getGradientMapResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);
	const buffer = ctx.renderer.getTemporaryBuffer(uniformBufferData);

	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	const renderPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	renderPass.setPipeline(pipeline);
	renderPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uniformLayout,
			entries: [{ binding: 0, resource: { buffer } }],
		}),
	);
	renderPass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			textureLayout,
			tmpTex,
			sampler,
		),
	);
	renderPass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: signalLayout,
			entries: [
				{ binding: 0, resource: opacityView },
				{ binding: 1, resource: sampler },
			],
		}),
	);
	renderPass.draw(4);
	renderPass.end();

	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(
		finalPass,
		outTex,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: props.opacity ?? 1 },
	);

	(args as unknown as { pass: GPURenderPassEncoder }).pass = finalPass;
};
