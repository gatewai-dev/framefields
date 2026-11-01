/// <reference types="@webgpu/types" />
import type { SignalData, VirtualMediaData } from "@framefields/core";
import { signalRegistry } from "@framefields/webgpu-renderers";
import type { NodeRenderProps, WebGPUNodeRenderer } from "./index.js";

/** The argument object every WebGPU node renderer receives. */
export type WebGPUNodeRendererArgs = Parameters<WebGPUNodeRenderer>[0];

const TRANSPARENT: GPUColor = { r: 0, g: 0, b: 0, a: 0 };

/**
 * Full-screen quad vertex stage: a 4-vertex triangle strip (draw(4)) that
 * hands `in.uv` (0,0 top-left → 1,1 bottom-right) to an `fs` reading `VSOut`.
 */
export const FULLSCREEN_QUAD_WGSL = `
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
`;

/** Premultiplied-alpha "over" blending. */
export const PREMULTIPLIED_BLEND: GPUBlendState = {
	color: {
		srcFactor: "one",
		dstFactor: "one-minus-src-alpha",
		operation: "add",
	},
	alpha: {
		srcFactor: "one",
		dstFactor: "one-minus-src-alpha",
		operation: "add",
	},
};

/** Straight-alpha color over a premultiplied-alpha accumulation. */
export const STRAIGHT_ALPHA_BLEND: GPUBlendState = {
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
};

/**
 * One bind-group entry, visible to the fragment stage unless it says
 * otherwise: `"uniform"` buffer, `"texture"` (filterable float 2D) or
 * `"sampler"` (filtering), or any other entry minus its binding index.
 */
export type FragmentBinding =
	| "uniform"
	| "texture"
	| "sampler"
	| Omit<GPUBindGroupLayoutEntry, "binding" | "visibility">
	| Omit<GPUBindGroupLayoutEntry, "binding">;

/** A bind group layout whose entries are bound at 0, 1, 2… in order. */
export function fragmentBindGroupLayout(
	device: GPUDevice,
	bindings: FragmentBinding[],
	label?: string,
): GPUBindGroupLayout {
	return device.createBindGroupLayout({
		...(label && { label }),
		entries: bindings.map((binding, index): GPUBindGroupLayoutEntry => {
			if (binding === "uniform") {
				return {
					binding: index,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				};
			}
			if (binding === "texture") {
				return {
					binding: index,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				};
			}
			if (binding === "sampler") {
				return {
					binding: index,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				};
			}
			return {
				visibility: GPUShaderStage.FRAGMENT,
				...binding,
				binding: index,
			};
		}),
	});
}

/** `count` float textures followed by one filtering sampler. */
export function texturesLayout(
	device: GPUDevice,
	count: number,
): GPUBindGroupLayout {
	return fragmentBindGroupLayout(device, [
		...Array<FragmentBinding>(count).fill("texture"),
		"sampler",
	]);
}

/** Memoizes `create` per GPUDevice (resources can't cross devices). */
export function perDevice<T>(
	create: (device: GPUDevice) => T,
): (device: GPUDevice) => T {
	const cache = new WeakMap<GPUDevice, T>();
	return (device) => {
		let value = cache.get(device);
		if (value === undefined) {
			value = create(device);
			cache.set(device, value);
		}
		return value;
	};
}

export interface FullscreenPipelineOptions {
	label?: string;
	module: GPUShaderModule;
	layouts: GPUBindGroupLayout[] | GPUPipelineLayout;
	format: GPUTextureFormat;
	blend?: GPUBlendState;
	/** Defaults to "vs". */
	vertexEntryPoint?: string;
	/** Defaults to "fs". */
	fragmentEntryPoint?: string;
}

/** A triangle-strip pipeline drawing one full-screen quad (`draw(4)`). */
export function createFullscreenPipeline(
	device: GPUDevice,
	options: FullscreenPipelineOptions,
): GPURenderPipeline {
	const { module, format, blend } = options;
	return device.createRenderPipeline({
		...(options.label && { label: options.label }),
		layout: Array.isArray(options.layouts)
			? device.createPipelineLayout({ bindGroupLayouts: options.layouts })
			: options.layouts,
		vertex: { module, entryPoint: options.vertexEntryPoint ?? "vs" },
		fragment: {
			module,
			entryPoint: options.fragmentEntryPoint ?? "fs",
			targets: [blend ? { format, blend } : { format }],
		},
		primitive: { topology: "triangle-strip" },
	});
}

export interface DrawChildToTextureOptions {
	/** Defaults to the target's size. */
	width?: number;
	height?: number;
	/** Props for the child; defaults to the node's props with the child as media. */
	props?: Partial<NodeRenderProps>;
	/** Textures still in use that the temporary texture must not alias. */
	exclude?: GPUTexture[];
}

/**
 * Renders `child` into a cleared temporary texture with an identity
 * transform and a full-size scissor, and returns that texture.
 */
export async function drawChildToTexture(
	args: WebGPUNodeRendererArgs,
	child: VirtualMediaData,
	options: DrawChildToTextureOptions = {},
): Promise<{ texture: GPUTexture; view: GPUTextureView }> {
	const { ctx, encoder, props } = args;
	const width = options.width ?? args.targetWidth;
	const height = options.height ?? args.targetHeight;
	const texture = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		args.targetTexture,
		...(options.exclude ?? []),
	]);
	const view = texture.createView();
	ctx.renderer
		.beginFrame(encoder, view, TRANSPARENT, width, height, "clear")
		.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await args.drawChild(
		child,
		options.props ?? { ...props, virtualMedia: child },
		view,
		texture,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();
	return { texture, view };
}

/**
 * Opens a "load" pass on the node's target and makes it the node's current
 * pass (the caller hands it back to the compositor).
 */
export function beginTargetPass(
	args: WebGPUNodeRendererArgs,
	width = args.targetWidth,
	height = args.targetHeight,
): GPURenderPassEncoder {
	const pass = args.ctx.renderer.beginFrame(
		args.encoder,
		args.targetView,
		TRANSPARENT,
		width,
		height,
		"load",
	);
	args.pass = pass;
	return pass;
}

/**
 * Target pixels per layout pixel (`props.pixelScale`, 1 when unset). A
 * renderer multiplies its pixel-unit parameters by it and declares
 * `maxPixelScale`.
 */
export function pixelScale(args: WebGPUNodeRendererArgs): number {
	return args.props.pixelScale ?? 1;
}

/** Draws `texture` over the whole target at `opacity` (the node's output). */
export function drawTextureToTarget(
	args: WebGPUNodeRendererArgs,
	texture: GPUTexture,
	opacity = 1,
): void {
	const { targetWidth: width, targetHeight: height } = args;
	args.ctx.renderer.drawTexture(
		beginTargetPass(args),
		texture,
		{ x: 0, y: 0, width, height },
		{ opacity },
	);
}

/** Clock a signal texture is evaluated at, in seconds. */
export function signalTiming(
	props: NodeRenderProps,
	frame: number,
	fps: number,
	fallbackDurationSeconds = 0,
): { elapsedSeconds: number; durationSeconds: number } {
	const metadataDurationMs = props.virtualMedia?.metadata?.durationMs;
	return {
		elapsedSeconds:
			props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps,
		durationSeconds: metadataDurationMs
			? metadataDurationMs / 1000
			: props.durationMs !== undefined
				? props.durationMs / 1000
				: fallbackDurationSeconds,
	};
}

export type NodeSignalData = SignalData & { nodeId?: string };

export interface SignalTextureContext {
	args: WebGPUNodeRendererArgs;
	width: number;
	height: number;
	frame: number;
	fps: number;
	elapsedSeconds: number;
	durationSeconds: number;
}

/**
 * The texture a bound parameter samples: its own GPU binding, the signal's
 * texture (cached under `sd.nodeId`, else `fallbackId`), or a 1×1 dummy.
 */
export function signalTextureView(
	sc: SignalTextureContext,
	param: {
		hasStaticSig: boolean;
		sd: NodeSignalData | null;
		gpuTextureView?: GPUTextureView;
	},
	fallbackId: string,
): GPUTextureView {
	const { args } = sc;
	if (param.gpuTextureView) return param.gpuTextureView;
	if (param.hasStaticSig && param.sd) {
		return signalRegistry.getOrCreate2DTextureView(
			args.ctx.device,
			args.encoder,
			param.sd.nodeId ?? fallbackId,
			sc.elapsedSeconds,
			sc.durationSeconds,
			param.sd,
			sc.width,
			sc.height,
			args.props.renderId,
			sc.frame,
			sc.fps,
		);
	}
	return signalRegistry.getDummy1x1TextureView(args.ctx.device);
}

/** Clears `target` to transparent and draws one full-screen quad into it. */
export function drawFullscreenPass(
	encoder: GPUCommandEncoder,
	target: GPUTextureView,
	pipeline: GPURenderPipeline,
	bindGroups: GPUBindGroup[],
): void {
	const pass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: target,
				loadOp: "clear",
				storeOp: "store",
				clearValue: TRANSPARENT,
			},
		],
	});
	pass.setPipeline(pipeline);
	bindGroups.forEach((group, index) => {
		pass.setBindGroup(index, group);
	});
	pass.draw(4);
	pass.end();
}
