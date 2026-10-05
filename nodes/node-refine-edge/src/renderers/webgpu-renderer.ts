/// <reference types="webgpu" />
import type { VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";
import {
	MAX_DECONTAMINATE,
	MAX_FEATHER,
	MAX_RADIUS,
	MAX_SHIFT_EDGE,
	MAX_SMOOTH,
	type MatteChannel,
	MIN_DECONTAMINATE,
	MIN_FEATHER,
	MIN_RADIUS,
	MIN_SHIFT_EDGE,
	MIN_SMOOTH,
	type RefineEdgeOp,
	type RefineEdgeOutputMode,
	type RefineEdgeSignalData,
} from "../shared/index.js";

const CHANNEL_MAP: Record<MatteChannel, number> = {
	Alpha: 0,
	Luminance: 1,
	Red: 2,
	Green: 3,
	Blue: 4,
};

const OUTPUT_MODE_MAP: Record<RefineEdgeOutputMode, number> = {
	Composite: 0,
	MatteOnly: 1,
	DecontaminatedRGB: 2,
};

const WGSL_REFINE_EDGE = `
struct RefineEdgeUniforms {
	dirX                : f32,
	dirY                : f32,
	decontaminateAmount : f32,
	radius              : f32,

	smoothness          : f32,
	feather             : f32,
	shiftEdge           : f32,
	matteChannel        : f32,

	outputMode          : f32,
	hasMatte            : f32,
	hasDecontamSig      : f32,
	hasRadiusSig        : f32,

	hasSmoothSig        : f32,
	hasFeatherSig       : f32,
	hasShiftEdgeSig     : f32,
	isSecondPass        : f32,

	pad0                : f32,
	pad1                : f32,
	pad2                : f32,
	pad3                : f32,
};

@group(0) @binding(0) var<uniform> u          : RefineEdgeUniforms;

@group(1) @binding(0) var texInput            : texture_2d<f32>;
@group(1) @binding(1) var texMatte            : texture_2d<f32>;
@group(1) @binding(2) var origTex             : texture_2d<f32>;
@group(1) @binding(3) var samp                : sampler;

@group(2) @binding(0) var decontamSigTex      : texture_2d<f32>;
@group(2) @binding(1) var radiusSigTex        : texture_2d<f32>;
@group(2) @binding(2) var smoothSigTex        : texture_2d<f32>;
@group(2) @binding(3) var featherSigTex       : texture_2d<f32>;
@group(2) @binding(4) var shiftEdgeSigTex     : texture_2d<f32>;
@group(2) @binding(5) var signalSamp          : sampler;

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

fn extractChannel(color : vec4<f32>, chCode : f32) -> f32 {
	if (chCode < 0.5) {
		// Alpha
		return color.a;
	} else if (chCode < 1.5) {
		// Luminance
		let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
		if (color.a > 1e-4) {
			return min(1.0, luma / color.a);
		}
		return luma;
	} else if (chCode < 2.5) {
		// Red
		if (color.a > 1e-4) {
			return min(1.0, color.r / color.a);
		}
		return color.r;
	} else if (chCode < 3.5) {
		// Green
		if (color.a > 1e-4) {
			return min(1.0, color.g / color.a);
		}
		return color.g;
	} else {
		// Blue
		if (color.a > 1e-4) {
			return min(1.0, color.b / color.a);
		}
		return color.b;
	}
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let dimensions = vec2<f32>(textureDimensions(texInput));
	let texelSize = 1.0 / max(dimensions, vec2<f32>(1.0, 1.0));

	var decontam = u.decontaminateAmount;
	if (u.hasDecontamSig > 0.5) {
		decontam = clamp(textureSampleLevel(decontamSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 1.0);
	}
	var radius = u.radius;
	if (u.hasRadiusSig > 0.5) {
		radius = clamp(textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.5, 50.0);
	}
	var smoothVal = u.smoothness;
	if (u.hasSmoothSig > 0.5) {
		smoothVal = clamp(textureSampleLevel(smoothSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 100.0);
	}
	var featherVal = u.feather;
	if (u.hasFeatherSig > 0.5) {
		featherVal = clamp(textureSampleLevel(featherSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 50.0);
	}
	var shiftEdgeVal = u.shiftEdge;
	if (u.hasShiftEdgeSig > 0.5) {
		shiftEdgeVal = clamp(textureSampleLevel(shiftEdgeSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, -100.0, 100.0);
	}

	let direction = vec2<f32>(u.dirX, u.dirY);

	// Combined sigma for smoothing & feathering
	let smoothSigma = max(0.0, smoothVal * 0.15);
	let featherSigma = max(0.0, featherVal);
	let totalSigma = max(0.1, sqrt(smoothSigma * smoothSigma + featherSigma * featherSigma));

	if (u.isSecondPass <= 0.5) {
		// =============================================================
		// PASS 1: Horizontal Pass (Alpha filter + FG color sampling)
		// =============================================================
		let centerInput = textureSampleLevel(texInput, samp, in.uv, 0.0);
		let centerMatte = textureSampleLevel(texMatte, samp, in.uv, 0.0);

		var centerRawAlpha = centerInput.a;
		if (u.hasMatte > 0.5) {
			centerRawAlpha = extractChannel(centerMatte, u.matteChannel);
		}

		// 1. Horizontal Alpha Blur / Filter
		var alphaAccum = 0.0;
		var alphaWeightSum = 0.0;

		let stepScale = max(1.0, totalSigma / 15.0);
		let effectiveSigma = totalSigma / stepScale;
		let sampleRadius = min(i32(ceil(3.0 * effectiveSigma)), 32);

		for (var i = -sampleRadius; i <= sampleRadius; i++) {
			let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
			let sampleUv = clamp(in.uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
			let sampleInput = textureSampleLevel(texInput, samp, sampleUv, 0.0);
			var sAlpha = sampleInput.a;
			if (u.hasMatte > 0.5) {
				let sMatte = textureSampleLevel(texMatte, samp, sampleUv, 0.0);
				sAlpha = extractChannel(sMatte, u.matteChannel);
			}

			let dist = f32(i) * stepScale;
			let weight = exp(-0.5 * (dist / totalSigma) * (dist / totalSigma));
			alphaAccum += sAlpha * weight;
			alphaWeightSum += weight;
		}

		let smoothedAlpha = alphaAccum / max(alphaWeightSum, 1e-5);

		// 2. Horizontal Foreground Color Sampling for Defringing
		var fgColorAccum = vec3<f32>(0.0);
		var fgWeightSum = 0.0;

		let rStepScale = max(1.0, radius / 15.0);
		let rSampleCount = min(i32(ceil(radius / rStepScale)), 32);

		for (var i = -rSampleCount; i <= rSampleCount; i++) {
			let offset = vec2<f32>(f32(i) * rStepScale) * direction * texelSize;
			let sampleUv = clamp(in.uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
			let sampleCol = textureSampleLevel(texInput, samp, sampleUv, 0.0);
			var sampleA = sampleCol.a;
			if (u.hasMatte > 0.5) {
				let sm = textureSampleLevel(texMatte, samp, sampleUv, 0.0);
				sampleA = extractChannel(sm, u.matteChannel);
			}

			let sampleRgb = select(sampleCol.rgb, sampleCol.rgb / max(sampleCol.a, 1e-4), sampleCol.a > 1e-4);
			let spatialDist = f32(i) * rStepScale;
			let spatialWeight = exp(-0.5 * (spatialDist / max(radius, 0.5)) * (spatialDist / max(radius, 0.5)));
			// Weight foreground pixels by alpha confidence
			let fgConfidence = clamp((sampleA - 0.2) / 0.8, 0.0, 1.0);
			let weight = fgConfidence * spatialWeight;

			fgColorAccum += sampleRgb * weight;
			fgWeightSum += weight;
		}

		let centerUnpremult = select(centerInput.rgb, centerInput.rgb / max(centerInput.a, 1e-4), centerInput.a > 1e-4);
		let fgColor = select(centerUnpremult, fgColorAccum / max(fgWeightSum, 1e-5), fgWeightSum > 1e-4);

		return vec4<f32>(fgColor, smoothedAlpha);
	}

	// =============================================================
	// PASS 2: Vertical Pass & Final Defringe/Composite
	// =============================================================
	let pass1Sample = textureSampleLevel(texInput, samp, in.uv, 0.0);
	let origSample = textureSampleLevel(origTex, samp, in.uv, 0.0);

	var rawMatteAlpha = origSample.a;
	if (u.hasMatte > 0.5) {
		let rawMatteSample = textureSampleLevel(texMatte, samp, in.uv, 0.0);
		rawMatteAlpha = extractChannel(rawMatteSample, u.matteChannel);
	}

	// 1. Vertical Alpha Blur / Filter
	var alphaAccum = 0.0;
	var alphaWeightSum = 0.0;

	let stepScale = max(1.0, totalSigma / 15.0);
	let effectiveSigma = totalSigma / stepScale;
	let sampleRadius = min(i32(ceil(3.0 * effectiveSigma)), 32);

	for (var i = -sampleRadius; i <= sampleRadius; i++) {
		let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
		let sampleUv = clamp(in.uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
		let sPass1 = textureSampleLevel(texInput, samp, sampleUv, 0.0);
		let sAlpha = sPass1.a;

		let dist = f32(i) * stepScale;
		let weight = exp(-0.5 * (dist / totalSigma) * (dist / totalSigma));
		alphaAccum += sAlpha * weight;
		alphaWeightSum += weight;
	}

	var refinedAlpha = alphaAccum / max(alphaWeightSum, 1e-5);

	// 2. Shift Edge (Choke < 0 or Expand > 0)
	if (abs(shiftEdgeVal) > 0.01) {
		let shiftNorm = shiftEdgeVal / 100.0;
		if (shiftNorm < 0.0) {
			// Contract / Choke
			let chokeLimit = abs(shiftNorm);
			refinedAlpha = clamp((refinedAlpha - chokeLimit) / max(1.0 - chokeLimit, 1e-4), 0.0, 1.0);
		} else {
			// Expand / Dilate
			refinedAlpha = clamp(refinedAlpha / max(1.0 - shiftNorm, 1e-4), 0.0, 1.0);
		}
	}

	// 3. Vertical Foreground Color Sampling for Defringing
	var fgColorAccum = vec3<f32>(0.0);
	var fgWeightSum = 0.0;

	let rStepScale = max(1.0, radius / 15.0);
	let rSampleCount = min(i32(ceil(radius / rStepScale)), 32);

	for (var i = -rSampleCount; i <= rSampleCount; i++) {
		let offset = vec2<f32>(f32(i) * rStepScale) * direction * texelSize;
		let sampleUv = clamp(in.uv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
		let sPass1 = textureSampleLevel(texInput, samp, sampleUv, 0.0);
		let sRgb = sPass1.rgb;
		let sA = sPass1.a;

		let spatialDist = f32(i) * rStepScale;
		let spatialWeight = exp(-0.5 * (spatialDist / max(radius, 0.5)) * (spatialDist / max(radius, 0.5)));
		let fgConfidence = clamp((sA - 0.2) / 0.8, 0.0, 1.0);
		let weight = fgConfidence * spatialWeight;

		fgColorAccum += sRgb * weight;
		fgWeightSum += weight;
	}

	let origUnpremult = select(origSample.rgb, origSample.rgb / max(origSample.a, 1e-4), origSample.a > 1e-4);
	let fgColor = select(origUnpremult, fgColorAccum / max(fgWeightSum, 1e-5), fgWeightSum > 1e-4);

	// Edge zone detection: transitions between foreground and background
	let edgeWeight = clamp(4.0 * rawMatteAlpha * (1.0 - rawMatteAlpha), 0.0, 1.0);
	let decontamFactor = clamp(decontam * max(edgeWeight, (1.0 - refinedAlpha) * 0.8), 0.0, 1.0);

	let decontaminatedColor = mix(origUnpremult, fgColor, decontamFactor);

	// Format Output
	let mode = u.outputMode;
	if (mode < 0.5) {
		// Composite: Decontaminated RGB with refined alpha (premultiplied)
		return vec4<f32>(decontaminatedColor * refinedAlpha, refinedAlpha);
	} else if (mode < 1.5) {
		// MatteOnly: Grayscale refined alpha mask
		return vec4<f32>(refinedAlpha, refinedAlpha, refinedAlpha, 1.0);
	} else {
		// DecontaminatedRGB: Clean defringed RGB with full alpha
		return vec4<f32>(decontaminatedColor, 1.0);
	}
}
`;

interface DeviceRefineEdgeResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceRefineEdgeResources>();

function getRefineEdgeResources(
	device: GPUDevice,
	targetFormat: GPUTextureFormat,
): DeviceRefineEdgeResources {
	const cached = deviceResourceCache.get(device);
	if (cached) return cached;

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
				sampler: { type: "filtering" },
			},
		],
	});

	const shaderModule = device.createShaderModule({
		code: WGSL_REFINE_EDGE,
	});

	const pipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [uniformLayout, textureLayout, signalTextureLayout],
	});

	const pipeline = device.createRenderPipeline({
		layout: pipelineLayout,
		vertex: {
			module: shaderModule,
			entryPoint: "vs",
		},
		fragment: {
			module: shaderModule,
			entryPoint: "fs",
			targets: [{ format: targetFormat }],
		},
		primitive: {
			topology: "triangle-strip",
		},
	});

	const res: DeviceRefineEdgeResources = {
		uniformLayout,
		textureLayout,
		signalTextureLayout,
		pipeline,
	};
	deviceResourceCache.set(device, res);
	return res;
}

export const WebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as RefineEdgeOp | undefined;
	if (op?.op !== "RefineEdge" || !op) return;

	const childMedia = props.virtualMedia?.children?.[0];
	if (!childMedia) return;

	// End incoming pass
	pass.end();

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const width = targetWidth;
	const height = targetHeight;

	const resolveField = (
		handleId: string | null | undefined,
		fallbackVal: number,
		clampMin = 0,
		clampMax = 1000,
	): {
		val: number;
		hasStaticSig: boolean;
		sd: RefineEdgeSignalData | null;
		handleId?: string | null;
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
					handleId,
				};
			}
			if (outputItem?.type === "Signal" && outputItem.data) {
				return {
					val: fallbackVal,
					hasStaticSig: true,
					sd: outputItem.data as RefineEdgeSignalData,
					handleId,
				};
			}
		}
		return {
			val: Math.max(clampMin, Math.min(clampMax, fallbackVal)),
			hasStaticSig: false,
			sd: null,
			handleId,
		};
	};

	const decontamRes = resolveField(
		op.decontaminateAmountHandleId,
		Number(op.decontaminateAmount ?? 0.7),
		MIN_DECONTAMINATE,
		MAX_DECONTAMINATE,
	);
	const radiusRes = resolveField(
		op.radiusHandleId,
		Number(op.radius ?? 2.0),
		MIN_RADIUS,
		MAX_RADIUS,
	);
	const smoothRes = resolveField(
		op.smoothHandleId,
		Number(op.smooth ?? 5),
		MIN_SMOOTH,
		MAX_SMOOTH,
	);
	const featherRes = resolveField(
		op.featherHandleId,
		Number(op.feather ?? 0.5),
		MIN_FEATHER,
		MAX_FEATHER,
	);
	const shiftEdgeRes = resolveField(
		op.shiftEdgeHandleId,
		Number(op.shiftEdge ?? 0),
		MIN_SHIFT_EDGE,
		MAX_SHIFT_EDGE,
	);

	// 1. Render primary Input child media
	const tmpInputTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpInputView = tmpInputTex.createView();

	const childInputPass = ctx.renderer.beginFrame(
		encoder,
		tmpInputView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childInputPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
			renderId: `${props.renderId}-input`,
			excludeTextures: [...(props.excludeTextures || []), tmpInputTex],
		},
		tmpInputView,
		tmpInputTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Render optional Matte child media if connected
	let tmpMatteTex: GPUTexture | null = null;
	if (op.matteMedia) {
		tmpMatteTex = ctx.renderer.getTemporaryTexture(width, height, [
			...(props.excludeTextures || []),
			targetTexture,
			tmpInputTex,
		]);
		const tmpMatteView = tmpMatteTex.createView();

		const childMattePass = ctx.renderer.beginFrame(
			encoder,
			tmpMatteView,
			{ r: 0, g: 0, b: 0, a: 0 },
			width,
			height,
			"clear",
		);
		childMattePass.end();

		ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
		ctx.renderer.pushIdentity();
		await drawChild(
			op.matteMedia as VirtualMediaData,
			{
				...props,
				virtualMedia: op.matteMedia as VirtualMediaData,
				renderId: `${props.renderId}-matte`,
				excludeTextures: [
					...(props.excludeTextures || []),
					tmpInputTex,
					tmpMatteTex,
				],
			},
			tmpMatteView,
			tmpMatteTex,
			width,
			height,
		);
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
	}

	// 3. Compile pipeline resources
	const { pipeline, uniformLayout, textureLayout, signalTextureLayout } =
		getRefineEdgeResources(ctx.device, ctx.renderer.format);
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
			sd: RefineEdgeSignalData | null;
			handleId?: string | null;
		},
		suffix: string,
	) => {
		if (res.hasStaticSig && res.sd) {
			const cacheNodeId =
				res.sd.nodeId ??
				res.handleId ??
				`${props.renderId ?? "refineedge"}_${suffix}`;
			return signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				cacheNodeId,
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

	const decontamView = getSignalView(decontamRes, "decontam_sig");
	const radiusView = getSignalView(radiusRes, "radius_sig");
	const smoothView = getSignalView(smoothRes, "smooth_sig");
	const featherView = getSignalView(featherRes, "feather_sig");
	const shiftEdgeView = getSignalView(shiftEdgeRes, "shiftEdge_sig");

	const sigBindGroup = ctx.device.createBindGroup({
		layout: signalTextureLayout,
		entries: [
			{ binding: 0, resource: decontamView },
			{ binding: 1, resource: radiusView },
			{ binding: 2, resource: smoothView },
			{ binding: 3, resource: featherView },
			{ binding: 4, resource: shiftEdgeView },
			{ binding: 5, resource: sampler },
		],
	});

	const matteChannelCode = CHANNEL_MAP[op.matteChannel ?? "Alpha"] ?? 0;
	const outputModeCode = OUTPUT_MODE_MAP[op.outputMode ?? "Composite"] ?? 0;

	const dummyMatteView = tmpMatteTex ? tmpMatteTex.createView() : tmpInputView;

	// Populate separate uniform data buffers for each pass
	const hUniformData = new Float32Array(20);
	const vUniformData = new Float32Array(20);

	const baseUniforms = [
		0.0, // [0] dirX (set per pass)
		0.0, // [1] dirY (set per pass)
		decontamRes.val, // [2] decontaminateAmount
		radiusRes.val, // [3] radius
		smoothRes.val, // [4] smooth
		featherRes.val, // [5] feather
		shiftEdgeRes.val, // [6] shiftEdge
		matteChannelCode, // [7] matteChannel
		outputModeCode, // [8] outputMode
		tmpMatteTex ? 1.0 : 0.0, // [9] hasMatte
		decontamRes.hasStaticSig ? 1.0 : 0.0, // [10] hasDecontamSig
		radiusRes.hasStaticSig ? 1.0 : 0.0, // [11] hasRadiusSig
		smoothRes.hasStaticSig ? 1.0 : 0.0, // [12] hasSmoothSig
		featherRes.hasStaticSig ? 1.0 : 0.0, // [13] hasFeatherSig
		shiftEdgeRes.hasStaticSig ? 1.0 : 0.0, // [14] hasShiftEdgeSig
		0.0, // [15] isSecondPass (set per pass)
		0.0, // [16] pad0
		0.0, // [17] pad1
		0.0, // [18] pad2
		0.0, // [19] pad3
	];

	hUniformData.set(baseUniforms);
	hUniformData[0] = 1.0; // dirX
	hUniformData[1] = 0.0; // dirY
	hUniformData[15] = 0.0; // isSecondPass = false

	vUniformData.set(baseUniforms);
	vUniformData[0] = 0.0; // dirX
	vUniformData[1] = 1.0; // dirY
	vUniformData[15] = 1.0; // isSecondPass = true

	const outTex1 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpInputTex,
		...(tmpMatteTex ? [tmpMatteTex] : []),
		targetTexture,
		...(props.excludeTextures || []),
	]);
	const outTex2 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpInputTex,
		...(tmpMatteTex ? [tmpMatteTex] : []),
		outTex1,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// Pass 1: Horizontal Pass
	const hBuffer = ctx.renderer.getTemporaryBuffer(hUniformData);

	const hPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex1.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});
	hPass.setPipeline(pipeline);
	hPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uniformLayout,
			entries: [{ binding: 0, resource: { buffer: hBuffer } }],
		}),
	);
	hPass.setBindGroup(
		1,
		ctx.device.createBindGroup({
			layout: textureLayout,
			entries: [
				{ binding: 0, resource: tmpInputView },
				{ binding: 1, resource: dummyMatteView },
				{ binding: 2, resource: tmpInputView },
				{ binding: 3, resource: sampler },
			],
		}),
	);
	hPass.setBindGroup(2, sigBindGroup);
	hPass.draw(4);
	hPass.end();

	// Pass 2: Vertical Pass + Defringe & Composite
	const vBuffer = ctx.renderer.getTemporaryBuffer(vUniformData);

	const vPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex2.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});
	vPass.setPipeline(pipeline);
	vPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uniformLayout,
			entries: [{ binding: 0, resource: { buffer: vBuffer } }],
		}),
	);
	vPass.setBindGroup(
		1,
		ctx.device.createBindGroup({
			layout: textureLayout,
			entries: [
				{ binding: 0, resource: outTex1.createView() },
				{ binding: 1, resource: dummyMatteView },
				{ binding: 2, resource: tmpInputView },
				{ binding: 3, resource: sampler },
			],
		}),
	);
	vPass.setBindGroup(2, sigBindGroup);
	vPass.draw(4);
	vPass.end();

	// 4. Final Pass: draw output into targetView
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	const finalOpacity = props.opacity ?? op.opacity ?? 1.0;

	ctx.renderer.drawTexture(
		finalPass,
		outTex2,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: finalOpacity },
	);

	args.pass = finalPass;
};
