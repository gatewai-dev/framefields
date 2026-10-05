/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import type { LiquifyDeformOperation } from "../shared/config.js";

const MAX_OPERATIONS = 1024;

interface LiquifyOp {
	op: "Liquify";
	operations?: LiquifyDeformOperation[];
	opacity?: number;
}

const LIQUIFY_SHADER = `
struct LiquifyOpData {
	opType   : f32, // 0=Push, 1=Pull, 2=Bloat, 3=Pucker, 4=TwirlCW, 5=TwirlCCW
	x        : f32,
	y        : f32,
	radius   : f32,
	strength : f32,
	dx       : f32,
	dy       : f32,
	_pad     : f32,
};

struct LiquifyUniforms {
	opCount     : f32,
	aspectRatio : f32,
	opacity     : f32,
	_pad0       : f32,
	ops         : array<LiquifyOpData, 1024>,
};

@group(0) @binding(0) var<uniform> u : LiquifyUniforms;
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

const PI = 3.141592653589793;

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	var currentUV = in.uv;
	let count = u32(u.opCount);
	let aspect = u.aspectRatio;

	for (var i = 0u; i < count && i < 1024u; i = i + 1u) {
		let op = u.ops[i];
		let center = vec2<f32>(op.x, op.y);
		let delta = currentUV - center;
		let deltaAspect = vec2<f32>(delta.x * aspect, delta.y);
		let dist = length(deltaAspect);

		if (dist < op.radius && op.radius > 0.0001) {
			let t = dist / op.radius;
			let falloff = (1.0 - t * t) * (1.0 - t * t);
			let s = op.strength;

			if (op.opType < 0.5) {
				// 0 = Push
				let shift = vec2<f32>(op.dx, op.dy) * s * falloff;
				currentUV = currentUV - shift;
			} else if (op.opType < 1.5) {
				// 1 = Pull
				let shift = vec2<f32>(op.dx, op.dy) * s * falloff;
				currentUV = currentUV + shift;
			} else if (op.opType < 2.5) {
				// 2 = Bloat
				let factor = 1.0 - s * falloff * 0.45;
				currentUV = center + delta * factor;
			} else if (op.opType < 3.5) {
				// 3 = Pucker
				let factor = 1.0 + s * falloff * 0.45;
				currentUV = center + delta * factor;
			} else if (op.opType < 4.5) {
				// 4 = TwirlCW
				let angle = -s * PI * falloff;
				let cosA = cos(angle);
				let sinA = sin(angle);
				let rotated = vec2<f32>(delta.x * cosA - delta.y * sinA, delta.x * sinA + delta.y * cosA);
				currentUV = center + rotated;
			} else {
				// 5 = TwirlCCW
				let angle = s * PI * falloff;
				let cosA = cos(angle);
				let sinA = sin(angle);
				let rotated = vec2<f32>(delta.x * cosA - delta.y * sinA, delta.x * sinA + delta.y * cosA);
				currentUV = center + rotated;
			}
		}
	}

	let clampedUV = clamp(currentUV, vec2<f32>(0.0), vec2<f32>(1.0));
	let sampledColor = textureSampleLevel(tex, samp, clampedUV, 0.0);
	return sampledColor;
}
`;

interface DeviceLiquifyResources {
	uniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceLiquifyResources>();

function getLiquifyResources(device: GPUDevice, format: GPUTextureFormat) {
	let layouts = deviceResourceCache.get(device);
	if (!layouts) {
		const uniformLayout = device.createBindGroupLayout({
			label: "LiquifyUniformLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		const singleTextureLayout = device.createBindGroupLayout({
			label: "LiquifyTextureLayout",
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

		layouts = {
			uniformLayout,
			singleTextureLayout,
			pipelineCache: new Map(),
		};
		deviceResourceCache.set(device, layouts);
	}

	const cacheKey = format;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const module = device.createShaderModule({
			label: "liquify.wgsl",
			code: LIQUIFY_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `LiquifyPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [layouts.uniformLayout, layouts.singleTextureLayout],
			}),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [
					{
						format,
						blend: {
							color: {
								srcFactor: "src-alpha",
								dstFactor: "one-minus-src-alpha",
								operation: "add",
							},
							alpha: {
								srcFactor: "one",
								dstFactor: "one-minus-src-alpha",
								operation: "add",
							},
						},
					},
				],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		liquifyPipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
	};
}

const TYPE_ENUM_MAP: Record<string, number> = {
	Push: 0,
	Pull: 1,
	Bloat: 2,
	Pucker: 3,
	TwirlCW: 4,
	TwirlCCW: 5,
};

export const LiquifyWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as LiquifyOp | undefined;
	if (op?.op !== "Liquify" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End current incoming pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const aspectRatio = height > 0 ? width / height : 1.0;

	// 1. Render child media into intermediate texture
	const childTexture = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const childView = childTexture.createView();

	const childPass = ctx.renderer.beginFrame(
		encoder,
		childView,
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
			containerWidth: width,
			containerHeight: height,
			excludeTextures: [...(props.excludeTextures || []), childTexture],
		},
		childView,
		childTexture,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Prepare Uniform Buffer
	const operations = op.operations || [];
	const opCount = Math.min(operations.length, MAX_OPERATIONS);

	// Header: 4 floats (opCount, aspectRatio, opacity, _pad)
	// Ops: 64 * 8 floats
	const uniformData = new Float32Array(4 + MAX_OPERATIONS * 8);
	uniformData[0] = opCount;
	uniformData[1] = aspectRatio;
	uniformData[2] = 1.0; // opacity
	uniformData[3] = 0.0;

	for (let i = 0; i < opCount; i++) {
		const item = operations[i];
		if (!item) continue;
		const offset = 4 + i * 8;
		uniformData[offset + 0] = TYPE_ENUM_MAP[item.type] ?? 2; // default bloat
		uniformData[offset + 1] = item.x;
		uniformData[offset + 2] = item.y;
		uniformData[offset + 3] = item.radius ?? 0.15;
		uniformData[offset + 4] = item.strength ?? 0.5;
		uniformData[offset + 5] = item.dx ?? 0.0;
		uniformData[offset + 6] = item.dy ?? 0.0;
		uniformData[offset + 7] = 0.0;
	}

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);
	const resources = getLiquifyResources(ctx.device, ctx.renderer.format);

	const uniformBindGroup = ctx.device.createBindGroup({
		layout: resources.uniformLayout,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);
	const textureBindGroup = ctx.renderer.bindGroupCache.getBindGroup(
		ctx.device,
		resources.singleTextureLayout,
		childTexture,
		sampler,
	);

	// 3. Render final pass to targetView
	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"load",
	);

	outPass.setPipeline(resources.liquifyPipeline);
	outPass.setBindGroup(0, uniformBindGroup);
	outPass.setBindGroup(1, textureBindGroup);
	outPass.draw(4, 1, 0, 0);

	args.pass = outPass;
};

export default LiquifyWebGPURenderer;
