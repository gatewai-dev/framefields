import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import type { KenBurnsKeyframe } from "../shared/config.js";

const easeIn = (t: number): number => t * t;
const easeOut = (t: number): number => t * (2 - t);
const easeInOut = (t: number): number =>
	t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
const springEase = (t: number): number => {
	const c4 = (2 * Math.PI) / 3;
	return t === 0
		? 0
		: t === 1
			? 1
			: 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};

const applyEasing = (t: number, easing?: string): number => {
	switch (easing) {
		case "ease-in":
			return easeIn(t);
		case "ease-out":
			return easeOut(t);
		case "ease-in-out":
			return easeInOut(t);
		case "spring":
			return springEase(t);
		default:
			return t;
	}
};

const catmullRom = (
	p0: number,
	p1: number,
	p2: number,
	p3: number,
	t: number,
): number => {
	const t2 = t * t;
	const t3 = t2 * t;
	return (
		0.5 *
		(2 * p1 +
			(-p0 + p2) * t +
			(2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
			(-p0 + 3 * p1 - 3 * p2 + p3) * t3)
	);
};

interface InterpolatedState {
	x: number;
	y: number;
	scale: number;
}

function interpolateKenBurns(
	keyframes: KenBurnsKeyframe[],
	timeMs: number,
	movementStyle = "spline",
): InterpolatedState {
	if (keyframes.length === 0) return { x: 50, y: 50, scale: 1 };
	if (keyframes.length === 1) {
		const kf = keyframes[0];
		return { x: kf.x ?? 50, y: kf.y ?? 50, scale: kf.scale ?? 1 };
	}
	let elapsed = 0;
	for (let i = 0; i < keyframes.length; i++) {
		const kf = keyframes[i];
		const hold = kf.holdMs ?? 0;
		const dur = kf.durationMs ?? 0;
		if (timeMs <= elapsed + hold)
			return { x: kf.x ?? 50, y: kf.y ?? 50, scale: kf.scale ?? 1 };
		elapsed += hold;
		if (i < keyframes.length - 1 && dur > 0) {
			if (timeMs <= elapsed + dur) {
				const rawT = (timeMs - elapsed) / dur;
				const t = applyEasing(Math.max(0, Math.min(1, rawT)), kf.easing);
				const next = keyframes[i + 1];
				if (movementStyle === "spline") {
					const prev = keyframes[i - 1] ?? kf;
					const afterNext = keyframes[i + 2] ?? next;
					return {
						x: catmullRom(
							prev.x ?? 50,
							kf.x ?? 50,
							next.x ?? 50,
							afterNext.x ?? 50,
							t,
						),
						y: catmullRom(
							prev.y ?? 50,
							kf.y ?? 50,
							next.y ?? 50,
							afterNext.y ?? 50,
							t,
						),
						scale: catmullRom(
							prev.scale ?? 1,
							kf.scale ?? 1,
							next.scale ?? 1,
							afterNext.scale ?? 1,
							t,
						),
					};
				}
				return {
					x: (kf.x ?? 50) + ((next.x ?? 50) - (kf.x ?? 50)) * t,
					y: (kf.y ?? 50) + ((next.y ?? 50) - (kf.y ?? 50)) * t,
					scale: (kf.scale ?? 1) + ((next.scale ?? 1) - (kf.scale ?? 1)) * t,
				};
			}
			elapsed += dur;
		}
	}
	const last = keyframes[keyframes.length - 1];
	return { x: last.x ?? 50, y: last.y ?? 50, scale: last.scale ?? 1 };
}

function calculateSrcRect(
	state: InterpolatedState,
	sourceWidth: number,
	sourceHeight: number,
	targetAspectRatio: string,
) {
	let baseBoxW_pct = 100;
	let baseBoxH_pct = 100;

	if (targetAspectRatio !== "input") {
		const parts = targetAspectRatio.split(":");
		const tW = Number(parts[0]);
		const tH = Number(parts[1]);
		if (!Number.isNaN(tW) && !Number.isNaN(tH) && tW > 0 && tH > 0) {
			const desiredAR = tW / tH;
			const sourceAR = sourceWidth / sourceHeight;
			if (sourceAR > desiredAR) {
				baseBoxH_pct = 100;
				baseBoxW_pct = (desiredAR / sourceAR) * 100;
			} else {
				baseBoxW_pct = 100;
				baseBoxH_pct = (sourceAR / desiredAR) * 100;
			}
		}
	}

	const baseBoxPxW = (baseBoxW_pct / 100) * sourceWidth;
	const baseBoxPxH = (baseBoxH_pct / 100) * sourceHeight;
	const clampedScale = Math.max(state.scale, 1);
	const currentBoxPxW = baseBoxPxW / clampedScale;
	const currentBoxPxH = baseBoxPxH / clampedScale;

	const rawFocalX = (state.x / 100) * sourceWidth;
	const rawFocalY = (state.y / 100) * sourceHeight;
	const halfBoxW = currentBoxPxW / 2;
	const halfBoxH = currentBoxPxH / 2;
	const focalX = Math.max(
		halfBoxW,
		Math.min(sourceWidth - halfBoxW, rawFocalX),
	);
	const focalY = Math.max(
		halfBoxH,
		Math.min(sourceHeight - halfBoxH, rawFocalY),
	);

	return {
		x: focalX - halfBoxW,
		y: focalY - halfBoxH,
		width: currentBoxPxW,
		height: currentBoxPxH,
	};
}

const motionBlurWgsl = `
struct MotionBlurUniforms {
	prev_origin : vec2<f32>,
	prev_size   : vec2<f32>,
	curr_origin : vec2<f32>,
	curr_size   : vec2<f32>,
	samples     : f32,
	blurSize    : f32,
	padding     : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : MotionBlurUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

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
	let uv = in.uv;
	let n = i32(u.samples);
	
	if (n <= 1) {
		let p_curr = u.curr_origin + uv * u.curr_size;
		return textureSampleLevel(tex, samp, p_curr, 0.0);
	}
	
	var color = vec4<f32>(0.0);
	for (var i = 0; i < n; i = i + 1) {
		// Use blurSize to control the shutter interval width. 
		// t=1.0 is current frame, t=0.0 is previous frame.
		let t = 1.0 + (f32(i) / f32(n - 1) - 0.5) * u.blurSize;
		
		let origin = mix(u.prev_origin, u.curr_origin, t);
		let size = mix(u.prev_size, u.curr_size, t);
		let p_sample = origin + uv * size;
		
		color += textureSampleLevel(tex, samp, p_sample, 0.0);
	}
	return color / f32(n);
}
`;

interface DeviceKenBurnsResources {
	motionBlurPipeline: GPURenderPipeline;
	motionBlurUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceKenBurnsResources>();
const motionBlurData = new Float32Array(12);

function getMotionBlurResources(device: GPUDevice, format: GPUTextureFormat) {
	let res = deviceResourceCache.get(device);
	if (!res) {
		const motionBlurUniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		const singleTextureLayout = device.createBindGroupLayout({
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
			label: "kenburns_motionblur.wgsl",
			code: motionBlurWgsl,
		});
		const motionBlurPipeline = device.createRenderPipeline({
			label: "MotionBlurPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [motionBlurUniformLayout, singleTextureLayout],
			}),
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-strip" },
		});
		res = { motionBlurPipeline, motionBlurUniformLayout, singleTextureLayout };
		deviceResourceCache.set(device, res);
	}
	return res;
}

export const KenBurnsWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const {
		virtualMedia,
		containerWidth,
		containerHeight,
		frame,
		fps,
		trimStartOverride,
		opacity = 1,
		inheritedSeekOffset = 0,
	} = props;

	const op = virtualMedia.operation as any;
	if (op?.op !== "KenBurns") return;

	const childMedia = virtualMedia.children?.[0];
	if (!childMedia) return;

	// ── Source dimensions ────────────────────────────────────────────────────
	const sourceWidth =
		op.originalWidth ??
		childMedia.metadata?.width ??
		virtualMedia.metadata?.width ??
		containerWidth ??
		targetWidth;
	const sourceHeight =
		op.originalHeight ??
		childMedia.metadata?.height ??
		virtualMedia.metadata?.height ??
		containerHeight ??
		targetHeight;

	const keyframes = op.keyframes ?? [];
	const movementStyle = op.movementStyle ?? "spline";
	const targetAspectRatio = op.aspectRatio || "input";

	// ── Interpolate Ken Burns state ──────────────────────────────────────────
	const offsetMs = ((trimStartOverride ?? 0) + inheritedSeekOffset) * 1000;
	const fpsVal = Math.max(1, fps ?? 30);
	const frameDurationMs = 1000 / fpsVal;
	const timeMs = offsetMs + ((frame ?? 0) / fpsVal) * 1000;
	const prevTimeMs = timeMs - frameDurationMs;

	const state = interpolateKenBurns(keyframes, timeMs, movementStyle);
	const prevState = interpolateKenBurns(keyframes, prevTimeMs, movementStyle);

	const srcRect = calculateSrcRect(
		state,
		sourceWidth,
		sourceHeight,
		targetAspectRatio,
	);
	const prevSrcRect = calculateSrcRect(
		prevState,
		sourceWidth,
		sourceHeight,
		targetAspectRatio,
	);
	const dstWidth = containerWidth ?? targetWidth;
	const dstHeight = containerHeight ?? targetHeight;
	const dstRect = { x: 0, y: 0, width: dstWidth, height: dstHeight };

	// ── 5. Render child into a temporary offscreen texture ───────────────────
	//
	// ROOT CAUSE FIX: drawChild receives `matrix: new DOMMatrix()` which resets
	// the renderer's transform stack internally, so pushTransform() is silently
	// ignored by the child. We therefore render the child to a temp texture at
	// its native size (no Ken Burns transform applied), then composite the
	// cropped region ourselves using drawTextureRegion — which does not depend
	// on the transform stack at all.
	//
	const tempTex = ctx.renderer.getTemporaryTexture(sourceWidth, sourceHeight, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tempView = tempTex.createView();

	// End the current pass before starting child rendering.
	pass.end();

	// Clear the temporary texture to avoid garbage from previous frames
	const clearPass = ctx.renderer.beginFrame(
		encoder,
		tempView,
		{ r: 0, g: 0, b: 0, a: 0 },
		sourceWidth,
		sourceHeight,
		"clear",
	);
	clearPass.end();

	ctx.renderer.pushScissor({
		x: 0,
		y: 0,
		width: sourceWidth,
		height: sourceHeight,
	});
	ctx.renderer.pushIdentity();

	await drawChild(
		childMedia,
		{
			...props,
			containerWidth: sourceWidth,
			containerHeight: sourceHeight,
		},
		tempView,
		tempTex,
		sourceWidth,
		sourceHeight,
	);

	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	const motionBlurSize = op.motionBlurSize ?? 1.5;
	let blurTex: GPUTexture | null = null;

	if (motionBlurSize > 0) {
		const {
			motionBlurPipeline: pipeline,
			motionBlurUniformLayout: uLayout,
			singleTextureLayout: tLayout,
		} = getMotionBlurResources(ctx.device, ctx.renderer.format);
		const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

		motionBlurData[0] = prevSrcRect.x / sourceWidth;
		motionBlurData[1] = prevSrcRect.y / sourceHeight;
		motionBlurData[2] = prevSrcRect.width / sourceWidth;
		motionBlurData[3] = prevSrcRect.height / sourceHeight;
		motionBlurData[4] = srcRect.x / sourceWidth;
		motionBlurData[5] = srcRect.y / sourceHeight;
		motionBlurData[6] = srcRect.width / sourceWidth;
		motionBlurData[7] = srcRect.height / sourceHeight;
		motionBlurData[8] = 12; // samples
		motionBlurData[9] = motionBlurSize;

		const uBuffer = ctx.renderer.getTemporaryBuffer(motionBlurData);

		// 1. Create a temporary texture for the blurred result at layer size
		blurTex = ctx.renderer.getTemporaryTexture(dstWidth, dstHeight, [
			targetTexture,
			tempTex,
			...(props.excludeTextures || []),
		]);
		const blurView = blurTex.createView();

		// 2. Render blurred result into blurTex
		const blurPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: blurView,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		blurPass.setPipeline(pipeline!);
		blurPass.setBindGroup(
			0,
			ctx.device.createBindGroup({
				layout: uLayout!,
				entries: [{ binding: 0, resource: { buffer: uBuffer } }],
			}),
		);
		blurPass.setBindGroup(
			1,
			ctx.renderer.bindGroupCache.getBindGroup(
				ctx.device,
				tLayout!,
				tempTex,
				sampler,
			),
		);
		blurPass.draw(4);
		blurPass.end();
	}

	// ── 6. Composite the cropped source onto the output ──────────────────────
	// Begin a new pass on the real target, preserving any existing content.
	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	if (blurTex) {
		// 3. Draw the blurred result to the target (respecting parent transform)
		ctx.renderer.drawTexture(outPass, blurTex, dstRect, { opacity });
	} else {
		ctx.renderer.drawTextureRegion(outPass, tempTex, srcRect, dstRect, {
			opacity,
		});
	}

	args.pass = outPass;
};
