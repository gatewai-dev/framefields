/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";

interface VignetteOp {
	op: "Vignette";
	strength?: number;
	radius?: number;
	softness?: number;
	roundness?: number;
	centerX?: number;
	centerY?: number;
	opacity?: number;
	strengthHandleId?: string | null;
	radiusHandleId?: string | null;
	softnessHandleId?: string | null;
	roundnessHandleId?: string | null;
	centerXHandleId?: string | null;
	centerYHandleId?: string | null;
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

type VignetteSignalData = SignalData & { nodeId?: string };

const VIGNETTE_SHADER = `
struct VignetteUniforms {
    strength       : f32,
    radius         : f32,
    softness       : f32,
    roundness      : f32,

    centerX        : f32,
    centerY        : f32,
    hasStrengthSig : f32,
    hasRadiusSig   : f32,

    hasSoftnessSig : f32,
    hasRoundnessSig: f32,
    hasCenterXSig  : f32,
    hasCenterYSig  : f32,
};

@group(0) @binding(0) var<uniform> u : VignetteUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

@group(2) @binding(0) var strengthSigTex  : texture_2d<f32>;
@group(2) @binding(1) var radiusSigTex    : texture_2d<f32>;
@group(2) @binding(2) var softnessSigTex  : texture_2d<f32>;
@group(2) @binding(3) var roundnessSigTex : texture_2d<f32>;
@group(2) @binding(4) var centerXSigTex   : texture_2d<f32>;
@group(2) @binding(5) var centerYSigTex   : texture_2d<f32>;
@group(2) @binding(6) var signalSamp      : sampler;

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
    let color = textureSampleLevel(tex, samp, in.uv, 0.0);

    if (color.a < 1e-5) {
        return color;
    }

    // Resolve parameter overrides or dynamic signals
    var strength = u.strength;
    if (u.hasStrengthSig > 0.5) {
        strength = textureSampleLevel(strengthSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var radius = u.radius;
    if (u.hasRadiusSig > 0.5) {
        radius = textureSampleLevel(radiusSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var softness = u.softness;
    if (u.hasSoftnessSig > 0.5) {
        softness = textureSampleLevel(softnessSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var roundness = u.roundness;
    if (u.hasRoundnessSig > 0.5) {
        roundness = textureSampleLevel(roundnessSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var centerX = u.centerX;
    if (u.hasCenterXSig > 0.5) {
        centerX = textureSampleLevel(centerXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var centerY = u.centerY;
    if (u.hasCenterYSig > 0.5) {
        centerY = textureSampleLevel(centerYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    let center = vec2<f32>(centerX, centerY);
    let dimensions = vec2<f32>(textureDimensions(tex));
    let aspect = dimensions.x / dimensions.y;
    let uvOffset = in.uv - center;

    // Calculate aspect ratio corrected coordinate for circle
    let correctedOffset = vec2<f32>(
        uvOffset.x * mix(1.0, aspect, roundness),
        uvOffset.y
    );
    let dist = length(correctedOffset);

    // Calculate vignette edge falloff
    let edge0 = radius;
    let edge1 = max(0.0, radius - softness);
    let vignetteFactor = smoothstep(edge0, edge1, dist);

    // Blend based on strength
    let intensity = strength / 100.0;
    let finalVignette = mix(1.0, vignetteFactor, intensity);

    // Unpremultiply, apply vignette, and repremultiply
    let unpremult_rgb = color.rgb / color.a;
    let final_rgb = unpremult_rgb * finalVignette;

    return vec4<f32>(clamp(final_rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * color.a, color.a);
}
`;

interface DeviceVignetteResources {
	uniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceVignetteResources>();
const vignetteUniformData = new Float32Array(12);

function getDeviceLayouts(device: GPUDevice): DeviceVignetteResources {
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

function getVignetteResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `vignette_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const vignetteModule = device.createShaderModule({
			label: `vignette_${format}.wgsl`,
			code: VIGNETTE_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `VignettePipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.uniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: vignetteModule, entryPoint: "vs" },
			fragment: {
				module: vignetteModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		vignettePipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const VignetteWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	const compositionFrame = props.compositionFrame ?? frame;
	const fps = props.fps || 30;
	const op = props.virtualMedia?.operation as VignetteOp | undefined;
	if (op?.op !== "Vignette" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "vignette_node";

	// 1. Resolve Bindable Parameters
	const resolveBindable = (
		configKey:
			| "strength"
			| "radius"
			| "softness"
			| "roundness"
			| "centerX"
			| "centerY",
		defaultValue: number,
		minVal: number,
		maxVal: number,
	) => {
		const handleIdKey = `${configKey}HandleId` as keyof VignetteOp;
		const handleId = op[handleIdKey] as string | null | undefined;
		const input = handleId ? op.inputs?.[handleId] : null;

		const hasSignal = !!(
			input?.connectionValid &&
			(input.outputItem?.type === "Signal" ||
				input.outputItem?.type === "Numeric")
		);

		const sd =
			hasSignal && input?.outputItem?.data
				? (input.outputItem.data as VignetteSignalData)
				: null;

		let val = defaultValue;
		let hasStaticSig = false;

		let gpuTextureView: GPUTextureView | undefined;

		if (!hasSignal) {
			if (input?.connectionValid && input.outputItem?.type === "Number") {
				val = Math.max(
					minVal,
					Math.min(maxVal, Number(input.outputItem.data ?? defaultValue)),
				);
			} else {
				let rawVal = op[configKey] as unknown;
				if (rawVal !== undefined && rawVal !== null) {
					if (typeof rawVal === "object") {
						if (
							"get" in (rawVal as Record<string, unknown>) &&
							typeof (rawVal as Record<string, unknown>).get === "function"
						) {
							rawVal = (
								rawVal as {
									get: (ctx: { frame: number; fps: number }) => unknown;
								}
							).get({ frame: compositionFrame, fps });
						} else if ("value" in (rawVal as Record<string, unknown>)) {
							const sig = rawVal as {
								value: unknown;
								gpuBinding?: { textureView?: GPUTextureView };
							};
							if (sig.gpuBinding?.textureView) {
								gpuTextureView = sig.gpuBinding.textureView;
								hasStaticSig = true;
							}
							rawVal = sig.value;
						}
					} else if (typeof rawVal === "function") {
						rawVal = (rawVal as (f: number, fps: number) => unknown)(
							compositionFrame,
							fps,
						);
					}
				}
				const numVal = Number(rawVal ?? defaultValue);
				val = Math.max(
					minVal,
					Math.min(maxVal, isNaN(numVal) ? defaultValue : numVal),
				);
			}
		} else if (sd) {
			val = Math.max(minVal, Math.min(maxVal, Number(sd.offset ?? 0.0)));
			hasStaticSig = true;
		}

		return { val, hasStaticSig, sd, gpuTextureView };
	};

	const strengthRes = resolveBindable("strength", 50, 0, 100);
	const radiusRes = resolveBindable("radius", 1.0, 0.1, 2.0);
	const softnessRes = resolveBindable("softness", 0.5, 0.0, 1.0);
	const roundnessRes = resolveBindable("roundness", 0.5, 0.0, 1.0);
	const centerXRes = resolveBindable("centerX", 0.5, 0.0, 1.0);
	const centerYRes = resolveBindable("centerY", 0.5, 0.0, 1.0);

	// 2. Draw child media
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

	// End any active pass from drawing child
	args.pass.end();

	// 3. Fetch layout and resources
	const {
		vignettePipeline: pipeline,
		uniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getVignetteResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Fetch dynamic signal texture views on-demand
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
			sd: VignetteSignalData | null;
			gpuTextureView?: GPUTextureView;
		},
		suffix: string,
	) => {
		if (res.gpuTextureView) {
			return res.gpuTextureView;
		}
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

	const strengthView = getSignalView(strengthRes, "strength_sig");
	const radiusView = getSignalView(radiusRes, "radius_sig");
	const softnessView = getSignalView(softnessRes, "softness_sig");
	const roundnessView = getSignalView(roundnessRes, "roundness_sig");
	const centerXView = getSignalView(centerXRes, "centerX_sig");
	const centerYView = getSignalView(centerYRes, "centerY_sig");

	// 4. Fill uniform array
	vignetteUniformData[0] = strengthRes.val;
	vignetteUniformData[1] = radiusRes.val;
	vignetteUniformData[2] = softnessRes.val;
	vignetteUniformData[3] = roundnessRes.val;
	vignetteUniformData[4] = centerXRes.val;
	vignetteUniformData[5] = centerYRes.val;
	vignetteUniformData[6] = strengthRes.hasStaticSig ? 1.0 : 0.0;
	vignetteUniformData[7] = radiusRes.hasStaticSig ? 1.0 : 0.0;
	vignetteUniformData[8] = softnessRes.hasStaticSig ? 1.0 : 0.0;
	vignetteUniformData[9] = roundnessRes.hasStaticSig ? 1.0 : 0.0;
	vignetteUniformData[10] = centerXRes.hasStaticSig ? 1.0 : 0.0;
	vignetteUniformData[11] = centerYRes.hasStaticSig ? 1.0 : 0.0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(vignetteUniformData);

	// 5. Output Texture
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// 6. Run vignette pass
	const vignettePass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	vignettePass.setPipeline(pipeline);
	vignettePass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	vignettePass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout,
			tmpTex,
			sampler,
		),
	);
	vignettePass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: strengthView },
				{ binding: 1, resource: radiusView },
				{ binding: 2, resource: softnessView },
				{ binding: 3, resource: roundnessView },
				{ binding: 4, resource: centerXView },
				{ binding: 5, resource: centerYView },
				{ binding: 6, resource: sampler },
			],
		}),
	);
	vignettePass.draw(4);
	vignettePass.end();

	// 7. Output result back to targetView
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
		{ opacity: op.opacity ?? 1.0 },
	);

	args.pass = finalPass;
};
