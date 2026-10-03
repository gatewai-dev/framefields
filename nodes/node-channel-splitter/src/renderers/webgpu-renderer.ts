/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import type { ChannelColorSpace, ChannelSplitterOp } from "../shared/index.js";

const COLOR_SPACE_MAP: Record<ChannelColorSpace, number> = {
	RGBA: 0,
	HSLA: 1,
	CMYK: 2,
	LAB: 3,
};

const WGSL_CHANNEL_SPLITTER = `
struct SplitterUniforms {
	colorSpace   : f32, // 0=RGBA, 1=HSLA, 2=CMYK, 3=LAB
	channelIndex : f32, // 0=Ch1, 1=Ch2, 2=Ch3, 3=Ch4
	_pad0        : f32,
	_pad1        : f32,
};

@group(0) @binding(0) var<uniform> u : SplitterUniforms;
@group(1) @binding(0) var srcTex     : texture_2d<f32>;
@group(1) @binding(1) var srcSamp    : sampler;

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

fn srgb2lin(v: f32) -> f32 {
	let cv = clamp(v, 0.0, 1.0);
	return select(cv / 12.92, pow((cv + 0.055) / 1.055, 2.4), cv > 0.04045);
}

fn lab_f(t: f32) -> f32 {
	return select(pow(t, 1.0 / 3.0), (7.787 * t) + (16.0 / 116.0), t <= 0.008856);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	let c = textureSample(srcTex, srcSamp, in.uv);
	let cs = u32(u.colorSpace + 0.5);
	let idx = u32(u.channelIndex + 0.5);

	var val: f32 = 0.0;

	if (cs == 0u) { // RGBA
		if (idx == 0u) { val = c.r; }
		else if (idx == 1u) { val = c.g; }
		else if (idx == 2u) { val = c.b; }
		else { val = c.a; }
	} else if (cs == 1u) { // HSLA
		let maxV = max(c.r, max(c.g, c.b));
		let minV = min(c.r, min(c.g, c.b));
		let d = maxV - minV;
		let L = (maxV + minV) * 0.5;
		let S = select(select(d / (2.0 - maxV - minV), d / (maxV + minV), L < 0.5), 0.0, d < 0.00001);
		var H: f32 = 0.0;
		if (d > 0.00001) {
			if (maxV == c.r) {
				H = ((c.g - c.b) / d + select(0.0, 6.0, c.g < c.b)) / 6.0;
			} else if (maxV == c.g) {
				H = ((c.b - c.r) / d + 2.0) / 6.0;
			} else {
				H = ((c.r - c.g) / d + 4.0) / 6.0;
			}
		}
		if (idx == 0u) { val = H; }
		else if (idx == 1u) { val = S; }
		else if (idx == 2u) { val = L; }
		else { val = c.a; }
	} else if (cs == 2u) { // CMYK
		let K = 1.0 - max(c.r, max(c.g, c.b));
		if (K >= 1.0 - 0.00001) {
			val = select(0.0, 1.0, idx == 3u);
		} else {
			let denom = 1.0 - K;
			if (idx == 0u) { val = (1.0 - c.r - K) / denom; }
			else if (idx == 1u) { val = (1.0 - c.g - K) / denom; }
			else if (idx == 2u) { val = (1.0 - c.b - K) / denom; }
			else { val = K; }
		}
	} else { // LAB
		let lr = srgb2lin(c.r);
		let lg = srgb2lin(c.g);
		let lb = srgb2lin(c.b);

		let X = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
		let Y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
		let Z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

		let x = X / 0.95047;
		let y = Y / 1.00000;
		let z = Z / 1.08883;

		let fx = lab_f(x);
		let fy = lab_f(y);
		let fz = lab_f(z);

		let L_star = 116.0 * fy - 16.0;
		let a_star = 500.0 * (fx - fy);
		let b_star = 200.0 * (fy - fz);

		let L_norm = clamp(L_star / 100.0, 0.0, 1.0);
		let a_norm = clamp((a_star + 128.0) / 255.0, 0.0, 1.0);
		let b_norm = clamp((b_star + 128.0) / 255.0, 0.0, 1.0);

		if (idx == 0u) { val = L_norm; }
		else if (idx == 1u) { val = a_norm; }
		else if (idx == 2u) { val = b_norm; }
		else { val = c.a; }
	}

	val = clamp(val, 0.0, 1.0);
	return vec4<f32>(val, val, val, 1.0);
}
`;

interface SplitterDeviceResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, SplitterDeviceResources>();
const uniformData = new Float32Array(4);

function getDeviceLayouts(device: GPUDevice): SplitterDeviceResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const uniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const textureLayout = device.createBindGroupLayout({
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

	res = {
		uniformLayout,
		textureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getPipeline(
	device: GPUDevice,
	format: GPUTextureFormat,
): { pipeline: GPURenderPipeline; resources: SplitterDeviceResources } {
	const resources = getDeviceLayouts(device);
	const key = `splitter_${format}`;
	let pipeline = resources.pipelineCache.get(key);
	if (!pipeline) {
		const module = device.createShaderModule({
			label: "ChannelSplitterShader",
			code: WGSL_CHANNEL_SPLITTER,
		});
		const layout = device.createPipelineLayout({
			bindGroupLayouts: [resources.uniformLayout, resources.textureLayout],
		});
		pipeline = device.createRenderPipeline({
			label: "ChannelSplitterPipeline",
			layout,
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		resources.pipelineCache.set(key, pipeline);
	}
	return { pipeline, resources };
}

export const ChannelSplitterWebGPURenderer: WebGPUNodeRenderer = async (
	args,
) => {
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

	const op = props.virtualMedia?.operation as ChannelSplitterOp | undefined;
	if (op?.op !== "ChannelSplitter" || !op) return;

	const sourceMedia = props.virtualMedia.children?.[0];
	if (!sourceMedia) return;

	// End previous pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	// Draw source child into temp texture
	const srcTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const srcView = srcTex.createView();

	const srcClearPass = ctx.renderer.beginFrame(
		encoder,
		srcView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	srcClearPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		sourceMedia,
		{
			...props,
			virtualMedia: sourceMedia,
			renderId: `${props.renderId}-src`,
			excludeTextures: [...(props.excludeTextures || []), srcTex],
		},
		srcView,
		srcTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// Close pass opened by drawChild
	args.pass.end();

	const colorSpace = op.colorSpace ?? "RGBA";
	const channelIndex = op.channelIndex ?? 0;

	uniformData[0] = COLOR_SPACE_MAP[colorSpace] ?? 0;
	uniformData[1] = channelIndex;
	uniformData[2] = 0;
	uniformData[3] = 0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	const { pipeline, resources } = getPipeline(ctx.device, targetTexture.format);

	const uniformBindGroup = ctx.device.createBindGroup({
		layout: resources.uniformLayout,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const textureBindGroup = ctx.device.createBindGroup({
		layout: resources.textureLayout,
		entries: [
			{ binding: 0, resource: srcView },
			{ binding: 1, resource: sampler },
		],
	});

	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"load",
	);

	finalPass.setPipeline(pipeline);
	finalPass.setBindGroup(0, uniformBindGroup);
	finalPass.setBindGroup(1, textureBindGroup);
	finalPass.draw(4, 1, 0, 0);

	args.pass = finalPass;
};
