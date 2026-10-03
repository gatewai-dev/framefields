import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { createUniformGrid } from "../shared/utils.js";

const meshWarpWgsl = `
struct MeshUniforms {
	gridSize    : vec2<f32>,
	layerSize   : vec2<f32>,
	matrix_col0 : vec4<f32>,
	matrix_col1 : vec4<f32>,
	points      : array<vec4<f32>, 144>,
};

@group(0) @binding(0) var<uniform> u : MeshUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

struct VSOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
	let cols = u32(u.gridSize.x);
	let rows = u32(u.gridSize.y);
	
	let cellsCol = cols - 1u;
	let cellsRow = rows - 1u;
	let totalCells = cellsCol * cellsRow;
	
	let cellIndex = vi / 6u;
	let vertexInCell = vi % 6u;
	
	if (cellIndex >= totalCells) {
		return VSOut(vec4<f32>(0.0), vec4<f32>(0.0).xy);
	}
	
	let cellC = cellIndex % cellsCol;
	let cellR = cellIndex / cellsCol;
	
	var colOffset = 0u;
	var rowOffset = 0u;
	
	// Mapping vertex index in cell to quad corner offset
	// Triangle 1: TL (0,0), TR (1,0), BL (0,1)
	// Triangle 2: TR (1,0), BR (1,1), BL (0,1)
	if (vertexInCell == 1u) { // TR
		colOffset = 1u;
		rowOffset = 0u;
	} else if (vertexInCell == 2u) { // BL
		colOffset = 0u;
		rowOffset = 1u;
	} else if (vertexInCell == 3u) { // TR
		colOffset = 1u;
		rowOffset = 0u;
	} else if (vertexInCell == 4u) { // BR
		colOffset = 1u;
		rowOffset = 1u;
	} else if (vertexInCell == 5u) { // BL
		colOffset = 0u;
		rowOffset = 1u;
	}
	// Vertex 0 is TL (colOffset=0, rowOffset=0)
	
	let gridC = cellC + colOffset;
	let gridR = cellR + rowOffset;
	
	let pointIndex = gridR * cols + gridC;
	let warpedPoint = u.points[pointIndex].xy;
	
	let lx = (warpedPoint.x / 100.0) * u.layerSize.x;
	let ly = (warpedPoint.y / 100.0) * u.layerSize.y;
	
	let tx = u.matrix_col0.x * lx + u.matrix_col0.y * ly + u.matrix_col0.z;
	let ty = u.matrix_col1.x * lx + u.matrix_col1.y * ly + u.matrix_col1.z;
	
	let targetW = u.matrix_col0.w;
	let targetH = u.matrix_col1.w;
	
	let x_clip = (tx / targetW) * 2.0 - 1.0;
	let y_clip = 1.0 - (ty / targetH) * 2.0;
	
	let u_coord = f32(gridC) / f32(cellsCol);
	let v_coord = f32(gridR) / f32(cellsRow);
	
	return VSOut(vec4<f32>(x_clip, y_clip, 0.0, 1.0), vec2<f32>(u_coord, v_coord));
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let color = textureSampleLevel(tex, samp, in.uv, 0.0);
	return color;
}
`;

interface DeviceMeshWarpResources {
	warpPipeline: GPURenderPipeline;
	warpUniformLayout: GPUBindGroupLayout;
	warpTextureLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceMeshWarpResources>();

function getMeshWarpResources(device: GPUDevice, format: GPUTextureFormat) {
	let res = deviceResourceCache.get(device);
	if (!res) {
		const warpUniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		const warpTextureLayout = device.createBindGroupLayout({
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
			label: "mesh_warp.wgsl",
			code: meshWarpWgsl,
		});

		const warpPipeline = device.createRenderPipeline({
			label: "MeshWarpPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [warpUniformLayout, warpTextureLayout],
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
				topology: "triangle-list",
			},
		});

		res = { warpPipeline, warpUniformLayout, warpTextureLayout };
		deviceResourceCache.set(device, res);
	}
	return res;
}

export const MeshWarpWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	if (!op || op.op !== "MeshWarp") return;

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

	// 1. Render child into a temporary offscreen texture at its native size
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
		},
		childView,
		childTex,
		sourceWidth,
		sourceHeight,
	);

	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 2. Setup warp rendering to targetView
	const cols = Number(op.cols) || 3;
	const rows = Number(op.rows) || 3;
	const points = op.points || [];

	const finalPoints =
		points.length === cols * rows ? points : createUniformGrid(cols, rows);

	// Setup uniforms: gridSize (vec2), layerSize (vec2), matrix_col0 (vec4), matrix_col1 (vec4), then 144 points
	const maxPoints = 144;
	const uniformData = new Float32Array(12 + maxPoints * 4);
	uniformData[0] = cols;
	uniformData[1] = rows;
	uniformData[2] = props.containerWidth ?? sourceWidth;
	uniformData[3] = props.containerHeight ?? sourceHeight;

	const matrix = ctx.renderer.getCurrentTransform();
	uniformData[4] = matrix.a;
	uniformData[5] = matrix.c;
	uniformData[6] = matrix.e;
	uniformData[7] = targetWidth;

	uniformData[8] = matrix.b;
	uniformData[9] = matrix.d;
	uniformData[10] = matrix.f;
	uniformData[11] = targetHeight;

	for (let i = 0; i < maxPoints; i++) {
		const pt = finalPoints[i] || { x: 0, y: 0 };
		uniformData[12 + i * 4] = pt.x;
		uniformData[12 + i * 4 + 1] = pt.y;
	}

	const {
		warpPipeline: pipeline,
		warpUniformLayout: uLayout,
		warpTextureLayout: tLayout,
	} = getMeshWarpResources(ctx.device, ctx.renderer.format);

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

	const outPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	outPass.setPipeline(pipeline!);
	outPass.setBindGroup(0, uniformBindGroup);
	outPass.setBindGroup(1, textureBindGroup);

	const cellCount = (cols - 1) * (rows - 1);
	const vertexCount = cellCount * 6;
	outPass.draw(vertexCount);

	args.pass = outPass;
};
