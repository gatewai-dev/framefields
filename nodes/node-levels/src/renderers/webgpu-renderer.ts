import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { colorMatrixWgsl } from "@gitframes/webgpu-renderers";
import { type LevelChannel, type LevelsOperation, defaultLevelChannel } from "../shared/config.js";

interface DeviceLevelsResources {
	colorMatrixPipeline: GPURenderPipeline;
	colorMatrixUniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceLevelsResources>();
const colorMatrixData = new Float32Array(20);

function getColorMatrixResources(device: GPUDevice, format: GPUTextureFormat) {
	let res = deviceResourceCache.get(device);
	if (!res) {
		const colorMatrixUniformLayout = device.createBindGroupLayout({
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

		const colorMatrixModule = device.createShaderModule({
			label: "color-matrix.wgsl",
			code: colorMatrixWgsl,
		});

		const colorMatrixPipeline = device.createRenderPipeline({
			label: "ColorMatrixPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [colorMatrixUniformLayout, singleTextureLayout],
			}),
			vertex: { module: colorMatrixModule, entryPoint: "vs" },
			fragment: {
				module: colorMatrixModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});

		res = {
			colorMatrixPipeline,
			colorMatrixUniformLayout,
			singleTextureLayout,
		};
		deviceResourceCache.set(device, res);
	}
	return res;
}

function getTransform(ch: LevelChannel) {
	const inRange = Math.max(ch.inWhite - ch.inBlack, 1e-5);
	const outRange = ch.outWhite - ch.outBlack;
	const scale = outRange / inRange;
	const bias = ch.outBlack - ch.inBlack * scale;
	return { scale, bias };
}

export const LevelsWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
		| LevelsOperation
		| undefined;

	if (op?.op !== "Levels" || !props.virtualMedia?.children?.[0]) return;

	pass.end();

	const childMedia = props.virtualMedia.children[0];

	const m = getTransform(op.master ?? defaultLevelChannel);
	const r = getTransform(op.red ?? defaultLevelChannel);
	const g = getTransform(op.green ?? defaultLevelChannel);
	const b = getTransform(op.blue ?? defaultLevelChannel);

	const rS = r.scale * m.scale;
	const rB = r.bias * m.scale + m.bias;

	const gS = g.scale * m.scale;
	const gB = g.bias * m.scale + m.bias;

	const bS = b.scale * m.scale;
	const bB = b.bias * m.scale + m.bias;

	const matrix = [
		rS,
		0,
		0,
		0,
		rB,
		0,
		gS,
		0,
		0,
		gB,
		0,
		0,
		bS,
		0,
		bB,
		0,
		0,
		0,
		1,
		0,
	];

	const width = targetWidth;
	const height = targetHeight;

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

	// Apply Color Matrix
	const {
		colorMatrixPipeline: pipeline,
		colorMatrixUniformLayout: uLayout,
		singleTextureLayout: tLayout,
	} = getColorMatrixResources(ctx.device, ctx.renderer.format);
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Remap matrix to uniform layout
	colorMatrixData[0] = matrix[0];
	colorMatrixData[1] = matrix[1];
	colorMatrixData[2] = matrix[2];
	colorMatrixData[3] = matrix[3];

	colorMatrixData[4] = matrix[5];
	colorMatrixData[5] = matrix[6];
	colorMatrixData[6] = matrix[7];
	colorMatrixData[7] = matrix[8];

	colorMatrixData[8] = matrix[10];
	colorMatrixData[9] = matrix[11];
	colorMatrixData[10] = matrix[12];
	colorMatrixData[11] = matrix[13];

	colorMatrixData[12] = matrix[15];
	colorMatrixData[13] = matrix[16];
	colorMatrixData[14] = matrix[17];
	colorMatrixData[15] = matrix[18];

	colorMatrixData[16] = matrix[4];
	colorMatrixData[17] = matrix[9];
	colorMatrixData[18] = matrix[14];
	colorMatrixData[19] = matrix[19];

	const buffer = ctx.renderer.getTemporaryBuffer(colorMatrixData);

	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
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

	renderPass.setPipeline(pipeline!);
	renderPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout!,
			entries: [{ binding: 0, resource: { buffer } }],
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

	(args as any).pass = finalPass;
};
