/// <reference types="webgpu" />
/**
 * Op art: Optical art from the layer: stripes, rings, checks or waves whose lines bend with the image's brightness and thicken in its darks — line-art portraits and Bridget Riley warps.
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

const OP = "OpArt";
const UNIFORM_FLOATS = 20;

/** One fragment shader per pass; pass 0 reads the layer, later passes read the previous pass. */
const PASSES = [
	`struct U { v : array<vec4<f32>, 5> };
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
	let pattern = u32(u.v[1].x + 0.5);
	let frequency = u.v[1].y;
	let angle = u.v[1].z;
	let warp = u.v[1].w;
	let source = u.v[2].x;
	let colorA = u.v[3];
	let colorB = u.v[4];

	let R = res();
	let c = sampleS(in.uv);
	let l = luma(c.rgb) * c.a + (1.0 - c.a);
	var p = (in.uv - 0.5) * vec2<f32>(R.x / R.y, 1.0);
	p = rot2(radians(angle)) * p;
	var v = p.y * frequency;
	if (pattern == 1u) { v = length(p) * frequency; }
	if (pattern == 3u) { v = p.y * frequency + sin(p.x * frequency * 0.25) * 2.0; }
	v += (1.0 - l) * warp * 3.0;
	var v2 = p.x * frequency + (1.0 - l) * warp * 3.0;
	let duty = mix(0.5, clamp(1.0 - l, 0.05, 0.95), source);
	let e = max(fwidth(v), 1e-4);
	let e2 = max(fwidth(v2), 1e-4);
	let s = fract(v);
	var ink = smoothstep(duty + e, duty - e, s) * smoothstep(-e, e, s);
	if (pattern == 2u) {
		let s2 = fract(v2);
		let a = step(0.5, s);
		let b = step(0.5, s2);
		ink = abs(a - b);
		ink = mix(ink, 1.0 - ink, step(duty, 0.5) * 0.0);
		let edgeA = smoothstep(0.0, e, min(s, 1.0 - s)) * smoothstep(0.0, e, abs(s - 0.5));
		let edgeB = smoothstep(0.0, e2, min(s2, 1.0 - s2)) * smoothstep(0.0, e2, abs(s2 - 0.5));
		ink = mix(0.5, ink, edgeA * edgeB);
	}
	return vec4<f32>(mix(colorB.rgb, colorA.rgb, ink), 1.0);
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

function hexToRgba(hex: string): [number, number, number, number] {
	let h = hex.trim().replace("#", "");
	if (h.length === 3 || h.length === 4) {
		h = [...h].map((c) => c + c).join("");
	}
	const n = (i: number) => Number.parseInt(h.slice(i, i + 2), 16) / 255;
	return [n(0), n(2), n(4), h.length >= 8 ? n(6) : 1];
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
	data[4] = Math.max(
		0,
		["stripes", "rings", "checker", "waves"].indexOf(
			String(raw.pattern ?? "stripes"),
		),
	);
	data[5] = num(raw.frequency, 48);
	data[6] = num(raw.angle, 0);
	data[7] = num(raw.warp, 0.6);
	data[8] = num(raw.source, 1);
	data.set(hexToRgba(String(raw.colorA ?? "#0a0a0a")), 12);
	data.set(hexToRgba(String(raw.colorB ?? "#f5f5f5")), 16);
}

export const OpArtWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
