/// <reference types="webgpu" />
import type { VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { probeVideoSize } from "@framefields/webgpu-renderers";
import { rotatedSourceSize } from "../shared/config.js";

/** A plain number, a per-frame function, or a signal (`{ value }`). */
type NumericProp =
	| number
	| ((frame: number, fps: number) => number)
	| { value: unknown };

interface RotateOp {
	op: "Rotate";
	angle?: NumericProp;
	fit?: "cover" | "contain" | "fill";
	scale?: NumericProp;
	opacity?: number;
}

// Inverse-maps each output pixel into the source: p (px from the output
// center) turned back by the angle, divided by the source's on-screen size.
// Edges are antialiased over one output pixel so animated angles stay clean.
const WGSL_ROTATE_SHADER = `
struct RotateUniforms {
	outSize: vec2<f32>,
	size   : vec2<f32>,
	cs     : vec2<f32>,
	_pad   : vec2<f32>,
};

@group(0) @binding(0) var<uniform> u : RotateUniforms;
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
	let p = (in.uv - vec2<f32>(0.5)) * u.outSize;
	// Clockwise on screen (y down): undo it with the transpose.
	let q = vec2<f32>(u.cs.x * p.x + u.cs.y * p.y, -u.cs.y * p.x + u.cs.x * p.y);
	let uv = q / u.size + vec2<f32>(0.5);
	// Distance (output px) inside the source rectangle's nearest edge.
	let edge = (vec2<f32>(0.5) - abs(uv - vec2<f32>(0.5))) * u.size;
	let coverage = clamp(min(edge.x, edge.y) + 0.5, 0.0, 1.0);
	let color = textureSampleLevel(tex, samp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
	// Premultiplied: coverage scales every channel.
	return color * coverage;
}
`;

interface DeviceRotateResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceRotateResources>();
const uniformData = new Float32Array(8);

function getRotateResources(
	device: GPUDevice,
	targetFormat: GPUTextureFormat,
): DeviceRotateResources {
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
				sampler: { type: "filtering" },
			},
		],
	});

	const shaderModule = device.createShaderModule({ code: WGSL_ROTATE_SHADER });

	const pipeline = device.createRenderPipeline({
		layout: device.createPipelineLayout({
			bindGroupLayouts: [uniformLayout, textureLayout],
		}),
		vertex: { module: shaderModule, entryPoint: "vs" },
		fragment: {
			module: shaderModule,
			entryPoint: "fs",
			// The pass clears and writes every pixel: no blending needed.
			targets: [{ format: targetFormat }],
		},
		primitive: { topology: "triangle-strip" },
	});

	const res: DeviceRotateResources = { uniformLayout, textureLayout, pipeline };
	deviceResourceCache.set(device, res);
	return res;
}

function resolveNumber(
	raw: NumericProp | undefined,
	fallback: number,
	frame: number,
	fps: number,
): number {
	const value =
		typeof raw === "function"
			? raw(frame, fps)
			: raw !== null && typeof raw === "object"
				? "get" in raw && typeof (raw as { get: unknown }).get === "function"
					? (
							raw as { get: (ctx: { frame: number; fps: number }) => unknown }
						).get({ frame, fps })
					: "value" in raw
						? raw.value
						: raw
				: raw;
	const n = Number(value ?? fallback);
	return Number.isFinite(n) ? n : fallback;
}

/**
 * The child's own size: the nearest stated metadata down the chain, else the
 * source file's display size. A layer built from a bare path states none, and
 * guessing the layer box would turn a 16:9 clip into a squeezed 9:16 one.
 */
async function intrinsicSize(
	media: VirtualMediaData,
): Promise<{ width: number; height: number } | null> {
	for (let node: VirtualMediaData | undefined = media; node; ) {
		const { width, height } = node.metadata ?? {};
		if (width && height) return { width, height };
		const op = node.operation as {
			op?: string;
			url?: unknown;
			source?: unknown;
		};
		if (op.op === "source") {
			const url = typeof op.url === "string" ? op.url : op.source;
			return typeof url === "string" ? probeVideoSize(url) : null;
		}
		node = node.children?.[0];
	}
	return null;
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

	const op = props.virtualMedia?.operation as RotateOp | undefined;
	if (op?.op !== "Rotate" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	pass.end();

	const frame = props.frame ?? 0;
	const compositionFrame = props.compositionFrame ?? frame;
	const fps = props.fps || 30;
	const width = targetWidth;
	const height = targetHeight;

	const intrinsic = await intrinsicSize(childMedia);
	const sourceWidth = intrinsic?.width ?? props.containerWidth ?? width;
	const sourceHeight = intrinsic?.height ?? props.containerHeight ?? height;

	// 1. Render the child upright into an offscreen texture at its own size
	const childTex = ctx.renderer.getTemporaryTexture(sourceWidth, sourceHeight, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const childView = childTex.createView();

	const childPass = ctx.renderer.beginFrame(
		encoder,
		childView,
		{ r: 0, g: 0, b: 0, a: 0 },
		sourceWidth,
		sourceHeight,
		"clear",
	);
	childPass.end();

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
			virtualMedia: childMedia,
		},
		childView,
		childTex,
		sourceWidth,
		sourceHeight,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Rotate it into the output
	const angle = resolveNumber(op.angle, 90, compositionFrame, fps);
	const scale = Math.max(
		0.01,
		resolveNumber(op.scale, 1, compositionFrame, fps),
	);
	const size = rotatedSourceSize(
		sourceWidth,
		sourceHeight,
		width,
		height,
		angle,
		op.fit ?? "cover",
	);
	const rad = (angle * Math.PI) / 180;

	uniformData[0] = width;
	uniformData[1] = height;
	uniformData[2] = size.width * scale;
	uniformData[3] = size.height * scale;
	uniformData[4] = Math.cos(rad);
	uniformData[5] = Math.sin(rad);

	const { pipeline, uniformLayout, textureLayout } = getRotateResources(
		ctx.device,
		ctx.renderer.format,
	);

	const uBindGroup = ctx.device.createBindGroup({
		layout: uniformLayout,
		entries: [
			{
				binding: 0,
				resource: { buffer: ctx.renderer.getTemporaryBuffer(uniformData) },
			},
		],
	});

	const tBindGroup = ctx.device.createBindGroup({
		layout: textureLayout,
		entries: [
			{ binding: 0, resource: childTex.createView() },
			{
				binding: 1,
				resource: ctx.renderer.samplerCache.getSampler(ctx.device),
			},
		],
	});

	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		childTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

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
	renderPass.setBindGroup(0, uBindGroup);
	renderPass.setBindGroup(1, tBindGroup);
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
		{ opacity: op.opacity ?? 1.0 },
	);

	args.pass = finalPass;
};
