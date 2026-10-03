/// <reference types="webgpu" />
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";

interface FlipOp {
	op: "Flip";
	horizontal?: boolean;
	vertical?: boolean;
	diagonal?: boolean;
	mode?:
		| "horizontal"
		| "vertical"
		| "both"
		| "diagonal"
		| "antiDiagonal"
		| "custom";
	symmetry?:
		| "none"
		| "leftToRight"
		| "rightToLeft"
		| "topToBottom"
		| "bottomToTop"
		| "quadrant";
	opacity?: number;
}

const WGSL_FLIP_SHADER = `
struct FlipUniforms {
	flipH     : f32,
	flipV     : f32,
	diagonal  : f32,
	symmetry  : f32,
};

@group(0) @binding(0) var<uniform> u : FlipUniforms;
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
	var uv = in.uv;

	// 1. Split-Mirror / Symmetry
	if (u.symmetry > 0.5 && u.symmetry < 1.5) {
		// leftToRight: mirror left half to right half
		uv.x = select(uv.x, 1.0 - uv.x, uv.x > 0.5);
	} else if (u.symmetry > 1.5 && u.symmetry < 2.5) {
		// rightToLeft: mirror right half to left half
		uv.x = select(1.0 - uv.x, uv.x, uv.x > 0.5);
	} else if (u.symmetry > 2.5 && u.symmetry < 3.5) {
		// topToBottom: mirror top half to bottom half
		uv.y = select(uv.y, 1.0 - uv.y, uv.y > 0.5);
	} else if (u.symmetry > 3.5 && u.symmetry < 4.5) {
		// bottomToTop: mirror bottom half to top half
		uv.y = select(1.0 - uv.y, uv.y, uv.y > 0.5);
	} else if (u.symmetry > 4.5) {
		// quadrant: 4-way kaleidoscopic symmetry
		uv.x = select(uv.x, 1.0 - uv.x, uv.x > 0.5);
		uv.y = select(uv.y, 1.0 - uv.y, uv.y > 0.5);
	}

	// 2. Diagonal Swap (Transposition: x <-> y)
	if (u.diagonal > 0.5) {
		let temp = uv.x;
		uv.x = uv.y;
		uv.y = temp;
	}

	// 3. Horizontal / Vertical Flip
	if (u.flipH > 0.5) {
		uv.x = 1.0 - uv.x;
	}
	if (u.flipV > 0.5) {
		uv.y = 1.0 - uv.y;
	}

	return textureSampleLevel(tex, samp, uv, 0.0);
}
`;

interface DeviceFlipResources {
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
	pipeline: GPURenderPipeline;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceFlipResources>();
const uniformData = new Float32Array(4);

function getFlipResources(
	device: GPUDevice,
	targetFormat: GPUTextureFormat,
): DeviceFlipResources {
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

	const shaderModule = device.createShaderModule({
		code: WGSL_FLIP_SHADER,
	});

	const pipelineLayout = device.createPipelineLayout({
		bindGroupLayouts: [uniformLayout, textureLayout],
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
			targets: [
				{
					format: targetFormat,
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
		primitive: {
			topology: "triangle-strip",
		},
	});

	const res: DeviceFlipResources = {
		uniformLayout,
		textureLayout,
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

	const op = props.virtualMedia?.operation as FlipOp | undefined;
	if (op?.op !== "Flip" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	const sourceWidth =
		childMedia.metadata?.width ?? props.containerWidth ?? width;
	const sourceHeight =
		childMedia.metadata?.height ?? props.containerHeight ?? height;

	// 1. Render child into offscreen texture
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

	// 2. Fetch resources & configure flip parameters
	const {
		pipeline,
		uniformLayout: uLayout,
		textureLayout: tLayout,
	} = getFlipResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const mode = op.mode ?? "horizontal";
	let isFlipH = false;
	let isFlipV = false;
	let isDiag = false;

	if (mode === "horizontal") {
		isFlipH = true;
	} else if (mode === "vertical") {
		isFlipV = true;
	} else if (mode === "both") {
		isFlipH = true;
		isFlipV = true;
	} else if (mode === "diagonal") {
		isDiag = true;
	} else if (mode === "antiDiagonal") {
		isDiag = true;
		isFlipH = true;
		isFlipV = true;
	} else if (mode === "custom") {
		isFlipH = op.horizontal ?? true;
		isFlipV = op.vertical ?? false;
		isDiag = op.diagonal ?? false;
	}

	let symVal = 0.0;
	if (op.symmetry === "leftToRight") symVal = 1.0;
	else if (op.symmetry === "rightToLeft") symVal = 2.0;
	else if (op.symmetry === "topToBottom") symVal = 3.0;
	else if (op.symmetry === "bottomToTop") symVal = 4.0;
	else if (op.symmetry === "quadrant") symVal = 5.0;

	uniformData[0] = isFlipH ? 1.0 : 0.0;
	uniformData[1] = isFlipV ? 1.0 : 0.0;
	uniformData[2] = isDiag ? 1.0 : 0.0;
	uniformData[3] = symVal;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	const uBindGroup = ctx.device.createBindGroup({
		layout: uLayout,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const tBindGroup = ctx.device.createBindGroup({
		layout: tLayout,
		entries: [
			{ binding: 0, resource: childTex.createView() },
			{ binding: 1, resource: sampler },
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
