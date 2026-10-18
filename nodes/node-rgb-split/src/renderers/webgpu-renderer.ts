/// <reference types="webgpu" />
/**
 * RGB split: Chromatic aberration: red and blue pulled apart from green, along an angle or radially from the center like a cheap lens.
 */
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import {
	drawChildToTexture,
	drawFullscreenPass,
	drawTextureToTarget,
	FULLSCREEN_QUAD_WGSL,
	fragmentBindGroupLayout,
	perDevice,
} from "@framefields/node-sdk/gpu";

const OP = "RGBSplit";
const UNIFORM_FLOATS = 8;

/** One fragment shader per pass; pass 0 reads the layer, later passes read the previous pass. */
const PASSES = [
	`struct U { v : array<vec4<f32>, 2> };
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var src : texture_2d<f32>;
@group(0) @binding(2) var prev : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;
${FULLSCREEN_QUAD_WGSL}

fn straight(c : vec4<f32>) -> vec4<f32> {
	if (c.a <= 0.0001) { return vec4<f32>(0.0); }
	return vec4<f32>(c.rgb / c.a, c.a);
}
fn premul(c : vec4<f32>) -> vec4<f32> { return vec4<f32>(c.rgb * c.a, c.a); }
fn res() -> vec2<f32> { return vec2<f32>(textureDimensions(src)); }
/** Straight-alpha color of the layer at a uv (filtered). */
fn sampleS(uv : vec2<f32>) -> vec4<f32> { return straight(textureSampleLevel(src, samp, uv, 0.0)); }
/** Premultiplied color of the layer at a uv (filtered). */
fn sampleP(uv : vec2<f32>) -> vec4<f32> { return textureSampleLevel(src, samp, uv, 0.0); }
/** Straight-alpha color of the layer's texel at a pixel position (nearest). */
fn texelS(p : vec2<f32>) -> vec4<f32> {
	let d = vec2<i32>(textureDimensions(src));
	let q = clamp(vec2<i32>(floor(p)), vec2<i32>(0), d - vec2<i32>(1));
	return straight(textureLoad(src, q, 0));
}
fn luma(c : vec3<f32>) -> f32 { return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)); }
fn hash12(p : vec2<f32>) -> f32 {
	var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p : vec2<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash12(i), hash12(i + vec2<f32>(1.0, 0.0)), u.x),
		mix(hash12(i + vec2<f32>(0.0, 1.0)), hash12(i + vec2<f32>(1.0, 1.0)), u.x), u.y);
}
/** 8x8 ordered-dither threshold, 0..1. */
fn bayer8(p : vec2<f32>) -> f32 {
	let x = u32(p.x) & 7u;
	let y = u32(p.y) & 7u;
	var v = 0u;
	for (var k = 0u; k < 3u; k++) {
		let bx = (x >> k) & 1u;
		let by = (y >> k) & 1u;
		let m = ((bx ^ by) << 1u) | by;
		v += m * (1u << (2u * (2u - k)));
	}
	return (f32(v) + 0.5) / 64.0;
}
fn rot2(a : f32) -> mat2x2<f32> { let c = cos(a); let s = sin(a); return mat2x2<f32>(c, s, -s, c); }
@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let time = u.v[0].x;
	let frame = u.v[0].y;
	let amount = u.v[1].x;
	let angle = u.v[1].y;
	let radial = u.v[1].z;

	let R = res();
	let a = radians(angle);
	var d = vec2<f32>(cos(a), sin(a)) * amount / R;
	if (radial > 0.5) { d = (in.uv - 0.5) * 2.0 * amount / R; }
	let cr = sampleP(in.uv + d);
	let cg = sampleP(in.uv);
	let cb = sampleP(in.uv - d);
	return vec4<f32>(cr.r, cg.g, cb.b, max(max(cr.a, cg.a), cb.a));
}
`,
];

const resources = perDevice((device: GPUDevice) => ({
	layout: fragmentBindGroupLayout(
		device,
		["uniform", "texture", "texture", "sampler"],
		`${OP}_layout`,
	),
	pipelines: new Map<GPUTextureFormat, GPURenderPipeline[]>(),
	sampler: device.createSampler({
		magFilter: "linear",
		minFilter: "linear",
		addressModeU: "clamp-to-edge",
		addressModeV: "clamp-to-edge",
	}),
}));

function pipelinesFor(
	device: GPUDevice,
	format: GPUTextureFormat,
): GPURenderPipeline[] {
	const r = resources(device);
	let list = r.pipelines.get(format);
	if (!list) {
		list = PASSES.map((code, i) => {
			const module = device.createShaderModule({
				code,
				label: `${OP}_${i}.wgsl`,
			});
			return device.createRenderPipeline({
				label: `${OP}_${i}`,
				layout: device.createPipelineLayout({ bindGroupLayouts: [r.layout] }),
				vertex: { module, entryPoint: "vs" },
				fragment: { module, entryPoint: "fs", targets: [{ format }] },
				primitive: { topology: "triangle-strip" },
			});
		});
		r.pipelines.set(format, list);
	}
	return list;
}

function num(v: unknown, fallback: number): number {
	const n = typeof v === "number" ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
}

/** Packs the effect's resolved props into the uniform block the shaders read. */
function pack(
	raw: Record<string, unknown>,
	data: Float32Array,
	time: number,
	frame: number,
): void {
	data.fill(0);
	data[0] = time;
	data[1] = frame;
	data[4] = num(raw.amount, 8);
	data[5] = num(raw.angle, 0);
	data[6] = raw.radial === undefined ? 0 : raw.radial ? 1 : 0;
}

export const RGBSplitWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		encoder,
		pass,
		targetTexture,
		targetWidth,
		targetHeight,
		props,
	} = args;
	const op = props.virtualMedia?.operation as
		| ({
				op?: string;
				effect?: {
					resolveUniforms?: (ctx: unknown) => Record<string, unknown>;
				};
		  } & Record<string, unknown>)
		| undefined;
	if (op?.op !== OP) return;
	const child = props.virtualMedia?.children?.[0];
	if (!child) return;
	pass.end();

	const fps = props.fps || 30;
	const frame = Math.round(props.compositionFrame ?? props.frame ?? 0);
	const raw = op.effect?.resolveUniforms
		? op.effect.resolveUniforms({ frame, fps, time: frame / fps })
		: op;
	const data = new Float32Array(UNIFORM_FLOATS);
	pack(raw, data, frame / fps, frame);

	const { texture: childTex } = await drawChildToTexture(args, child);
	const device = ctx.device;
	const r = resources(device);
	const pipelines = pipelinesFor(device, ctx.renderer.format);
	const ubo = ctx.renderer.getTemporaryBuffer(data);
	let prev = childTex;
	for (const pipeline of pipelines) {
		const out = ctx.renderer.getTemporaryTexture(targetWidth, targetHeight, [
			childTex,
			prev,
			targetTexture,
			...(props.excludeTextures || []),
		]);
		drawFullscreenPass(encoder, out.createView(), pipeline, [
			device.createBindGroup({
				layout: r.layout,
				entries: [
					{ binding: 0, resource: { buffer: ubo } },
					{ binding: 1, resource: childTex.createView() },
					{ binding: 2, resource: prev.createView() },
					{ binding: 3, resource: r.sampler },
				],
			}),
		]);
		prev = out;
	}
	drawTextureToTarget(args, prev);
};
