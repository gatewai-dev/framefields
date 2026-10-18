/// <reference types="webgpu" />
/**
 * Trails: the layer over a decaying, optionally zooming / turning / drifting
 * / hue-shifting copy of its own history (echoes, light painting, feedback
 * tunnels). History lives in textures on the effect object and advances one
 * frame at a time; after a jump the last frames are replayed to rebuild it.
 */
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import {
	drawChildToTexture,
	drawFullscreenPass,
	drawTextureToTarget,
	FULLSCREEN_QUAD_WGSL,
	fragmentBindGroupLayout,
	perDevice,
	type WebGPUNodeRendererArgs,
} from "@framefields/node-sdk/gpu";
import type { TrailsMode } from "../shared/index.js";

const HISTORY_FORMAT: GPUTextureFormat = "rgba16float";

interface TrailsValues {
	decay: number;
	mode: TrailsMode;
	zoom: number;
	rotation: number;
	offsetX: number;
	offsetY: number;
	hueShift: number;
	warmup: number;
}

const TRAILS_WGSL = /* wgsl */ `
struct U { a : vec4<f32>, b : vec4<f32> };
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var historyTex : texture_2d<f32>;
@group(0) @binding(2) var currentTex : texture_2d<f32>;
@group(0) @binding(3) var samp : sampler;
${FULLSCREEN_QUAD_WGSL}

// Hue rotation in YIQ: linear, so it works on premultiplied color.
fn hueRotate(c : vec3<f32>, angle : f32) -> vec3<f32> {
	let yiq = mat3x3<f32>(0.299, 0.596, 0.211, 0.587, -0.274, -0.523, 0.114, -0.322, 0.312) * c;
	let cs = cos(angle);
	let sn = sin(angle);
	let rot = vec3<f32>(yiq.x, yiq.y * cs - yiq.z * sn, yiq.y * sn + yiq.z * cs);
	return mat3x3<f32>(1.0, 1.0, 1.0, 0.956, -0.272, -1.106, 0.621, -0.647, 1.703) * rot;
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let decay = u.a.x;
	let mode = u.a.y;
	let zoom = max(u.a.z, 1e-3);
	let angle = u.a.w;
	let offset = u.b.xy;
	let hue = u.b.z;
	let fresh = u.b.w;
	let cur = textureSampleLevel(currentTex, samp, in.uv, 0.0);
	if (fresh > 0.5) { return cur; }
	let c = in.uv - 0.5;
	let cs = cos(-angle);
	let sn = sin(-angle);
	let src = vec2<f32>(c.x * cs - c.y * sn, c.x * sn + c.y * cs) / zoom + 0.5 - offset;
	var hist = vec4<f32>(0.0);
	if (all(src >= vec2<f32>(0.0)) && all(src <= vec2<f32>(1.0))) {
		hist = textureSampleLevel(historyTex, samp, src, 0.0);
	}
	if (hue != 0.0) { hist = vec4<f32>(max(hueRotate(hist.rgb, hue), vec3<f32>(0.0)), hist.a); }
	hist *= decay;
	if (mode < 0.5) { return cur + hist * (1.0 - cur.a); }
	if (mode < 1.5) { return vec4<f32>(cur.rgb + hist.rgb, min(cur.a + hist.a, 1.0)); }
	if (mode < 2.5) { return max(cur, hist); }
	// blend: a running average, so opaque footage shows its own echoes.
	return mix(cur, hist / max(decay, 1e-4), decay);
}
`;

const resources = perDevice((device: GPUDevice) => {
	const layout = fragmentBindGroupLayout(
		device,
		["uniform", "texture", "texture", "sampler"],
		"trails_layout",
	);
	const module = device.createShaderModule({
		code: TRAILS_WGSL,
		label: "trails.wgsl",
	});
	return {
		layout,
		pipeline: device.createRenderPipeline({
			label: "trails",
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format: HISTORY_FORMAT }],
			},
			primitive: { topology: "triangle-strip" },
		}),
		sampler: device.createSampler({ magFilter: "linear", minFilter: "linear" }),
	};
});

interface History {
	device: GPUDevice;
	width: number;
	height: number;
	/** Ping-pong history; `front` holds the latest. */
	front: GPUTexture;
	back: GPUTexture;
	/** Layer frame `front` holds; -1 = none. */
	frame: number;
}

interface FeedbackEffect {
	resolveUniforms(ctx?: unknown): Record<string, unknown>;
	feedbackHistory?: History;
}

function historyFor(
	effect: FeedbackEffect,
	device: GPUDevice,
	width: number,
	height: number,
): History {
	const h = effect.feedbackHistory;
	if (h && h.device === device && h.width === width && h.height === height)
		return h;
	h?.front.destroy();
	h?.back.destroy();
	const make = (label: string) =>
		device.createTexture({
			label,
			size: [width, height],
			format: HISTORY_FORMAT,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC |
				GPUTextureUsage.COPY_DST,
		});
	const next: History = {
		device,
		width,
		height,
		front: make("trails_front"),
		back: make("trails_back"),
		frame: -1,
	};
	effect.feedbackHistory = next;
	return next;
}

async function childAt(
	args: WebGPUNodeRendererArgs,
	frame: number,
	compositionStart: number,
	h: History,
) {
	const child = args.props.virtualMedia?.children?.[0];
	if (!child) return null;
	return drawChildToTexture(args, child, {
		exclude: [h.front, h.back],
		props: {
			...args.props,
			virtualMedia: child,
			frame,
			compositionFrame: compositionStart + frame,
		},
	});
}

function swap(h: History): void {
	const t = h.front;
	h.front = h.back;
	h.back = t;
}

async function stepTrails(
	args: WebGPUNodeRendererArgs,
	h: History,
	v: TrailsValues,
	frame: number,
	compositionStart: number,
	fresh: boolean,
): Promise<void> {
	const cur = await childAt(args, frame, compositionStart, h);
	if (!cur) return;
	const r = resources(args.ctx.device);
	const uniforms = new Float32Array([
		v.decay,
		{ over: 0, add: 1, max: 2, blend: 3 }[v.mode] ?? 0,
		v.zoom,
		(v.rotation * Math.PI) / 180,
		v.offsetX / h.width,
		v.offsetY / h.height,
		(v.hueShift * Math.PI) / 180,
		fresh ? 1 : 0,
	]);
	drawFullscreenPass(args.encoder, h.back.createView(), r.pipeline, [
		args.ctx.device.createBindGroup({
			layout: r.layout,
			entries: [
				{
					binding: 0,
					resource: { buffer: args.ctx.renderer.getTemporaryBuffer(uniforms) },
				},
				{ binding: 1, resource: h.front.createView() },
				{ binding: 2, resource: cur.view },
				{ binding: 3, resource: r.sampler },
			],
		}),
	]);
	swap(h);
	h.frame = frame;
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export const TrailsWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, pass, targetWidth, targetHeight, props } = args;
	const op = props.virtualMedia?.operation as
		| { op?: string; effect?: FeedbackEffect }
		| undefined;
	if (op?.op !== "Trails" || !op.effect?.resolveUniforms) return;
	if (!props.virtualMedia?.children?.[0]) return;
	pass.end();

	const fps = props.fps || 30;
	const local = Math.max(0, Math.round(props.frame ?? 0));
	const compositionFrame = Math.round(props.compositionFrame ?? local);
	const compositionStart = compositionFrame - local;
	const raw = op.effect.resolveUniforms({
		frame: compositionFrame,
		fps,
		time: compositionFrame / fps,
	});
	const h = historyFor(op.effect, ctx.device, targetWidth, targetHeight);

	{
		const v: TrailsValues = {
			decay: Math.min(1, Math.max(0, num(raw.decay, 0.9))),
			mode: (raw.mode as TrailsValues["mode"]) ?? "blend",
			zoom: num(raw.zoom, 1),
			rotation: num(raw.rotation, 0),
			offsetX: num(raw.offsetX, 0),
			offsetY: num(raw.offsetY, 0),
			hueShift: num(raw.hueShift, 0),
			warmup: Math.max(0, Math.round(num(raw.warmup, 60))),
		};
		if (h.frame !== local) {
			let start = local;
			if (h.frame === local - 1) start = local;
			else {
				// Rebuild: replay until older frames have faded below 0.5%.
				const needed =
					v.decay > 0 && v.decay < 1
						? Math.ceil(Math.log(0.005) / Math.log(v.decay))
						: v.warmup;
				start = Math.max(0, local - Math.min(v.warmup, needed));
				h.frame = -1;
			}
			for (let f = start; f <= local; f++) {
				await stepTrails(args, h, v, f, compositionStart, h.frame < 0);
			}
		}
	}
	drawTextureToTarget(args, h.front);
};
