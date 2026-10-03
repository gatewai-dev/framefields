/// <reference types="webgpu" />
import type { SignalData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { signalRegistry } from "@gitframes/webgpu-renderers";
import { MAX_RADIUS } from "../shared/config.js";

interface HighPassOp {
	op: "HighPass";
	radius?: number;
	contrastBoost?: number;
	monochrome?: boolean;
	radiusHandleId?: string | null;
	contrastBoostHandleId?: string | null;
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

type HighPassSignalData = SignalData & { nodeId?: string };

const WGSL_HIGHPASS_UNIFORMS = `
struct HighPassUniforms {
	dirX           : f32,
	dirY           : f32,
	radius         : f32,
	contrastBoost  : f32,

	monochrome     : f32,
	hasRadiusSig   : f32,
	hasContrastSig : f32,
	isSecondPass   : f32,
};

@group(0) @binding(0) var<uniform> u          : HighPassUniforms;
@group(1) @binding(0) var tex                 : texture_2d<f32>;
@group(1) @binding(1) var samp                : sampler;
@group(1) @binding(2) var origTex             : texture_2d<f32>;

@group(2) @binding(0) var radiusSigTex        : texture_2d<f32>;
@group(2) @binding(1) var contrastSigTex      : texture_2d<f32>;
@group(2) @binding(2) var signalSamp          : sampler;

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
	let dimensions = vec2<f32>(textureDimensions(tex));
	var radius = u.radius;
	if (u.hasRadiusSig > 0.5) {
		radius = textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}
	var contrastBoost = u.contrastBoost;
	if (u.hasContrastSig > 0.5) {
		contrastBoost = textureSampleLevel(contrastSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
	}

	let origCol = textureSampleLevel(origTex, samp, in.uv, 0.0);
	if (radius <= 0.0) {
		if (u.isSecondPass > 0.5) {
			return vec4<f32>(vec3<f32>(0.5) * origCol.a, origCol.a);
		}
		return origCol;
	}

	let texelSize = 1.0 / dimensions;
	let spatial_sigma = radius;
	let stepScale = max(1.0, spatial_sigma / 20.0);
	let effectiveSigma = spatial_sigma / stepScale;
	let sampleRadius = min(i32(ceil(3.0 * effectiveSigma)), 64);
	let direction = vec2<f32>(u.dirX, u.dirY);

	var blurred = vec4<f32>(0.0);
	var totalWeight = 0.0;

	for (var i = -sampleRadius; i <= sampleRadius; i++) {
		let offset = vec2<f32>(f32(i) * stepScale) * direction * texelSize;
		let x = f32(i) * stepScale;
		let weight = exp(-0.5 * (x / spatial_sigma) * (x / spatial_sigma));
		blurred += textureSampleLevel(tex, samp, in.uv + offset, 0.0) * weight;
		totalWeight += weight;
	}

	let blurResult = blurred / max(totalWeight, 1e-5);

	if (u.isSecondPass <= 0.5) {
		// Pass 1: Intermediate horizontal blur
		return blurResult;
	}

	// Pass 2: Vertical blur complete -> Calculate High Pass difference against original
	if (origCol.a < 1e-5) {
		return vec4<f32>(0.0, 0.0, 0.0, 0.0);
	}

	let origUnpremult = origCol.rgb / origCol.a;
	let blurUnpremult = blurResult.rgb / max(blurResult.a, 1e-5);
	let diff = origUnpremult - blurUnpremult;

	var highPassRgb : vec3<f32>;
	if (u.monochrome > 0.5) {
		let lumaDiff = dot(diff, vec3<f32>(0.2126, 0.7152, 0.0722));
		highPassRgb = vec3<f32>(0.5) + vec3<f32>(lumaDiff * contrastBoost);
	} else {
		highPassRgb = vec3<f32>(0.5) + diff * contrastBoost;
	}

	let clampedRgb = clamp(highPassRgb, vec3<f32>(0.0), vec3<f32>(1.0));
	return vec4<f32>(clampedRgb * origCol.a, origCol.a);
}
`;

interface DeviceHighPassResources {
	highPassUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	highPassPipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceHighPassResources>();
const highPassUniformData = new Float32Array(8);

function getHighPassResources(
	device: GPUDevice,
	targetFormat: GPUTextureFormat,
): DeviceHighPassResources {
	const cached = deviceResourceCache.get(device);
	if (cached) return cached;

	const highPassUniformLayout = device.createBindGroupLayout({
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
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
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
				sampler: { type: "filtering" },
			},
		],
	});

	const shaderModule = device.createShaderModule({
		code: WGSL_HIGHPASS_UNIFORMS,
	});

	const pipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [
			highPassUniformLayout,
			singleTextureLayout,
			signalTextureLayout,
		],
	});

	const highPassPipeline = device.createRenderPipeline({
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

	const res: DeviceHighPassResources = {
		highPassUniformLayout,
		singleTextureLayout,
		signalTextureLayout,
		highPassPipeline,
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

	const op = props.virtualMedia?.operation as HighPassOp | undefined;
	if (op?.op !== "HighPass" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the incoming active pass
	pass.end();

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const width = targetWidth;
	const height = targetHeight;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "highpass_node";

	const resolveField = (
		handleId: string | null | undefined,
		fallbackVal: number,
		clampMin = 0,
		clampMax = 1000,
	): { val: number; hasStaticSig: boolean; sd: HighPassSignalData | null } => {
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
					sd: outputItem.data as HighPassSignalData,
				};
			}
		}
		return {
			val: Math.max(clampMin, Math.min(clampMax, fallbackVal)),
			hasStaticSig: false,
			sd: null,
		};
	};

	const radiusRes = resolveField(
		op.radiusHandleId,
		Number(op.radius ?? 3.0),
		0.1,
		MAX_RADIUS,
	);
	const contrastRes = resolveField(
		op.contrastBoostHandleId,
		Number(op.contrastBoost ?? 1.0),
		1.0,
		10.0,
	);

	// 1. Render child media into temporary input texture
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
		{ ...props, virtualMedia: childMedia },
		tmpView,
		tmpTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Fetch static resources and compile pipeline once
	const {
		highPassPipeline: pipeline,
		highPassUniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getHighPassResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const getSignalView = (
		res: { val: number; hasStaticSig: boolean; sd: HighPassSignalData | null },
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

	const radiusView = getSignalView(radiusRes, "radius_sig");
	const contrastView = getSignalView(contrastRes, "contrast_sig");

	const createHighPassBindGroup1 = (
		inputTex: GPUTexture,
		origTexture: GPUTexture,
	) =>
		ctx.device.createBindGroup({
			layout: tLayout,
			entries: [
				{ binding: 0, resource: inputTex.createView() },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: origTexture.createView() },
			],
		});

	// Prepare uniform template (32 bytes / 8 floats)
	highPassUniformData[2] = radiusRes.val;
	highPassUniformData[3] = contrastRes.val;
	highPassUniformData[4] = (op.monochrome ?? true) ? 1.0 : 0.0;
	highPassUniformData[5] = radiusRes.hasStaticSig ? 1.0 : 0.0;
	highPassUniformData[6] = contrastRes.hasStaticSig ? 1.0 : 0.0;
	highPassUniformData[7] = 0.0; // isSecondPass

	const outTex1 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);
	const outTex2 = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		outTex1,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	const sigBindGroup = ctx.device.createBindGroup({
		layout: sigLayout,
		entries: [
			{ binding: 0, resource: radiusView },
			{ binding: 1, resource: contrastView },
			{ binding: 2, resource: sampler },
		],
	});

	// Pass 1: Horizontal Gaussian convolution
	highPassUniformData[0] = 1.0;
	highPassUniformData[1] = 0.0;
	highPassUniformData[7] = 0.0; // isSecondPass = false
	const hBuffer = ctx.renderer.getTemporaryBuffer(highPassUniformData);

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
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: hBuffer } }],
		}),
	);
	hPass.setBindGroup(1, createHighPassBindGroup1(tmpTex, tmpTex));
	hPass.setBindGroup(2, sigBindGroup);
	hPass.draw(4);
	hPass.end();

	// Pass 2: Vertical Gaussian convolution + High Pass Subtraction against original tmpTex
	highPassUniformData[0] = 0.0;
	highPassUniformData[1] = 1.0;
	highPassUniformData[7] = 1.0; // isSecondPass = true
	const vBuffer = ctx.renderer.getTemporaryBuffer(highPassUniformData);

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
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: vBuffer } }],
		}),
	);
	vPass.setBindGroup(1, createHighPassBindGroup1(outTex1, tmpTex));
	vPass.setBindGroup(2, sigBindGroup);
	vPass.draw(4);
	vPass.end();

	// 3. Final Pass: Draw result back to targetView using standard drawTexture for blending/opacity
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
		outTex2,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: op.opacity ?? 1.0 },
	);

	args.pass = finalPass;
};
