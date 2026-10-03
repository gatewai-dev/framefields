/// <reference types="webgpu" />
import type { SignalData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { signalRegistry } from "@gitframes/webgpu-renderers";

interface TileOffsetOp {
	op: "TileOffset";
	offsetX?: number;
	offsetY?: number;
	wrap?: boolean;
	edgeMode?: "wrap" | "clamp" | "transparent" | "mirror";
	opacity?: number;
	offsetXHandleId?: string | null;
	offsetYHandleId?: string | null;
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

type TileOffsetSignalData = SignalData & { nodeId?: string };

const TILE_OFFSET_SHADER = `
struct TileOffsetUniforms {
    offsetX        : f32,
    offsetY        : f32,
    hasOffsetXSig  : f32,
    hasOffsetYSig  : f32,

    layerWidth     : f32,
    layerHeight    : f32,
    edgeMode       : f32,
    pad            : f32,
};

@group(0) @binding(0) var<uniform> u : TileOffsetUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

@group(2) @binding(0) var offsetXSigTex : texture_2d<f32>;
@group(2) @binding(1) var offsetYSigTex : texture_2d<f32>;
@group(2) @binding(2) var signalSamp    : sampler;

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
    var offX = u.offsetX;
    if (u.hasOffsetXSig > 0.5) {
        let sigX = textureSampleLevel(offsetXSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
        offX = offX + sigX;
    }

    var offY = u.offsetY;
    if (u.hasOffsetYSig > 0.5) {
        let sigY = textureSampleLevel(offsetYSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
        offY = offY + sigY;
    }

    let normOffset = vec2<f32>(
        offX / max(1.0, u.layerWidth),
        offY / max(1.0, u.layerHeight)
    );
    var uv = in.uv - normOffset;

    // Edge Modes:
    // 0.0 = wrap (seamless modulo)
    // 1.0 = clamp (edge smear)
    // 2.0 = transparent (clear bounds)
    // 3.0 = mirror (ping-pong reflection)
    if (u.edgeMode < 0.5) {
        uv = fract(uv);
    } else if (u.edgeMode < 1.5) {
        uv = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    } else if (u.edgeMode < 2.5) {
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            return vec4<f32>(0.0);
        }
    } else {
        uv = 1.0 - abs(fract(uv * 0.5) * 2.0 - 1.0);
    }

    let color = textureSampleLevel(tex, samp, uv, 0.0);
    return color;
}
`;

interface DeviceTileOffsetResources {
	uniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceTileOffsetResources>();
const uniformData = new Float32Array(8);

function getDeviceLayouts(device: GPUDevice): DeviceTileOffsetResources {
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

function getTileOffsetResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `tile_offset_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);

	if (!pipeline) {
		const module = device.createShaderModule({
			label: `tile_offset_${format}.wgsl`,
			code: TILE_OFFSET_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `TileOffsetPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.uniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		pipeline,
		uniformLayout: layouts.uniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const TileOffsetWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	const op = props.virtualMedia?.operation as TileOffsetOp | undefined;
	if (op?.op !== "TileOffset" || !op) return;

	const childMedia = props.virtualMedia?.children?.[0];
	if (!childMedia) return;

	// End active pass before rendering child
	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "tile_offset_node";

	// 1. Resolve Bindable Parameters
	const resolveBindable = (
		configKey: "offsetX" | "offsetY",
		defaultValue: number,
	) => {
		const handleIdKey = `${configKey}HandleId` as keyof TileOffsetOp;
		const handleId = op[handleIdKey] as string | null | undefined;
		const input = handleId ? op.inputs?.[handleId] : null;

		const hasSignal = !!(
			input?.connectionValid &&
			(input.outputItem?.type === "Signal" ||
				input.outputItem?.type === "Numeric")
		);

		const sd =
			hasSignal && input?.outputItem?.data
				? (input.outputItem.data as TileOffsetSignalData)
				: null;

		let val = defaultValue;
		let hasStaticSig = false;

		if (!hasSignal) {
			if (input?.connectionValid && input.outputItem?.type === "Number") {
				val = Number(input.outputItem.data ?? defaultValue);
			} else {
				val = Number(op[configKey] ?? defaultValue);
			}
		} else if (sd) {
			val = Number(sd.offset ?? 0.0);
			hasStaticSig = true;
		}

		return { val, hasStaticSig, sd };
	};

	const offsetXRes = resolveBindable("offsetX", 0);
	const offsetYRes = resolveBindable("offsetY", 0);

	// Determine edge mode numeric index
	let edgeModeIndex = 0.0; // wrap
	const edgeMode = op.edgeMode ?? (op.wrap !== false ? "wrap" : "transparent");
	if (edgeMode === "clamp") {
		edgeModeIndex = 1.0;
	} else if (edgeMode === "transparent" || op.wrap === false) {
		edgeModeIndex = 2.0;
	} else if (edgeMode === "mirror") {
		edgeModeIndex = 3.0;
	}

	// 2. Draw child media to offscreen texture
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

	// End active pass from drawing child
	args.pass.end();

	// 3. Fetch layout and resources
	const {
		pipeline,
		uniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getTileOffsetResources(ctx.device, ctx.renderer.format);

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
			sd: TileOffsetSignalData | null;
		},
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

	const offsetXView = getSignalView(offsetXRes, "offsetX_sig");
	const offsetYView = getSignalView(offsetYRes, "offsetY_sig");

	// 4. Fill uniform array
	uniformData[0] = offsetXRes.val;
	uniformData[1] = offsetYRes.val;
	uniformData[2] = offsetXRes.hasStaticSig ? 1.0 : 0.0;
	uniformData[3] = offsetYRes.hasStaticSig ? 1.0 : 0.0;
	uniformData[4] = width;
	uniformData[5] = height;
	uniformData[6] = edgeModeIndex;
	uniformData[7] = 0.0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	// 5. Output Texture
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// 6. Run tile offset pass
	const tilePass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	tilePass.setPipeline(pipeline);
	tilePass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	tilePass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout,
			tmpTex,
			sampler,
		),
	);
	tilePass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: offsetXView },
				{ binding: 1, resource: offsetYView },
				{ binding: 2, resource: sampler },
			],
		}),
	);
	tilePass.draw(4);
	tilePass.end();

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

export const WebGPURenderer = TileOffsetWebGPURenderer;
