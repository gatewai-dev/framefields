/// <reference types="webgpu" />
/**
 * Datamosh: instead of each new frame, the previous output dragged along the
 * layer's optical flow, until a keyframe (I-frame) shows the clean picture.
 * History lives in textures on the effect object and advances one frame at a
 * time; after a jump the frames since the last keyframe are replayed.
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
import { OpticalFlowComputePipeline } from "@framefields/tensor-webgpu";

const HISTORY_FORMAT: GPUTextureFormat = "rgba16float";

interface DatamoshValues {
	keyframes: number[];
	strength: number;
	bleed: number;
	warmup: number;
}

const MOSH_WGSL = /* wgsl */ `
struct U { a : vec4<f32>, b : vec4<f32> };
@group(0) @binding(0) var<uniform> u : U;
@group(0) @binding(1) var moshTex : texture_2d<f32>;
@group(0) @binding(2) var currentTex : texture_2d<f32>;
@group(0) @binding(3) var flowTex : texture_2d<f32>;
@group(0) @binding(4) var samp : sampler;
${FULLSCREEN_QUAD_WGSL}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let strength = u.a.x;
	let bleed = u.a.y;
	let inv = u.a.zw;
	let cur0 = textureSampleLevel(currentTex, samp, in.uv, 0.0);
	if (u.b.x > 0.5) { return cur0; }
	let dims = vec2<f32>(textureDimensions(flowTex));
	let coord = vec2<i32>(clamp(in.uv * dims, vec2<f32>(0.0), dims - 1.0));
	let flow = textureLoad(flowTex, coord, 0).xy;
	let cur = textureSampleLevel(currentTex, samp, in.uv, 0.0);
	// The old picture moves with the new motion instead of being replaced.
	let moved = textureSampleLevel(moshTex, samp, clamp(in.uv - flow * inv * strength, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
	var out = mix(moved, cur, bleed);
	if (moved.a < 0.01) { out = cur; }
	return out;
}
`;

const resources = perDevice((device: GPUDevice) => {
	const layout = fragmentBindGroupLayout(
		device,
		["uniform", "texture", "texture", "texture", "sampler"],
		"datamosh_layout",
	);
	const module = device.createShaderModule({
		code: MOSH_WGSL,
		label: "datamosh.wgsl",
	});
	return {
		layout,
		pipeline: device.createRenderPipeline({
			label: "datamosh",
			layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format: HISTORY_FORMAT }],
			},
			primitive: { topology: "triangle-strip" },
		}),
		flow: new OpticalFlowComputePipeline(device),
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
	/** Datamosh: the layer's previous clean frame. */
	prev: GPUTexture | null;
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
	format: GPUTextureFormat,
): History {
	const h = effect.feedbackHistory;
	if (h && h.device === device && h.width === width && h.height === height)
		return h;
	h?.front.destroy();
	h?.back.destroy();
	h?.prev?.destroy();
	const make = (label: string, fmt: GPUTextureFormat) =>
		device.createTexture({
			label,
			size: [width, height],
			format: fmt,
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
		front: make("feedback_front", HISTORY_FORMAT),
		back: make("feedback_back", HISTORY_FORMAT),
		prev: make("feedback_prev", format),
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
		exclude: [h.front, h.back, ...(h.prev ? [h.prev] : [])],
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

async function stepDatamosh(
	args: WebGPUNodeRendererArgs,
	h: History,
	v: DatamoshValues,
	frame: number,
	compositionStart: number,
	key: boolean,
): Promise<void> {
	const cur = await childAt(args, frame, compositionStart, h);
	if (!cur || !h.prev) return;
	const r = resources(args.ctx.device);
	const { encoder } = args;
	const clean = key || h.frame < 0;
	// On a keyframe the flow is unused; the current frame stands in for it.
	const flow = clean
		? cur.texture
		: r.flow.execute(h.prev, cur.texture, {}, encoder);
	const uniforms = new Float32Array([
		v.strength,
		v.bleed,
		1 / h.width,
		1 / h.height,
		clean ? 1 : 0,
		0,
		0,
		0,
	]);
	drawFullscreenPass(encoder, h.back.createView(), r.pipeline, [
		args.ctx.device.createBindGroup({
			layout: r.layout,
			entries: [
				{
					binding: 0,
					resource: { buffer: args.ctx.renderer.getTemporaryBuffer(uniforms) },
				},
				{ binding: 1, resource: h.front.createView() },
				{ binding: 2, resource: cur.view },
				{ binding: 3, resource: flow.createView() },
				{ binding: 4, resource: r.sampler },
			],
		}),
	]);
	encoder.copyTextureToTexture({ texture: cur.texture }, { texture: h.prev }, [
		h.width,
		h.height,
		1,
	]);
	swap(h);
	h.frame = frame;
}

function num(v: unknown, fallback: number): number {
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export const DatamoshWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, pass, targetWidth, targetHeight, props } = args;
	const op = props.virtualMedia?.operation as
		| { op?: string; effect?: FeedbackEffect }
		| undefined;
	if (op?.op !== "Datamosh" || !op.effect?.resolveUniforms) return;
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
	const h = historyFor(
		op.effect,
		ctx.device,
		targetWidth,
		targetHeight,
		ctx.renderer.format,
	);

	{
		const v: DatamoshValues = {
			keyframes: Array.isArray(raw.keyframes)
				? (raw.keyframes as number[]).map(Math.round)
				: [],
			strength: num(raw.strength, 1),
			bleed: Math.min(1, Math.max(0, num(raw.bleed, 0))),
			warmup: Math.max(1, Math.round(num(raw.warmup, 48))),
		};
		if (h.frame !== local) {
			let start = local;
			if (h.frame !== local - 1) {
				const lastKey = Math.max(0, ...v.keyframes.filter((k) => k <= local));
				start = Math.max(lastKey, local - v.warmup);
				h.frame = -1;
			}
			for (let f = start; f <= local; f++) {
				await stepDatamosh(
					args,
					h,
					v,
					f,
					compositionStart,
					f === 0 || v.keyframes.includes(f) || h.frame < 0,
				);
			}
		}
	}
	drawTextureToTarget(args, h.front);
};
