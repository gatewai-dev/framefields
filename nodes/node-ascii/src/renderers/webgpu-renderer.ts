/// <reference types="webgpu" />
/**
 * ASCII: The layer as text characters: each cell picks a glyph from ` .:-=+*#%@` by brightness. Monochrome terminal, source colors, or green phosphor.
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

const OP = "Ascii";
const UNIFORM_FLOATS = 16;

/** One fragment shader per pass; pass 0 reads the layer, later passes read the previous pass. */
const PASSES = [
	`struct U { v : array<vec4<f32>, 4> };
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
const GLYPH_BITS = array<u32, 10>(0u, 4194304u, 131200u, 14336u, 459200u, 145536u, 332096u, 11512810u, 27070835u, 15652782u);
@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let time = u.v[0].x;
	let frame = u.v[0].y;
	let cellSize = u.v[1].x;
	let colorMode = u32(u.v[1].y + 0.5);
	let fg = u.v[2];
	let bg = u.v[3];
	let contrast = u.v[1].z;
	let invert = u.v[1].w;

	let R = res();
	let cs = max(cellSize, 2.0);
	let cp = floor(in.uv * R / cs);
	let col = sampleS((cp + 0.5) * cs / R);
	var l = clamp((luma(col.rgb) - 0.5) * contrast + 0.5, 0.0, 1.0) * col.a;
	if (invert > 0.5) { l = 1.0 - l; }
	let idx = min(u32(l * 9.999), 9u);
	let f = in.uv * R / cs - cp;
	let gx = i32(floor(f.x * 6.0));
	let gy = i32(floor(f.y * 6.0));
	var on = 0.0;
	if (gx < 5 && gy < 5) {
		on = f32((GLYPH_BITS[idx] >> u32(gy * 5 + gx)) & 1u);
	}
	var fgc = fg.rgb;
	if (colorMode == 1u) { fgc = col.rgb * 1.25; }
	if (colorMode == 2u) { fgc = vec3<f32>(0.25, 1.0, 0.45) * (0.4 + 0.6 * l); }
	return vec4<f32>(mix(bg.rgb, fgc, on), 1.0);
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
	data[4] = num(raw.cellSize, 10);
	data[5] = Math.max(
		0,
		["mono", "source", "green"].indexOf(String(raw.colorMode ?? "mono")),
	);
	data.set(hexToRgba(String(raw.fg ?? "#e8e8e8")), 8);
	data.set(hexToRgba(String(raw.bg ?? "#0b0b0b")), 12);
	data[6] = num(raw.contrast, 1.2);
	data[7] = raw.invert === undefined ? 0 : raw.invert ? 1 : 0;
}

export const AsciiWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
