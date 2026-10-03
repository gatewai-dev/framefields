/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { solveMonotonicSpline } from "../shared/spline.js";
import { computeHistogramFromEncoder } from "./histogram-computer.js";

// ─── LUT resolution ───────────────────────────────────────────────────────────
const LUT_SIZE = 1024;
// Use rgba8unorm at 1024 entries — gives 4× finer sampling than 256 while
// avoiding Float16 encoding issues with writeTexture.
const LUT_FORMAT: GPUTextureFormat = "rgba8unorm";
const LUT_BYTES_PER_ROW = LUT_SIZE * 4; // 4 bytes per rgba8unorm texel

// ─── RGB Curves Shader ────────────────────────────────────────────────────────
const CURVES_RGB_SHADER = /* wgsl */ `
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

@group(0) @binding(0) var t_lut : texture_2d<f32>;
@group(0) @binding(1) var s_lut : sampler;

@group(1) @binding(0) var t_src : texture_2d<f32>;
@group(1) @binding(1) var s_src : sampler;

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	let src = textureSampleLevel(t_src, s_src, in.uv, 0.0);
	if (src.a < 1e-5) { return src; }

	let rgb = src.rgb / src.a;

	let N = f32(${LUT_SIZE});
	let uv_r = (rgb.r * (N - 1.0) + 0.5) / N;
	let uv_g = (rgb.g * (N - 1.0) + 0.5) / N;
	let uv_b = (rgb.b * (N - 1.0) + 0.5) / N;

	let r_graded = textureSampleLevel(t_lut, s_lut, vec2<f32>(uv_r, 0.5), 0.0).r;
	let g_graded = textureSampleLevel(t_lut, s_lut, vec2<f32>(uv_g, 0.5), 0.0).g;
	let b_graded = textureSampleLevel(t_lut, s_lut, vec2<f32>(uv_b, 0.5), 0.0).b;

	let graded = vec3<f32>(r_graded, g_graded, b_graded);
	return vec4<f32>(graded * src.a, src.a);
}
`;

// ─── HSL Curves Shader ────────────────────────────────────────────────────────
const CURVES_HSL_SHADER = /* wgsl */ `
struct Uniforms {
	mode: u32,
	pad0: u32,
	pad1: u32,
	pad2: u32,
};

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var t_lut      : texture_2d<f32>;
@group(0) @binding(2) var s_lut      : sampler;

@group(1) @binding(0) var t_src : texture_2d<f32>;
@group(1) @binding(1) var s_src : sampler;

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
	var pos = array<vec2<f32>, 4>(
		vec2<f32>(-1.0,  1.0), vec2<f32>(1.0,  1.0),
		vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
	);
	var uv = array<vec2<f32>, 4>(
		vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0),
		vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 1.0)
	);
	return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

fn rgb_to_hsl(rgb: vec3<f32>) -> vec3<f32> {
	let r = rgb.r; let g = rgb.g; let b = rgb.b;
	let cmax = max(r, max(g, b));
	let cmin = min(r, min(g, b));
	let delta = cmax - cmin;

	var h = 0.0;
	var s = 0.0;
	let l = (cmax + cmin) * 0.5;

	if (delta > 1e-5) {
		s = delta / (1.0 - abs(2.0 * l - 1.0));
		if (cmax == r) {
			h = ((g - b) / delta) % 6.0;
		} else if (cmax == g) {
			h = (b - r) / delta + 2.0;
		} else {
			h = (r - g) / delta + 4.0;
		}
		h = h / 6.0;
		if (h < 0.0) { h = h + 1.0; }
	}
	return vec3<f32>(h, s, l);
}

fn hsl_to_rgb(hsl: vec3<f32>) -> vec3<f32> {
	let h = hsl.x; let s = hsl.y; let l = hsl.z;
	let c = (1.0 - abs(2.0 * l - 1.0)) * s;
	let x = c * (1.0 - abs((h * 6.0) % 2.0 - 1.0));
	let m = l - c * 0.5;

	var rgb = vec3<f32>(0.0);
	let hi = u32(h * 6.0) % 6u;
	if (hi == 0u) { rgb = vec3<f32>(c, x, 0.0); }
	else if (hi == 1u) { rgb = vec3<f32>(x, c, 0.0); }
	else if (hi == 2u) { rgb = vec3<f32>(0.0, c, x); }
	else if (hi == 3u) { rgb = vec3<f32>(0.0, x, c); }
	else if (hi == 4u) { rgb = vec3<f32>(x, 0.0, c); }
	else { rgb = vec3<f32>(c, 0.0, x); }
	return rgb + vec3<f32>(m);
}

fn lut_sample(x: f32) -> f32 {
	let N = f32(${LUT_SIZE});
	let uv_x = (x * (N - 1.0) + 0.5) / N;
	return textureSampleLevel(t_lut, s_lut, vec2<f32>(uv_x, 0.5), 0.0).r;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	let src = textureSampleLevel(t_src, s_src, in.uv, 0.0);
	if (src.a < 1e-5) { return src; }

	let rgb = src.rgb / src.a;
	let hsl = rgb_to_hsl(rgb);

	var out_hsl = hsl;

	if (u.mode == 0u) {
		let adj = lut_sample(hsl.x);
		out_hsl.x = fract(hsl.x + (adj - 0.5) * 2.0);
	} else if (u.mode == 1u) {
		let adj = lut_sample(hsl.x);
		out_hsl.y = clamp(hsl.y * (adj * 2.0), 0.0, 1.0);
	} else if (u.mode == 2u) {
		let adj = lut_sample(hsl.z);
		out_hsl.y = clamp(hsl.y * (adj * 2.0), 0.0, 1.0);
	} else {
		let adj = lut_sample(hsl.y);
		out_hsl.y = clamp(adj, 0.0, 1.0);
	}

	let out_rgb = clamp(hsl_to_rgb(out_hsl), vec3<f32>(0.0), vec3<f32>(1.0));
	return vec4<f32>(out_rgb * src.a, src.a);
}
`;

// ─── Device resource caches ───────────────────────────────────────────────────
interface RgbCurvesResources {
	pipeline: GPURenderPipeline;
	lutBindGroupLayout: GPUBindGroupLayout;
	srcBindGroupLayout: GPUBindGroupLayout;
}

interface HslCurvesResources {
	pipeline: GPURenderPipeline;
	uniformLayout: GPUBindGroupLayout;
	srcBindGroupLayout: GPUBindGroupLayout;
}

const rgbResourceCache = new WeakMap<GPUDevice, RgbCurvesResources>();
const hslResourceCache = new WeakMap<GPUDevice, HslCurvesResources>();

function getRgbResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): RgbCurvesResources {
	let res = rgbResourceCache.get(device);
	if (!res) {
		const lutBGL = device.createBindGroupLayout({
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
		const srcBGL = device.createBindGroupLayout({
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
			label: "curves-rgb.wgsl",
			code: CURVES_RGB_SHADER,
		});
		const pipeline = device.createRenderPipeline({
			label: "CurvesRgbPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [lutBGL, srcBGL],
			}),
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-strip" },
		});
		res = { pipeline, lutBindGroupLayout: lutBGL, srcBindGroupLayout: srcBGL };
		rgbResourceCache.set(device, res);
	}
	return res;
}

function getHslResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): HslCurvesResources {
	let res = hslResourceCache.get(device);
	if (!res) {
		const uniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
			],
		});
		const srcBGL = device.createBindGroupLayout({
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
			label: "curves-hsl.wgsl",
			code: CURVES_HSL_SHADER,
		});
		const pipeline = device.createRenderPipeline({
			label: "CurvesHslPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [uniformLayout, srcBGL],
			}),
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-strip" },
		});
		res = { pipeline, uniformLayout, srcBindGroupLayout: srcBGL };
		hslResourceCache.set(device, res);
	}
	return res;
}

// ─── LUT texture cache ────────────────────────────────────────────────────────
// Content-addressed: instances with equal curves share one LUT, and distinct
// curves never evict each other mid-frame (a node-keyed slot would destroy a
// texture another instance's pending pass still samples). LRU-bounded so
// animated curves don't grow it without limit.
const LUT_CACHE_LIMIT = 32;
const deviceTextureCache = new WeakMap<GPUDevice, Map<string, GPUTexture>>();

function getLut(
	device: GPUDevice,
	configKey: string,
	build: () => GPUTexture,
): GPUTexture {
	let cache = deviceTextureCache.get(device);
	if (!cache) {
		cache = new Map();
		deviceTextureCache.set(device, cache);
	}
	const hit = cache.get(configKey);
	if (hit) {
		cache.delete(configKey);
		cache.set(configKey, hit);
		return hit;
	}
	const texture = build();
	cache.set(configKey, texture);
	if (cache.size > LUT_CACHE_LIMIT) {
		const [oldestKey, oldest] = cache.entries().next().value as [string, GPUTexture];
		cache.delete(oldestKey);
		oldest.destroy();
	}
	return texture;
}

function buildRgbLut(
	device: GPUDevice,
	op: Record<string, unknown>,
): GPUTexture {
	const masterSpline = solveMonotonicSpline(
		(op.master as { x: number; y: number }[]) || [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	);
	const redSpline = solveMonotonicSpline(
		(op.red as { x: number; y: number }[]) || [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	);
	const greenSpline = solveMonotonicSpline(
		(op.green as { x: number; y: number }[]) || [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	);
	const blueSpline = solveMonotonicSpline(
		(op.blue as { x: number; y: number }[]) || [
			{ x: 0, y: 0 },
			{ x: 1, y: 1 },
		],
	);

	const lutData = new Uint8Array(LUT_SIZE * 4);
	for (let i = 0; i < LUT_SIZE; i++) {
		const u = i / (LUT_SIZE - 1);
		const masterVal = masterSpline(u);
		const r = Math.max(0, Math.min(1, redSpline(masterVal)));
		const g = Math.max(0, Math.min(1, greenSpline(masterVal)));
		const b = Math.max(0, Math.min(1, blueSpline(masterVal)));
		lutData[i * 4 + 0] = Math.round(r * 255);
		lutData[i * 4 + 1] = Math.round(g * 255);
		lutData[i * 4 + 2] = Math.round(b * 255);
		lutData[i * 4 + 3] = 255;
	}

	const texture = device.createTexture({
		size: [LUT_SIZE, 1, 1],
		dimension: "2d",
		format: LUT_FORMAT,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture(
		{ texture },
		lutData,
		{ bytesPerRow: LUT_BYTES_PER_ROW },
		[LUT_SIZE, 1, 1],
	);
	return texture;
}

function buildHslLut(
	device: GPUDevice,
	points: { x: number; y: number }[],
): GPUTexture {
	const spline = solveMonotonicSpline(points);
	const lutData = new Uint8Array(LUT_SIZE * 4);
	for (let i = 0; i < LUT_SIZE; i++) {
		const u = i / (LUT_SIZE - 1);
		const val = Math.round(Math.max(0, Math.min(1, spline(u))) * 255);
		lutData[i * 4 + 0] = val;
		lutData[i * 4 + 1] = val;
		lutData[i * 4 + 2] = val;
		lutData[i * 4 + 3] = 255;
	}
	const texture = device.createTexture({
		size: [LUT_SIZE, 1, 1],
		dimension: "2d",
		format: LUT_FORMAT,
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	device.queue.writeTexture(
		{ texture },
		lutData,
		{ bytesPerRow: LUT_BYTES_PER_ROW },
		[LUT_SIZE, 1, 1],
	);
	return texture;
}

const HSL_MODE_MAP: Record<string, number> = {
	"hue-vs-hue": 0,
	"hue-vs-sat": 1,
	"lum-vs-sat": 2,
	"sat-vs-sat": 3,
};
const HSL_CURVE_KEY_MAP: Record<string, string> = {
	"hue-vs-hue": "hueVsHue",
	"hue-vs-sat": "hueVsSat",
	"lum-vs-sat": "lumVsSat",
	"sat-vs-sat": "satVsSat",
};

// ─── Main renderer ─────────────────────────────────────────────────────────────
export const CurvesWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as Record<string, unknown> & {
		op?: string;
	};
	if (op?.op !== "Curves" || !props.virtualMedia?.children?.[0]) return;

	pass.end();

	const childMedia = props.virtualMedia.children[0];
	const width = targetWidth;
	const height = targetHeight;
	const nodeId = (op.nodeId as string) || "curves_fallback";
	const curveType = (op.curveType as string) || "rgb";

	// ── Capture child input frame ───────────────────────────────────────────
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
		{ ...props, virtualMedia: childMedia },
		tmpView,
		tmpTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// ── LUT / grading pass ──────────────────────────────────────────────────
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	if (curveType === "rgb") {
		const configKey = JSON.stringify({
			curveType,
			master: op.master,
			red: op.red,
			green: op.green,
			blue: op.blue,
		});
		const lut = getLut(ctx.device, configKey, () => buildRgbLut(ctx.device, op));
		const { pipeline, lutBindGroupLayout, srcBindGroupLayout } =
			getRgbResources(ctx.device, ctx.renderer.format);
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
				layout: lutBindGroupLayout,
				entries: [
					{ binding: 0, resource: lut.createView() },
					{ binding: 1, resource: sampler },
				],
			}),
		);
		renderPass.setBindGroup(
			1,
			ctx.renderer.bindGroupCache.getBindGroup(
				ctx.device,
				srcBindGroupLayout,
				tmpTex,
				sampler,
			),
		);
		renderPass.draw(4);
		renderPass.end();
	} else {
		const hslCurveKey = HSL_CURVE_KEY_MAP[curveType];
		const hslPoints = (op[hslCurveKey] as { x: number; y: number }[]) || [
			{ x: 0, y: 0.5 },
			{ x: 1, y: 0.5 },
		];
		const configKey = JSON.stringify({ curveType, points: hslPoints });
		const lut = getLut(ctx.device, configKey, () => buildHslLut(ctx.device, hslPoints));
		const uniformData = new Uint32Array([
			HSL_MODE_MAP[curveType] ?? 0,
			0,
			0,
			0,
		]);
		const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);
		const { pipeline, uniformLayout, srcBindGroupLayout } = getHslResources(
			ctx.device,
			ctx.renderer.format,
		);
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
				entries: [
					{ binding: 0, resource: { buffer: uniformBuffer } },
					{ binding: 1, resource: lut.createView() },
					{ binding: 2, resource: sampler },
				],
			}),
		);
		renderPass.setBindGroup(
			1,
			ctx.renderer.bindGroupCache.getBindGroup(
				ctx.device,
				srcBindGroupLayout,
				tmpTex,
				sampler,
			),
		);
		renderPass.draw(4);
		renderPass.end();
	}

	// ── Histogram compute — runs in the SAME encoder so outTex data is valid ─
	computeHistogramFromEncoder(ctx.device, encoder, outTex, nodeId);

	// ── Final composite to target ──────────────────────────────────────────
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
	(args as Record<string, unknown>).pass = finalPass;
};
