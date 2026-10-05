/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";
import type { ColorBalanceOperation } from "../shared/config.js";

type ColorBalanceSignalData = SignalData & { nodeId?: string };

interface ColorBalanceOpWithHandles extends ColorBalanceOperation {
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

interface DeviceColorBalanceResources {
	pipeline: GPURenderPipeline;
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<
	GPUDevice,
	DeviceColorBalanceResources
>();

const WGSL_COLOR_BALANCE_SHADER = `
struct ColorBalanceUniforms {
	shadows                      : vec4<f32>,
	midtones                     : vec4<f32>,
	highlights                   : vec4<f32>,
	preserveLuminosity           : f32,
	hasShadowsCyanRedSig         : f32,
	hasShadowsMagentaGreenSig    : f32,
	hasShadowsYellowBlueSig      : f32,

	hasMidtonesCyanRedSig        : f32,
	hasMidtonesMagentaGreenSig   : f32,
	hasMidtonesYellowBlueSig     : f32,
	hasHighlightsCyanRedSig      : f32,

	hasHighlightsMagentaGreenSig : f32,
	hasHighlightsYellowBlueSig   : f32,
	_pad0                        : f32,
	_pad1                        : f32,
};

@group(0) @binding(0) var<uniform> u                : ColorBalanceUniforms;
@group(1) @binding(0) var tex                       : texture_2d<f32>;
@group(1) @binding(1) var samp                      : sampler;

@group(2) @binding(0) var shadowsCyanRedSigTex      : texture_2d<f32>;
@group(2) @binding(1) var shadowsMagentaGreenSigTex : texture_2d<f32>;
@group(2) @binding(2) var shadowsYellowBlueSigTex   : texture_2d<f32>;
@group(2) @binding(3) var midtonesCyanRedSigTex     : texture_2d<f32>;
@group(2) @binding(4) var midtonesMagentaGreenSigTex: texture_2d<f32>;
@group(2) @binding(5) var midtonesYellowBlueSigTex  : texture_2d<f32>;
@group(2) @binding(6) var highlightsCyanRedSigTex   : texture_2d<f32>;
@group(2) @binding(7) var highlightsMagentaGreenSigTex: texture_2d<f32>;
@group(2) @binding(8) var highlightsYellowBlueSigTex: texture_2d<f32>;
@group(2) @binding(9) var signalSamp                : sampler;

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

fn get_luminance(c: vec3<f32>) -> f32 {
	return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn set_luminance(c: vec3<f32>, l: f32) -> vec3<f32> {
	let d = l - get_luminance(c);
	var res = c + vec3<f32>(d);
	let min_c = min(res.r, min(res.g, res.b));
	let max_c = max(res.r, max(res.g, res.b));
	if (min_c < 0.0) {
		res = l + ((res - vec3<f32>(l)) * l) / max(l - min_c, 1e-5);
	}
	if (max_c > 1.0) {
		res = l + ((res - vec3<f32>(l)) * (1.0 - l)) / max(max_c - l, 1e-5);
	}
	return clamp(res, vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let color = textureSampleLevel(tex, samp, in.uv, 0.0);
	if (color.a <= 0.00001) {
		return color;
	}

	let alpha = color.a;
	let rgb = color.rgb / max(alpha, 0.0001);

	var sShift = u.shadows.rgb;
	if (u.hasShadowsCyanRedSig > 0.5) {
		sShift.r = clamp(textureSampleLevel(shadowsCyanRedSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasShadowsMagentaGreenSig > 0.5) {
		sShift.g = clamp(textureSampleLevel(shadowsMagentaGreenSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasShadowsYellowBlueSig > 0.5) {
		sShift.b = clamp(textureSampleLevel(shadowsYellowBlueSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}

	var mShift = u.midtones.rgb;
	if (u.hasMidtonesCyanRedSig > 0.5) {
		mShift.r = clamp(textureSampleLevel(midtonesCyanRedSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasMidtonesMagentaGreenSig > 0.5) {
		mShift.g = clamp(textureSampleLevel(midtonesMagentaGreenSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasMidtonesYellowBlueSig > 0.5) {
		mShift.b = clamp(textureSampleLevel(midtonesYellowBlueSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}

	var hShift = u.highlights.rgb;
	if (u.hasHighlightsCyanRedSig > 0.5) {
		hShift.r = clamp(textureSampleLevel(highlightsCyanRedSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasHighlightsMagentaGreenSig > 0.5) {
		hShift.g = clamp(textureSampleLevel(highlightsMagentaGreenSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}
	if (u.hasHighlightsYellowBlueSig > 0.5) {
		hShift.b = clamp(textureSampleLevel(highlightsYellowBlueSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0) / 100.0;
	}

	let origLum = get_luminance(rgb);

	// Tonal range weighting curves
	let wShadows = clamp((1.0 - origLum) * (1.0 - origLum * 1.5), 0.0, 1.0);
	let wMidtones = clamp(1.0 - 4.0 * (origLum - 0.5) * (origLum - 0.5), 0.0, 1.0);
	let wHighlights = clamp(origLum * (origLum * 1.5 - 0.5), 0.0, 1.0);

	let delta = wShadows * sShift + wMidtones * mShift + wHighlights * hShift;
	var adjustedRgb = clamp(rgb + delta, vec3<f32>(0.0), vec3<f32>(1.0));

	if (u.preserveLuminosity > 0.5) {
		adjustedRgb = set_luminance(adjustedRgb, origLum);
	}

	return vec4<f32>(adjustedRgb * alpha, alpha);
}
`;

function getColorBalanceResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): DeviceColorBalanceResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const uniformLayout = device.createBindGroupLayout({
		label: "ColorBalanceUniformLayout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const textureLayout = device.createBindGroupLayout({
		label: "ColorBalanceTextureLayout",
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

	const signalTextureLayout = device.createBindGroupLayout({
		label: "ColorBalanceSignalTextureLayout",
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
				texture: { sampleType: "float" },
			},
			{
				binding: 5,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 6,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 7,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 8,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 9,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	const module = device.createShaderModule({
		label: "ColorBalanceShaderModule",
		code: WGSL_COLOR_BALANCE_SHADER,
	});

	const pipeline = device.createRenderPipeline({
		label: "ColorBalancePipeline",
		layout: device.createPipelineLayout({
			bindGroupLayouts: [uniformLayout, textureLayout, signalTextureLayout],
		}),
		vertex: { module, entryPoint: "vs" },
		fragment: { module, entryPoint: "fs", targets: [{ format }] },
		primitive: { topology: "triangle-strip" },
	});

	res = {
		pipeline,
		uniformLayout,
		textureLayout,
		signalTextureLayout,
	};
	deviceResourceCache.set(device, res);
	return res;
}

const uniformBufferData = new Float32Array(24);

export const ColorBalanceWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as unknown as
		| ColorBalanceOpWithHandles
		| undefined;

	if (op?.op !== "ColorBalance" || !props.virtualMedia?.children?.[0]) return;

	pass.end();

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const childMedia = props.virtualMedia.children[0];
	const width = targetWidth;
	const height = targetHeight;
	const nodeId =
		(props.virtualMedia?.metadata as { id?: string } | undefined)?.id ||
		(op.inputs ? Object.keys(op.inputs)[0] : null) ||
		props.renderId ||
		"colorbalance_node";

	const resolveField = (
		handleId: string | null | undefined,
		fallbackVal: number,
		clampMin = -100,
		clampMax = 100,
	): {
		val: number;
		hasStaticSig: boolean;
		sd: ColorBalanceSignalData | null;
	} => {
		if (handleId && op.inputs?.[handleId]?.connectionValid) {
			const outputItem = op.inputs[handleId].outputItem;
			if (outputItem?.type === "Number") {
				const numVal =
					typeof outputItem.data === "number"
						? outputItem.data
						: ((outputItem.data as { value?: number })?.value ?? fallbackVal);
				return {
					val: Math.max(clampMin, Math.min(clampMax, numVal)),
					hasStaticSig: false,
					sd: null,
				};
			}
			if (outputItem?.type === "Signal" && outputItem.data) {
				return {
					val: fallbackVal,
					hasStaticSig: true,
					sd: outputItem.data as ColorBalanceSignalData,
				};
			}
		}
		return {
			val: Math.max(clampMin, Math.min(clampMax, fallbackVal)),
			hasStaticSig: false,
			sd: null,
		};
	};

	const resolveVal = (val: unknown): number => {
		if (val !== undefined && val !== null) {
			if (typeof val === "object" && "value" in (val as Record<string, unknown>)) {
				val = (val as { value: unknown }).value;
			} else if (typeof val === "function") {
				val = (val as (f: number, fps: number) => unknown)(frame, fps);
			}
		}
		const n = Number(val ?? 0);
		return isNaN(n) ? 0 : n;
	};

	const sCR = resolveField(
		op.shadows_cyanRedHandleId,
		resolveVal(op.shadows?.cyanRed),
	);
	const sMG = resolveField(
		op.shadows_magentaGreenHandleId,
		resolveVal(op.shadows?.magentaGreen),
	);
	const sYB = resolveField(
		op.shadows_yellowBlueHandleId,
		resolveVal(op.shadows?.yellowBlue),
	);

	const mCR = resolveField(
		op.midtones_cyanRedHandleId,
		resolveVal(op.midtones?.cyanRed),
	);
	const mMG = resolveField(
		op.midtones_magentaGreenHandleId,
		resolveVal(op.midtones?.magentaGreen),
	);
	const mYB = resolveField(
		op.midtones_yellowBlueHandleId,
		resolveVal(op.midtones?.yellowBlue),
	);

	const hCR = resolveField(
		op.highlights_cyanRedHandleId,
		resolveVal(op.highlights?.cyanRed),
	);
	const hMG = resolveField(
		op.highlights_magentaGreenHandleId,
		resolveVal(op.highlights?.magentaGreen),
	);
	const hYB = resolveField(
		op.highlights_yellowBlueHandleId,
		resolveVal(op.highlights?.yellowBlue),
	);

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

	const { pipeline, uniformLayout, textureLayout, signalTextureLayout } =
		getColorBalanceResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const getSignalView = (
		res: {
			val: number;
			hasStaticSig: boolean;
			sd: ColorBalanceSignalData | null;
		},
		suffix: string,
	) => {
		if (res.hasStaticSig && res.sd) {
			return signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				res.sd.nodeId ?? `${nodeId}_${suffix}`,
				elapsedSeconds,
				durationSeconds,
				res.sd,
				width,
				height,
				props.renderId,
				frame,
				fps,
			);
		}
		return signalRegistry.getDummy1x1TextureView(ctx.device);
	};

	const sCRView = getSignalView(sCR, "shadows_cyanRed_sig");
	const sMGView = getSignalView(sMG, "shadows_magentaGreen_sig");
	const sYBView = getSignalView(sYB, "shadows_yellowBlue_sig");

	const mCRView = getSignalView(mCR, "midtones_cyanRed_sig");
	const mMGView = getSignalView(mMG, "midtones_magentaGreen_sig");
	const mYBView = getSignalView(mYB, "midtones_yellowBlue_sig");

	const hCRView = getSignalView(hCR, "highlights_cyanRed_sig");
	const hMGView = getSignalView(hMG, "highlights_magentaGreen_sig");
	const hYBView = getSignalView(hYB, "highlights_yellowBlue_sig");

	const preserveLum = op.preserveLuminosity === false ? 0.0 : 1.0;

	uniformBufferData[0] = sCR.val / 100;
	uniformBufferData[1] = sMG.val / 100;
	uniformBufferData[2] = sYB.val / 100;
	uniformBufferData[3] = 0.0;

	uniformBufferData[4] = mCR.val / 100;
	uniformBufferData[5] = mMG.val / 100;
	uniformBufferData[6] = mYB.val / 100;
	uniformBufferData[7] = 0.0;

	uniformBufferData[8] = hCR.val / 100;
	uniformBufferData[9] = hMG.val / 100;
	uniformBufferData[10] = hYB.val / 100;
	uniformBufferData[11] = 0.0;

	uniformBufferData[12] = preserveLum;
	uniformBufferData[13] = sCR.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[14] = sMG.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[15] = sYB.hasStaticSig ? 1.0 : 0.0;

	uniformBufferData[16] = mCR.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[17] = mMG.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[18] = mYB.hasStaticSig ? 1.0 : 0.0;

	uniformBufferData[19] = hCR.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[20] = hMG.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[21] = hYB.hasStaticSig ? 1.0 : 0.0;
	uniformBufferData[22] = 0.0;
	uniformBufferData[23] = 0.0;

	const buffer = ctx.renderer.getTemporaryBuffer(uniformBufferData);
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	const sigBindGroup = ctx.device.createBindGroup({
		layout: signalTextureLayout,
		entries: [
			{ binding: 0, resource: sCRView },
			{ binding: 1, resource: sMGView },
			{ binding: 2, resource: sYBView },
			{ binding: 3, resource: mCRView },
			{ binding: 4, resource: mMGView },
			{ binding: 5, resource: mYBView },
			{ binding: 6, resource: hCRView },
			{ binding: 7, resource: hMGView },
			{ binding: 8, resource: hYBView },
			{ binding: 9, resource: sampler },
		],
	});

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
	renderPass.setBindGroup(2, sigBindGroup);
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
