/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { lutStore, signalRegistry } from "@framefields/webgpu-renderers";

export const LUT_3D_SHADER = `
struct LutUniforms {
	intensity      : f32,
	lutSize        : f32,
	hasSignal      : f32,
	pad            : f32,
};

@group(0) @binding(0) var<uniform> u : LutUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;
@group(2) @binding(0) var lutTex     : texture_3d<f32>;
@group(2) @binding(1) var lutSamp    : sampler;
@group(3) @binding(0) var signalTex  : texture_2d<f32>;
@group(3) @binding(1) var signalSamp : sampler;

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
	let inputColor = textureSampleLevel(tex, samp, in.uv, 0.0);
	
	// Coordinate adjustment to sample from texel centers
	let uvw = inputColor.rgb * ((u.lutSize - 1.0) / u.lutSize) + vec3<f32>(0.5 / u.lutSize);
	let mappedColor = textureSampleLevel(lutTex, lutSamp, uvw, 0.0);
	
	var activeIntensity = u.intensity;
	if (u.hasSignal > 0.5) {
		activeIntensity = textureSampleLevel(signalTex, signalSamp, in.uv, 0.0).r;
	}
	
	let finalRgb = inputColor.rgb + activeIntensity  * (mappedColor.rgb - inputColor.rgb);
	return vec4<f32>(finalRgb * inputColor.a, inputColor.a);
}
`;

export const LUT_1D_SHADER = `
struct LutUniforms {
	intensity      : f32,
	lutSize        : f32,
	hasSignal      : f32,
	pad            : f32,
};

@group(0) @binding(0) var<uniform> u : LutUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;
@group(2) @binding(0) var lutTex     : texture_1d<f32>;
@group(2) @binding(1) var lutSamp    : sampler;
@group(3) @binding(0) var signalTex  : texture_2d<f32>;
@group(3) @binding(1) var signalSamp : sampler;

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
	let inputColor = textureSampleLevel(tex, samp, in.uv, 0.0);
	
	let rCoord = inputColor.r * ((u.lutSize - 1.0) / u.lutSize) + (0.5 / u.lutSize);
	let gCoord = inputColor.g * ((u.lutSize - 1.0) / u.lutSize) + (0.5 / u.lutSize);
	let bCoord = inputColor.b * ((u.lutSize - 1.0) / u.lutSize) + (0.5 / u.lutSize);
	
	let mappedR = textureSampleLevel(lutTex, lutSamp, rCoord, 0.0).r;
	let mappedG = textureSampleLevel(lutTex, lutSamp, gCoord, 0.0).g;
	let mappedB = textureSampleLevel(lutTex, lutSamp, bCoord, 0.0).b;
	
	var activeIntensity = u.intensity;
	if (u.hasSignal > 0.5) {
		activeIntensity = textureSampleLevel(signalTex, signalSamp, in.uv, 0.0).r;
	}
	
	let finalRgb = inputColor.rgb + activeIntensity  * (vec3<f32>(mappedR, mappedG, mappedB) - inputColor.rgb);
	return vec4<f32>(finalRgb * inputColor.a, inputColor.a);
}
`;

interface DeviceLutLayouts {
	lutUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	lutTextureLayout3D: GPUBindGroupLayout;
	lutTextureLayout1D: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceLutLayouts>();
const lutUniformData = new Float32Array(4);

function getDeviceLayouts(device: GPUDevice): DeviceLutLayouts {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const lutUniformLayout = device.createBindGroupLayout({
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
	const lutTextureLayout3D = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { viewDimension: "3d", sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});
	const lutTextureLayout1D = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { viewDimension: "1d", sampleType: "float" },
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
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		lutUniformLayout,
		singleTextureLayout,
		lutTextureLayout3D,
		lutTextureLayout1D,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getLutResources(
	device: GPUDevice,
	format: GPUTextureFormat,
	type: "1D" | "3D",
) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `lut_${type}_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const shaderCode = type === "3D" ? LUT_3D_SHADER : LUT_1D_SHADER;
		const lutModule = device.createShaderModule({
			label: `lut_${type.toLowerCase()}_${format}.wgsl`,
			code: shaderCode,
		});
		const currentLutLayout =
			type === "3D" ? layouts.lutTextureLayout3D : layouts.lutTextureLayout1D;
		pipeline = device.createRenderPipeline({
			label: `LutPipeline_${type}_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.lutUniformLayout,
					layouts.singleTextureLayout,
					currentLutLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: lutModule, entryPoint: "vs" },
			fragment: {
				module: lutModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		lutPipeline: pipeline,
		lutUniformLayout: layouts.lutUniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		lutTextureLayout:
			type === "3D" ? layouts.lutTextureLayout3D : layouts.lutTextureLayout1D,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const LutWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	const op = props.virtualMedia?.operation as any;
	if (op?.op !== "ApplyLUT" || !op) return;
	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	const lutUrl = op.lutUrl;
	if (!lutUrl) return;

	// End the active pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	// Resolve the intensity signal
	const intensityInput = op.intensityHandleId
		? op.inputs?.[op.intensityHandleId]
		: null;
	const hasSignal = !!(
		intensityInput?.connectionValid &&
		intensityInput.outputItem?.type === "Signal"
	);
	const sd = hasSignal ? intensityInput?.outputItem?.data : null;

	let intensity = 1.0;
	let hasStaticSignal = false;

	if (!hasSignal) {
		if (
			intensityInput?.connectionValid &&
			intensityInput.outputItem?.type === "Number"
		) {
			intensity = Number(intensityInput.outputItem.data ?? 1.0);
		} else {
			intensity = Number(op.intensity ?? 1.0);
		}
	} else if (sd && typeof sd === "object") {
		intensity = Number((sd as any).offset ?? 1.0);
		hasStaticSignal = true;
	}
	intensity = Math.max(0, Math.min(10, intensity));

	// Load the GPU LUT resource without blocking the rendering pipeline.
	let lut = lutStore.get(lutUrl, ctx.device);
	if (!lut) {
		const isHeadless =
			props.isHeadless ??
			(typeof window === "undefined" ||
				(globalThis as any).__IS_HEADLESS_RENDERER__);

		if (isHeadless || props.forceWait) {
			try {
				lut = await lutStore.getOrLoad(lutUrl, ctx.device);
			} catch (err) {
				if (
					!(err instanceof DOMException && err.name === "AbortError") &&
					!(
						err &&
						typeof err === "object" &&
						"name" in err &&
						err.name === "AbortError"
					)
				) {
					console.error("[ApplyLUT] Failed to load LUT synchronously:", err);
				}
			}
		} else {
			// Trigger background load
			lutStore.getOrLoad(lutUrl, ctx.device).catch((err) => {
				if (
					(err instanceof DOMException && err.name === "AbortError") ||
					(err &&
						typeof err === "object" &&
						"name" in err &&
						err.name === "AbortError")
				) {
					return;
				}
				console.error("[ApplyLUT] Failed to load LUT in background:", err);
			});
		}

		// Fallback to any matching cached LUT for the same node
		if (!lut && lutUrl.startsWith("runtime://lut/")) {
			const prefix = lutUrl.substring(0, lutUrl.lastIndexOf("-") + 1);
			if (prefix) {
				lut = lutStore.getAnyMatching(prefix, ctx.device);
			}
		}
	}

	const tmpTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	// Clear temporary texture
	const childPass = ctx.renderer.beginFrame(
		encoder,
		tmpView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	childPass.end();

	// Draw child frame into tmpTex
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

	// If no LUT is ready (and no fallback is available), draw the child frame directly as a passthrough
	if (!lut) {
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
			tmpTex,
			{ x: 0, y: 0, width: targetWidth, height: targetHeight },
			{ opacity: op.opacity ?? 1 },
		);
		args.pass = finalPass;
		return;
	}

	// Fetch pipeline and layouts
	const {
		lutPipeline: pipeline,
		lutUniformLayout: uLayout,
		singleTextureLayout: tLayout,
		lutTextureLayout: lLayout,
		signalTextureLayout: sigLayout,
	} = getLutResources(ctx.device, ctx.renderer.format, lut.type);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Setup intermediate output texture
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// Fetch dynamic intensity signal texture view
	let signalView: GPUTextureView;
	if (hasStaticSignal) {
		const elapsedSeconds =
			props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
		const durationSeconds = props.virtualMedia?.metadata?.durationMs
			? props.virtualMedia.metadata.durationMs / 1000
			: props.durationMs !== undefined
				? props.durationMs / 1000
				: 0;
		signalView = signalRegistry.getOrCreate2DTextureView(
			ctx.device,
			encoder,
			sd.nodeId ?? "lut_intensity_sig",
			elapsedSeconds,
			durationSeconds,
			sd,
			width,
			height,
			props.renderId,
			frame,
			fps,
		);
	} else {
		signalView = signalRegistry.getDummy1x1TextureView(ctx.device);
	}

	// Prepare uniforms
	lutUniformData[0] = intensity;
	lutUniformData[1] = lut.size;
	lutUniformData[2] = hasStaticSignal ? 1 : 0;
	lutUniformData[3] = 0; // padding

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(lutUniformData);

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

	renderPass.setPipeline(pipeline!);
	renderPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout!,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	renderPass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout!,
			tmpTex,
			sampler,
		),
	);
	renderPass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: lLayout!,
			entries: [
				{ binding: 0, resource: lut.texture.createView() },
				{ binding: 1, resource: sampler },
			],
		}),
	);
	renderPass.setBindGroup(
		3,
		ctx.device.createBindGroup({
			layout: sigLayout!,
			entries: [
				{ binding: 0, resource: signalView },
				{ binding: 1, resource: sampler },
			],
		}),
	);
	renderPass.draw(4);
	renderPass.end();

	// Blending/opacity draw to the targetView
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
