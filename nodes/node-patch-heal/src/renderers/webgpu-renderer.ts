/// <reference types="webgpu" />
import type { SignalData, VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry as globalSignalRegistry } from "@framefields/webgpu-renderers";
import {
	MAX_FEATHER,
	MAX_OFFSET,
	MAX_RADIUS,
	normalizePatches,
	type PatchHealNodeConfig,
} from "../shared/index.js";

const WGSL_FULLSCREEN_VS = `
struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0)
    );
    var uvs = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    var output : VertexOutput;
    output.position = vec4<f32>(pos[vertexIndex], 0.0, 1.0);
    output.uv = uvs[vertexIndex];
    return output;
}
`;

const WGSL_PATCHHEAL_UNIFORMS = `
struct PatchHealUniforms {
    offsetX          : f32,
    offsetY          : f32,
    centerX          : f32,
    centerY          : f32,

    radius           : f32,
    sourceRadius     : f32,
    feather          : f32,
    opacity          : f32,

    mode             : f32,
    hasMask          : f32,
    hasOffsetXSig    : f32,
    hasOffsetYSig    : f32,

    hasCenterXSig    : f32,
    hasCenterYSig    : f32,
    hasRadiusSig     : f32,
    hasSourceRadSig  : f32,

    hasFeatherSig    : f32,
    hasOpacitySig    : f32,
    pad0             : f32,
    pad1             : f32,
};
`;

const WGSL_PATCHHEAL_FS = `
${WGSL_PATCHHEAL_UNIFORMS}

@group(0) @binding(0) var<uniform> u : PatchHealUniforms;

@group(1) @binding(0) var srcTex : texture_2d<f32>;
@group(1) @binding(1) var maskTex : texture_2d<f32>;
@group(1) @binding(2) var samp : sampler;

@group(2) @binding(0) var offsetXSigTex : texture_2d<f32>;
@group(2) @binding(1) var offsetYSigTex : texture_2d<f32>;
@group(2) @binding(2) var centerXSigTex : texture_2d<f32>;
@group(2) @binding(3) var centerYSigTex : texture_2d<f32>;
@group(2) @binding(4) var radiusSigTex : texture_2d<f32>;
@group(2) @binding(5) var sourceRadSigTex : texture_2d<f32>;
@group(2) @binding(6) var featherSigTex : texture_2d<f32>;
@group(2) @binding(7) var opacitySigTex : texture_2d<f32>;
@group(2) @binding(8) var signalSamp : sampler;

fn getLuminance(c : vec3<f32>) -> f32 {
    return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn sampleBoxBlur(tex : texture_2d<f32>, smp : sampler, centerUv : vec2<f32>, blurPx : f32, dims : vec2<f32>) -> vec4<f32> {
    let texel = 1.0 / dims;
    let stepSize = max(1.0, blurPx / 3.0);
    var accum = vec4<f32>(0.0);
    var count = 0.0;

    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            let offset = vec2<f32>(f32(x) * stepSize, f32(y) * stepSize) * texel;
            let sampleUv = clamp(centerUv + offset, vec2<f32>(0.0), vec2<f32>(1.0));
            accum += textureSampleLevel(tex, smp, sampleUv, 0.0);
            count += 1.0;
        }
    }
    return accum / count;
}

@fragment
fn fs_main(in : VertexOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(srcTex));

    var offsetX = u.offsetX;
    if (u.hasOffsetXSig > 0.5) {
        offsetX = textureSampleLevel(offsetXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var offsetY = u.offsetY;
    if (u.hasOffsetYSig > 0.5) {
        offsetY = textureSampleLevel(offsetYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var centerX = u.centerX;
    if (u.hasCenterXSig > 0.5) {
        centerX = textureSampleLevel(centerXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var centerY = u.centerY;
    if (u.hasCenterYSig > 0.5) {
        centerY = textureSampleLevel(centerYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var radius = u.radius;
    if (u.hasRadiusSig > 0.5) {
        radius = textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var sourceRadius = u.sourceRadius;
    if (u.hasSourceRadSig > 0.5) {
        sourceRadius = textureSampleLevel(sourceRadSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var feather = u.feather;
    if (u.hasFeatherSig > 0.5) {
        feather = textureSampleLevel(featherSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    var opacity = u.opacity;
    if (u.hasOpacitySig > 0.5) {
        opacity = textureSampleLevel(opacitySigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    let dstCol = textureSampleLevel(srcTex, samp, in.uv, 0.0);

    // Calculate mask weight (either from explicit mask or procedural circular patch)
    var maskWeight = 0.0;
    let targetCenterUV = vec2<f32>(centerX, centerY);

    if (u.hasMask > 0.5) {
        let maskCol = textureSampleLevel(maskTex, samp, in.uv, 0.0);
        maskWeight = max(maskCol.a, max(maskCol.r, max(maskCol.g, maskCol.b)));
    } else {
        let distPx = length((in.uv - targetCenterUV) * dimensions);
        let innerRadius = radius * max(0.0, 1.0 - feather / 100.0);
        maskWeight = 1.0 - smoothstep(innerRadius, max(innerRadius + 0.001, radius), distPx);
    }

    let blendWeight = clamp(maskWeight * opacity, 0.0, 1.0);
    if (blendWeight < 1e-4) {
        return dstCol;
    }

    // Compute source sample coordinate (scaling from sourceRadius to target radius if different)
    let sourceCenterUV = targetCenterUV + vec2<f32>(offsetX, offsetY) / dimensions;
    let srcScale = max(1.0, sourceRadius) / max(1.0, radius);
    let uvFromTargetCenter = in.uv - targetCenterUV;
    let srcUV = clamp(sourceCenterUV + uvFromTargetCenter * srcScale, vec2<f32>(0.0), vec2<f32>(1.0));
    let srcCol = textureSampleLevel(srcTex, samp, srcUV, 0.0);

    var healedCol = srcCol;

    if (u.mode > 0.5 && u.mode < 1.5) {
        // Mode 1: Seamless Heal (Poisson gradient / local illumination matching)
        let blurRadius = max(4.0, radius * 0.4);
        let srcBlur = sampleBoxBlur(srcTex, samp, srcUV, blurRadius, dimensions);
        let dstBlur = sampleBoxBlur(srcTex, samp, in.uv, blurRadius, dimensions);

        let srcDetail = srcCol.rgb - srcBlur.rgb;
        let healedRgb = dstBlur.rgb + srcDetail;
        let clampedRgb = clamp(healedRgb, vec3<f32>(0.0), vec3<f32>(srcCol.a));
        healedCol = vec4<f32>(clampedRgb, srcCol.a);
    } else if (u.mode >= 1.5) {
        // Mode 2: Texture Transfer (Luminance structure matching)
        let blurRadius = max(4.0, radius * 0.4);
        let srcBlur = sampleBoxBlur(srcTex, samp, srcUV, blurRadius, dimensions);

        let lumaSrc = getLuminance(srcCol.rgb);
        let lumaSrcBlur = getLuminance(srcBlur.rgb);
        let lumaDelta = lumaSrc - lumaSrcBlur;

        let healedRgb = dstCol.rgb + vec3<f32>(lumaDelta);
        let clampedRgb = clamp(healedRgb, vec3<f32>(0.0), vec3<f32>(dstCol.a));
        healedCol = vec4<f32>(clampedRgb, dstCol.a);
    }

    return mix(dstCol, healedCol, blendWeight);
}
`;

interface DevicePatchHealResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DevicePatchHealResources>();

function getDeviceResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): DevicePatchHealResources {
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
				sampler: { type: "filtering" },
			},
		],
	});

	const shaderModule = device.createShaderModule({
		code: `${WGSL_FULLSCREEN_VS}\n${WGSL_PATCHHEAL_FS}`,
	});

	const pipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [uniformLayout, textureLayout, signalTextureLayout],
	});

	const pipeline = device.createRenderPipeline({
		layout: pipelineLayout,
		vertex: { module: shaderModule, entryPoint: "vs_main" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs_main",
			targets: [
				{
					format,
					blend: {
						color: {
							srcFactor: "one",
							dstFactor: "zero",
							operation: "add",
						},
						alpha: {
							srcFactor: "one",
							dstFactor: "zero",
							operation: "add",
						},
					},
				},
			],
		},
		primitive: { topology: "triangle-strip" },
	});

	res = {
		uniformLayout,
		textureLayout,
		signalTextureLayout,
		pipeline,
	};
	deviceResourceCache.set(device, res);
	return res;
}

type PatchHealSignalData = SignalData & { nodeId?: string };

interface PatchHealOp extends PatchHealNodeConfig {
	op: "PatchHeal";
	maskMedia?: VirtualMediaData;
	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: { type: string; data: unknown } | null;
		}
	>;
}

export const PatchHealWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
		| PatchHealOp
		| undefined;
	if (op?.op !== "PatchHeal" || !op) return;

	const childMedia = props.virtualMedia?.children?.[0];
	if (!childMedia) return;

	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const frame = props.frame ?? 0;
	const fps = props.fps || 30;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "patch_heal_node";

	const signalRegistry = globalSignalRegistry;

	// 1. Draw source child media into tmpSrcTex
	const tmpSrcTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpSrcView = tmpSrcTex.createView();

	const srcClearPass = ctx.renderer.beginFrame(
		encoder,
		tmpSrcView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	srcClearPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
			renderId: `${props.renderId}-src`,
			excludeTextures: [...(props.excludeTextures || []), tmpSrcTex],
		},
		tmpSrcView,
		tmpSrcTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Draw optional mask child media into maskTex if present
	let maskTex: GPUTexture | null = null;
	if (op.maskMedia) {
		maskTex = ctx.renderer.getTemporaryTexture(width, height, [
			...(props.excludeTextures || []),
			targetTexture,
			tmpSrcTex,
		]);
		const maskView = maskTex.createView();

		const maskClearPass = ctx.renderer.beginFrame(
			encoder,
			maskView,
			{ r: 0, g: 0, b: 0, a: 0 },
			width,
			height,
			"clear",
		);
		maskClearPass.end();

		ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
		ctx.renderer.pushIdentity();
		await drawChild(
			op.maskMedia,
			{
				...props,
				virtualMedia: op.maskMedia,
				renderId: `${props.renderId}-mask`,
				excludeTextures: [...(props.excludeTextures || []), tmpSrcTex, maskTex],
			},
			maskView,
			maskTex,
			width,
			height,
		);
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
	}

	// 3. Compile pipeline resources
	const {
		pipeline,
		uniformLayout: uLayout,
		textureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getDeviceResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const patches = normalizePatches(op);

	const resolveBindable = (
		configKey:
			| "centerX"
			| "centerY"
			| "offsetX"
			| "offsetY"
			| "radius"
			| "sourceRadius"
			| "feather"
			| "opacity",
		fallbackVal: number,
		minVal: number,
		maxVal: number,
	): {
		val: number;
		hasStaticSig: boolean;
		sd: PatchHealSignalData | null;
	} => {
		const handleIdKey = `${configKey}HandleId` as keyof PatchHealOp;
		const handleId = op[handleIdKey] as string | null | undefined;
		const input = handleId ? op.inputs?.[handleId] : null;

		const hasSignal = !!(
			input?.connectionValid &&
			(input.outputItem?.type === "Signal" ||
				input.outputItem?.type === "Numeric")
		);

		const sd =
			hasSignal && input?.outputItem?.data
				? (input.outputItem.data as PatchHealSignalData)
				: null;

		let val = fallbackVal;
		let hasStaticSig = false;

		if (!hasSignal) {
			if (input?.connectionValid && input.outputItem?.type === "Number") {
				const numVal =
					typeof input.outputItem.data === "number"
						? input.outputItem.data
						: ((input.outputItem.data as { value?: number })?.value ??
							fallbackVal);
				val = Math.max(minVal, Math.min(maxVal, Number(numVal)));
			} else {
				val = Math.max(minVal, Math.min(maxVal, fallbackVal));
			}
		} else if (sd) {
			val = Math.max(minVal, Math.min(maxVal, Number(sd.offset ?? 0.0)));
			hasStaticSig = true;
		}

		return { val, hasStaticSig, sd };
	};

	const dummyMaskView = maskTex ? maskTex.createView() : tmpSrcView;

	// Execute patches sequentially (ping-pong between intermediate textures if > 1 patch)
	let currentInputTex = tmpSrcTex;

	const pingTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpSrcTex,
		...(maskTex ? [maskTex] : []),
		targetTexture,
		...(props.excludeTextures || []),
	]);
	const pongTex =
		patches.length > 1
			? ctx.renderer.getTemporaryTexture(width, height, [
					tmpSrcTex,
					pingTex,
					...(maskTex ? [maskTex] : []),
					targetTexture,
					...(props.excludeTextures || []),
				])
			: pingTex;

	for (let i = 0; i < patches.length; i++) {
		const patch = patches[i];
		const isFirstPatch = i === 0;

		const centerXRes = isFirstPatch
			? resolveBindable("centerX", patch.centerX, 0.0, 1.0)
			: { val: patch.centerX, hasStaticSig: false, sd: null };
		const centerYRes = isFirstPatch
			? resolveBindable("centerY", patch.centerY, 0.0, 1.0)
			: { val: patch.centerY, hasStaticSig: false, sd: null };
		const offsetXRes = isFirstPatch
			? resolveBindable("offsetX", patch.offsetX, -MAX_OFFSET, MAX_OFFSET)
			: { val: patch.offsetX, hasStaticSig: false, sd: null };
		const offsetYRes = isFirstPatch
			? resolveBindable("offsetY", patch.offsetY, -MAX_OFFSET, MAX_OFFSET)
			: { val: patch.offsetY, hasStaticSig: false, sd: null };
		const radiusRes = isFirstPatch
			? resolveBindable("radius", patch.radius, 1, MAX_RADIUS)
			: { val: patch.radius, hasStaticSig: false, sd: null };
		const sourceRadiusRes = isFirstPatch
			? resolveBindable(
					"sourceRadius",
					patch.sourceRadius ?? patch.radius,
					1,
					MAX_RADIUS,
				)
			: {
					val: patch.sourceRadius ?? patch.radius,
					hasStaticSig: false,
					sd: null,
				};
		const featherRes = isFirstPatch
			? resolveBindable("feather", patch.feather, 0, MAX_FEATHER)
			: { val: patch.feather, hasStaticSig: false, sd: null };
		const opacityRes = isFirstPatch
			? resolveBindable("opacity", patch.opacity, 0.0, 1.0)
			: { val: patch.opacity, hasStaticSig: false, sd: null };

		const getSignalView = (
			res: {
				val: number;
				hasStaticSig: boolean;
				sd: PatchHealSignalData | null;
			},
			suffix: string,
		) => {
			if (res.hasStaticSig && res.sd && signalRegistry) {
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
			return signalRegistry
				? signalRegistry.getDummy1x1TextureView(ctx.device)
				: tmpSrcView;
		};

		const offsetXView = getSignalView(offsetXRes, "offsetX_sig");
		const offsetYView = getSignalView(offsetYRes, "offsetY_sig");
		const centerXView = getSignalView(centerXRes, "centerX_sig");
		const centerYView = getSignalView(centerYRes, "centerY_sig");
		const radiusView = getSignalView(radiusRes, "radius_sig");
		const sourceRadiusView = getSignalView(sourceRadiusRes, "sourceRadius_sig");
		const featherView = getSignalView(featherRes, "feather_sig");
		const opacityView = getSignalView(opacityRes, "opacity_sig");

		const modeNum =
			patch.mode === "Clone"
				? 0.0
				: patch.mode === "TextureTransfer"
					? 2.0
					: 1.0;

		const patchData = new Float32Array(20);
		patchData[0] = offsetXRes.val;
		patchData[1] = offsetYRes.val;
		patchData[2] = centerXRes.val;
		patchData[3] = centerYRes.val;

		patchData[4] = radiusRes.val;
		patchData[5] = sourceRadiusRes.val;
		patchData[6] = featherRes.val;
		patchData[7] = opacityRes.val;

		patchData[8] = modeNum;
		patchData[9] = maskTex ? 1.0 : 0.0;
		patchData[10] = offsetXRes.hasStaticSig ? 1.0 : 0.0;
		patchData[11] = offsetYRes.hasStaticSig ? 1.0 : 0.0;

		patchData[12] = centerXRes.hasStaticSig ? 1.0 : 0.0;
		patchData[13] = centerYRes.hasStaticSig ? 1.0 : 0.0;
		patchData[14] = radiusRes.hasStaticSig ? 1.0 : 0.0;
		patchData[15] = sourceRadiusRes.hasStaticSig ? 1.0 : 0.0;

		patchData[16] = featherRes.hasStaticSig ? 1.0 : 0.0;
		patchData[17] = opacityRes.hasStaticSig ? 1.0 : 0.0;
		patchData[18] = 0.0;
		patchData[19] = 0.0;

		const uBuffer = ctx.renderer.getTemporaryBuffer(patchData);

		const destinationTex = i % 2 === 0 ? pingTex : pongTex;

		const texBindGroup = ctx.device.createBindGroup({
			layout: tLayout,
			entries: [
				{ binding: 0, resource: currentInputTex.createView() },
				{ binding: 1, resource: dummyMaskView },
				{ binding: 2, resource: sampler },
			],
		});

		const sigBindGroup = ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: offsetXView },
				{ binding: 1, resource: offsetYView },
				{ binding: 2, resource: centerXView },
				{ binding: 3, resource: centerYView },
				{ binding: 4, resource: radiusView },
				{ binding: 5, resource: sourceRadiusView },
				{ binding: 6, resource: featherView },
				{ binding: 7, resource: opacityView },
				{ binding: 8, resource: sampler },
			],
		});

		const healPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: destinationTex.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		healPass.setPipeline(pipeline);
		healPass.setBindGroup(
			0,
			ctx.device.createBindGroup({
				layout: uLayout,
				entries: [{ binding: 0, resource: { buffer: uBuffer } }],
			}),
		);
		healPass.setBindGroup(1, texBindGroup);
		healPass.setBindGroup(2, sigBindGroup);
		healPass.draw(4);
		healPass.end();

		currentInputTex = destinationTex;
	}

	// Final blit to targetView
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"load",
	);

	ctx.renderer.drawTexture(
		finalPass,
		currentInputTex,
		{ x: 0, y: 0, width, height },
		{ opacity: 1.0 },
	);

	args.pass = finalPass;
};
