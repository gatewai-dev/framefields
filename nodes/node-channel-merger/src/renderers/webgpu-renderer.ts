/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import type { ChannelColorSpace, ChannelMergerOp } from "../shared/index.js";

const COLOR_SPACE_MAP: Record<ChannelColorSpace, number> = {
	RGBA: 0,
	HSLA: 1,
	CMYK: 2,
	LAB: 3,
};

const WGSL_CHANNEL_MERGER = `
struct MergerUniforms {
	colorSpace   : f32, // 0=RGBA, 1=HSLA, 2=CMYK, 3=LAB
	hasCh4       : f32, // 0 or 1
	defaultCh4   : f32, // fallback value (1.0 for alpha, 0.0 for CMYK black)
	_pad0        : f32,
};

@group(0) @binding(0) var<uniform> u : MergerUniforms;
@group(1) @binding(0) var tex1      : texture_2d<f32>;
@group(1) @binding(1) var tex2      : texture_2d<f32>;
@group(1) @binding(2) var tex3      : texture_2d<f32>;
@group(1) @binding(3) var tex4      : texture_2d<f32>;
@group(1) @binding(4) var samp      : sampler;

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

fn hue2rgb(p: f32, q: f32, t_in: f32) -> f32 {
	var t = t_in;
	if (t < 0.0) { t = t + 1.0; }
	if (t > 1.0) { t = t - 1.0; }
	if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
	if (t < 1.0 / 2.0) { return q; }
	if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
	return p;
}

fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3<f32> {
	if (s <= 0.00001) {
		return vec3<f32>(l, l, l);
	}
	let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
	let p = 2.0 * l - q;
	let r = hue2rgb(p, q, h + 1.0 / 3.0);
	let g = hue2rgb(p, q, h);
	let b = hue2rgb(p, q, h - 1.0 / 3.0);
	return vec3<f32>(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0));
}

fn inv_lab_f(t: f32) -> f32 {
	let t3 = t * t * t;
	return select((t - 16.0 / 116.0) / 7.787, t3, t3 > 0.008856);
}

fn lin2srgb(v: f32) -> f32 {
	let c = clamp(v, 0.0, 1.0);
	return select(c * 12.92, 1.055 * pow(c, 1.0 / 2.4) - 0.055, c > 0.0031308);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	let c1 = textureSample(tex1, samp, in.uv);
	let c2 = textureSample(tex2, samp, in.uv);
	let c3 = textureSample(tex3, samp, in.uv);
	let c4 = textureSample(tex4, samp, in.uv);

	let v1 = c1.r;
	let v2 = c2.r;
	let v3 = c3.r;
	let v4 = select(u.defaultCh4, c4.r, u.hasCh4 > 0.5);

	let cs = u32(u.colorSpace + 0.5);

	if (cs == 0u) { // RGBA
		return vec4<f32>(clamp(v1, 0.0, 1.0), clamp(v2, 0.0, 1.0), clamp(v3, 0.0, 1.0), clamp(v4, 0.0, 1.0));
	} else if (cs == 1u) { // HSLA
		let rgb = hsl2rgb(fract(v1), clamp(v2, 0.0, 1.0), clamp(v3, 0.0, 1.0));
		return vec4<f32>(rgb, clamp(v4, 0.0, 1.0));
	} else if (cs == 2u) { // CMYK
		let C = clamp(v1, 0.0, 1.0);
		let M = clamp(v2, 0.0, 1.0);
		let Y = clamp(v3, 0.0, 1.0);
		let K = clamp(v4, 0.0, 1.0);
		let r = (1.0 - C) * (1.0 - K);
		let g = (1.0 - M) * (1.0 - K);
		let b = (1.0 - Y) * (1.0 - K);
		return vec4<f32>(clamp(r, 0.0, 1.0), clamp(g, 0.0, 1.0), clamp(b, 0.0, 1.0), 1.0);
	} else { // LAB
		let L_norm = clamp(v1, 0.0, 1.0);
		let a_norm = clamp(v2, 0.0, 1.0);
		let b_norm = clamp(v3, 0.0, 1.0);

		let L_star = L_norm * 100.0;
		let a_star = a_norm * 255.0 - 128.0;
		let b_star = b_norm * 255.0 - 128.0;

		let fy = (L_star + 16.0) / 116.0;
		let fx = fy + a_star / 500.0;
		let fz = fy - b_star / 200.0;

		let x = inv_lab_f(fx);
		let y = inv_lab_f(fy);
		let z = inv_lab_f(fz);

		let X = x * 0.95047;
		let Y = y * 1.00000;
		let Z = z * 1.08883;

		let lr =  3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
		let lg = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
		let lb =  0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;

		return vec4<f32>(lin2srgb(lr), lin2srgb(lg), lin2srgb(lb), clamp(v4, 0.0, 1.0));
	}
}
`;

interface MergerDeviceResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, MergerDeviceResources>();
const uniformData = new Float32Array(4);

function getDeviceLayouts(device: GPUDevice): MergerDeviceResources {
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
				texture: { sampleType: "float" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 4,
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
): { pipeline: GPURenderPipeline; resources: MergerDeviceResources } {
	const resources = getDeviceLayouts(device);
	const key = `merger_${format}`;
	let pipeline = resources.pipelineCache.get(key);
	if (!pipeline) {
		const module = device.createShaderModule({
			label: "ChannelMergerShader",
			code: WGSL_CHANNEL_MERGER,
		});
		const layout = device.createPipelineLayout({
			bindGroupLayouts: [resources.uniformLayout, resources.textureLayout],
		});
		pipeline = device.createRenderPipeline({
			label: "ChannelMergerPipeline",
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

export const ChannelMergerWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as ChannelMergerOp | undefined;
	if (op?.op !== "ChannelMerger" || !op) return;

	const ch1Media = op.channel1Media ?? props.virtualMedia.children?.[0];
	const ch2Media = op.channel2Media;
	const ch3Media = op.channel3Media;
	const ch4Media = op.channel4Media;

	if (!ch1Media || !ch2Media || !ch3Media) return;

	// End previous pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	// 1. Draw Channel 1
	const tex1 = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const view1 = tex1.createView();
	const pass1 = ctx.renderer.beginFrame(
		encoder,
		view1,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	pass1.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		ch1Media,
		{
			...props,
			virtualMedia: ch1Media,
			renderId: `${props.renderId}-ch1`,
			excludeTextures: [...(props.excludeTextures || []), tex1],
		},
		view1,
		tex1,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();
	args.pass.end();

	// 2. Draw Channel 2
	const tex2 = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
		tex1,
	]);
	const view2 = tex2.createView();
	const pass2 = ctx.renderer.beginFrame(
		encoder,
		view2,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	pass2.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		ch2Media,
		{
			...props,
			virtualMedia: ch2Media,
			renderId: `${props.renderId}-ch2`,
			excludeTextures: [...(props.excludeTextures || []), tex1, tex2],
		},
		view2,
		tex2,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();
	args.pass.end();

	// 3. Draw Channel 3
	const tex3 = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
		tex1,
		tex2,
	]);
	const view3 = tex3.createView();
	const pass3 = ctx.renderer.beginFrame(
		encoder,
		view3,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	pass3.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		ch3Media,
		{
			...props,
			virtualMedia: ch3Media,
			renderId: `${props.renderId}-ch3`,
			excludeTextures: [...(props.excludeTextures || []), tex1, tex2, tex3],
		},
		view3,
		tex3,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();
	args.pass.end();

	// 4. Draw Channel 4 (if connected)
	const tex4 = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
		tex1,
		tex2,
		tex3,
	]);
	const view4 = tex4.createView();
	const pass4 = ctx.renderer.beginFrame(
		encoder,
		view4,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	pass4.end();

	const hasCh4 = ch4Media ? 1.0 : 0.0;
	if (ch4Media) {
		ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
		ctx.renderer.pushIdentity();
		await drawChild(
			ch4Media,
			{
				...props,
				virtualMedia: ch4Media,
				renderId: `${props.renderId}-ch4`,
				excludeTextures: [
					...(props.excludeTextures || []),
					tex1,
					tex2,
					tex3,
					tex4,
				],
			},
			view4,
			tex4,
			width,
			height,
		);
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
		args.pass.end();
	}

	const colorSpace = op.colorSpace ?? "RGBA";
	const defaultCh4 = op.defaultChannel4 ?? (colorSpace === "CMYK" ? 0.0 : 1.0);

	uniformData[0] = COLOR_SPACE_MAP[colorSpace] ?? 0;
	uniformData[1] = hasCh4;
	uniformData[2] = defaultCh4;
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
			{ binding: 0, resource: view1 },
			{ binding: 1, resource: view2 },
			{ binding: 2, resource: view3 },
			{ binding: 3, resource: view4 },
			{ binding: 4, resource: sampler },
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
