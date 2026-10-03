import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { solveHomography } from "../shared/utils.js";

const cornerPinWgsl = `
struct CornerPinUniforms {
	matrix_row0 : vec4<f32>,
	matrix_row1 : vec4<f32>,
	matrix_row2 : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : CornerPinUniforms;
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
	let x = in.uv.x;
	let y = in.uv.y;

	let d = u.matrix_row2.x * x + u.matrix_row2.y * y + u.matrix_row2.z;
	if (abs(d) < 1e-6) {
		return vec4<f32>(0.0);
	}

	let src_u = (u.matrix_row0.x * x + u.matrix_row0.y * y + u.matrix_row0.z) / d;
	let src_v = (u.matrix_row1.x * x + u.matrix_row1.y * y + u.matrix_row1.z) / d;

	if (src_u < 0.0 || src_u > 1.0 || src_v < 0.0 || src_v > 1.0) {
		return vec4<f32>(0.0);
	}

	let color = textureSampleLevel(tex, samp, vec2<f32>(src_u, src_v), 0.0);
	return color;
}
`;

interface DeviceCornerPinResources {
	pinPipeline: GPURenderPipeline;
	pinUniformLayout: GPUBindGroupLayout;
	pinTextureLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceCornerPinResources>();

function getCornerPinResources(device: GPUDevice, format: GPUTextureFormat) {
	let res = deviceResourceCache.get(device);
	if (!res) {
		const pinUniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		const pinTextureLayout = device.createBindGroupLayout({
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

		const module = device.createShaderModule({
			label: "corner_pin.wgsl",
			code: cornerPinWgsl,
		});

		const pinPipeline = device.createRenderPipeline({
			label: "CornerPinPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [pinUniformLayout, pinTextureLayout],
			}),
			vertex: {
				module,
				entryPoint: "vs",
			},
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
			primitive: {
				topology: "triangle-strip",
			},
		});

		res = { pinPipeline, pinUniformLayout, pinTextureLayout };
		deviceResourceCache.set(device, res);
	}
	return res;
}

export const CornerPinWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		props,
		drawChild,
		targetTexture,
		targetView,
		targetWidth,
		targetHeight,
		encoder,
	} = args;
	const { virtualMedia } = props;
	const op = virtualMedia?.operation as any;
	if (!op || op.op !== "CornerPin") return;

	const childMedia = virtualMedia.children?.[0];
	if (!childMedia) return;

	const sourceWidth =
		op.originalWidth ??
		childMedia.metadata?.width ??
		props.containerWidth ??
		targetWidth;
	const sourceHeight =
		op.originalHeight ??
		childMedia.metadata?.height ??
		props.containerHeight ??
		targetHeight;

	// End incoming pass to avoid conflicts
	args.pass.end();

	// 2. Render child into a temporary offscreen texture at its native size
	const childTex = ctx.renderer.getTemporaryTexture(sourceWidth, sourceHeight, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const childView = childTex.createView();

	const clearPass = ctx.renderer.beginFrame(
		encoder,
		childView,
		{ r: 0, g: 0, b: 0, a: 0 },
		sourceWidth,
		sourceHeight,
		"clear",
	);
	clearPass.end();

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

	// 3. Solve homography matrix mapping target corners to source corners
	const points = op.points || [];
	const h = solveHomography(points);

	// 4. Setup uniform buffer with std140 layout alignment
	const uniformData = new Float32Array(12);
	uniformData[0] = h[0]; // h00
	uniformData[1] = h[1]; // h01
	uniformData[2] = h[2]; // h02
	uniformData[3] = 0; // padding

	uniformData[4] = h[3]; // h10
	uniformData[5] = h[4]; // h11
	uniformData[6] = h[5]; // h12
	uniformData[7] = 0; // padding

	uniformData[8] = h[6]; // h20
	uniformData[9] = h[7]; // h21
	uniformData[10] = h[8]; // h22 (1.0)
	uniformData[11] = 0; // padding

	const {
		pinPipeline: pipeline,
		pinUniformLayout: uLayout,
		pinTextureLayout: tLayout,
	} = getCornerPinResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);
	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	const uniformBindGroup = ctx.device.createBindGroup({
		layout: uLayout!,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const textureBindGroup = ctx.renderer.bindGroupCache.getBindGroup(
		ctx.device,
		tLayout!,
		childTex,
		sampler,
	);

	// 5. Render warped result into a temporary offscreen texture at target size
	const outTex = ctx.renderer.getTemporaryTexture(targetWidth, targetHeight, [
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

	renderPass.setPipeline(pipeline!);
	renderPass.setBindGroup(0, uniformBindGroup);
	renderPass.setBindGroup(1, textureBindGroup);
	renderPass.draw(4);
	renderPass.end();

	// 6. Draw warped texture on top of targetView (with loadOp: "load" to keep background/prev layers)
	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	ctx.renderer.drawTexture(
		outPass,
		outTex,
		{ x: 0, y: 0, width: targetWidth, height: targetHeight },
		{ opacity: op.opacity ?? 1 },
	);

	args.pass = outPass;
};
