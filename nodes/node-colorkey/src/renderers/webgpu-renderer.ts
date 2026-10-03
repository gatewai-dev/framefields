/// <reference types="webgpu" />
import type { SignalData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { signalRegistry } from "@gitframes/webgpu-renderers";

interface ColorKeyOp {
	op: "ColorKey";
	keyColor?: string;
	similarity?: number;
	smoothness?: number;
	spillSuppression?: number;
	colorSpace?: "YUV" | "RGB";
	spillSuppressionType?: "Desaturate" | "Neutralize" | "None";
	similarityHandleId?: string | null;
	smoothnessHandleId?: string | null;
	spillSuppressionHandleId?: string | null;
	opacity?: number;
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

type ColorKeySignalData = SignalData & { nodeId?: string };

export const COLORKEY_SHADER = `
struct ColorKeyUniforms {
	similarity           : f32,
	smoothness           : f32,
	spillSuppression     : f32,
	colorSpace           : f32, // 0 for YUV, 1 for RGB
	spillSuppressionType : f32, // 0 for Desaturate, 1 for Neutralize, 2 for None
	keyR                 : f32,
	keyG                 : f32,
	keyB                 : f32,
	hasSimilaritySig     : f32,
	hasSmoothnessSig     : f32,
	hasSpillSig          : f32,
};

@group(0) @binding(0) var<uniform> u : ColorKeyUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

@group(2) @binding(0) var similaritySigTex  : texture_2d<f32>;
@group(2) @binding(1) var smoothnessSigTex  : texture_2d<f32>;
@group(2) @binding(2) var spillSigTex       : texture_2d<f32>;
@group(2) @binding(3) var signalSamp        : sampler;

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

fn rgb2yuv(rgb: vec3<f32>) -> vec3<f32> {
	let y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
	let u = -0.169 * rgb.r - 0.331 * rgb.g + 0.500 * rgb.b;
	let v = 0.500 * rgb.r - 0.419 * rgb.g - 0.081 * rgb.b;
	return vec3<f32>(y, u, v);
}

fn yuv2rgb(yuv: vec3<f32>) -> vec3<f32> {
	let r = yuv.x + 1.402 * yuv.z;
	let g = yuv.x - 0.344 * yuv.y - 0.714 * yuv.z;
	let b = yuv.x + 1.772 * yuv.y;
	return vec3<f32>(r, g, b);
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let src_color = textureSampleLevel(tex, samp, in.uv, 0.0);
	if (src_color.a < 1e-5) {
		return src_color;
	}

	// Unpremultiply alpha for keying and grading
	let unpremult_rgb = src_color.rgb / src_color.a;

	// Resolve dynamic signals if connected, otherwise use static uniform values
	var similarity = u.similarity;
	if (u.hasSimilaritySig > 0.5) {
		similarity = textureSampleLevel(similaritySigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	var smoothness = u.smoothness;
	if (u.hasSmoothnessSig > 0.5) {
		smoothness = textureSampleLevel(smoothnessSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	var spillSuppression = u.spillSuppression;
	if (u.hasSpillSig > 0.5) {
		spillSuppression = textureSampleLevel(spillSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let keyColor = vec3<f32>(u.keyR, u.keyG, u.keyB);

	// 1. Calculate similarity distance
	var dist = 0.0;
	if (u.colorSpace < 0.5) {
		// YUV (Chroma Distance)
		let C_yuv = rgb2yuv(unpremult_rgb);
		let K_yuv = rgb2yuv(keyColor);
		dist = distance(C_yuv.yz, K_yuv.yz);
	} else {
		// RGB (Exact Distance)
		dist = distance(unpremult_rgb, keyColor);
	}

	// 2. Calculate transparency mask
	var mask = 0.0;
	if (smoothness < 0.0001) {
		mask = select(0.0, 1.0, dist >= similarity);
	} else {
		mask = smoothstep(similarity, similarity + smoothness, dist);
	}

	// 3. Apply spill suppression
	var final_rgb = unpremult_rgb;
	if (u.spillSuppressionType < 2.5) { // 0 for Desaturate, 1 for Neutralize, 2 for None
		let C_yuv = rgb2yuv(unpremult_rgb);
		let K_yuv = rgb2yuv(keyColor);
		let K_chroma = K_yuv.yz;
		let K_len_sq = dot(K_chroma, K_chroma);

		if (K_len_sq > 1e-6) {
			let C_chroma = C_yuv.yz;
			let proj = dot(C_chroma, K_chroma) / K_len_sq;
			if (proj > 0.0) {
				let C_para = proj * K_chroma;
				var C_chroma_suppressed = C_chroma;

				if (u.spillSuppressionType < 0.5) {
					// Desaturate
					C_chroma_suppressed = C_chroma - spillSuppression * C_para;
				} else {
					// Neutralize (completely shift to neutral gray chroma)
					C_chroma_suppressed = C_chroma - C_para;
				}

				final_rgb = yuv2rgb(vec3<f32>(C_yuv.x, C_chroma_suppressed.x, C_chroma_suppressed.y));
			}
		}
	}

	let final_alpha = src_color.a * mask;
	return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * final_alpha, final_alpha);
}
`;

interface DeviceColorKeyResources {
	uniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceColorKeyResources>();
const colorKeyData = new Float32Array(12);

function getDeviceLayouts(device: GPUDevice): DeviceColorKeyResources {
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

	const signalTextureLayout = device.createBindGroupLayout({
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
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		uniformLayout,
		singleTextureLayout,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getColorKeyResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `colorkey_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const colorKeyModule = device.createShaderModule({
			label: `colorkey_${format}.wgsl`,
			code: COLORKEY_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `ColorKeyPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.uniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: colorKeyModule, entryPoint: "vs" },
			fragment: {
				module: colorKeyModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		colorKeyPipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

function hexToRgb(hex: string): [number, number, number] {
	let h = hex.replace("#", "");
	if (h.length === 3) {
		h = h
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const r = parseInt(h.substring(0, 2), 16) / 255;
	const g = parseInt(h.substring(2, 4), 16) / 255;
	const b = parseInt(h.substring(4, 6), 16) / 255;
	return [r, g, b];
}

export const ColorKeyWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const op = props.virtualMedia?.operation as ColorKeyOp | undefined;
	if (op?.op !== "ColorKey" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "colorkey_node";

	// Resolve similarity signal
	const similarityInput = op.similarityHandleId
		? op.inputs?.[op.similarityHandleId]
		: null;
	const hasSimilaritySig = !!(
		similarityInput?.connectionValid &&
		(similarityInput.outputItem?.type === "Signal" ||
			similarityInput.outputItem?.type === "Numeric")
	);
	const similaritySd =
		hasSimilaritySig && similarityInput?.outputItem?.data
			? (similarityInput.outputItem.data as ColorKeySignalData)
			: null;

	let similarity = 0.4;
	let hasStaticSimilaritySig = false;
	if (!hasSimilaritySig) {
		if (
			similarityInput?.connectionValid &&
			similarityInput.outputItem?.type === "Number"
		) {
			similarity = Math.max(
				0,
				Math.min(1, Number(similarityInput.outputItem.data ?? 0.4)),
			);
		} else {
			similarity = Math.max(0, Math.min(1, Number(op.similarity ?? 0.4)));
		}
	} else if (similaritySd) {
		similarity = Math.max(0, Math.min(1, Number(similaritySd.offset ?? 0.0)));
		hasStaticSimilaritySig = true;
	}

	// Resolve smoothness signal
	const smoothnessInput = op.smoothnessHandleId
		? op.inputs?.[op.smoothnessHandleId]
		: null;
	const hasSmoothnessSig = !!(
		smoothnessInput?.connectionValid &&
		(smoothnessInput.outputItem?.type === "Signal" ||
			smoothnessInput.outputItem?.type === "Numeric")
	);
	const smoothnessSd =
		hasSmoothnessSig && smoothnessInput?.outputItem?.data
			? (smoothnessInput.outputItem.data as ColorKeySignalData)
			: null;

	let smoothness = 0.1;
	let hasStaticSmoothnessSig = false;
	if (!hasSmoothnessSig) {
		if (
			smoothnessInput?.connectionValid &&
			smoothnessInput.outputItem?.type === "Number"
		) {
			smoothness = Math.max(
				0,
				Math.min(1, Number(smoothnessInput.outputItem.data ?? 0.1)),
			);
		} else {
			smoothness = Math.max(0, Math.min(1, Number(op.smoothness ?? 0.1)));
		}
	} else if (smoothnessSd) {
		smoothness = Math.max(0, Math.min(1, Number(smoothnessSd.offset ?? 0.0)));
		hasStaticSmoothnessSig = true;
	}

	// Resolve spill suppression signal
	const spillInput = op.spillSuppressionHandleId
		? op.inputs?.[op.spillSuppressionHandleId]
		: null;
	const hasSpillSig = !!(
		spillInput?.connectionValid &&
		(spillInput.outputItem?.type === "Signal" ||
			spillInput.outputItem?.type === "Numeric")
	);
	const spillSd =
		hasSpillSig && spillInput?.outputItem?.data
			? (spillInput.outputItem.data as ColorKeySignalData)
			: null;

	let spillSuppression = 0.2;
	let hasStaticSpillSig = false;
	if (!hasSpillSig) {
		if (
			spillInput?.connectionValid &&
			spillInput.outputItem?.type === "Number"
		) {
			spillSuppression = Math.max(
				0,
				Math.min(1, Number(spillInput.outputItem.data ?? 0.2)),
			);
		} else {
			spillSuppression = Math.max(
				0,
				Math.min(1, Number(op.spillSuppression ?? 0.2)),
			);
		}
	} else if (spillSd) {
		spillSuppression = Math.max(0, Math.min(1, Number(spillSd.offset ?? 0.0)));
		hasStaticSpillSig = true;
	}

	const tmpTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	// Clear intermediate texture
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

	// Fetch static resources and compile pipeline once
	const {
		colorKeyPipeline: pipeline,
		uniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getColorKeyResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Fetch dynamic signal texture views on-demand
	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	let similarityView: GPUTextureView;
	if (hasStaticSimilaritySig && similaritySd) {
		similarityView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			similaritySd.nodeId ?? `${nodeId}_similarity_sig`,
			elapsedSeconds,
			durationSeconds,
			similaritySd,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		similarityView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	let smoothnessView: GPUTextureView;
	if (hasStaticSmoothnessSig && smoothnessSd) {
		smoothnessView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			smoothnessSd.nodeId ?? `${nodeId}_smoothness_sig`,
			elapsedSeconds,
			durationSeconds,
			smoothnessSd,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		smoothnessView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	let spillView: GPUTextureView;
	if (hasStaticSpillSig && spillSd) {
		spillView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			spillSd.nodeId ?? `${nodeId}_spill_sig`,
			elapsedSeconds,
			durationSeconds,
			spillSd,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		spillView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	const [keyR, keyG, keyB] = hexToRgb(op.keyColor ?? "#00ff00");

	// Prepare uniform data
	colorKeyData[0] = similarity;
	colorKeyData[1] = smoothness;
	colorKeyData[2] = spillSuppression;
	colorKeyData[3] = op.colorSpace === "RGB" ? 1.0 : 0.0;
	colorKeyData[4] =
		op.spillSuppressionType === "None"
			? 2.0
			: op.spillSuppressionType === "Neutralize"
				? 1.0
				: 0.0;
	colorKeyData[5] = keyR;
	colorKeyData[6] = keyG;
	colorKeyData[7] = keyB;
	colorKeyData[8] = hasStaticSimilaritySig ? 1.0 : 0.0;
	colorKeyData[9] = hasStaticSmoothnessSig ? 1.0 : 0.0;
	colorKeyData[10] = hasStaticSpillSig ? 1.0 : 0.0;
	colorKeyData[11] = 0.0;

	// 1-Pass Filter (ColorKey)
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	const singleBuffer = ctx.renderer.getTemporaryBuffer(colorKeyData);

	const singlePass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});
	singlePass.setPipeline(pipeline);
	singlePass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: singleBuffer } }],
		}),
	);
	singlePass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout,
			tmpTex,
			sampler,
		),
	);
	singlePass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: similarityView },
				{ binding: 1, resource: smoothnessView },
				{ binding: 2, resource: spillView },
				{ binding: 3, resource: sampler },
			],
		}),
	);
	singlePass.draw(4);
	singlePass.end();

	// Final Pass: Draw result to targetView using standard drawTexture for blending/opacity
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
		{ opacity: op.opacity ?? 1 },
	);

	args.pass = finalPass;
};
