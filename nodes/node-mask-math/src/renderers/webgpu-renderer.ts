/// <reference types="webgpu" />
import type { VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";
import {
	MAX_RADIUS,
	type MaskChannel,
	type MaskMathOp,
	type MaskMathSignalData,
	type MaskOperation,
	type MaskOutputFormat,
} from "../shared/index.js";

const OPERATION_MAP: Record<MaskOperation, number> = {
	Union: 0,
	Intersect: 1,
	Subtract: 2,
	Difference: 3,
	Invert: 4,
	Dilate: 5,
	Erode: 6,
	Choke: 7,
	Feather: 8,
};

const CHANNEL_MAP: Record<MaskChannel, number> = {
	Alpha: 0,
	Luminance: 1,
	Red: 2,
	Green: 3,
	Blue: 4,
};

const OUTPUT_FORMAT_MAP: Record<MaskOutputFormat, number> = {
	WhiteWithAlpha: 0,
	GrayscaleRGB: 1,
	AlphaOnly: 2,
	PassthroughRGB: 3,
};

const WGSL_MASKMATH = `
struct MaskMathUniforms {
	dirX           : f32,
	dirY           : f32,
	radius         : f32,
	threshold      : f32,

	clampMin       : f32,
	clampMax       : f32,
	operation      : f32,
	channelA       : f32,

	channelB       : f32,
	binarize       : f32,
	invertResult   : f32,
	outputFormat   : f32,

	hasMaskB       : f32,
	hasRadiusSig   : f32,
	hasThreshSig   : f32,
	hasClampMinSig : f32,

	hasClampMaxSig : f32,
	isSecondPass   : f32,
	pad0           : f32,
	pad1           : f32,
};

@group(0) @binding(0) var<uniform> u          : MaskMathUniforms;

@group(1) @binding(0) var texA                : texture_2d<f32>;
@group(1) @binding(1) var texB                : texture_2d<f32>;
@group(1) @binding(2) var origTexA            : texture_2d<f32>;
@group(1) @binding(3) var samp                : sampler;

@group(2) @binding(0) var radiusSigTex        : texture_2d<f32>;
@group(2) @binding(1) var threshSigTex        : texture_2d<f32>;
@group(2) @binding(2) var clampMinSigTex      : texture_2d<f32>;
@group(2) @binding(3) var clampMaxSigTex      : texture_2d<f32>;
@group(2) @binding(4) var signalSamp          : sampler;

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
	let dimensions = vec2<f32>(textureDimensions(texA));
	let texelSize = 1.0 / max(dimensions, vec2<f32>(1.0, 1.0));

	var radius = u.radius;
	if (u.hasRadiusSig > 0.5) {
		radius = clamp(textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 200.0);
	}
	var threshold = u.threshold;
	if (u.hasThreshSig > 0.5) {
		threshold = clamp(textureSampleLevel(threshSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 1.0);
	}
	var clampMin = u.clampMin;
	if (u.hasClampMinSig > 0.5) {
		clampMin = clamp(textureSampleLevel(clampMinSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 1.0);
	}
	var clampMax = u.clampMax;
	if (u.hasClampMaxSig > 0.5) {
		clampMax = clamp(textureSampleLevel(clampMaxSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r, 0.0, 1.0);
	}

	let op = u.operation;
	let direction = vec2<f32>(u.dirX, u.dirY);

	var val = 0.0;

	if (u.isSecondPass <= 0.5) {
		// -------------------------------------------------------------
		// PASS 1: Horizontal pass / Boolean operation
		// -------------------------------------------------------------
		let sampleA = textureSampleLevel(texA, samp, in.uv, 0.0);
		let sampleB = textureSampleLevel(texB, samp, in.uv, 0.0);

		let a = extractChannel(sampleA, u.channelA);
		let b = select(0.0, extractChannel(sampleB, u.channelB), u.hasMaskB > 0.5);

		if (op < 0.5) {
			// Union (A + B)
			val = select(a, clamp(a + b, 0.0, 1.0), u.hasMaskB > 0.5);
		} else if (op < 1.5) {
			// Intersect (min(A, B))
			val = select(a, min(a, b), u.hasMaskB > 0.5);
		} else if (op < 2.5) {
			// Subtract (clamp(A - B, 0, 1))
			val = select(a, clamp(a - b, 0.0, 1.0), u.hasMaskB > 0.5);
		} else if (op < 3.5) {
			// Difference (|A - B|)
			val = select(a, abs(a - b), u.hasMaskB > 0.5);
		} else if (op < 4.5) {
			// Invert (1 - A)
			val = 1.0 - a;
		} else if (op < 5.5) {
			// Dilate (Horizontal Max)
			if (radius <= 0.0) {
				val = a;
			} else {
				let stepScale = max(1.0, radius / 20.0);
				let sampleRadius = min(i32(ceil(radius / stepScale)), 48);
				var maxVal = a;
				for (var i = -sampleRadius; i <= sampleRadius; i++) {
					let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
					let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
					maxVal = max(maxVal, extractChannel(s, u.channelA));
				}
				val = maxVal;
			}
		} else if (op < 7.5) {
			// Erode & Choke (Horizontal Min)
			if (radius <= 0.0) {
				val = a;
			} else {
				let stepScale = max(1.0, radius / 20.0);
				let sampleRadius = min(i32(ceil(radius / stepScale)), 48);
				var minVal = a;
				for (var i = -sampleRadius; i <= sampleRadius; i++) {
					let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
					let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
					minVal = min(minVal, extractChannel(s, u.channelA));
				}
				val = minVal;
			}
		} else {
			// Feather (Horizontal Gaussian Blur)
			if (radius <= 0.0) {
				val = a;
			} else {
				let spatial_sigma = max(0.1, radius / 2.0);
				let stepScale = max(1.0, spatial_sigma / 20.0);
				let effectiveSigma = spatial_sigma / stepScale;
				let sampleRadius = min(i32(ceil(3.0 * effectiveSigma)), 48);
				var accum = 0.0;
				var totalWeight = 0.0;
				for (var i = -sampleRadius; i <= sampleRadius; i++) {
					let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
					let x = f32(i) * stepScale;
					let weight = exp(-0.5 * (x / spatial_sigma) * (x / spatial_sigma));
					let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
					accum += extractChannel(s, u.channelA) * weight;
					totalWeight += weight;
				}
				val = accum / max(totalWeight, 1e-5);
			}
		}

		return vec4<f32>(val, val, val, val);
	}

	// -------------------------------------------------------------
	// PASS 2: Vertical pass & Post-processing (clamp, binarize, format)
	// -------------------------------------------------------------
	let samplePass1 = textureSampleLevel(texA, samp, in.uv, 0.0);
	var matte = samplePass1.r;

	// 1. Spatial kernel processing (Dilate, Erode, Choke, Feather) when radius > 0
	if (radius > 0.0) {
		if (op >= 4.5 && op < 5.5) {
			// Dilate (Vertical Max)
			let stepScale = max(1.0, radius / 20.0);
			let sampleRadius = min(i32(ceil(radius / stepScale)), 48);
			var maxVal = matte;
			for (var i = -sampleRadius; i <= sampleRadius; i++) {
				let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
				let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
				maxVal = max(maxVal, s.r);
			}
			matte = maxVal;
		} else if (op >= 5.5 && op < 7.5) {
			// Erode & Choke (Vertical Min)
			let stepScale = max(1.0, radius / 20.0);
			let sampleRadius = min(i32(ceil(radius / stepScale)), 48);
			var minVal = matte;
			for (var i = -sampleRadius; i <= sampleRadius; i++) {
				let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
				let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
				minVal = min(minVal, s.r);
			}
			matte = minVal;
		} else if (op >= 7.5) {
			// Feather (Vertical Gaussian Blur)
			let spatial_sigma = max(0.1, radius / 2.0);
			let stepScale = max(1.0, spatial_sigma / 20.0);
			let effectiveSigma = spatial_sigma / stepScale;
			let sampleRadius = min(i32(ceil(3.0 * effectiveSigma)), 48);
			var accum = 0.0;
			var totalWeight = 0.0;
			for (var i = -sampleRadius; i <= sampleRadius; i++) {
				let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
				let x = f32(i) * stepScale;
				let weight = exp(-0.5 * (x / spatial_sigma) * (x / spatial_sigma));
				let s = textureSampleLevel(texA, samp, in.uv + offset, 0.0);
				accum += s.r * weight;
				totalWeight += weight;
			}
			matte = accum / max(totalWeight, 1e-5);
		}
	}

	// 2. Choke non-linear threshold contraction curve (applies even if radius == 0)
	if (op >= 6.5 && op < 7.5) {
		let threshRange = max(0.01, 1.0 - threshold);
		matte = clamp((matte - threshold) / threshRange, 0.0, 1.0);
	}

	// Range clamping
	let lowerLimit = min(clampMin, clampMax);
	let upperLimit = max(clampMin, clampMax);
	matte = clamp(matte, lowerLimit, upperLimit);

	// Optional Binarization
	if (u.binarize > 0.5) {
		matte = select(0.0, 1.0, matte >= threshold);
	}

	// Optional Inversion
	if (u.invertResult > 0.5) {
		matte = 1.0 - matte;
	}

	// Output format conversion
	let fmt = u.outputFormat;
	if (fmt < 0.5) {
		// WhiteWithAlpha: vec4(matte, matte, matte, matte) (premultiplied standard mask)
		return vec4<f32>(matte, matte, matte, matte);
	} else if (fmt < 1.5) {
		// GrayscaleRGB: vec4(matte, matte, matte, 1.0)
		return vec4<f32>(matte, matte, matte, 1.0);
	} else if (fmt < 2.5) {
		// AlphaOnly: vec4(0.0, 0.0, 0.0, matte)
		return vec4<f32>(0.0, 0.0, 0.0, matte);
	} else {
		// PassthroughRGB: Mask A color with new alpha
		let origCol = textureSampleLevel(origTexA, samp, in.uv, 0.0);
		if (origCol.a < 1e-4) {
			return vec4<f32>(0.0, 0.0, 0.0, 0.0);
		}
		let unpremult = origCol.rgb / origCol.a;
		return vec4<f32>(unpremult * matte, matte);
	}
}
`;

interface DeviceMaskMathResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceMaskMathResources>();

function getMaskMathResources(
	device: GPUDevice,
	targetFormat: GPUTextureFormat,
): DeviceMaskMathResources {
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
				sampler: { type: "filtering" },
			},
		],
	});

	const shaderModule = device.createShaderModule({
		code: WGSL_MASKMATH,
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

	const res: DeviceMaskMathResources = {
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

	const op = props.virtualMedia?.operation as MaskMathOp | undefined;
	if (op?.op !== "MaskMath" || !op) return;

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
		sd: MaskMathSignalData | null;
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
					sd: outputItem.data as MaskMathSignalData,
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

	const radiusRes = resolveField(
		op.radiusHandleId,
		Number(op.radius ?? 0),
		0,
		MAX_RADIUS,
	);
	const thresholdRes = resolveField(
		op.thresholdHandleId,
		Number(op.threshold ?? 0.5),
		0.0,
		1.0,
	);
	const clampMinRes = resolveField(
		op.clampMinHandleId,
		Number(op.clampMin ?? 0.0),
		0.0,
		1.0,
	);
	const clampMaxRes = resolveField(
		op.clampMaxHandleId,
		Number(op.clampMax ?? 1.0),
		0.0,
		1.0,
	);

	// 1. Render primary Mask A child media
	const tmpATex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpAView = tmpATex.createView();

	const childAPass = ctx.renderer.beginFrame(
		encoder,
		tmpAView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childAPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
			renderId: `${props.renderId}-maskA`,
			excludeTextures: [...(props.excludeTextures || []), tmpATex],
		},
		tmpAView,
		tmpATex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Render optional Mask B child media if connected
	let tmpBTex: GPUTexture | null = null;
	if (op.maskBMedia) {
		tmpBTex = ctx.renderer.getTemporaryTexture(width, height, [
			...(props.excludeTextures || []),
			targetTexture,
			tmpATex,
		]);
		const tmpBView = tmpBTex.createView();

		const childBPass = ctx.renderer.beginFrame(
			encoder,
			tmpBView,
			{ r: 0, g: 0, b: 0, a: 0 },
			width,
			height,
			"clear",
		);
		childBPass.end();

		ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
		ctx.renderer.pushIdentity();
		await drawChild(
			op.maskBMedia as VirtualMediaData,
			{
				...props,
				virtualMedia: op.maskBMedia as VirtualMediaData,
				renderId: `${props.renderId}-maskB`,
				excludeTextures: [...(props.excludeTextures || []), tmpATex, tmpBTex],
			},
			tmpBView,
			tmpBTex,
			width,
			height,
		);
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
	}

	// 3. Compile pipeline resources
	const { pipeline, uniformLayout, textureLayout, signalTextureLayout } =
		getMaskMathResources(ctx.device, ctx.renderer.format);
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
			sd: MaskMathSignalData | null;
			handleId?: string | null;
		},
		suffix: string,
	) => {
		if (res.hasStaticSig && res.sd) {
			const cacheNodeId =
				res.sd.nodeId ??
				res.handleId ??
				`${props.renderId ?? "maskmath"}_${suffix}`;
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

	const radiusView = getSignalView(radiusRes, "radius_sig");
	const threshView = getSignalView(thresholdRes, "threshold_sig");
	const clampMinView = getSignalView(clampMinRes, "clampMin_sig");
	const clampMaxView = getSignalView(clampMaxRes, "clampMax_sig");

	const sigBindGroup = ctx.device.createBindGroup({
		layout: signalTextureLayout,
		entries: [
			{ binding: 0, resource: radiusView },
			{ binding: 1, resource: threshView },
			{ binding: 2, resource: clampMinView },
			{ binding: 3, resource: clampMaxView },
			{ binding: 4, resource: sampler },
		],
	});

	const operationCode = OPERATION_MAP[op.operation ?? "Union"] ?? 0;
	const channelACode = CHANNEL_MAP[op.channelA ?? "Alpha"] ?? 0;
	const channelBCode = CHANNEL_MAP[op.channelB ?? "Alpha"] ?? 0;
	const outputFormatCode =
		OUTPUT_FORMAT_MAP[op.outputFormat ?? "WhiteWithAlpha"] ?? 0;

	const dummyBView = tmpBTex ? tmpBTex.createView() : tmpAView;

	// Populate separate uniform data buffers for each pass
	const hUniformData = new Float32Array(20);
	const vUniformData = new Float32Array(20);

	const baseUniforms = [
		0.0, // [0] dirX (set per pass)
		0.0, // [1] dirY (set per pass)
		radiusRes.val, // [2] radius
		thresholdRes.val, // [3] threshold
		clampMinRes.val, // [4] clampMin
		clampMaxRes.val, // [5] clampMax
		operationCode, // [6] operation
		channelACode, // [7] channelA
		channelBCode, // [8] channelB
		op.binarize ? 1.0 : 0.0, // [9] binarize
		op.invertResult ? 1.0 : 0.0, // [10] invertResult
		outputFormatCode, // [11] outputFormat
		tmpBTex ? 1.0 : 0.0, // [12] hasMaskB
		radiusRes.hasStaticSig ? 1.0 : 0.0, // [13] hasRadiusSig
		thresholdRes.hasStaticSig ? 1.0 : 0.0, // [14] hasThreshSig
		clampMinRes.hasStaticSig ? 1.0 : 0.0, // [15] hasClampMinSig
		clampMaxRes.hasStaticSig ? 1.0 : 0.0, // [16] hasClampMaxSig
		0.0, // [17] isSecondPass (set per pass)
		0.0, // [18] pad0
		0.0, // [19] pad1
	];

	hUniformData.set(baseUniforms);
	hUniformData[0] = 1.0; // dirX
	hUniformData[1] = 0.0; // dirY
	hUniformData[17] = 0.0; // isSecondPass = false

	vUniformData.set(baseUniforms);
	vUniformData[0] = 0.0; // dirX
	vUniformData[1] = 1.0; // dirY
	vUniformData[17] = 1.0; // isSecondPass = true

	const outTex1 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpATex,
		...(tmpBTex ? [tmpBTex] : []),
		targetTexture,
		...(props.excludeTextures || []),
	]);
	const outTex2 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpATex,
		...(tmpBTex ? [tmpBTex] : []),
		outTex1,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// Pass 1: Horizontal Pass (or direct combination)
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
				{ binding: 0, resource: tmpAView },
				{ binding: 1, resource: dummyBView },
				{ binding: 2, resource: tmpAView },
				{ binding: 3, resource: sampler },
			],
		}),
	);
	hPass.setBindGroup(2, sigBindGroup);
	hPass.draw(4);
	hPass.end();

	// Pass 2: Vertical Pass + post-processing
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
				{ binding: 1, resource: dummyBView },
				{ binding: 2, resource: tmpAView },
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
