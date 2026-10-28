/// <reference types="webgpu" />

import { resolveMediaSourceUrl } from "@framefields/client-utils";
import { decodeAudioSource } from "@framefields/compositions";
import {
	collectNodeOps,
	computeLayout,
	initLayout,
	type LayoutNode,
	type Rect,
} from "@framefields/compositions/program";
import type { MeshAudioDeformConfig, TextSpan } from "@framefields/core";
import {
	DEFAULT_DURATION_MS,
	getActiveMediaMetadata,
	mediaSourceTime,
	type VirtualMediaData,
} from "@framefields/core";
import {
	effectReach,
	type NodeRenderProps,
	resolveFrameNumber,
	solveHomography,
	type WebGPUNodeRenderer,
	type WebGPUNodeRendererArgs,
} from "@framefields/node-sdk";
import {
	createFullscreenPipeline,
	FULLSCREEN_QUAD_WGSL,
	fragmentBindGroupLayout,
	PREMULTIPLIED_BLEND,
} from "@framefields/node-sdk/gpu";
import { measureText } from "@framefields/renderers";
import { TemporalDeflickerPipeline } from "@framefields/tensor-webgpu";
import {
	AudioLatentTrackCache,
	type BlendMode,
	type BloomOptions,
	Camera3D,
	type Camera3DPose,
	type Color,
	type DrawMesh3DOpts,
	type DrawQuad3DOpts,
	type Environment3DOptions,
	type ExtrudedTextGeometryOptions,
	fitSpansToText,
	type GPUMeshBuffers,
	generateExtrudedTextGeometry,
	getPrimitiveGeometry,
	jointMatrices,
	Light3D,
	type Light3DOptions,
	type Mat4,
	Matrix4Math,
	type Mesh3DData,
	type Model3DData,
	measureMaxCaptionHeight,
	type PrimitiveGeometryOptions,
	parseColor,
	poseNodes,
	type RenderContextValue,
	Renderer3D,
	resolveTextSpans,
	ScreenSpaceRelightPipeline,
	type ShadowCaster3D,
	type ShapeFillConfig,
	type ShapeGeometryConfig,
	SlugFontCache,
	type SlugGlyphBatch,
	spansText,
	srtLoader,
	Vector3Math,
} from "@framefields/webgpu-renderers";
import { compileTimeline, seekTimeline } from "../shared/compiler.js";
import type { CompositorOperation } from "../shared/config.js";
import { shouldPaintContainerBackground } from "./container-bg.js";
import {
	buildLayerMatrix,
	resolveLayer2DPosition,
	toDOMMatrix,
} from "./transform.js";
import { has3DTransform, type Quad2D, Transform3DMath } from "./transform3d.js";

// Layout depends on the document tree (whose `children` array keeps its
// identity between frames), the viewport, media sizes and the few layout
// props a timeline can animate. A film's tree holds every scene, so
// re-running Yoga each frame is costly when none of those changed.
const LAYOUT_PROPS = [
	"width",
	"height",
	"gap",
	"padding",
	"fontSize",
	"letterSpacing",
] as const;
const layoutMemo = new WeakMap<
	object,
	{ key: string; rects: Record<string, Rect> }
>();

function layoutKey(
	width: number,
	height: number,
	targetsById: Record<string, any>,
	mediaDims: Map<string, { width: number; height: number }>,
): string {
	const parts: unknown[] = [width, height];
	for (const id in targetsById) {
		const t = targetsById[id];
		for (const k of LAYOUT_PROPS)
			if (t[k] !== undefined) parts.push(id, k, t[k]);
	}
	for (const [id, d] of mediaDims) parts.push(id, d.width, d.height);
	return JSON.stringify(parts);
}

const compositorHomographyWgsl = `
struct HomographyUniforms {
	matrix_row0 : vec4<f32>,
	matrix_row1 : vec4<f32>,
	matrix_row2 : vec4<f32>,
	params      : vec4<f32>, // params.x = opacity
};

@group(0) @binding(0) var<uniform> u : HomographyUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;
${FULLSCREEN_QUAD_WGSL}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
	let x = in.uv.x;
	let y = in.uv.y;

	let d = u.matrix_row2.x * x + u.matrix_row2.y * y + u.matrix_row2.z;
	if (d <= 1e-6) {
		return vec4<f32>(0.0);
	}

	let src_u = (u.matrix_row0.x * x + u.matrix_row0.y * y + u.matrix_row0.z) / d;
	let src_v = (u.matrix_row1.x * x + u.matrix_row1.y * y + u.matrix_row1.z) / d;

	if (src_u < 0.0 || src_u > 1.0 || src_v < 0.0 || src_v > 1.0) {
		return vec4<f32>(0.0);
	}

	let color = textureSampleLevel(tex, samp, vec2<f32>(src_u, src_v), 0.0);
	return color * u.params.x;
}
`;

interface DeviceHomographyResources {
	pipeline: GPURenderPipeline;
	uniformLayout: GPUBindGroupLayout;
	textureLayout: GPUBindGroupLayout;
}

const deviceHomographyCache = new WeakMap<
	GPUDevice,
	DeviceHomographyResources
>();

function getHomographyResources(
	device: GPUDevice,
	format: GPUTextureFormat,
): DeviceHomographyResources {
	let res = deviceHomographyCache.get(device);
	if (!res) {
		const uniformLayout = fragmentBindGroupLayout(device, ["uniform"]);

		const textureLayout = fragmentBindGroupLayout(device, [
			"texture",
			"sampler",
		]);

		const module = device.createShaderModule({
			label: "compositor_homography.wgsl",
			code: compositorHomographyWgsl,
		});

		const pipeline = createFullscreenPipeline(device, {
			label: "CompositorHomographyPipeline",
			module,
			layouts: [uniformLayout, textureLayout],
			format,
			blend: PREMULTIPLIED_BLEND,
		});

		res = { pipeline, uniformLayout, textureLayout };
		deviceHomographyCache.set(device, res);
	}
	return res;
}

const audioTrackLatentCache = new Map<string, AudioLatentTrackCache>();
const deviceRenderer3DCache = new WeakMap<GPUDevice, Map<string, Renderer3D>>();

/** One Renderer3D per device, target format and MSAA sample count. */
function getRenderer3D(
	device: GPUDevice,
	format: GPUTextureFormat,
	sampleCount: number,
): Renderer3D {
	let byConfig = deviceRenderer3DCache.get(device);
	if (!byConfig) {
		byConfig = new Map();
		deviceRenderer3DCache.set(device, byConfig);
	}
	const key = `${format}|${sampleCount}`;
	let r3d = byConfig.get(key);
	if (!r3d) {
		r3d = new Renderer3D(device, format, sampleCount);
		byConfig.set(key, r3d);
	}
	return r3d;
}

const deviceRelightPipelineCache = new WeakMap<
	GPUDevice,
	ScreenSpaceRelightPipeline
>();

function getScreenSpaceRelightPipeline(
	device: GPUDevice,
	format: GPUTextureFormat,
): ScreenSpaceRelightPipeline {
	let relight = deviceRelightPipelineCache.get(device);
	if (!relight || relight.format !== format) {
		relight = new ScreenSpaceRelightPipeline(device, format);
		deviceRelightPipelineCache.set(device, relight);
	}
	return relight;
}

const deviceDeflickerPipelineCache = new WeakMap<
	GPUDevice,
	Map<string, TemporalDeflickerPipeline>
>();

function getTemporalDeflickerPipeline(
	device: GPUDevice,
	layerKey: string,
): TemporalDeflickerPipeline {
	let map = deviceDeflickerPipelineCache.get(device);
	if (!map) {
		map = new Map();
		deviceDeflickerPipelineCache.set(device, map);
	}
	let pipe = map.get(layerKey);
	if (!pipe) {
		pipe = new TemporalDeflickerPipeline(device);
		map.set(layerKey, pipe);
	}
	return pipe;
}

function synthesizeRelightLights(
	relightOpts: Record<string, unknown>,
	sceneLights: Light3DOptions[],
	bounds: { x: number; y: number; width: number; height: number },
	shiftedFrame: number,
	fps: number,
): Light3DOptions[] {
	if (
		sceneLights.length > 0 ||
		(relightOpts.lightType === undefined &&
			relightOpts.intensity === undefined &&
			relightOpts.lightPosX === undefined)
	) {
		return sceneLights;
	}

	const lightTypeStr = String(relightOpts.lightType ?? "point").toLowerCase();
	const lightKind: Light3DOptions["lightType"] =
		lightTypeStr === "directional"
			? "directional"
			: lightTypeStr === "spot"
				? "spot"
				: "point";

	const rawIntensity = relightOpts.intensity ?? 1.0;
	const intensity = resolveFrameNumber(rawIntensity, 1.0, shiftedFrame, fps);

	const normX = resolveFrameNumber(
		relightOpts.lightPosX,
		0.5,
		shiftedFrame,
		fps,
	);
	const normY = resolveFrameNumber(
		relightOpts.lightPosY,
		0.5,
		shiftedFrame,
		fps,
	);
	const normZ = resolveFrameNumber(
		relightOpts.lightPosZ,
		0.25,
		shiftedFrame,
		fps,
	);
	const normRadius = resolveFrameNumber(
		relightOpts.lightRadius,
		0.75,
		shiftedFrame,
		fps,
	);

	const lightX = bounds.x + normX * bounds.width;
	const lightY = bounds.y + normY * bounds.height;
	const lightZ = normZ * Math.max(bounds.width, bounds.height);
	const lightRadius = normRadius * Math.max(bounds.width, bounds.height);

	const synthLight: Light3DOptions = {
		lightType: lightKind,
		color: (relightOpts.lightColor as string) ?? "#ffffff",
		intensity,
		x: lightX,
		y: lightY,
		z: lightZ,
		radius: lightRadius,
		decay: 1.0,
	};

	const ambientInt = resolveFrameNumber(
		relightOpts.ambientIntensity,
		0.15,
		shiftedFrame,
		fps,
	);
	const synthAmbient: Light3DOptions = {
		lightType: "ambient",
		color: (relightOpts.ambientColor as string) ?? "#ffffff",
		intensity: ambientInt,
	};

	return [synthAmbient, synthLight];
}

function drawProjectedQuad(
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	destView: GPUTextureView,
	sourceTex: GPUTexture,
	quad: Quad2D,
	destWidth: number,
	destHeight: number,
	opacity: number,
): void {
	const area = Math.abs(Transform3DMath.computeSignedArea(quad));
	if (area < 1e-4) {
		return;
	}

	const minX = Math.max(
		0,
		Math.min(
			destWidth,
			Math.floor(
				Math.min(
					quad.topLeft.x,
					quad.topRight.x,
					quad.bottomLeft.x,
					quad.bottomRight.x,
				),
			),
		),
	);
	const minY = Math.max(
		0,
		Math.min(
			destHeight,
			Math.floor(
				Math.min(
					quad.topLeft.y,
					quad.topRight.y,
					quad.bottomLeft.y,
					quad.bottomRight.y,
				),
			),
		),
	);
	const maxX = Math.max(
		0,
		Math.min(
			destWidth,
			Math.ceil(
				Math.max(
					quad.topLeft.x,
					quad.topRight.x,
					quad.bottomLeft.x,
					quad.bottomRight.x,
				),
			),
		),
	);
	const maxY = Math.max(
		0,
		Math.min(
			destHeight,
			Math.ceil(
				Math.max(
					quad.topLeft.y,
					quad.topRight.y,
					quad.bottomLeft.y,
					quad.bottomRight.y,
				),
			),
		),
	);

	const scissorW = maxX - minX;
	const scissorH = maxY - minY;
	if (scissorW <= 0 || scissorH <= 0) {
		return;
	}

	const dstPoints = [
		{ x: quad.topLeft.x / destWidth, y: quad.topLeft.y / destHeight },
		{ x: quad.topRight.x / destWidth, y: quad.topRight.y / destHeight },
		{ x: quad.bottomLeft.x / destWidth, y: quad.bottomLeft.y / destHeight },
		{ x: quad.bottomRight.x / destWidth, y: quad.bottomRight.y / destHeight },
	];

	const h = solveHomography(dstPoints);
	for (const val of h) {
		if (!Number.isFinite(val)) return;
	}

	const uniformData = new Float32Array(16);
	uniformData[0] = h[0];
	uniformData[1] = h[1];
	uniformData[2] = h[2];
	uniformData[3] = 0;

	uniformData[4] = h[3];
	uniformData[5] = h[4];
	uniformData[6] = h[5];
	uniformData[7] = 0;

	uniformData[8] = h[6];
	uniformData[9] = h[7];
	uniformData[10] = h[8];
	uniformData[11] = 0;

	uniformData[12] = opacity;
	uniformData[13] = 0;
	uniformData[14] = 0;
	uniformData[15] = 0;

	const { pipeline, uniformLayout, textureLayout } = getHomographyResources(
		ctx.device,
		ctx.renderer.format,
	);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);
	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	const uniformBindGroup = ctx.device.createBindGroup({
		layout: uniformLayout,
		entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
	});

	const textureBindGroup = ctx.renderer.bindGroupCache.getBindGroup(
		ctx.device,
		textureLayout,
		sourceTex,
		sampler,
	);

	const renderPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: destView,
				loadOp: "load",
				storeOp: "store",
			},
		],
	});

	renderPass.setPipeline(pipeline);
	renderPass.setScissorRect(minX, minY, scissorW, scissorH);
	renderPass.setBindGroup(0, uniformBindGroup);
	renderPass.setBindGroup(1, textureBindGroup);
	renderPass.draw(4);
	renderPass.end();
}

/**
 * Emissive and shadow participation for a 3D draw: animated values first,
 * then the node's own, then (meshes) the model file's material.
 */
function surfaceProps(
	target: any,
	lop: any,
	mat?: { emissive?: [number, number, number]; emissiveStrength?: number },
): {
	emissive?: string | [number, number, number];
	emissiveIntensity?: number;
	castShadow?: boolean;
} {
	// glTF emissiveFactor is linear; draws take display (sRGB) colors.
	const toSrgb = (v: number) =>
		v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
	const emissive =
		target?.emissive ??
		lop.emissive ??
		(mat?.emissive
			? ([
					toSrgb(mat.emissive[0]),
					toSrgb(mat.emissive[1]),
					toSrgb(mat.emissive[2]),
				] as [number, number, number])
			: undefined);
	const out: ReturnType<typeof surfaceProps> = {};
	if (emissive !== undefined) {
		out.emissive = emissive;
		out.emissiveIntensity =
			target?.emissiveIntensity ??
			lop.emissiveIntensity ??
			mat?.emissiveStrength ??
			1;
	}
	if (lop.castShadow !== undefined) out.castShadow = lop.castShadow;
	return out;
}

function computeContainerScissor(
	matrix: DOMMatrix,
	width: number,
	height: number,
): Rect {
	const corners = [
		matrix.transformPoint(new DOMPoint(0, 0)),
		matrix.transformPoint(new DOMPoint(width, 0)),
		matrix.transformPoint(new DOMPoint(0, height)),
		matrix.transformPoint(new DOMPoint(width, height)),
	];
	const xs = corners.map((p) => p.x);
	const ys = corners.map((p) => p.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const maxX = Math.max(...xs);
	const maxY = Math.max(...ys);
	return {
		x: Math.round(minX),
		y: Math.round(minY),
		width: Math.max(0, Math.round(maxX - minX)),
		height: Math.max(0, Math.round(maxY - minY)),
	};
}

/**
 * How far a layer's effects draw past its pixels, px: the sum of what each
 * effect's renderer declares (`reach`), or null as soon as one doesn't
 * (it then runs over the whole target, as any effect may need to).
 */
function effectsReach(effects: unknown[]): number | null {
	let reach = 0;
	for (const e of effects) {
		const op = (
			e && typeof (e as { toOperation?: unknown }).toOperation === "function"
				? (e as { toOperation: () => Record<string, unknown> }).toOperation()
				: e
		) as Record<string, unknown> | null;
		const r = op ? effectReach(op) : null;
		if (r === null) return null;
		reach += r;
	}
	return reach;
}

function expandRect(r: Rect, by: number): Rect {
	return {
		x: r.x - by,
		y: r.y - by,
		width: r.width + by * 2,
		height: r.height + by * 2,
	};
}

/** `r` within a `width` × `height` target, in whole pixels; null when nothing is left. */
function clampRect(r: Rect, width: number, height: number): Rect | null {
	const x0 = Math.max(0, Math.floor(r.x));
	const y0 = Math.max(0, Math.floor(r.y));
	const x1 = Math.min(width, Math.ceil(r.x + r.width));
	const y1 = Math.min(height, Math.ceil(r.y + r.height));
	return x1 > x0 && y1 > y0
		? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
		: null;
}

/**
 * `applyLayerEffects` over `region` of a full-target texture only: the
 * region is cut out, its effects run at its size, and the result lands back
 * at its place in a full-target texture. Without a region (or when it is
 * most of the target) the effects run over the whole texture.
 */
async function applyLayerEffectsInRegion(
	region: Rect | null,
	effects: unknown[],
	sourceTex: GPUTexture,
	width: number,
	height: number,
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	props: NodeRenderProps,
	drawChild: WebGPUNodeRendererArgs["drawChild"],
	excludes: GPUTexture[],
	shiftedFrame: number,
	compositionFrame: number,
	fps: number,
	isVideoMode: boolean,
	layerId: string,
): Promise<{ texture: GPUTexture; view: GPUTextureView }> {
	const run = (tex: GPUTexture, w: number, h: number, ex: GPUTexture[]) =>
		applyLayerEffects(
			effects,
			tex,
			w,
			h,
			ctx,
			encoder,
			props,
			drawChild,
			ex,
			shiftedFrame,
			compositionFrame,
			fps,
			isVideoMode,
			layerId,
		);
	if (!region || region.width * region.height > width * height * 0.6) {
		return run(sourceTex, width, height, excludes);
	}
	const blit = (
		dest: GPUTexture,
		w: number,
		h: number,
		src: GPUTexture,
		at: Rect,
	) => {
		const pass = ctx.renderer.beginFrame(
			encoder,
			dest.createView(),
			{ r: 0, g: 0, b: 0, a: 0 },
			w,
			h,
			"clear",
		);
		ctx.renderer.pushScissor({ x: 0, y: 0, width: w, height: h });
		ctx.renderer.pushIdentity();
		ctx.renderer.drawTexture(pass, src, at, { opacity: 1 });
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
		pass.end();
	};
	const cut = ctx.renderer.getTemporaryTexture(region.width, region.height, [
		sourceTex,
		...excludes,
	]);
	blit(cut, region.width, region.height, sourceTex, {
		x: -region.x,
		y: -region.y,
		width,
		height,
	});
	const fx = await run(cut, region.width, region.height, [
		sourceTex,
		cut,
		...excludes,
	]);
	const out = ctx.renderer.getTemporaryTexture(width, height, [
		fx.texture,
		sourceTex,
		cut,
		...excludes,
	]);
	blit(out, width, height, fx.texture, region);
	return { texture: out, view: out.createView() };
}

async function applyLayerEffects(
	effects: unknown[],
	sourceTex: GPUTexture,
	width: number,
	height: number,
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	props: NodeRenderProps,
	drawChild: WebGPUNodeRendererArgs["drawChild"],
	excludes: GPUTexture[],
	shiftedFrame: number,
	compositionFrame: number,
	fps: number,
	isVideoMode: boolean,
	layerId: string,
): Promise<{ texture: GPUTexture; view: GPUTextureView }> {
	const remainingEffects = effects.filter((e: unknown) => {
		if (!e || typeof e !== "object") return false;
		const op = (e as { op?: string })?.op;
		const name = (e as { constructor?: { name?: string } })?.constructor?.name;
		if (
			op === "TemporalDeflicker" ||
			op === "Deflicker" ||
			op === "Relight3D" ||
			name === "TemporalDeflicker" ||
			name === "Relight3D"
		) {
			return false;
		}
		return true;
	});

	if (remainingEffects.length === 0) {
		return { texture: sourceTex, view: sourceTex.createView() };
	}

	let currentMedia: VirtualMediaData = {
		metadata: { width, height },
		operation: {
			op: "TextureSource",
			sourceTexture: sourceTex,
			dataType: "Image",
		} as unknown as VirtualMediaData["operation"],
		children: [],
	};

	for (let i = 0; i < remainingEffects.length; i++) {
		const eff = remainingEffects[i];
		const effOp =
			eff &&
			typeof (eff as { toOperation?: unknown }).toOperation === "function"
				? (eff as { toOperation: () => Record<string, unknown> }).toOperation()
				: (eff as Record<string, unknown>);
		const opName = String(effOp.op ?? "effect");
		currentMedia = {
			metadata: { width, height },
			operation: {
				op: opName,
				id: `${layerId}-${opName}_${i}`,
				effect: eff,
				...effOp,
				dataType: "Image",
			} as unknown as VirtualMediaData["operation"],
			children: [currentMedia],
		};
	}

	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		sourceTex,
		...excludes,
	]);
	const outView = outTex.createView();

	const clearPass = ctx.renderer.beginFrame(
		encoder,
		outView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	clearPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	try {
		await drawChild(
			currentMedia,
			{
				...props,
				containerWidth: width,
				containerHeight: height,
				renderId: `${props.renderId}-${layerId}-fx`,
				frame: shiftedFrame,
				compositionFrame,
				fps,
				isVideoMode,
				signals: props.signals,
				excludeTextures: [sourceTex, outTex, ...excludes],
			},
			outView,
			outTex,
			width,
			height,
		);
	} finally {
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();
	}

	return { texture: outTex, view: outView };
}

export const CompositorWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const {
		ctx,
		pass,
		targetView,
		targetTexture,
		targetWidth,
		targetHeight,
		encoder,
		props,
		drawChild,
	} = args;
	const { virtualMedia, fps, frame } = props;
	const op = virtualMedia.operation as any;

	if (!op) return;

	// Always end the incoming pass as we will be creating our own
	pass.end();

	if (op.op === "CompositorLayer") {
		console.warn(
			"CompositorWebGPURenderer called directly with legacy CompositorLayer operation. This is a bug.",
		);
		(args as any).pass = ctx.renderer.beginFrame(
			encoder,
			targetView,
			{ r: 0, g: 0, b: 0, a: 0 },
			targetWidth,
			targetHeight,
			"load",
		);
		return;
	}

	if (op.op === "Compositor") {
		const vop = op as CompositorOperation;
		// 4x MSAA in the 3D pass unless the document opts out (antialias3d: false).
		const sampleCount3d = vop.antialias3d === false ? 1 : 4;
		const containerWidth = props.containerWidth ?? ctx.surface.width;
		const containerHeight = props.containerHeight ?? ctx.surface.height;

		const nativeWidth = vop.width ?? containerWidth;
		const nativeHeight = vop.height ?? containerHeight;
		const opacity =
			typeof (vop as any).opacity === "number" ? (vop as any).opacity : 1;

		const isVideoMode =
			props.isVideoMode ??
			(vop.mode === "Video" ||
				vop.dataType === "Video" ||
				virtualMedia?.metadata?.durationMs != null);

		const inheritedSeekOffset = props.inheritedSeekOffset ?? 0;
		const shiftedFrame = Math.max(
			0,
			frame != null && fps != null
				? frame + Math.round(inheritedSeekOffset * fps)
				: (frame ?? 0),
		);
		const compositionFrame = props.compositionFrame ?? shiftedFrame;

		// 1. Create a temporary texture at native resolution
		const compTex = ctx.renderer.getTemporaryTexture(
			nativeWidth,
			nativeHeight,
			[...(props.excludeTextures || []), targetTexture],
		);
		const compView = compTex.createView();

		const composeDuration =
			virtualMedia?.metadata?.durationMs ?? DEFAULT_DURATION_MS;
		const durationSec = composeDuration / 1000;
		const compiled = compileTimeline(props.renderId, virtualMedia as any, {
			fps: fps ?? 24,
			durationSec,
		});
		const { targetsById } = compiled;
		seekTimeline(compiled, shiftedFrame, fps ?? 24);

		const r3d = getRenderer3D(
			ctx.device,
			ctx.renderer.format ?? "rgba8unorm",
			sampleCount3d,
		);
		r3d.resetPools();

		const relightPipe = getScreenSpaceRelightPipeline(
			ctx.device,
			ctx.renderer.format ?? "rgba8unorm",
		);
		relightPipe.resetPools();

		// 2. Initial clear
		const clearColor = parseColor(vop.backgroundColor);
		const clearPass = ctx.renderer.beginFrame(
			encoder,
			compView,
			clearColor,
			nativeWidth,
			nativeHeight,
			"clear",
		);
		clearPass.end();

		// 3. Draw all children into the native texture
		let currentCompTex = compTex;

		ctx.renderer.pushScissor({
			x: 0,
			y: 0,
			width: nativeWidth,
			height: nativeHeight,
		});
		ctx.renderer.pushIdentity();
		// 3. Layout pass — deterministic geometry from the document (v2).
		//    Animated layout props (width/height/gap/padding) are sampled per
		//    frame from the compiled timeline into the tree via targetsById.
		await initLayout();
		const mediaDims = new Map<string, { width: number; height: number }>();
		for (const vm of collectNodeOps(virtualMedia.children)) {
			const lop = vm.operation as any;
			if (lop.kind === "media") {
				const meta = getActiveMediaMetadata(vm.children?.[0] as any);
				if (meta?.width && meta?.height) {
					mediaDims.set(lop.id, { width: meta.width, height: meta.height });
				} else if (
					lop.dataType === "Caption" ||
					(vm.children?.[0]?.operation as any)?.dataType === "Caption" ||
					(vm.children?.[0]?.operation as any)?.srtText !== undefined
				) {
					const lopWidth = targetsById[lop.id]?.width ?? lop.width;
					const autoWidth =
						typeof lopWidth === "number"
							? lopWidth
							: Math.round(nativeWidth * 0.8);
					const lopHeight = targetsById[lop.id]?.height ?? lop.height;
					let autoHeight = typeof lopHeight === "number" ? lopHeight : 160;
					const contentVM = vm.children?.[0];
					const src =
						resolveMediaSourceUrl(contentVM) ??
						(contentVM?.operation as any)?.url ??
						(contentVM?.operation as any)?.src ??
						(contentVM?.operation as any)?.srtText ??
						lop.src ??
						lop.url;
					if (typeof lopHeight !== "number" && src) {
						try {
							const captions = await srtLoader.load(src);
							if (captions && captions.length > 0) {
								autoHeight = measureMaxCaptionHeight(captions, lop, autoWidth);
							}
						} catch {}
					}
					mediaDims.set(lop.id, { width: autoWidth, height: autoHeight });
				}
			}
		}
		const frameResolveNode = (vm: any): LayoutNode => {
			const lop = vm?.operation ?? {};
			const target = targetsById[lop.id];
			const pick = (k: string) =>
				target && target[k] !== undefined ? target[k] : lop[k];
			const node: any = {
				...lop,
				width: pick("width"),
				height: pick("height"),
				gap: pick("gap"),
				padding: pick("padding"),
				fontSize: pick("fontSize"),
				letterSpacing: pick("letterSpacing"),
			};
			node.children = (vm?.children ?? []).map(frameResolveNode);
			if (!node.children.length) node.children = undefined;
			return node;
		};
		const layoutRoots = (): LayoutNode[] =>
			(virtualMedia.children ?? [])
				.map(frameResolveNode)
				.filter(
					(node: any) => node?.kind !== "camera" && node?.kind !== "light",
				);
		const memoTree = virtualMedia.children as object | undefined;
		const memoKey = layoutKey(
			nativeWidth,
			nativeHeight,
			targetsById,
			mediaDims,
		);
		const memo = memoTree ? layoutMemo.get(memoTree) : undefined;
		const { rects } =
			memo?.key === memoKey
				? memo
				: await computeLayout({
						layout: layoutRoots(),
						viewport: { width: nativeWidth, height: nativeHeight },
						measure: (node, constraintWidth) => {
							if (node.kind === "text") {
								const textStyle = {
									fontSize: node.fontSize ?? 48,
									fontWeight: node.fontWeight,
									fontFamily: node.fontFamily,
									letterSpacing: node.letterSpacing,
									lineHeight: node.lineHeight,
									padding: node.padding,
									direction: node.direction,
								};

								if (constraintWidth !== undefined) {
									const isAuto = typeof node.width !== "number";
									const wrapped = measureText(node.text ?? "", {
										...textStyle,
										width: isAuto ? undefined : constraintWidth,
										keepNaturalWidth: true,
									});
									return {
										width: isAuto
											? Math.ceil(wrapped.width)
											: Math.min(constraintWidth, Math.ceil(wrapped.width)),
										height: Math.ceil(wrapped.height),
									};
								}

								const natural = measureText(node.text ?? "", textStyle);
								if (typeof node.width !== "number") {
									return {
										width: Math.ceil(natural.width),
										height: Math.ceil(natural.height),
									};
								}
								const wrapped = measureText(node.text ?? "", {
									...textStyle,
									width: node.width,
								});
								return {
									width: Math.ceil(wrapped.width),
									height: Math.ceil(wrapped.height),
								};
							}
							if (node.kind === "media") return mediaDims.get(node.id) ?? null;
							return null;
						},
					});
		if (memoTree && memo?.key !== memoKey)
			layoutMemo.set(memoTree, { key: memoKey, rects });
		// 4. 3D Camera and Multiplane Setup
		const allNodeOps = collectNodeOps(virtualMedia.children ?? []);
		// A film can cut between cameras: the active one is the camera whose
		// window holds this frame, and the latest to start wins (a cut list).
		const cameraVMs = allNodeOps.filter(
			(vm) => (vm.operation as any)?.kind === "camera",
		);
		const cameraVM = isVideoMode
			? cameraVMs
					.filter((vm) => {
						const op = vm.operation as any;
						const start = op.startFrame ?? 0;
						const dur = op.durationFrames;
						return (
							shiftedFrame >= start &&
							(dur === undefined || shiftedFrame < start + dur)
						);
					})
					.sort(
						(a, b) =>
							((b.operation as any).startFrame ?? 0) -
							((a.operation as any).startFrame ?? 0),
					)[0]
			: cameraVMs[0];
		const lightVMs = allNodeOps.filter(
			(vm) => (vm.operation as any)?.kind === "light",
		);
		const has3DLayer = allNodeOps.some((vm) => {
			const lop = vm.operation as any;
			const target = lop.id ? targetsById[lop.id] : undefined;
			return (
				lop.kind !== "camera" &&
				lop.kind !== "light" &&
				(Boolean(target?.is3D ?? lop.is3D) || (target?.z ?? lop.z ?? 0) !== 0)
			);
		});
		const is3DScene = Boolean(cameraVM || has3DLayer || lightVMs.length > 0);

		let camera: Camera3DPose | null = null;
		let dofEnabled = false;
		const sceneLights: Light3DOptions[] = [];
		let sceneEnvironment: Environment3DOptions | null = null;
		let sceneBloom: BloomOptions | null = null;
		let shadowMapSize: number | undefined;

		if (is3DScene) {
			const camOp = cameraVM?.operation as any;
			const camStub = camOp?.id ? targetsById[camOp.id] : undefined;
			const fov = camStub?.cameraFov ?? camOp?.lens?.fov ?? 50;
			camera = Camera3D.createDefaultCamera(nativeWidth, nativeHeight, fov);
			camera.near = camOp?.lens?.near ?? 1.0;
			camera.far = camOp?.lens?.far ?? 50000.0;
			camera.zoom = camStub?.cameraZoom ?? camOp?.lens?.zoom ?? 1.0;

			const defaultEye = camera.eye;
			const defaultTarget = camera.target;

			// Eye
			const eyeX = camStub?.cameraX ?? camStub?.x ?? camOp?.x ?? defaultEye[0];
			const eyeY = camStub?.cameraY ?? camStub?.y ?? camOp?.y ?? defaultEye[1];
			const eyeZ = camStub?.cameraZ ?? camStub?.z ?? camOp?.z ?? defaultEye[2];
			camera.eye = [eyeX, eyeY, eyeZ];

			// Target
			const hasCustomTarget =
				camStub?.targetX !== undefined ||
				camStub?.targetY !== undefined ||
				camStub?.targetZ !== undefined ||
				camOp?.targetX !== undefined ||
				camOp?.targetY !== undefined ||
				camOp?.targetZ !== undefined;
			if (hasCustomTarget) {
				camera.target = [
					camStub?.targetX ?? camOp?.targetX ?? defaultTarget[0],
					camStub?.targetY ?? camOp?.targetY ?? defaultTarget[1],
					camStub?.targetZ ?? camOp?.targetZ ?? defaultTarget[2],
				];
			} else {
				// Pure truck / pedestal shifts target along with eye
				camera.target = [eyeX, eyeY, 0];
			}

			// Orientation (Pitch / Yaw / Roll)
			const pitch = camStub?.cameraPitch ?? camOp?.pitch ?? 0;
			const yaw = camStub?.cameraYaw ?? camOp?.yaw ?? 0;
			const roll = camStub?.cameraRoll ?? camOp?.roll ?? 0;
			if (pitch !== 0 || yaw !== 0 || roll !== 0) {
				camera = Camera3D.applyOrientation(camera, pitch, yaw, roll);
			}

			// Orbit turntable
			const orbitAzimuth = camStub?.orbitAzimuth;
			const orbitElevation = camStub?.orbitElevation;
			const orbitRadius = camStub?.orbitRadius;
			if (
				orbitAzimuth !== undefined ||
				orbitElevation !== undefined ||
				orbitRadius !== undefined
			) {
				const radius =
					orbitRadius ?? Vector3Math.distance(camera.eye, camera.target);
				camera.eye = Camera3D.orbit(
					camera.target,
					radius,
					orbitAzimuth ?? 0,
					orbitElevation ?? 0,
				);
			}

			// Procedural Handheld Shake
			const shakeTrans =
				camStub?.shakeTranslation ??
				(camOp?.shake?.enabled ? camOp?.shake?.translationAmplitude : 0) ??
				0;
			const shakeRot =
				camStub?.shakeRotation ??
				(camOp?.shake?.enabled ? camOp?.shake?.rotationAmplitude : 0) ??
				0;
			if (shakeTrans > 0 || shakeRot > 0) {
				const t = shiftedFrame / (fps ?? 24);
				camera = Camera3D.applyCameraShake(camera, t, {
					translationAmplitude: shakeTrans,
					rotationAmplitude: shakeRot,
					frequency: camOp?.shake?.frequency ?? 1.5,
					octaves: camOp?.shake?.octaves ?? 3,
					seed: camOp?.shake?.seed ?? 42,
				});
			}

			// Depth of Field
			dofEnabled = Boolean(
				camOp?.dof?.enabled || camStub?.focusDistance !== undefined,
			);
			if (dofEnabled) {
				camera.focusDistance =
					camStub?.focusDistance ??
					camOp?.dof?.focusDistance ??
					Vector3Math.distance(camera.eye, camera.target);
				camera.fStop = camStub?.fStop ?? camOp?.dof?.fStop ?? 2.8;
				camera.maxBlurRadius =
					camStub?.maxBlurRadius ?? camOp?.dof?.maxBlurRadius ?? 24;
			}

			// Collect Active Lights
			for (const lvm of lightVMs) {
				const lop = lvm.operation as any;
				const targetId = lop.id || lop.inputHandleId;
				const target = targetId ? targetsById[targetId] : undefined;
				if (target?.hidden || lop.hidden) continue;

				if (isVideoMode) {
					const startFrame = lop.startFrame ?? 0;
					const durationFrames = lop.durationFrames;
					if (shiftedFrame < startFrame) continue;
					if (
						durationFrames !== undefined &&
						shiftedFrame >= startFrame + durationFrames
					) {
						continue;
					}
				}

				const lightType = (target?.lightType ?? lop.lightType ?? "point") as
					| "ambient"
					| "directional"
					| "point"
					| "spot"
					| "environment";
				if (lightType === "environment") {
					// The scene's world: the last visible one wins.
					const intensity = target?.intensity ?? lop.intensity;
					sceneEnvironment = {
						preset: lop.preset,
						top: lop.top,
						horizon: lop.horizon,
						bottom: lop.bottom,
						softboxes: target?.softboxes ?? lop.softboxes,
						rotation: target?.rotation ?? lop.rotation,
						exposure: target?.exposure ?? lop.exposure,
						toneMapping: lop.toneMapping,
						fog: lop.fog,
						...(intensity !== undefined && { intensity }),
					};
					sceneBloom =
						lop.bloom === true
							? {}
							: lop.bloom && typeof lop.bloom === "object"
								? { ...lop.bloom }
								: null;
					continue;
				}
				const rawColor = target?.color ?? lop.color ?? "#ffffff";
				const color = parseColor(rawColor);
				const intensity = target?.intensity ?? lop.intensity ?? 1.0;
				const x = target?.x ?? lop.x ?? 0;
				const y = target?.y ?? lop.y ?? 0;
				const z = target?.z ?? lop.z ?? 0;
				const targetX = target?.targetX ?? lop.targetX ?? 0;
				const targetY = target?.targetY ?? lop.targetY ?? 0;
				const targetZ = target?.targetZ ?? lop.targetZ ?? 0;
				const radius = target?.radius ?? lop.radius ?? 1000;
				const angle = target?.angle ?? lop.angle ?? 45;
				const penumbra = target?.penumbra ?? lop.penumbra ?? 0.2;
				const decay = target?.decay ?? lop.decay ?? 1;

				sceneLights.push({
					type: lightType,
					color,
					intensity,
					position: [x, y, z],
					target: [targetX, targetY, targetZ],
					radius,
					angle,
					penumbra,
					decay,
					castShadow: Boolean(lop.castShadow),
					shadowSoftness: target?.shadowSoftness ?? lop.shadowSoftness,
					shadowDarkness: target?.shadowDarkness ?? lop.shadowDarkness,
				});
				if (lop.castShadow && lop.shadowMapSize) {
					shadowMapSize = lop.shadowMapSize;
				}
			}
		}

		type Pending3DItem =
			| { kind: "quad"; texture: GPUTexture; opts: DrawQuad3DOpts }
			| {
					// A text layer's glyphs, drawn natively on its plane.
					kind: "slug";
					texture?: undefined;
					batches: SlugGlyphBatch[];
					opts: DrawQuad3DOpts;
					/** Passes already on this plane (its backdrop quad) */
					stackBase: number;
			  }
			| {
					kind: "mesh";
					mesh: Mesh3DData;
					texture?: GPUTexture;
					opts: DrawMesh3DOpts;
					meshBuffers?: GPUMeshBuffers;
			  };
		const pending3DItems: Pending3DItem[] = [];
		/** Textures the queued 3D items still read: their layers and mattes. */
		const pendingTextures = (): GPUTexture[] =>
			pending3DItems
				.flatMap((q) => [q.texture, q.opts.matte])
				.filter((t): t is GPUTexture => Boolean(t));

		const flush3DPass = (
			curTex: GPUTexture,
			curView: GPUTextureView,
			curExcludes: GPUTexture[],
		): { finalTex: GPUTexture; finalView: GPUTextureView } => {
			if (pending3DItems.length === 0 || !camera) {
				return { finalTex: curTex, finalView: curView };
			}

			const r3d = getRenderer3D(
				ctx.device,
				ctx.renderer.format ?? "rgba8unorm",
				sampleCount3d,
			);

			// Execute audio mesh deformation compute passes before beginning render pass
			for (const item of pending3DItems) {
				if (item.kind === "mesh" && item.opts.audioDeform) {
					item.meshBuffers = r3d.deformMesh(
						encoder,
						item.mesh,
						item.opts.audioDeform,
						item.opts.wireframe,
					);
				}
			}

			const itemTextures = pendingTextures();

			const scene3dTex = ctx.renderer.getTemporaryTexture(
				nativeWidth,
				nativeHeight,
				[curTex, targetTexture, ...curExcludes, ...itemTextures],
			);
			const scene3dView = scene3dTex.createView();

			let linearDepthTex: GPUTexture | undefined;
			let linearDepthView: GPUTextureView | undefined;
			if (dofEnabled) {
				linearDepthTex = r3d.getOrCreateLinearDepthTexture(
					nativeWidth,
					nativeHeight,
				);
				linearDepthView = linearDepthTex.createView();
			}

			// Shadow map from the first castShadow light: meshes cast unless
			// they opt out, flat layers only when they opt in; everything
			// in the pass can receive.
			let shadow: ReturnType<typeof r3d.renderShadowMap> = null;
			const casterIndex = Light3D.shadowCasterIndex(sceneLights);
			if (casterIndex >= 0) {
				const casters: ShadowCaster3D[] = [];
				const receivers: ReturnType<typeof r3d.worldBounds>[] = [];
				for (const item of pending3DItems) {
					if (item.kind === "mesh") {
						const caster: ShadowCaster3D = {
							kind: "mesh",
							mesh: item.mesh,
							buffers: item.meshBuffers,
							opts: item.opts,
						};
						receivers.push(r3d.worldBounds(caster));
						if (
							item.opts.castShadow !== false &&
							item.opts.material !== "unlit"
						) {
							casters.push(caster);
						}
					} else if (item.kind === "quad") {
						const caster: ShadowCaster3D = {
							kind: "quad",
							texture: item.texture,
							opts: item.opts,
						};
						receivers.push(r3d.worldBounds(caster));
						if (item.opts.castShadow === true) casters.push(caster);
					}
				}
				const shadowLight = sceneLights.filter(
					(l) => (l.lightType ?? l.type) !== "ambient",
				)[casterIndex];
				if (shadowLight && casters.length > 0) {
					shadow = r3d.renderShadowMap(
						encoder,
						shadowLight,
						casterIndex,
						casters,
						receivers,
						{ mapSize: shadowMapSize },
					);
				}
			}

			const {
				pass: pass3d,
				cameraBindGroup,
				cameraBuffer,
				lightsBindGroup,
			} = r3d.beginPass(
				encoder,
				scene3dView,
				nativeWidth,
				nativeHeight,
				camera,
				"clear",
				{ r: 0, g: 0, b: 0, a: 0 },
				linearDepthView,
				sceneLights,
				{ environment: sceneEnvironment, shadow },
				Boolean(sceneBloom),
			);

			// Glass reads what is behind the batch (the canvas so far), and goes
			// last so opaque meshes are already in the depth buffer.
			const isGlass = (item: Pending3DItem) =>
				item.kind === "mesh" &&
				(item.opts.material === "glass" ||
					item.opts.material === "acrylic" ||
					item.opts.material === "frosted");
			const ordered = [
				...pending3DItems.filter((i) => !isGlass(i)),
				...pending3DItems.filter(isGlass),
			];
			for (const item of ordered) {
				if (item.kind === "quad") {
					r3d.drawTextureQuad(
						pass3d,
						cameraBindGroup,
						lightsBindGroup,
						item.texture,
						item.opts,
						dofEnabled,
					);
				} else if (item.kind === "slug") {
					r3d.drawSlugText(
						pass3d,
						cameraBindGroup,
						lightsBindGroup,
						item.batches,
						item.opts,
						item.stackBase,
						dofEnabled,
					);
				} else if (item.kind === "mesh") {
					r3d.drawMesh3D(
						pass3d,
						cameraBindGroup,
						lightsBindGroup,
						item.meshBuffers ?? item.mesh,
						item.texture,
						isGlass(item) ? { ...item.opts, backdrop: curTex } : item.opts,
						dofEnabled,
					);
				}
			}

			pass3d.end();

			let final3dTex = scene3dTex;
			if (dofEnabled && linearDepthTex) {
				const dofResultTex = ctx.renderer.getTemporaryTexture(
					nativeWidth,
					nativeHeight,
					[curTex, targetTexture, scene3dTex, ...curExcludes],
				);
				r3d.applyDepthOfField(
					encoder,
					scene3dTex,
					linearDepthTex,
					dofResultTex.createView(),
					cameraBuffer,
				);
				final3dTex = dofResultTex;
			}

			if (sceneBloom) {
				const bloomTex = ctx.renderer.getTemporaryTexture(
					nativeWidth,
					nativeHeight,
					[curTex, targetTexture, final3dTex, scene3dTex, ...curExcludes],
				);
				r3d.applyBloom(
					encoder,
					final3dTex,
					bloomTex,
					sceneBloom,
					r3d.hdrSource(),
				);
				final3dTex = bloomTex;
			}

			const nextTex = ctx.renderer.composite(
				encoder,
				curTex,
				final3dTex,
				"normal",
				[targetTexture, ...curExcludes],
			);
			pending3DItems.length = 0;
			return { finalTex: nextTex, finalView: nextTex.createView() };
		};

		// 5. Draw the node tree into the native texture (z-sorted per level).
		let nodeIndex = 0;

		/**
		 * True when every child of a rounded box sits where the rounding can't
		 * touch it (inside the inset at which the corner arcs meet 45°), as laid
		 * out and moved this frame, untransformed and without effects of its own.
		 */
		const childrenClearOfCorners = (
			children: VirtualMediaData[],
			box: Rect,
			radius: number,
		): boolean => {
			const k = radius * (1 - Math.SQRT1_2);
			for (const child of children) {
				const cop = child.operation as Record<string, any> | undefined;
				if (!cop) return false;
				const t = targetsById[cop.id || cop.inputHandleId] as
					| Record<string, any>
					| undefined;
				if (t?.hidden || cop.hidden) continue;
				const r = rects[cop.id];
				if (!r) return false;
				const v = (key: string, d: number) =>
					(t?.[key] ?? cop[key] ?? d) as number;
				if (
					v("scale", 1) !== 1 ||
					v("scaleX", 1) !== 1 ||
					v("scaleY", 1) !== 1 ||
					v("rotation", 0) !== 0 ||
					v("rotateX", 0) !== 0 ||
					v("rotateY", 0) !== 0
				)
					return false;
				if (Array.isArray(cop.effects) && cop.effects.length > 0) return false;
				if ((t?.animators ?? cop.animators)?.length) return false;
				const x = r.x - box.x + (v("x", 0) - (cop.x ?? 0));
				const y = r.y - box.y + (v("y", 0) - (cop.y ?? 0));
				if (
					x < k ||
					y < k ||
					x + r.width > box.width - k ||
					y + r.height > box.height - k
				)
					return false;
			}
			return true;
		};

		const renderNodeTree = async (
			vms: VirtualMediaData[],
			initialTex: GPUTexture,
			initialView: GPUTextureView,
			excludes: GPUTexture[],
			accumulatedOpacity = 1.0,
			parentMatrix = new DOMMatrix(),
			parentRect: Rect | null = null,
			targetW: number = nativeWidth,
			targetH: number = nativeHeight,
			parent3DMatrix: Mat4 | null = null,
			isRootScene = false,
		): Promise<{ finalTex: GPUTexture; finalView: GPUTextureView }> => {
			const sorted = [...vms].sort((a, b) => {
				const za = (a.operation as any)?.zIndex ?? 0;
				const zb = (b.operation as any)?.zIndex ?? 0;
				return za - zb;
			});
			let activeTex = initialTex;
			let activeView = initialView;
			let activeExcludes = excludes;
			// Matte layers are not drawn on their own: their owner draws them.
			const mattesByOwner = new Map<string, VirtualMediaData>();
			for (const vm of vms) {
				const owner = (vm.operation as any)?.matteOf;
				if (owner) mattesByOwner.set(owner, vm);
			}
			for (const child of sorted) {
				const lop = child.operation as any;
				if (lop.kind === "camera" || lop.kind === "light") continue;
				if (lop.matteOf) continue;
				const targetId = lop.id || lop.inputHandleId;
				const target = targetId ? targetsById[targetId] : undefined;
				const isChild3D =
					Boolean(target?.is3D ?? lop.is3D) ||
					Boolean(camera && ((target?.z ?? lop.z ?? 0) !== 0 || lop.is3D)) ||
					Boolean(parent3DMatrix);

				if (isRootScene && !isChild3D && pending3DItems.length > 0) {
					const flushed = flush3DPass(activeTex, activeView, activeExcludes);
					if (flushed.finalTex !== activeTex) {
						activeExcludes = [...activeExcludes, flushed.finalTex];
					}
					activeTex = flushed.finalTex;
					activeView = flushed.finalView;
				}

				if (lop.op !== "CompositorLayer") {
					await drawChild(
						child,
						{
							containerWidth: targetW,
							containerHeight: targetH,
							renderId: `${props.renderId}-c${nodeIndex}-${lop.op}`,
							fps,
							isVideoMode,
							frame: shiftedFrame,
							compositionFrame,
							// The child's effect passes must not borrow textures still in use here.
							excludeTextures: [targetTexture, ...activeExcludes],
						},
						activeView,
						activeTex,
						targetW,
						targetH,
					);
					continue;
				}
				nodeIndex += 1;
				const matteVM = lop.matteId ? mattesByOwner.get(lop.id) : undefined;
				if (matteVM) {
					// Draws a layer alone on transparent. 3D content it queues is
					// rendered into it right away, in a pass of its own.
					const isolate = async (vm: VirtualMediaData, index: number) => {
						const queued = pending3DItems.splice(0);
						const busy = [
							targetTexture,
							activeTex,
							...activeExcludes,
							...queued.flatMap((q) => [q.texture, q.opts.matte]),
						].filter((t): t is GPUTexture => Boolean(t));
						const tex = ctx.renderer.getTemporaryTexture(
							targetW,
							targetH,
							busy,
						);
						const view = tex.createView();
						ctx.renderer
							.beginFrame(
								encoder,
								view,
								{ r: 0, g: 0, b: 0, a: 0 },
								targetW,
								targetH,
								"clear",
							)
							.end();
						const out = await renderLayerVM(
							vm,
							index,
							tex,
							view,
							busy.filter((t) => t !== targetTexture),
							accumulatedOpacity,
							parentMatrix,
							parentRect,
							targetW,
							targetH,
							parent3DMatrix,
							false,
						);
						const drawn = out?.finalTex ?? tex;
						const flat = flush3DPass(drawn, drawn.createView(), busy).finalTex;
						pending3DItems.push(...queued);
						return flat;
					};
					const mode: string = (matteVM.operation as any).matteMode ?? "alpha";
					const blend =
						mode === "luma"
							? "luma-in"
							: mode === "luma-inverted"
								? "luma-out"
								: mode === "alpha-inverted"
									? "destination-out"
									: "destination-in";

					if (isChild3D) {
						// A 3D layer is matted inside the 3D pass, so it keeps its
						// depth against the rest of the scene: the matte is resolved
						// to screen coverage, and everything the owner queues shows
						// only where that coverage does.
						let coverage = await isolate(matteVM, nodeIndex);
						activeExcludes = [...activeExcludes, coverage];
						nodeIndex += 1;
						if (mode !== "alpha") {
							const white = ctx.renderer.getTemporaryTexture(targetW, targetH, [
								targetTexture,
								activeTex,
								...activeExcludes,
								...pendingTextures(),
							]);
							ctx.renderer
								.beginFrame(
									encoder,
									white.createView(),
									{ r: 1, g: 1, b: 1, a: 1 },
									targetW,
									targetH,
									"clear",
								)
								.end();
							coverage = ctx.renderer.composite(
								encoder,
								white,
								coverage,
								blend,
								[
									targetTexture,
									activeTex,
									...activeExcludes,
									...pendingTextures(),
									white,
								],
							);
							activeExcludes = [...activeExcludes, coverage];
						}
						const before = pending3DItems.length;
						const res = await renderLayerVM(
							child,
							nodeIndex,
							activeTex,
							activeView,
							activeExcludes,
							accumulatedOpacity,
							parentMatrix,
							parentRect,
							targetW,
							targetH,
							parent3DMatrix,
							isRootScene,
						);
						for (const item of pending3DItems.slice(before)) {
							item.opts.matte = coverage;
						}
						if (res) {
							if (res.finalTex !== activeTex) {
								activeExcludes = [...activeExcludes, res.finalTex];
							}
							activeTex = res.finalTex;
							activeView = res.finalView;
						}
						continue;
					}

					// Track matte: owner and matte each drawn alone, then the
					// owner keeps only what the matte's alpha / brightness allows.
					const contentTex = await isolate(child, nodeIndex);
					activeExcludes = [...activeExcludes, contentTex];
					nodeIndex += 1;
					const matteTex = await isolate(matteVM, nodeIndex);
					const masked = ctx.renderer.composite(
						encoder,
						contentTex,
						matteTex,
						blend,
						[targetTexture, activeTex, ...activeExcludes, matteTex],
					);
					const next = ctx.renderer.composite(
						encoder,
						activeTex,
						masked,
						"normal",
						[targetTexture, ...activeExcludes, matteTex],
					);
					activeExcludes = [...activeExcludes, next];
					activeTex = next;
					activeView = next.createView();
					continue;
				}
				const res = await renderLayerVM(
					child,
					nodeIndex,
					activeTex,
					activeView,
					activeExcludes,
					accumulatedOpacity,
					parentMatrix,
					parentRect,
					targetW,
					targetH,
					parent3DMatrix,
					isRootScene,
				);
				if (res) {
					if (res.finalTex !== activeTex) {
						activeExcludes = [...activeExcludes, res.finalTex];
					}
					activeTex = res.finalTex;
					activeView = res.finalView;
				}
			}

			if (isRootScene && pending3DItems.length > 0) {
				const flushed = flush3DPass(activeTex, activeView, activeExcludes);
				if (flushed.finalTex !== activeTex) {
					activeExcludes = [...activeExcludes, flushed.finalTex];
				}
				activeTex = flushed.finalTex;
				activeView = flushed.finalView;
			}
			return { finalTex: activeTex, finalView: activeView };
		};

		const renderLayerVM = async (
			nodeVM: VirtualMediaData,
			i: number,
			destTex: GPUTexture,
			destView: GPUTextureView,
			baseExcludes: GPUTexture[],
			accumulatedOpacity: number,
			parentMatrix: DOMMatrix,
			parentRect: Rect | null,
			targetW: number = nativeWidth,
			targetH: number = nativeHeight,
			parent3DMatrix: Mat4 | null = null,
			isRootScene = false,
		): Promise<
			{ finalTex: GPUTexture; finalView: GPUTextureView } | undefined
		> => {
			// Textures queued for the pending 3D flush are still live: a later
			// layer of the same size must not be handed one from the pool.
			const excludes = [...baseExcludes, ...pendingTextures()];
			const lop = nodeVM.operation as any;
			if (lop.kind === "camera" || lop.kind === "light") return;
			const targetId = lop.id || lop.inputHandleId;
			const target = targetId ? targetsById[targetId] : undefined;
			if (target?.hidden || lop.hidden) return;

			const kind = lop.kind;
			const isContainer = kind === "flex" || kind === "block" || kind === "box";

			// Temporal gate (video mode): clip-relative duration.
			if (isVideoMode) {
				const startFrame = lop.startFrame ?? 0;
				const durationFrames = lop.durationFrames;
				if (shiftedFrame < startFrame) {
					return;
				}
				if (
					durationFrames !== undefined &&
					shiftedFrame >= startFrame + durationFrames
				) {
					return;
				}
			}
			if (kind === "model3d") {
				const r3d = getRenderer3D(
					ctx.device,
					ctx.renderer.format ?? "rgba8unorm",
					sampleCount3d,
				);
				let modelSrc = lop.modelData ?? lop.src;

				if (!modelSrc && lop.text3dOptions) {
					// The node's Layer3D.extrudedText options: geometry options plus a family name.
					const tOpts = lop.text3dOptions as Omit<
						ExtrudedTextGeometryOptions,
						"font"
					> & { fontFamily?: string };
					const font =
						(tOpts.fontFamily
							? SlugFontCache.getParsed(tOpts.fontFamily)
							: null) ??
						SlugFontCache.getParsed("Inter") ??
						SlugFontCache.getParsed("Unbounded") ??
						SlugFontCache.getFirstParsed();
					if (font) {
						const res = generateExtrudedTextGeometry({
							...tOpts,
							// SlugFontCache holds fontkit fonts under a narrower type.
							font: font as unknown as ExtrudedTextGeometryOptions["font"],
						});
						modelSrc = res.modelData;
						lop.modelData = modelSrc;
					}
				}

				if (!modelSrc && lop.primitive3d) {
					modelSrc = getPrimitiveGeometry(
						lop.primitive3d as PrimitiveGeometryOptions,
					);
					lop.modelData = modelSrc;
				}

				if (!modelSrc) return;

				let model: Model3DData | undefined;
				try {
					model =
						typeof modelSrc === "object" &&
						modelSrc !== null &&
						"meshes" in modelSrc
							? (modelSrc as Model3DData)
							: r3d.loadModel(modelSrc, lop.modelFormat ?? "auto", {
									center: lop.center,
									normalizeSize: lop.normalizeSize,
								});
				} catch (err) {
					console.error("Failed to load 3D model:", err);
					return;
				}

				if (!model || model.meshes.length === 0) return;

				const baseX = lop.x ?? 0;
				const baseY = lop.y ?? 0;
				const sampledX = target?.x ?? baseX;
				const sampledY = target?.y ?? baseY;
				const posZ = target?.z ?? lop.z ?? 0;

				let posX = sampledX;
				let posY = sampledY;

				if (!parent3DMatrix) {
					// Models are not laid out by x / y (they sit in flow), so their
					// own x / y are parent-local: map them through the parent.
					const pos = resolveLayer2DPosition({
						rect: null,
						parentRect: null,
						baseX,
						baseY,
						sampledX,
						sampledY,
						parentMatrix,
					});
					posX = pos.x;
					posY = pos.y;
				}

				const rotX = target?.rotateX ?? lop.rotateX ?? 0;
				const rotY = target?.rotateY ?? lop.rotateY ?? 0;
				const rotZ =
					(target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
						? (target?.rotateZ ?? lop.rotateZ ?? 0)
						: (target?.rotation ?? lop.rotation ?? 0);

				const sc = target?.scale ?? lop.scale ?? 1;
				const scX = (target?.scaleX ?? lop.scaleX ?? 1) * sc;
				const scY = (target?.scaleY ?? lop.scaleY ?? 1) * sc;
				const scZ = (target?.scaleZ ?? lop.scaleZ ?? 1) * sc;

				let localM = Matrix4Math.identity();
				localM = Matrix4Math.multiply(
					localM,
					Matrix4Math.translate(posX, posY, posZ),
				);

				const rxRad = (rotX * Math.PI) / 180;
				const ryRad = (rotY * Math.PI) / 180;
				const rzRad = (rotZ * Math.PI) / 180;

				if (rzRad !== 0)
					localM = Matrix4Math.multiply(localM, Matrix4Math.rotateZ(rzRad));
				if (ryRad !== 0)
					localM = Matrix4Math.multiply(localM, Matrix4Math.rotateY(ryRad));
				if (rxRad !== 0)
					localM = Matrix4Math.multiply(localM, Matrix4Math.rotateX(rxRad));

				localM = Matrix4Math.multiply(localM, Matrix4Math.scale(scX, scY, scZ));

				const finalModelMatrix = parent3DMatrix
					? Matrix4Math.multiply(parent3DMatrix, localM)
					: localM;

				const colorParsed =
					target?.colorTint || target?.color || lop.colorTint || lop.color
						? parseColor(
								target?.colorTint ??
									target?.color ??
									lop.colorTint ??
									lop.color,
							)
						: undefined;

				const colorTint: [number, number, number, number] = colorParsed
					? [colorParsed.r, colorParsed.g, colorParsed.b, colorParsed.a]
					: [1, 1, 1, 1];

				const modelOpacity =
					(target?.opacity ?? lop.opacity ?? 1) * accumulatedOpacity;

				// Animation evaluation
				let skinningMatrices: Float32Array | undefined;
				const animProgress =
					target?.animationProgress ?? lop.animationProgress ?? 0;
				const animTime = target?.animationTime ?? lop.animationTime ?? 0;
				const animSpeed = target?.animationSpeed ?? lop.animationSpeed ?? 1.0;
				const clip =
					(lop.animationName
						? model.animations.find((a) => a.name === lop.animationName)
						: undefined) ?? model.animations[0];
				let clipSec = 0;
				if (clip && clip.duration > 0) {
					clipSec =
						animProgress > 0
							? animProgress * clip.duration
							: animTime + ((shiftedFrame ?? 0) / (fps || 30)) * animSpeed;
					if (lop.loop ?? true) clipSec %= clip.duration;
				}

				// A scene graph (glTF) is posed node by node: unskinned meshes ride
				// their node, skinned ones take their skin's joint matrices.
				const sceneRoot = Matrix4Math.multiply(
					finalModelMatrix,
					model.rootTransform ?? Matrix4Math.identity(),
				);
				const posed = model.nodes ? poseNodes(model, clip, clipSec) : undefined;
				const skinCache = new Map<number, Float32Array>();
				const placeMesh = (
					mesh: Mesh3DData,
				): { matrix: Mat4; joints?: Float32Array } => {
					if (!posed) return { matrix: sceneRoot };
					if (mesh.skin !== undefined) {
						let joints = skinCache.get(mesh.skin);
						if (!joints) {
							joints = jointMatrices(model, mesh.skin, posed);
							skinCache.set(mesh.skin, joints);
						}
						return { matrix: sceneRoot, joints };
					}
					if (mesh.node !== undefined)
						return {
							matrix: Matrix4Math.multiply(sceneRoot, posed[mesh.node]!),
						};
					return { matrix: sceneRoot };
				};

				if (!posed && clip && clip.duration > 0) {
					const currentSec = clipSec;
					if (model.skeleton && model.skeleton.bones.length > 0) {
						const numBones = Math.min(128, model.skeleton.bones.length);
						skinningMatrices = new Float32Array(128 * 16);
						for (let b = 0; b < 128; b++) {
							skinningMatrices[b * 16] = 1;
							skinningMatrices[b * 16 + 5] = 1;
							skinningMatrices[b * 16 + 10] = 1;
							skinningMatrices[b * 16 + 15] = 1;
						}

						for (const track of clip.tracks) {
							const boneIdx = model.skeleton.boneIndicesByName[track.nodeName];
							if (boneIdx !== undefined && boneIdx < numBones) {
								const times = track.times;
								let sampleIdx = 0;
								for (let k = 0; k < times.length - 1; k++) {
									if (currentSec >= times[k]! && currentSec <= times[k + 1]!) {
										sampleIdx = k;
										break;
									}
								}
								const t0 = times[sampleIdx] ?? 0;
								const t1 = times[sampleIdx + 1] ?? t0;
								const alpha = t1 > t0 ? (currentSec - t0) / (t1 - t0) : 0;

								if (track.translations) {
									const x0 = track.translations[sampleIdx * 3] ?? 0;
									const y0 = track.translations[sampleIdx * 3 + 1] ?? 0;
									const z0 = track.translations[sampleIdx * 3 + 2] ?? 0;
									const x1 = track.translations[(sampleIdx + 1) * 3] ?? x0;
									const y1 = track.translations[(sampleIdx + 1) * 3 + 1] ?? y0;
									const z1 = track.translations[(sampleIdx + 1) * 3 + 2] ?? z0;
									const curX = x0 + (x1 - x0) * alpha;
									const curY = y0 + (y1 - y0) * alpha;
									const curZ = z0 + (z1 - z0) * alpha;

									const boneMat = Matrix4Math.translate(curX, curY, curZ);
									const bone = model.skeleton.bones[boneIdx];
									const skinMat = bone
										? Matrix4Math.multiply(boneMat, bone.inverseBindMatrix)
										: boneMat;
									skinningMatrices.set(skinMat, boneIdx * 16);
								}
							}
						}
					}
				}

				// Blended materials draw after everything opaque behind them.
				const isBlend = (m: Mesh3DData) =>
					m.materialName
						? model.materials[m.materialName]?.alphaMode === "blend"
						: false;
				const drawOrder = [...model.meshes].sort(
					(a, b) => Number(isBlend(a)) - Number(isBlend(b)),
				);
				for (const mesh of drawOrder) {
					const mat = mesh.materialName
						? model.materials[mesh.materialName]
						: undefined;
					const placed = placeMesh(mesh);
					const meshSkin = placed.joints ?? skinningMatrices;

					let meshColorTint: [number, number, number, number];
					if (colorParsed) {
						if (mat?.diffuseColor) {
							meshColorTint = [
								mat.diffuseColor[0] * colorTint[0],
								mat.diffuseColor[1] * colorTint[1],
								mat.diffuseColor[2] * colorTint[2],
								(mat.diffuseColor[3] ?? 1.0) * colorTint[3],
							];
						} else {
							meshColorTint = colorTint;
						}
					} else if (mat?.diffuseColor) {
						meshColorTint = mat.diffuseColor;
					} else {
						meshColorTint = [0.8, 0.8, 0.85, 1.0];
					}

					// Audio latent 3D mesh deformation
					const audioDeformConfig = (target?.audioDeform ?? lop.audioDeform) as
						| MeshAudioDeformConfig
						| undefined;

					let meshAudioDeform: DrawMesh3DOpts["audioDeform"];
					if (audioDeformConfig) {
						const currentSec = (shiftedFrame ?? 0) / (fps || 30);
						const timeMs = currentSec * 1000;

						let latentBuffer = (audioDeformConfig as any).latentBuffer as
							| GPUBuffer
							| undefined;
						if (!latentBuffer && (audioDeformConfig as any).audioBuffer) {
							latentBuffer = (audioDeformConfig as any)
								.audioBuffer as GPUBuffer;
						}

						if (!latentBuffer) {
							const directAudio = (audioDeformConfig as any).audioData as
								| Float32Array[]
								| { channels: Float32Array[]; sampleRate: number }
								| undefined;

							if (directAudio) {
								const cacheKey = (lop.id ?? "audio-mesh") + "-direct-audio";
								let trackCache = audioTrackLatentCache.get(cacheKey);
								if (!trackCache) {
									const chs = Array.isArray(directAudio)
										? directAudio
										: directAudio.channels;
									const sRate = Array.isArray(directAudio)
										? 48000
										: directAudio.sampleRate;
									const totalF = Math.max(
										10,
										Math.ceil(((chs[0]?.length ?? 0) / sRate) * (fps || 30)) +
											10,
									);
									trackCache = new AudioLatentTrackCache(
										chs,
										sRate,
										fps || 30,
										totalF,
									);
									audioTrackLatentCache.set(cacheKey, trackCache);
								}
								latentBuffer = trackCache.getGpuBuffer(
									ctx.device,
									shiftedFrame ?? 0,
								);
							}
						}

						if (!latentBuffer && audioDeformConfig.audioTrackId) {
							const trackId = audioDeformConfig.audioTrackId;
							let foundAudioUrl: string | undefined;
							const searchVms = (list: VirtualMediaData[]) => {
								for (const v of list) {
									const op = v.operation as Record<string, unknown> | undefined;
									if (op) {
										if (op.id === trackId || op.inputHandleId === trackId) {
											foundAudioUrl =
												(op.inputHandleId as string) ||
												(op.src as string) ||
												(op.url as string);
											return;
										}
										if (v.children) searchVms(v.children);
									}
								}
							};
							if (virtualMedia.children) searchVms(virtualMedia.children);
							if (
								!foundAudioUrl &&
								(trackId.endsWith(".mp3") ||
									trackId.endsWith(".wav") ||
									trackId.endsWith(".ogg"))
							) {
								foundAudioUrl = trackId;
							}

							if (foundAudioUrl) {
								try {
									let trackCache = audioTrackLatentCache.get(foundAudioUrl);
									if (!trackCache) {
										const decoded = await decodeAudioSource(foundAudioUrl);
										if (decoded && decoded.channels.length > 0) {
											const sRate = decoded.sampleRate || 48000;
											const ch0Len = decoded.channels[0]?.length ?? 0;
											const durationSec =
												(decoded as any).durationSec ?? ch0Len / sRate;
											const totalF = Math.max(
												10,
												Math.ceil(durationSec * (fps || 30)) + 10,
											);
											trackCache = new AudioLatentTrackCache(
												decoded.channels,
												sRate,
												fps || 30,
												totalF,
											);
											audioTrackLatentCache.set(foundAudioUrl, trackCache);
										}
									}
									if (trackCache) {
										latentBuffer = trackCache.getGpuBuffer(
											ctx.device,
											shiftedFrame ?? 0,
										);
									}
								} catch (err) {
									console.warn(
										"[webgpu-renderer] Failed to decode audio for deformWithAudio:",
										err,
									);
								}
							}
						}

						if (latentBuffer) {
							let amplitudeMultiplier =
								audioDeformConfig.amplitudeMultiplier ?? 1.0;
							if (
								typeof amplitudeMultiplier !== "number" &&
								typeof (amplitudeMultiplier as any)?.get === "function"
							) {
								const frameCtx = {
									frame: shiftedFrame ?? 0,
									fps: fps || 30,
									time: currentSec,
									duration: 0,
									durationMs: 0,
									progress: 0,
									deltaTime: 1 / (fps || 30),
								};
								amplitudeMultiplier = Number(
									(amplitudeMultiplier as any).get(frameCtx),
								);
							} else if (
								typeof amplitudeMultiplier !== "number" &&
								typeof (amplitudeMultiplier as any)?.value === "number"
							) {
								amplitudeMultiplier = (amplitudeMultiplier as any).value;
							}

							meshAudioDeform = {
								config: {
									...audioDeformConfig,
									amplitudeMultiplier: Number.isFinite(
										amplitudeMultiplier as number,
									)
										? (amplitudeMultiplier as number)
										: 1.0,
								},
								latentBuffer,
								timeMs,
								sampleRate: 48000,
							};
						}
					}

					const meshOpts: DrawMesh3DOpts = {
						modelMatrix: placed.matrix,
						opacity: modelOpacity * (mat?.opacity ?? 1.0),
						colorTint: meshColorTint,
						twoSided: target?.twoSided ?? lop.twoSided ?? mat?.twoSided ?? true,
						wireframe: Boolean(target?.wireframe ?? lop.wireframe),
						isSkinned: Boolean(
							meshSkin || (mesh.jointIndices && mesh.jointWeights),
						),
						skinningMatrices: meshSkin,
						material: target?.material ?? lop.material ?? mat?.shading ?? "lit",
						shadeColor: mat?.shadeColor,
						alphaCutoff: mat?.alphaCutoff,
						textureWrap: mat?.textureWrap,
						textureFilter: mat?.textureFilter,
						shininess:
							target?.shininess ?? lop.shininess ?? mat?.shininess ?? 32,
						roughness: target?.roughness ?? lop.roughness ?? mat?.roughness,
						specularIntensity:
							target?.specularIntensity ?? lop.specularIntensity ?? 0.5,
						ambientIntensity:
							target?.ambientIntensity ?? lop.ambientIntensity ?? 1.0,
						metallic: target?.metallic ?? lop.metallic ?? mat?.metallic,
						...surfaceProps(target, lop, mat),
						ior: target?.ior ?? lop.ior,
						dispersion: target?.dispersion ?? lop.dispersion,
						thickness: target?.thickness ?? lop.thickness,
						audioDeform: meshAudioDeform,
					};

					if (mat) meshOpts.maps = await r3d.materialMaps(mat);
					pending3DItems.push({
						kind: "mesh",
						mesh,
						texture: mat ? await r3d.materialTexture(mat) : undefined,
						opts: meshOpts,
					});
				}

				return { finalTex: destTex, finalView: destView };
			}

			const rect = rects[lop.id];
			if (!rect) {
				if (isContainer) {
					return await renderNodeTree(
						nodeVM.children ?? [],
						destTex,
						destView,
						excludes,
						accumulatedOpacity,
						parentMatrix,
						parentRect,
						targetW,
						targetH,
						parent3DMatrix,
						isRootScene,
					);
				}
				return;
			}

			// Affine = layout rect + animated delta (CSS-transform semantics: a
			// track on x/y translates the node within/out of its laid-out slot).
			const baseX = lop.x ?? 0;
			const baseY = lop.y ?? 0;
			const sampledX = target?.x ?? baseX;
			const sampledY = target?.y ?? baseY;

			let localX = 0;
			let localY = 0;
			if (parentRect) {
				const localLayoutX = rect.x - parentRect.x;
				const localLayoutY = rect.y - parentRect.y;
				localX = localLayoutX + (sampledX - baseX);
				localY = localLayoutY + (sampledY - baseY);
			} else {
				localX = rect.x + (sampledX - baseX);
				localY = rect.y + (sampledY - baseY);
			}

			const scale = target?.scale ?? lop.scale ?? 1;
			const scaleX = target?.scaleX ?? lop.scaleX ?? 1;
			const scaleY = target?.scaleY ?? lop.scaleY ?? 1;
			const rotation = target?.rotation ?? lop.rotation ?? 0;
			const layerOpacity =
				(target?.opacity ?? lop.opacity ?? 1) * accumulatedOpacity;

			const rawAnimators = target?.animators ?? lop.animators;
			const isPathText =
				kind === "text" && Boolean(lop.pathOptions || target?.pathOptions);
			const hasKineticAnimators =
				kind === "text" &&
				Array.isArray(rawAnimators) &&
				rawAnimators.length > 0;
			const hasFormation =
				kind === "text" &&
				Array.isArray(rawAnimators) &&
				rawAnimators.some((a: unknown) => {
					const anim = a as
						| {
								props?: { formation?: unknown };
								formation?: unknown;
						  }
						| null
						| undefined;
					return (
						anim?.props?.formation !== undefined ||
						anim?.formation !== undefined
					);
				});
			let padX = 0;
			let padY = 0;
			if (hasFormation) {
				let formationRadius = 0;
				let formationPitch = 0;
				for (const a of rawAnimators as unknown[]) {
					const anim = a as
						| {
								props?: { formation?: { radius?: number; pitch?: number } };
								formation?: { radius?: number; pitch?: number };
						  }
						| null
						| undefined;
					const f = anim?.props?.formation ?? anim?.formation;
					if (f) {
						if (typeof f.radius === "number") {
							formationRadius = Math.max(formationRadius, f.radius);
						}
						if (typeof f.pitch === "number") {
							formationPitch = Math.max(formationPitch, f.pitch);
						}
					}
				}
				padX = Math.max(160, Math.ceil(formationRadius + 100));
				padY = Math.max(
					100,
					Math.ceil(formationRadius + formationPitch * 15 + 100),
				);
			} else if (!isPathText && hasKineticAnimators) {
				padX = Math.max(80, Math.ceil(rect.width * 0.2));
				padY = Math.max(50, Math.ceil(rect.height * 0.5));
			}
			// Path text draws into a canvas-sized layer so glyphs following a path
			// beyond the node box aren't clipped. Path coordinates stay local to
			// the node (like every other child), so the layer still sits at the
			// node's layout position.
			const layerW = isPathText ? targetW : rect.width + padX * 2;
			const layerH = isPathText ? targetH : rect.height + padY * 2;
			if (!isPathText && hasKineticAnimators) {
				localX -= padX;
				localY -= padY;
			}
			// Anchor-aware pivot (H2): scale/rotation happen AROUND the node's
			// anchor point (0.5/0.5 = center) instead of its top-left corner.
			// For path text the anchor is a point of the node box, not of the
			// oversized layer, so a badge spins around its own centre.
			const anchorX = lop.anchorX ?? 0.5;
			const anchorY = lop.anchorY ?? 0.5;
			const localMatrix = toDOMMatrix(
				buildLayerMatrix({
					x: localX,
					y: localY,
					width: layerW,
					height: layerH,
					rotation,
					scale,
					scaleX,
					scaleY,
					anchorX: isPathText ? (anchorX * rect.width) / layerW : anchorX,
					anchorY: isPathText ? (anchorY * rect.height) / layerH : anchorY,
				}),
			);
			const layerMatrix = parentMatrix.multiply(localMatrix);
			const blendMode = (lop.blendMode as BlendMode) || "normal";

			let activeTex = destTex;
			let activeView = destView;

			const is3D = has3DTransform(target, lop);
			const rotateX = target?.rotateX ?? lop.rotateX ?? 0;
			const rotateY = target?.rotateY ?? lop.rotateY ?? 0;
			const rotateZ = target?.rotateZ ?? lop.rotateZ ?? 0;
			const translateZ = target?.translateZ ?? lop.translateZ ?? 0;
			const perspective = target?.perspective ?? lop.perspective ?? 0;
			const perspectiveOriginX =
				target?.perspectiveOriginX ??
				lop.perspectiveOriginX ??
				lop.anchorX ??
				0.5;
			const perspectiveOriginY =
				target?.perspectiveOriginY ??
				lop.perspectiveOriginY ??
				lop.anchorY ??
				0.5;
			const backfaceVisibility =
				target?.backfaceVisibility ?? lop.backfaceVisibility ?? "visible";

			let quad3D: Quad2D | null = null;
			if (is3D) {
				const m3d = Transform3DMath.buildLayer3DMatrix({
					x: localX,
					y: localY,
					width: layerW,
					height: layerH,
					rotateXDeg: rotateX,
					rotateYDeg: rotateY,
					rotateZDeg: rotateZ !== 0 ? rotateZ : rotation,
					scaleX: scaleX * scale,
					scaleY: scaleY * scale,
					perspectivePx: perspective,
					originXRatio: perspectiveOriginX,
					originYRatio: perspectiveOriginY,
					translateZPx: translateZ,
				});

				let q = Transform3DMath.projectRectangleCorners(m3d, layerW, layerH);
				if (!parentMatrix.isIdentity) {
					q = {
						topLeft: parentMatrix.transformPoint(
							new DOMPoint(q.topLeft.x, q.topLeft.y),
						),
						topRight: parentMatrix.transformPoint(
							new DOMPoint(q.topRight.x, q.topRight.y),
						),
						bottomLeft: parentMatrix.transformPoint(
							new DOMPoint(q.bottomLeft.x, q.bottomLeft.y),
						),
						bottomRight: parentMatrix.transformPoint(
							new DOMPoint(q.bottomRight.x, q.bottomRight.y),
						),
					};
				}

				if (
					backfaceVisibility === "hidden" &&
					Transform3DMath.computeSignedArea(q) < 0
				) {
					return; // Culled by backface visibility
				}

				quad3D = q;
			}

			const isTrue3D =
				Boolean(target?.is3D ?? lop.is3D) ||
				Boolean(camera && ((target?.z ?? lop.z ?? 0) !== 0 || lop.is3D));

			// Container rendering
			if (isContainer) {
				if (lop.transformStyle === "preserve-3d" && isTrue3D) {
					let current3DMatrix: Mat4 = Matrix4Math.identity();
					const containerX =
						parent3DMatrix !== null
							? (target?.x ?? lop.x ?? 0)
							: (target?.x ?? lop.x ?? localX + layerW * 0.5);
					const containerY =
						parent3DMatrix !== null
							? (target?.y ?? lop.y ?? 0)
							: (target?.y ?? lop.y ?? localY + layerH * 0.5);
					const containerZ = target?.z ?? lop.z ?? 0;
					current3DMatrix = Matrix4Math.multiply(
						current3DMatrix,
						Matrix4Math.translate(containerX, containerY, containerZ),
					);
					const rxRad = ((target?.rotateX ?? lop.rotateX ?? 0) * Math.PI) / 180;
					const ryRad = ((target?.rotateY ?? lop.rotateY ?? 0) * Math.PI) / 180;
					const rzRad =
						((target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
							? (target?.rotateZ ?? lop.rotateZ ?? 0)
							: rotation) *
						(Math.PI / 180);
					if (rzRad !== 0)
						current3DMatrix = Matrix4Math.multiply(
							current3DMatrix,
							Matrix4Math.rotateZ(rzRad),
						);
					if (ryRad !== 0)
						current3DMatrix = Matrix4Math.multiply(
							current3DMatrix,
							Matrix4Math.rotateY(ryRad),
						);
					if (rxRad !== 0)
						current3DMatrix = Matrix4Math.multiply(
							current3DMatrix,
							Matrix4Math.rotateX(rxRad),
						);
					const csX = (target?.scaleX ?? lop.scaleX ?? 1) * scale;
					const csY = (target?.scaleY ?? lop.scaleY ?? 1) * scale;
					const csZ = (target?.scaleZ ?? lop.scaleZ ?? 1) * scale;
					if (csX !== 1 || csY !== 1 || csZ !== 1)
						current3DMatrix = Matrix4Math.multiply(
							current3DMatrix,
							Matrix4Math.scale(csX, csY, csZ),
						);

					if (parent3DMatrix) {
						current3DMatrix = Matrix4Math.multiply(
							parent3DMatrix,
							current3DMatrix,
						);
					}

					if (nodeVM.children && nodeVM.children.length > 0) {
						const res = await renderNodeTree(
							nodeVM.children,
							activeTex,
							activeView,
							excludes,
							layerOpacity,
							new DOMMatrix(),
							null,
							layerW,
							layerH,
							current3DMatrix,
							false,
						);
						activeTex = res.finalTex;
						activeView = res.finalView;
					}
					return { finalTex: activeTex, finalView: activeView };
				}

				if (isTrue3D) {
					const texW = Math.max(1, Math.ceil(layerW));
					const texH = Math.max(1, Math.ceil(layerH));
					const groupExcludes = [
						activeTex,
						targetTexture,
						...excludes,
						...pendingTextures(),
					];
					const groupTex = ctx.renderer.getTemporaryTexture(
						texW,
						texH,
						groupExcludes,
					);
					const groupView = groupTex.createView();

					const groupClearPass = ctx.renderer.beginFrame(
						encoder,
						groupView,
						{ r: 0, g: 0, b: 0, a: 0 },
						texW,
						texH,
						"clear",
					);
					groupClearPass.end();

					const br = Math.min(
						lop.borderRadius ?? lop.strokeRadius ?? 0,
						layerW / 2,
						layerH / 2,
					);

					if (shouldPaintContainerBackground(kind, lop.background)) {
						const bgPass = ctx.renderer.beginFrame(
							encoder,
							groupView,
							{ r: 0, g: 0, b: 0, a: 0 },
							texW,
							texH,
							"load",
						);
						ctx.renderer.drawRect(
							bgPass,
							{ x: 0, y: 0, width: layerW, height: layerH },
							lop.background,
							0,
							{ opacity: 1 },
						);
						bgPass.end();
					}

					let activeGroupTex = groupTex;
					let activeGroupView = groupView;
					if (nodeVM.children && nodeVM.children.length > 0) {
						const res = await renderNodeTree(
							nodeVM.children,
							groupTex,
							groupView,
							[groupTex, ...groupExcludes],
							1.0,
							new DOMMatrix(),
							rect,
							texW,
							texH,
							null,
							false,
						);
						activeGroupTex = res.finalTex;
						activeGroupView = res.finalView;
					}

					const borderResult =
						!isTrue3D && lop.borderWidth !== undefined && lop.borderColor
							? createBorderTexture(
									ctx,
									encoder,
									layerW,
									layerH,
									br,
									lop.borderWidth,
									lop.borderColor,
									lop.strokeAlign ?? "inside",
									[activeGroupTex, ...groupExcludes],
								)
							: null;

					if (borderResult) {
						const borderPass = ctx.renderer.beginFrame(
							encoder,
							activeGroupView,
							{ r: 0, g: 0, b: 0, a: 0 },
							texW,
							texH,
							"load",
						);
						ctx.renderer.drawTexture(
							borderPass,
							borderResult.borderTex,
							{
								x: borderResult.ox,
								y: borderResult.oy,
								width: borderResult.ow,
								height: borderResult.oh,
							},
							{ opacity: 1 },
						);
						borderPass.end();
					}

					let modelMatrix: Mat4 | undefined;
					if (parent3DMatrix) {
						let localM = Matrix4Math.identity();
						const childX = target?.x ?? lop.x ?? 0;
						const childY = target?.y ?? lop.y ?? 0;
						const childZ = target?.z ?? lop.z ?? 0;
						localM = Matrix4Math.multiply(
							localM,
							Matrix4Math.translate(childX, childY, childZ),
						);
						const rxRad =
							((target?.rotateX ?? lop.rotateX ?? 0) * Math.PI) / 180;
						const ryRad =
							((target?.rotateY ?? lop.rotateY ?? 0) * Math.PI) / 180;
						const rzRad =
							((target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
								? (target?.rotateZ ?? lop.rotateZ ?? 0)
								: rotation) *
							(Math.PI / 180);
						if (rzRad !== 0)
							localM = Matrix4Math.multiply(localM, Matrix4Math.rotateZ(rzRad));
						if (ryRad !== 0)
							localM = Matrix4Math.multiply(localM, Matrix4Math.rotateY(ryRad));
						if (rxRad !== 0)
							localM = Matrix4Math.multiply(localM, Matrix4Math.rotateX(rxRad));

						const sx = layerW * scale * scaleX;
						const sy = layerH * scale * scaleY;
						const sz = target?.scaleZ ?? lop.scaleZ ?? 1;
						localM = Matrix4Math.multiply(
							localM,
							Matrix4Math.scale(sx, sy, sz),
						);

						const ax = lop.anchorX ?? 0.5;
						const ay = lop.anchorY ?? 0.5;
						const pivotX = 0.5 - ax;
						const pivotY = 0.5 - ay;
						if (pivotX !== 0 || pivotY !== 0) {
							localM = Matrix4Math.multiply(
								localM,
								Matrix4Math.translate(pivotX, pivotY, 0),
							);
						}

						modelMatrix = Matrix4Math.multiply(parent3DMatrix, localM);
					}

					const quadOpts: DrawQuad3DOpts = {
						position: [
							localX + layerW * 0.5,
							localY + layerH * 0.5,
							target?.z ?? lop.z ?? 0,
						],
						width: layerW,
						height: layerH,
						textureExtent: [
							layerW / activeGroupTex.width,
							layerH / activeGroupTex.height,
						],
						rotation: [
							target?.rotateX ?? lop.rotateX ?? 0,
							target?.rotateY ?? lop.rotateY ?? 0,
							(target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
								? (target?.rotateZ ?? lop.rotateZ ?? 0)
								: rotation,
						],
						scale: [
							scale * scaleX,
							scale * scaleY,
							target?.scaleZ ?? lop.scaleZ ?? 1,
						],
						anchor: [lop.anchorX ?? 0.5, lop.anchorY ?? 0.5],
						borderRadius: br,
						borderWidth: lop.borderWidth,
						borderColor: lop.borderColor,
						opacity: layerOpacity,
						twoSided: target?.twoSided ?? lop.twoSided ?? true,
						material: target?.material ?? lop.material,
						shininess: target?.shininess ?? lop.shininess,
						roughness: target?.roughness ?? lop.roughness,
						specularIntensity:
							target?.specularIntensity ?? lop.specularIntensity,
						ambientIntensity: target?.ambientIntensity ?? lop.ambientIntensity,
						metallic: target?.metallic ?? lop.metallic,
						...surfaceProps(target, lop),
						...(modelMatrix && { modelMatrix }),
					};

					pending3DItems.push({
						kind: "quad",
						texture: activeGroupTex,
						opts: quadOpts,
					});
					return { finalTex: activeTex, finalView: activeView };
				}

				if (is3D && quad3D) {
					const texW = Math.max(1, Math.ceil(layerW));
					const texH = Math.max(1, Math.ceil(layerH));
					const groupExcludes = [activeTex, targetTexture, ...excludes];
					const groupTex = ctx.renderer.getTemporaryTexture(
						texW,
						texH,
						groupExcludes,
					);
					const groupView = groupTex.createView();

					const groupClearPass = ctx.renderer.beginFrame(
						encoder,
						groupView,
						{ r: 0, g: 0, b: 0, a: 0 },
						texW,
						texH,
						"clear",
					);
					groupClearPass.end();

					const br = Math.min(
						lop.borderRadius ?? lop.strokeRadius ?? 0,
						layerW / 2,
						layerH / 2,
					);

					if (shouldPaintContainerBackground(kind, lop.background)) {
						const bgPass = ctx.renderer.beginFrame(
							encoder,
							groupView,
							{ r: 0, g: 0, b: 0, a: 0 },
							texW,
							texH,
							"load",
						);
						ctx.renderer.drawRect(
							bgPass,
							{ x: 0, y: 0, width: layerW, height: layerH },
							lop.background,
							br,
							{ opacity: 1 },
						);
						bgPass.end();
					}

					let activeGroupTex = groupTex;
					let activeGroupView = groupView;
					if (nodeVM.children && nodeVM.children.length > 0) {
						const res = await renderNodeTree(
							nodeVM.children,
							groupTex,
							groupView,
							[groupTex, ...groupExcludes],
							1.0,
							new DOMMatrix(),
							rect,
							texW,
							texH,
							null,
							false,
						);
						activeGroupTex = res.finalTex;
						activeGroupView = res.finalView;
					}

					const borderResult =
						lop.borderWidth !== undefined && lop.borderColor
							? createBorderTexture(
									ctx,
									encoder,
									layerW,
									layerH,
									br,
									lop.borderWidth,
									lop.borderColor,
									lop.strokeAlign ?? "inside",
									[activeGroupTex, ...groupExcludes],
								)
							: null;

					if (borderResult) {
						const borderPass = ctx.renderer.beginFrame(
							encoder,
							activeGroupView,
							{ r: 0, g: 0, b: 0, a: 0 },
							texW,
							texH,
							"load",
						);
						ctx.renderer.drawTexture(
							borderPass,
							borderResult.borderTex,
							{
								x: borderResult.ox,
								y: borderResult.oy,
								width: borderResult.ow,
								height: borderResult.oh,
							},
							{ opacity: 1 },
						);
						borderPass.end();
					}

					const container3DShutter =
						target?.motionBlurShutter ?? lop.motionBlurShutter ?? 0;
					if (container3DShutter > 0 && fps && shiftedFrame !== undefined) {
						seekTimeline(compiled, shiftedFrame - 1, fps);
						const prevTarget = targetId ? targetsById[targetId] : undefined;
						const prevX = prevTarget?.x ?? baseX;
						const prevY = prevTarget?.y ?? baseY;
						seekTimeline(compiled, shiftedFrame, fps);

						const vx = sampledX - prevX;
						const vy = sampledY - prevY;

						if (Math.hypot(vx, vy) > 0.5) {
							activeGroupTex = ctx.renderer.applyMotionBlur(
								encoder,
								activeGroupTex,
								vx,
								vy,
								container3DShutter,
								16,
								[activeTex, targetTexture, ...excludes],
							);
							activeGroupView = activeGroupTex.createView();
						}
					}

					if (blendMode === "normal" || blendMode === "source-over") {
						drawProjectedQuad(
							ctx,
							encoder,
							activeView,
							activeGroupTex,
							quad3D,
							targetW,
							targetH,
							layerOpacity,
						);
					} else {
						const compositeExcludes = [
							activeTex,
							targetTexture,
							activeGroupTex,
							...excludes,
						];
						if (borderResult) compositeExcludes.push(borderResult.borderTex);
						const layerTex = ctx.renderer.getTemporaryTexture(
							targetW,
							targetH,
							compositeExcludes,
						);
						const layerView = layerTex.createView();
						const layerClearPass = ctx.renderer.beginFrame(
							encoder,
							layerView,
							{ r: 0, g: 0, b: 0, a: 0 },
							targetW,
							targetH,
							"clear",
						);
						layerClearPass.end();

						drawProjectedQuad(
							ctx,
							encoder,
							layerView,
							activeGroupTex,
							quad3D,
							targetW,
							targetH,
							layerOpacity,
						);

						activeTex = ctx.renderer.composite(
							encoder,
							activeTex,
							layerTex,
							blendMode,
							[targetTexture, ...excludes],
						);
						activeView = activeTex.createView();
					}

					return { finalTex: activeTex, finalView: activeView };
				}
				const shouldClip = lop.overflow !== "visible";
				const scissorRect = shouldClip
					? computeContainerScissor(layerMatrix, layerW, layerH)
					: null;
				// A scissor clips to the box; rounded corners need a mask pass.
				const clipRadius = shouldClip
					? Math.min(
							target?.borderRadius ?? lop.borderRadius ?? 0,
							layerW / 2,
							layerH / 2,
						)
					: 0;

				// Transparent optimized flex/block — only when there is no
				// background to paint (a flex/block with a background takes the
				// group-texture path below).
				if (
					(kind === "flex" || kind === "block") &&
					(!Array.isArray(lop.effects) || lop.effects.length === 0) &&
					clipRadius <= 0 &&
					!shouldPaintContainerBackground(kind, lop.background) &&
					layerOpacity === 1 &&
					blendMode === "normal" &&
					!lop.borderWidth &&
					!lop.borderColor &&
					(typeof lop.relighting !== "object" || !lop.relighting) &&
					(typeof lop.relight !== "object" || !lop.relight) &&
					(typeof target?.relighting !== "object" || !target?.relighting) &&
					(typeof target?.relight !== "object" || !target?.relight) &&
					(typeof lop.deflicker !== "object" || !lop.deflicker) &&
					(typeof target?.deflicker !== "object" || !target?.deflicker)
				) {
					if (scissorRect) {
						// Nested containers clip inside their parents' clip.
						ctx.renderer.pushScissorIntersect(scissorRect);
					}
					const res = await renderNodeTree(
						nodeVM.children ?? [],
						activeTex,
						activeView,
						excludes,
						accumulatedOpacity,
						layerMatrix,
						rect,
						targetW,
						targetH,
						null,
						isRootScene,
					);
					if (scissorRect) {
						ctx.renderer.popScissor();
					}
					return res;
				}

				// A box with nothing inside (a fill, a bar, a card's backing) and
				// nothing that needs it isolated draws straight onto the
				// destination: a group texture would cost a full-canvas clear
				// and composite for one rect.
				if (
					(!nodeVM.children || nodeVM.children.length === 0) &&
					(!Array.isArray(lop.effects) || lop.effects.length === 0) &&
					blendMode === "normal" &&
					!(target?.motionBlurShutter ?? lop.motionBlurShutter) &&
					(typeof lop.relighting !== "object" || !lop.relighting) &&
					(typeof lop.relight !== "object" || !lop.relight) &&
					(typeof target?.relighting !== "object" || !target?.relighting) &&
					(typeof target?.relight !== "object" || !target?.relight) &&
					(typeof lop.deflicker !== "object" || !lop.deflicker) &&
					(typeof target?.deflicker !== "object" || !target?.deflicker)
				) {
					if (layerOpacity <= 0)
						return { finalTex: activeTex, finalView: activeView };
					const br = Math.min(
						target?.borderRadius ?? lop.borderRadius ?? lop.strokeRadius ?? 0,
						layerW / 2,
						layerH / 2,
					);
					const paint = shouldPaintContainerBackground(kind, lop.background);
					const border =
						lop.borderWidth !== undefined && lop.borderColor
							? createBorderTexture(
									ctx,
									encoder,
									layerW,
									layerH,
									br,
									lop.borderWidth,
									lop.borderColor,
									lop.strokeAlign ?? "inside",
									[activeTex, targetTexture, ...excludes],
								)
							: null;
					if (paint || border) {
						const pass = ctx.renderer.beginFrame(
							encoder,
							activeView,
							{ r: 0, g: 0, b: 0, a: 0 },
							targetW,
							targetH,
							"load",
						);
						ctx.renderer.pushTransform(layerMatrix);
						if (paint)
							ctx.renderer.drawRect(
								pass,
								{ x: 0, y: 0, width: layerW, height: layerH },
								lop.background,
								br,
								{ opacity: layerOpacity },
							);
						if (border)
							ctx.renderer.drawTexture(
								pass,
								border.borderTex,
								{
									x: border.ox,
									y: border.oy,
									width: border.ow,
									height: border.oh,
								},
								{ opacity: layerOpacity },
							);
						ctx.renderer.popTransform();
						pass.end();
					}
					return { finalTex: activeTex, finalView: activeView };
				}

				// A container whose children need no isolation draws them straight
				// onto the destination too: its own clip is a scissor, and a
				// rounded corner only needs the mask pass when a child reaches into
				// it. Opacity, blending, effects and transformed children keep the
				// group texture.
				if (
					nodeVM.children &&
					nodeVM.children.length > 0 &&
					(!Array.isArray(lop.effects) || lop.effects.length === 0) &&
					layerOpacity === 1 &&
					blendMode === "normal" &&
					!(target?.motionBlurShutter ?? lop.motionBlurShutter) &&
					(typeof lop.relighting !== "object" || !lop.relighting) &&
					(typeof lop.relight !== "object" || !lop.relight) &&
					(typeof target?.relighting !== "object" || !target?.relighting) &&
					(typeof target?.relight !== "object" || !target?.relight) &&
					(typeof lop.deflicker !== "object" || !lop.deflicker) &&
					(typeof target?.deflicker !== "object" || !target?.deflicker) &&
					(clipRadius <= 0 ||
						childrenClearOfCorners(nodeVM.children, rect, clipRadius))
				) {
					const br = Math.min(
						target?.borderRadius ?? lop.borderRadius ?? lop.strokeRadius ?? 0,
						layerW / 2,
						layerH / 2,
					);
					if (shouldPaintContainerBackground(kind, lop.background)) {
						const bgPass = ctx.renderer.beginFrame(
							encoder,
							activeView,
							{ r: 0, g: 0, b: 0, a: 0 },
							targetW,
							targetH,
							"load",
						);
						ctx.renderer.pushTransform(layerMatrix);
						ctx.renderer.drawRect(
							bgPass,
							{ x: 0, y: 0, width: layerW, height: layerH },
							lop.background,
							br,
							{ opacity: 1 },
						);
						ctx.renderer.popTransform();
						bgPass.end();
					}
					if (scissorRect) ctx.renderer.pushScissorIntersect(scissorRect);
					const res = await renderNodeTree(
						nodeVM.children,
						activeTex,
						activeView,
						excludes,
						accumulatedOpacity,
						layerMatrix,
						rect,
						targetW,
						targetH,
						null,
						isRootScene,
					);
					if (scissorRect) ctx.renderer.popScissor();
					activeTex = res.finalTex;
					activeView = res.finalView;
					const border =
						lop.borderWidth !== undefined && lop.borderColor
							? createBorderTexture(
									ctx,
									encoder,
									layerW,
									layerH,
									br,
									lop.borderWidth,
									lop.borderColor,
									lop.strokeAlign ?? "inside",
									[activeTex, targetTexture, ...excludes],
								)
							: null;
					if (border) {
						const pass = ctx.renderer.beginFrame(
							encoder,
							activeView,
							{ r: 0, g: 0, b: 0, a: 0 },
							targetW,
							targetH,
							"load",
						);
						ctx.renderer.pushTransform(layerMatrix);
						ctx.renderer.drawTexture(
							pass,
							border.borderTex,
							{
								x: border.ox,
								y: border.oy,
								width: border.ow,
								height: border.oh,
							},
							{ opacity: 1 },
						);
						ctx.renderer.popTransform();
						pass.end();
					}
					return { finalTex: activeTex, finalView: activeView };
				}

				// Otherwise, draw container background + children + border onto a temporary group texture,
				// and composite/blend the group texture onto destTex.
				const groupExcludes = [activeTex, targetTexture, ...excludes];
				const groupTex = ctx.renderer.getTemporaryTexture(
					targetW,
					targetH,
					groupExcludes,
				);
				const groupView = groupTex.createView();

				const groupClearPass = ctx.renderer.beginFrame(
					encoder,
					groupView,
					{ r: 0, g: 0, b: 0, a: 0 },
					targetW,
					targetH,
					"clear",
				);
				groupClearPass.end();

				const br = Math.min(
					target?.borderRadius ?? lop.borderRadius ?? lop.strokeRadius ?? 0,
					layerW / 2,
					layerH / 2,
				);

				// Background fill pass — any container kind (flex/block/box).
				if (shouldPaintContainerBackground(kind, lop.background)) {
					const bgPass = ctx.renderer.beginFrame(
						encoder,
						groupView,
						{ r: 0, g: 0, b: 0, a: 0 },
						targetW,
						targetH,
						"load",
					);
					ctx.renderer.pushTransform(layerMatrix);
					ctx.renderer.drawRect(
						bgPass,
						{ x: 0, y: 0, width: layerW, height: layerH },
						lop.background,
						br,
						{ opacity: layerOpacity },
					);
					ctx.renderer.popTransform();
					bgPass.end();
				}

				let activeGroupTex = groupTex;
				let activeGroupView = groupView;
				if (nodeVM.children && nodeVM.children.length > 0) {
					if (scissorRect) {
						// Nested containers clip inside their parents' clip.
						ctx.renderer.pushScissorIntersect(scissorRect);
					}
					const res = await renderNodeTree(
						nodeVM.children,
						groupTex,
						groupView,
						[groupTex, ...groupExcludes],
						layerOpacity,
						layerMatrix,
						rect,
						targetW,
						targetH,
						null,
						false,
					);
					if (scissorRect) {
						ctx.renderer.popScissor();
					}
					activeGroupTex = res.finalTex;
					activeGroupView = res.finalView;
				}

				// overflow: hidden with a border radius: keep only what falls
				// inside the rounded box (background and children alike).
				if (clipRadius > 0) {
					const maskTex = ctx.renderer.getTemporaryTexture(targetW, targetH, [
						activeGroupTex,
						...groupExcludes,
					]);
					const maskPass = ctx.renderer.beginFrame(
						encoder,
						maskTex.createView(),
						{ r: 0, g: 0, b: 0, a: 0 },
						targetW,
						targetH,
						"clear",
					);
					ctx.renderer.pushTransform(layerMatrix);
					ctx.renderer.drawRect(
						maskPass,
						{ x: 0, y: 0, width: layerW, height: layerH },
						"#ffffff",
						clipRadius,
					);
					ctx.renderer.popTransform();
					maskPass.end();
					activeGroupTex = ctx.renderer.composite(
						encoder,
						activeGroupTex,
						maskTex,
						"mask-in",
						[activeGroupTex, maskTex, ...groupExcludes],
					);
					activeGroupView = activeGroupTex.createView();
				}

				const borderResult =
					lop.borderWidth !== undefined && lop.borderColor
						? createBorderTexture(
								ctx,
								encoder,
								layerW,
								layerH,
								br,
								lop.borderWidth,
								lop.borderColor,
								lop.strokeAlign ?? "inside",
								[activeGroupTex, ...groupExcludes],
							)
						: null;

				if (borderResult) {
					const borderPass = ctx.renderer.beginFrame(
						encoder,
						activeGroupView,
						{ r: 0, g: 0, b: 0, a: 0 },
						targetW,
						targetH,
						"load",
					);
					ctx.renderer.pushTransform(layerMatrix);
					ctx.renderer.drawTexture(
						borderPass,
						borderResult.borderTex,
						{
							x: borderResult.ox,
							y: borderResult.oy,
							width: borderResult.ow,
							height: borderResult.oh,
						},
						{ opacity: layerOpacity },
					);
					ctx.renderer.popTransform();
					borderPass.end();
				}

				const containerShutter =
					target?.motionBlurShutter ?? lop.motionBlurShutter ?? 0;
				if (containerShutter > 0 && fps && shiftedFrame !== undefined) {
					seekTimeline(compiled, shiftedFrame - 1, fps);
					const prevTarget = targetId ? targetsById[targetId] : undefined;
					const prevX = prevTarget?.x ?? baseX;
					const prevY = prevTarget?.y ?? baseY;
					seekTimeline(compiled, shiftedFrame, fps);

					const vx = sampledX - prevX;
					const vy = sampledY - prevY;

					if (Math.hypot(vx, vy) > 0.5) {
						activeGroupTex = ctx.renderer.applyMotionBlur(
							encoder,
							activeGroupTex,
							vx,
							vy,
							containerShutter,
							16,
							[activeTex, targetTexture, ...excludes],
						);
						activeGroupView = activeGroupTex.createView();
					}
				}

				// Temporal De-flickering & Optical Flow Warping
				const deflickerFromEffects = Array.isArray(lop.effects)
					? lop.effects.find(
							(e: unknown) =>
								(e as { op?: string })?.op === "TemporalDeflicker" ||
								(e as { op?: string })?.op === "Deflicker" ||
								(e as { constructor?: { name?: string } })?.constructor
									?.name === "TemporalDeflicker",
						)
					: undefined;
				const rawDeflicker =
					target?.deflicker ?? lop.deflicker ?? deflickerFromEffects;
				const deflickerOpts =
					typeof rawDeflicker === "object" && rawDeflicker !== null
						? rawDeflicker
						: undefined;
				if (deflickerOpts) {
					const deflickerPipe = getTemporalDeflickerPipeline(
						ctx.device,
						lop.id || `layer_${i}`,
					);
					if (shiftedFrame === 0) {
						deflickerPipe.reset();
					}
					activeGroupTex = deflickerPipe.execute(
						activeGroupTex,
						deflickerOpts,
						encoder,
					);
					activeGroupView = activeGroupTex.createView();
				}

				// Screen-Space 3D Relighting
				const relightEffect = Array.isArray(lop.effects)
					? lop.effects.find(
							(e: unknown) =>
								(e as { op?: string })?.op === "Relight3D" ||
								(e as { constructor?: { name?: string } })?.constructor
									?.name === "Relight3D",
						)
					: undefined;
				const rawRelight =
					target?.relighting ??
					lop.relighting ??
					(typeof lop.relight === "object" ? lop.relight : undefined) ??
					relightEffect;
				const relightOpts =
					typeof rawRelight === "object" && rawRelight !== null
						? rawRelight
						: undefined;
				if (relightOpts) {
					const relightPipeline = getScreenSpaceRelightPipeline(
						ctx.device,
						ctx.renderer.format ?? "rgba8unorm",
					);
					const r3dInstance = getRenderer3D(
						ctx.device,
						ctx.renderer.format ?? "rgba8unorm",
						sampleCount3d,
					);

					const activeLights = synthesizeRelightLights(
						relightOpts as Record<string, unknown>,
						sceneLights,
						rect,
						compositionFrame,
						fps ?? 24,
					);

					const lightsBuffer =
						r3dInstance.getOrCreateLightsBuffer(activeLights);

					const relitTex = ctx.renderer.getTemporaryTexture(targetW, targetH, [
						activeGroupTex,
						activeTex,
						targetTexture,
						...excludes,
					]);
					const relitView = relitTex.createView();

					const normalTex = relightOpts.normalTexture ?? relightOpts.normalMap;

					relightPipeline.execute(
						encoder,
						relitView,
						activeGroupTex,
						normalTex,
						lightsBuffer,
						{
							viewportWidth: targetW,
							viewportHeight: targetH,
							layerX: 0,
							layerY: 0,
							roughness: resolveFrameNumber(
								target?.roughness ??
									target?.relightRoughness ??
									relightOpts.specularRoughness ??
									relightOpts.roughness,
								0.35,
								compositionFrame,
								fps ?? 24,
							),
							specularStrength: resolveFrameNumber(
								target?.specularStrength ??
									target?.relightSpecularStrength ??
									relightOpts.specularStrength,
								0.7,
								compositionFrame,
								fps ?? 24,
							),
							metallic: resolveFrameNumber(
								target?.metallic ??
									target?.relightMetallic ??
									relightOpts.metallic,
								0.0,
								compositionFrame,
								fps ?? 24,
							),
							ambientIntensity: resolveFrameNumber(
								target?.ambientIntensity ??
									target?.relightAmbientIntensity ??
									relightOpts.ambientIntensity,
								0.15,
								compositionFrame,
								fps ?? 24,
							),
							depthScale: resolveFrameNumber(
								target?.depthScale ??
									target?.relightDepthScale ??
									relightOpts.depthScale,
								1.0,
								compositionFrame,
								fps ?? 24,
							),
							opacity: 1.0,
						},
						"clear",
					);

					activeGroupTex = relitTex;
					activeGroupView = relitView;
				}

				if (Array.isArray(lop.effects) && lop.effects.length > 0) {
					// A clipped container's pixels lie inside its box, so its effects
					// run over the box plus what they reach past it, not the canvas.
					const reach = shouldClip ? effectsReach(lop.effects) : null;
					const region =
						reach === null
							? null
							: clampRect(
									expandRect(
										computeContainerScissor(layerMatrix, layerW, layerH),
										reach,
									),
									targetW,
									targetH,
								);
					const postEffects = await applyLayerEffectsInRegion(
						region,
						lop.effects,
						activeGroupTex,
						targetW,
						targetH,
						ctx,
						encoder,
						props,
						drawChild,
						[activeTex, targetTexture, ...excludes],
						shiftedFrame,
						compositionFrame,
						fps ?? 24,
						isVideoMode,
						lop.id ?? `container_${i}`,
					);
					activeGroupTex = postEffects.texture;
					activeGroupView = postEffects.view;
				}

				// Always composite container groups using the composite shader
				const compositeExcludes = [activeTex, targetTexture, ...excludes];
				if (borderResult) compositeExcludes.push(borderResult.borderTex);
				const nextDestTex = ctx.renderer.composite(
					encoder,
					activeTex,
					activeGroupTex,
					blendMode,
					compositeExcludes,
				);
				activeTex = nextDestTex;
				activeView = activeTex.createView();

				return { finalTex: activeTex, finalView: activeView };
			}

			// Leaf layers (text/media)
			if (!(layerW > 0 && layerH > 0))
				return { finalTex: activeTex, finalView: activeView };

			const br = Math.min(
				lop.borderRadius ?? lop.strokeRadius ?? 0,
				layerW / 2,
				layerH / 2,
			);
			const texW = Math.ceil(layerW);
			const texH = Math.ceil(layerH);

			// Suspend any parent container scissors while rendering isolated offscreen localTex
			const savedScissors = ctx.renderer.suspendScissors?.() ?? [];

			const localTex = ctx.renderer.getTemporaryTexture(texW, texH, [
				activeTex,
				targetTexture,
				...excludes,
			]);
			const localView = localTex.createView();

			const localClearPass = ctx.renderer.beginFrame(
				encoder,
				localView,
				{ r: 0, g: 0, b: 0, a: 0 },
				texW,
				texH,
				"clear",
			);
			localClearPass.end();

			// Content: media → bound source VM; text → synthetic text op.
			let content: VirtualMediaData | undefined;
			let isCaption = false;
			if (kind === "media") {
				content = nodeVM.children?.[0];
				isCaption =
					content?.operation?.dataType === "Caption" ||
					lop.dataType === "Caption" ||
					(content?.operation as any)?.srtText !== undefined;
			} else if (kind === "text") {
				// Rich-text spans are the drawn text: read their animated fields for
				// this frame and take the plain text from them, so a reveal below
				// slices the same characters the spans hold.
				const rawSpans = (target?.spans ?? lop.spans) as TextSpan[] | undefined;
				const spanFps = fps ?? 24;
				const spans = rawSpans?.length
					? resolveTextSpans(rawSpans, {
							frame: compositionFrame,
							fps: spanFps,
							time: compositionFrame / spanFps,
							duration: composeDuration / 1000,
							durationMs: composeDuration,
							progress:
								composeDuration > 0
									? Math.min(
											1,
											((compositionFrame / spanFps) * 1000) / composeDuration,
										)
									: 0,
							deltaTime: 1 / spanFps,
						})
					: undefined;
				const fullText: string = spans ? spansText(spans) : (lop.text ?? "");
				let displayText = fullText;

				// Kinetic typography animators (Section 5)
				let resolvedAnimators = rawAnimators;
				if (Array.isArray(rawAnimators) && rawAnimators.length > 0) {
					resolvedAnimators = rawAnimators.map((animator: any, idx: number) => {
						const a = {
							...animator,
							transform: { ...(animator.transform ?? {}) },
						};
						if (idx === 0) {
							const offsetVal =
								typeof target?.offset === "number"
									? target.offset
									: typeof target?.animatorOffset === "number"
										? target.animatorOffset
										: undefined;
							const rangeStartVal =
								typeof target?.rangeStart === "number"
									? target.rangeStart
									: typeof target?.animatorRangeStart === "number"
										? target.animatorRangeStart
										: undefined;
							const rangeEndVal =
								typeof target?.rangeEnd === "number"
									? target.rangeEnd
									: typeof target?.animatorRangeEnd === "number"
										? target.animatorRangeEnd
										: undefined;

							if (offsetVal !== undefined) a.offset = offsetVal;
							if (rangeStartVal !== undefined) a.rangeStart = rangeStartVal;
							if (rangeEndVal !== undefined) a.rangeEnd = rangeEndVal;

							if (Array.isArray(a.selectors)) {
								a.selectors = a.selectors.map((s: any) => {
									if (s.type === "range") {
										return {
											...s,
											...(offsetVal !== undefined ? { offset: offsetVal } : {}),
											...(rangeStartVal !== undefined
												? { start: rangeStartVal }
												: {}),
											...(rangeEndVal !== undefined
												? { end: rangeEndVal }
												: {}),
										};
									}
									return s;
								});
							}
						}
						return a;
					});
				}

				const hasTypewriter = Boolean(lop.typewriter || target?.typewriter);

				// Check if there is an active text track or progress value evaluated by GSAP
				const textTrack = lop.animation?.tracks?.find(
					(t: { prop: string }) => t.prop === "text",
				);
				// Glyph animators index the full text, so they compose with a
				// prefix reveal: the shown characters keep their indices.
				const hasTextAnimation =
					!hasTypewriter &&
					(textTrack !== undefined || typeof target?.text === "number");

				if (hasTextAnimation && fullText.length > 0) {
					const progress =
						typeof target?.text === "number"
							? Math.max(0, Math.min(1, target.text))
							: 1;
					// Above 1, `text` is a count of characters (words, lines), not a fraction.
					const countsUnits =
						typeof target?.text === "number" && target.text > 1.0001;

					if (progress >= 1 && !countsUnits) {
						displayText = fullText;
					} else if (progress <= 0) {
						displayText = "";
					} else {
						// Determine preset style (default to typewriter)
						const presetType =
							textTrack?.keyframes?.find(
								(k: { presetType?: string }) => k.presetType,
							)?.presetType ?? "typewriter";

						const textNumeric =
							typeof target?.text === "number" ? target.text : null;
						const isDirectCount = textNumeric !== null && textNumeric > 1.0001;

						if (presetType === "word-reveal" || presetType === "karaoke") {
							const tokens = fullText.split(/(\s+)/);
							const wordIndices: number[] = [];
							tokens.forEach((token: string, idx: number) => {
								if (token.trim().length > 0) wordIndices.push(idx);
							});
							const visibleWordCount =
								isDirectCount && textNumeric !== null
									? Math.min(wordIndices.length, Math.round(textNumeric))
									: Math.round(wordIndices.length * progress);
							if (visibleWordCount === 0) {
								displayText = "";
							} else {
								const lastTokenIdx =
									wordIndices[
										Math.min(wordIndices.length - 1, visibleWordCount - 1)
									]!;
								displayText = tokens.slice(0, lastTokenIdx + 1).join("");
							}
						} else if (presetType === "line-reveal") {
							const lines = fullText.split("\n");
							const visibleLineCount =
								isDirectCount && textNumeric !== null
									? Math.min(lines.length, Math.round(textNumeric))
									: Math.round(lines.length * progress);
							displayText = lines
								.slice(0, Math.max(0, visibleLineCount))
								.join("\n");
						} else {
							// typewriter (character-level reveal)
							const visibleChars =
								isDirectCount && textNumeric !== null
									? Math.min(fullText.length, Math.round(textNumeric))
									: Math.round(fullText.length * progress);
							displayText = fullText.slice(0, visibleChars);
						}
					}
				}

				content = {
					metadata: {},
					operation: {
						op: "text",
						text: displayText,
						spans:
							spans && displayText !== fullText
								? fitSpansToText(spans, displayText)
								: spans,
						animators: resolvedAnimators,
						pathOptions: target?.pathOptions ?? lop.pathOptions,
						typewriter: target?.typewriter ?? lop.typewriter,
						marquee: target?.marquee ?? (lop as { marquee?: unknown }).marquee,
						textProgress:
							typeof target?.text === "number" ? target.text : undefined,
						firstMargin: target?.firstMargin ?? lop.firstMargin,
						lastMargin: target?.lastMargin ?? lop.lastMargin,
						baselineShift: target?.baselineShift ?? lop.baselineShift,
						signals:
							(virtualMedia as any)?.operation?.signals ??
							(virtualMedia as any)?.signals,
						fontSize: target?.fontSize ?? lop.fontSize,
						fontFamily: lop.fontFamily,
						fontStyle: lop.fontStyle,
						fontWeight: lop.fontWeight,
						fill: target?.fill ?? target?.color ?? lop.fill,
						align: lop.align,
						direction: lop.direction,
						verticalAlign: lop.verticalAlign,
						letterSpacing: target?.letterSpacing ?? lop.letterSpacing,
						lineHeight: lop.lineHeight,
						padding: lop.padding,
						textBackgroundColor:
							target?.textBackgroundColor ??
							target?.background ??
							lop.background,
						borderRadius: lop.borderRadius,
						stroke: target?.stroke ?? target?.strokeColor ?? lop.stroke,
						strokeWidth: target?.strokeWidth ?? lop.strokeWidth,
						strokeAlign: lop.strokeAlign,
						textShadow: lop.textShadow,
						shadows: lop.shadows,
						x: isPathText ? 0 : padX,
						y: isPathText ? 0 : padY,
						width: isPathText
							? targetW
							: lop.width !== undefined
								? rect.width
								: undefined,
						height: isPathText
							? targetH
							: lop.height !== undefined
								? rect.height
								: undefined,
					},
					children: [],
				} as unknown as VirtualMediaData;
			}

			// A true-3D text layer hands its glyphs to the 3D pass as outlines, to
			// be resolved per screen pixel on its plane: a texture of the text
			// blurs up close and aliases at a glancing angle. Whatever else the
			// layer draws (a backdrop, emoji) still lands in its texture.
			let glyphBatches: SlugGlyphBatch[] | null = null;
			let layerHasRaster = true;
			if (content) {
				const contentMeta = getActiveMediaMetadata(content);
				const contentDurationMs = contentMeta?.durationMs ?? composeDuration;
				const layerDurationFrames = Math.max(
					1,
					Math.round((contentDurationMs / 1000) * (fps ?? 24)),
				);
				const layerDurationInMS = (layerDurationFrames / (fps ?? 24)) * 1000;
				const contentIsImageCompositor =
					content.operation?.op === "Compositor" &&
					content.operation?.dataType === "Image";

				const captureGlyphs = isTrue3D && kind === "text";
				const rasterDrawsBefore = ctx.renderer.rasterDrawCount;
				if (captureGlyphs) ctx.renderer.slugPipeline.beginCapture();
				try {
					await drawChild(
						content,
						{
							containerWidth: layerW,
							containerHeight: layerH,
							renderId: `${props.renderId}-l${i}`,
							durationMs: layerDurationInMS,
							opacity: 1.0,
							fps,
							...(typeof lop.dpr === "number" && { dpr: lop.dpr }),
							// A media layer's effect chain (decode → passes) allocates from the
							// shared pool: keep it off the destination this layer composites onto,
							// or the raw frame lands there wherever the clip does not cover it.
							excludeTextures: [activeTex, targetTexture, ...excludes],
							isVideoMode: isVideoMode && !contentIsImageCompositor,
							...(isVideoMode &&
								lop.timeRemap &&
								kind === "media" &&
								lop.dataType === "Video" && {
									sourceTimeSec: mediaSourceTime(
										lop.timeRemap,
										Math.max(0, shiftedFrame - (lop.startFrame ?? 0)),
										fps ?? 24,
									),
								}),
							...(isVideoMode && {
								frame:
									lop.timeRemap && kind === "media" && lop.dataType === "Video"
										? Math.max(0, shiftedFrame - (lop.startFrame ?? 0))
										: Math.max(0, shiftedFrame - (lop.startFrame ?? 0)) +
											(lop.mediaStartFrame ??
												lop.trimStartFrames ??
												(lop.trimStartSec != null
													? Math.round(lop.trimStartSec * (fps ?? 24))
													: 0)),
							}),
							compositionFrame,
							...(isCaption && {
								fontFamily: lop.fontFamily,
								fontSize: target?.fontSize ?? lop.fontSize,
								fontWeight: lop.fontWeight,
								fontStyle: lop.fontStyle,
								fill: lop.fill,
								color: lop.fill,
								align: lop.align ?? "center",
								direction: lop.direction,
								verticalAlign: lop.verticalAlign ?? lop.textAlignVertical,
								lineHeight: lop.lineHeight,
								letterSpacing: lop.letterSpacing,
								textBackgroundColor: lop.background ?? lop.textBackgroundColor,
								borderRadius: lop.borderRadius ?? lop.strokeRadius,
								strokeRadius: lop.strokeRadius ?? lop.borderRadius,
								stroke: lop.stroke,
								strokeWidth: lop.strokeWidth,
								shadows: lop.shadows,
								padding: lop.padding,
								maxWidth: lop.maxWidth ?? layerW,
							}),
						},
						localView,
						localTex,
						texW,
						texH,
					);
				} finally {
					if (captureGlyphs) {
						glyphBatches = ctx.renderer.slugPipeline.endCapture();
					}
				}
				layerHasRaster = ctx.renderer.rasterDrawCount !== rasterDrawsBefore;
			} else if (kind === "shape") {
				const shapePass = ctx.renderer.beginFrame(
					encoder,
					localView,
					{ r: 0, g: 0, b: 0, a: 0 },
					texW,
					texH,
					"load",
				);

				const shapeType = lop.shapeType ?? lop.shape ?? "rect";
				const shapeConfig: ShapeGeometryConfig = {
					shapeType,
					width: layerW,
					height: layerH,
					path: target?.d ?? lop.d ?? lop.path,
					cornerRadius:
						target?.cornerRadius ??
						lop.cornerRadius ??
						lop.borderRadius ??
						lop.radius ??
						0,
					starPoints: lop.starPoints ?? 5,
					starInnerRadiusRatio:
						target?.starInnerRadiusRatio ?? lop.starInnerRadiusRatio ?? 0.5,
					polygonSides: lop.polygonSides ?? 5,
				};

				const fillType = lop.fillType ?? "solid";
				const fillColor =
					target?.fillColor ??
					target?.fill ??
					lop.fillColor ??
					lop.fill ??
					"#38bdf8";
				const color2 =
					target?.gradientEndColor ??
					lop.gradientEndColor ??
					lop.fillColor2 ??
					"#9333ea";

				let startX = lop.fillStartX;
				let startY = lop.fillStartY;
				let endX = lop.fillEndX;
				let endY = lop.fillEndY;
				if (
					fillType === "linear" &&
					startX === undefined &&
					lop.gradientAngle !== undefined
				) {
					const rad = (lop.gradientAngle * Math.PI) / 180;
					const cx = layerW / 2;
					const cy = layerH / 2;
					// Edge to edge along the angle (0° left→right, 90° top→bottom),
					// matching the shape generator's SVG gradients.
					const half =
						(Math.abs(layerW * Math.cos(rad)) +
							Math.abs(layerH * Math.sin(rad))) /
						2;
					startX = cx - Math.cos(rad) * half;
					startY = cy - Math.sin(rad) * half;
					endX = cx + Math.cos(rad) * half;
					endY = cy + Math.sin(rad) * half;
				}

				const fillConfig: ShapeFillConfig = {
					type: fillType,
					color: fillColor,
					color2,
					startX,
					startY,
					endX,
					endY,
					cx: lop.fillCx,
					cy: lop.fillCy,
					radius: lop.fillRadius,
				};

				const strokeWidth = target?.strokeWidth ?? lop.strokeWidth ?? 0;
				const strokeColor =
					target?.strokeColor ?? lop.strokeColor ?? lop.stroke ?? "#ffffff";
				const strokeLineCap = lop.strokeLineCap ?? "round";
				const strokeDashArray = lop.strokeDashArray;
				const strokeDashOffset =
					target?.strokeDashOffset ?? lop.strokeDashOffset ?? 0;
				const trimStart = target?.trimStart ?? lop.trimStart ?? 0;
				const trimEnd = target?.trimEnd ?? lop.trimEnd ?? 1;
				const trimOffset = target?.trimOffset ?? lop.trimOffset ?? 0;

				ctx.renderer.drawShape(
					shapePass,
					shapeConfig,
					fillConfig,
					strokeWidth > 0
						? {
								color: strokeColor,
								width: strokeWidth,
								cap: strokeLineCap,
								trimStart,
								trimEnd,
								trimOffset,
								dashArray: strokeDashArray,
								dashOffset: strokeDashOffset,
							}
						: undefined,
				);

				shapePass.end();
			}

			// Temporal De-flickering & Optical Flow Warping
			const leafDeflickerEffect = Array.isArray(lop.effects)
				? lop.effects.find(
						(e: unknown) =>
							(e as { op?: string })?.op === "TemporalDeflicker" ||
							(e as { constructor?: { name?: string } })?.constructor?.name ===
								"TemporalDeflicker",
					)
				: undefined;
			const deflickerOpts =
				target?.deflicker ?? lop.deflicker ?? leafDeflickerEffect;

			// Screen-Space 3D Relighting
			const leafRelightEffect = Array.isArray(lop.effects)
				? lop.effects.find(
						(e: unknown) =>
							(e as { op?: string })?.op === "Relight3D" ||
							(e as { constructor?: { name?: string } })?.constructor?.name ===
								"Relight3D",
					)
				: undefined;
			const rawLeafRelight =
				target?.relighting ??
				lop.relighting ??
				(typeof lop.relight === "object" ? lop.relight : undefined) ??
				leafRelightEffect;
			const relightOpts =
				typeof rawLeafRelight === "object" && rawLeafRelight !== null
					? rawLeafRelight
					: undefined;

			// Directional velocity motion blur
			const shutterAngle =
				target?.motionBlurShutter ?? lop.motionBlurShutter ?? 0;

			// Effects work on the layer's pixels: glyphs held back for the 3D
			// pass are drawn into its texture after all.
			const hasEffects =
				kind !== "media" &&
				Array.isArray(lop.effects) &&
				lop.effects.length > 0;
			if (
				glyphBatches &&
				glyphBatches.length > 0 &&
				(deflickerOpts || relightOpts || shutterAngle > 0 || hasEffects)
			) {
				const glyphPass = ctx.renderer.beginFrame(
					encoder,
					localView,
					{ r: 0, g: 0, b: 0, a: 0 },
					texW,
					texH,
					"load",
				);
				ctx.renderer.slugPipeline.drawBatches(
					glyphPass,
					glyphBatches,
					texW,
					texH,
				);
				glyphPass.end();
				glyphBatches = null;
				layerHasRaster = true;
			}

			let finalTex = localTex;
			if (!isTrue3D && br > 0 && !isCaption && kind !== "shape") {
				const maskTex = ctx.renderer.getTemporaryTexture(texW, texH, [
					localTex,
					activeTex,
					targetTexture,
					...excludes,
				]);
				const maskView = maskTex.createView();
				const maskClearPass = ctx.renderer.beginFrame(
					encoder,
					maskView,
					{ r: 0, g: 0, b: 0, a: 0 },
					texW,
					texH,
					"clear",
				);
				maskClearPass.end();

				const maskPass = ctx.renderer.beginFrame(
					encoder,
					maskView,
					{ r: 0, g: 0, b: 0, a: 0 },
					texW,
					texH,
					"load",
				);
				ctx.renderer.drawRect(
					maskPass,
					{ x: 0, y: 0, width: layerW, height: layerH },
					{ r: 1, g: 1, b: 1, a: 1 },
					br,
				);
				maskPass.end();

				finalTex = ctx.renderer.composite(
					encoder,
					localTex,
					maskTex,
					"mask-in",
					[activeTex, targetTexture, ...excludes],
				);
			}

			// Temporal De-flickering & Optical Flow Warping
			if (deflickerOpts) {
				const deflickerPipe = getTemporalDeflickerPipeline(
					ctx.device,
					lop.id || `layer_${i}`,
				);
				if (shiftedFrame === 0) {
					deflickerPipe.reset();
				}
				finalTex = deflickerPipe.execute(finalTex, deflickerOpts, encoder);
			}

			// Screen-Space 3D Relighting
			if (relightOpts) {
				const relightPipeline = getScreenSpaceRelightPipeline(
					ctx.device,
					ctx.renderer.format ?? "rgba8unorm",
				);
				const r3dInstance = getRenderer3D(
					ctx.device,
					ctx.renderer.format ?? "rgba8unorm",
					sampleCount3d,
				);
				const activeLights = synthesizeRelightLights(
					relightOpts as Record<string, unknown>,
					sceneLights,
					{ x: sampledX, y: sampledY, width: texW, height: texH },
					compositionFrame,
					fps ?? 24,
				);
				const lightsBuffer = r3dInstance.getOrCreateLightsBuffer(activeLights);

				const relitTex = ctx.renderer.getTemporaryTexture(texW, texH, [
					finalTex,
					activeTex,
					targetTexture,
					...excludes,
				]);
				const relitView = relitTex.createView();

				const normalTex = relightOpts.normalTexture ?? relightOpts.normalMap;

				relightPipeline.execute(
					encoder,
					relitView,
					finalTex,
					normalTex,
					lightsBuffer,
					{
						viewportWidth: texW,
						viewportHeight: texH,
						layerX: sampledX,
						layerY: sampledY,
						roughness: resolveFrameNumber(
							target?.roughness ??
								target?.relightRoughness ??
								relightOpts.specularRoughness ??
								relightOpts.roughness,
							0.35,
							compositionFrame,
							fps ?? 24,
						),
						specularStrength: resolveFrameNumber(
							target?.specularStrength ??
								target?.relightSpecularStrength ??
								relightOpts.specularStrength,
							0.7,
							compositionFrame,
							fps ?? 24,
						),
						metallic: resolveFrameNumber(
							target?.metallic ??
								target?.relightMetallic ??
								relightOpts.metallic,
							0.0,
							compositionFrame,
							fps ?? 24,
						),
						ambientIntensity: resolveFrameNumber(
							target?.ambientIntensity ??
								target?.relightAmbientIntensity ??
								relightOpts.ambientIntensity,
							0.15,
							compositionFrame,
							fps ?? 24,
						),
						depthScale: resolveFrameNumber(
							target?.depthScale ??
								target?.relightDepthScale ??
								relightOpts.depthScale,
							1.0,
							compositionFrame,
							fps ?? 24,
						),
						opacity: 1.0,
					},
					"clear",
				);

				finalTex = relitTex;
			}

			// Directional velocity motion blur (last: the shutter integrates the final look)
			let blurPadX = 0;
			let blurPadY = 0;
			if (shutterAngle > 0 && fps && shiftedFrame !== undefined) {
				seekTimeline(compiled, shiftedFrame - 1, fps);
				const prevTarget = targetId ? targetsById[targetId] : undefined;
				const prevX = prevTarget?.x ?? baseX;
				const prevY = prevTarget?.y ?? baseY;
				seekTimeline(compiled, shiftedFrame, fps);

				const vx = sampledX - prevX;
				const vy = sampledY - prevY;

				if (Math.hypot(vx, vy) > 0.5) {
					// The blur only samples inside its texture: give flat layers room
					// to streak past their own bounds instead of smearing edge pixels.
					if (!isTrue3D && !(is3D && quad3D)) {
						const reach = shutterAngle / 360;
						blurPadX = Math.ceil(Math.abs(vx) * reach);
						blurPadY = Math.ceil(Math.abs(vy) * reach);
						const paddedTex = ctx.renderer.getTemporaryTexture(
							texW + blurPadX * 2,
							texH + blurPadY * 2,
							[finalTex, activeTex, targetTexture, ...excludes],
						);
						const padPass = ctx.renderer.beginFrame(
							encoder,
							paddedTex.createView(),
							{ r: 0, g: 0, b: 0, a: 0 },
							paddedTex.width,
							paddedTex.height,
							"clear",
						);
						ctx.renderer.drawTexture(
							padPass,
							finalTex,
							{ x: blurPadX, y: blurPadY, width: texW, height: texH },
							{ opacity: 1.0 },
						);
						padPass.end();
						finalTex = paddedTex;
					}
					// ~1 tap per 2 px of streak so fast moves smear instead of ghosting.
					const streakPx = Math.hypot(vx, vy) * (shutterAngle / 360) * 2;
					const samples = Math.min(128, Math.max(16, Math.ceil(streakPx / 2)));
					finalTex = ctx.renderer.applyMotionBlur(
						encoder,
						finalTex,
						vx,
						vy,
						shutterAngle,
						samples,
						[activeTex, targetTexture, ...excludes],
					);
				}
			}

			if (
				kind !== "media" &&
				Array.isArray(lop.effects) &&
				lop.effects.length > 0
			) {
				const postEffects = await applyLayerEffects(
					lop.effects,
					finalTex,
					texW,
					texH,
					ctx,
					encoder,
					props,
					drawChild,
					[localTex, activeTex, targetTexture, ...excludes],
					shiftedFrame,
					compositionFrame,
					fps ?? 24,
					isVideoMode,
					lop.id ?? `leaf_${i}`,
				);
				finalTex = postEffects.texture;
			}

			const borderExcludes = [
				localTex,
				finalTex,
				activeTex,
				targetTexture,
				...excludes,
			];
			const borderResult =
				!isTrue3D && lop.borderWidth !== undefined && lop.borderColor
					? createBorderTexture(
							ctx,
							encoder,
							layerW,
							layerH,
							br,
							lop.borderWidth,
							lop.borderColor,
							lop.strokeAlign ?? "inside",
							borderExcludes,
						)
					: null;

			// Restore parent container scissors before compositing onto container/screen activeView
			if (savedScissors.length > 0) {
				ctx.renderer.resumeScissors?.(savedScissors);
			}

			if (isTrue3D) {
				const renderedTex = finalTex;
				if (borderResult) {
					const borderPass = ctx.renderer.beginFrame(
						encoder,
						renderedTex.createView(),
						{ r: 0, g: 0, b: 0, a: 0 },
						texW,
						texH,
						"load",
					);
					ctx.renderer.drawTexture(
						borderPass,
						borderResult.borderTex,
						{
							x: borderResult.ox,
							y: borderResult.oy,
							width: borderResult.ow,
							height: borderResult.oh,
						},
						{ opacity: 1.0 },
					);
					borderPass.end();
				}

				let modelMatrix: Mat4 | undefined;
				if (parent3DMatrix) {
					let localM = Matrix4Math.identity();
					const childX = target?.x ?? lop.x ?? 0;
					const childY = target?.y ?? lop.y ?? 0;
					const childZ = target?.z ?? lop.z ?? 0;
					localM = Matrix4Math.multiply(
						localM,
						Matrix4Math.translate(childX, childY, childZ),
					);
					const rxRad = ((target?.rotateX ?? lop.rotateX ?? 0) * Math.PI) / 180;
					const ryRad = ((target?.rotateY ?? lop.rotateY ?? 0) * Math.PI) / 180;
					const rzRad =
						((target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
							? (target?.rotateZ ?? lop.rotateZ ?? 0)
							: rotation) *
						(Math.PI / 180);
					if (rzRad !== 0)
						localM = Matrix4Math.multiply(localM, Matrix4Math.rotateZ(rzRad));
					if (ryRad !== 0)
						localM = Matrix4Math.multiply(localM, Matrix4Math.rotateY(ryRad));
					if (rxRad !== 0)
						localM = Matrix4Math.multiply(localM, Matrix4Math.rotateX(rxRad));

					const sx = layerW * scale * scaleX;
					const sy = layerH * scale * scaleY;
					const sz = target?.scaleZ ?? lop.scaleZ ?? 1;
					localM = Matrix4Math.multiply(localM, Matrix4Math.scale(sx, sy, sz));

					const ax = lop.anchorX ?? 0.5;
					const ay = lop.anchorY ?? 0.5;
					const pivotX = 0.5 - ax;
					const pivotY = 0.5 - ay;
					if (pivotX !== 0 || pivotY !== 0) {
						localM = Matrix4Math.multiply(
							localM,
							Matrix4Math.translate(pivotX, pivotY, 0),
						);
					}

					modelMatrix = Matrix4Math.multiply(parent3DMatrix, localM);
				}

				const quadOpts: DrawQuad3DOpts = {
					position: [
						localX + layerW * 0.5,
						localY + layerH * 0.5,
						target?.z ?? lop.z ?? 0,
					],
					width: layerW,
					height: layerH,
					textureExtent: [layerW / texW, layerH / texH],
					rotation: [
						target?.rotateX ?? lop.rotateX ?? 0,
						target?.rotateY ?? lop.rotateY ?? 0,
						(target?.rotateZ ?? lop.rotateZ ?? 0) !== 0
							? (target?.rotateZ ?? lop.rotateZ ?? 0)
							: rotation,
					],
					scale: [
						scale * scaleX,
						scale * scaleY,
						target?.scaleZ ?? lop.scaleZ ?? 1,
					],
					anchor: [lop.anchorX ?? 0.5, lop.anchorY ?? 0.5],
					borderRadius: br,
					borderWidth: lop.borderWidth,
					borderColor: lop.borderColor,
					opacity: layerOpacity,
					twoSided: target?.twoSided ?? lop.twoSided ?? true,
					material: target?.material ?? lop.material,
					shininess: target?.shininess ?? lop.shininess,
					roughness: target?.roughness ?? lop.roughness,
					specularIntensity: target?.specularIntensity ?? lop.specularIntensity,
					ambientIntensity: target?.ambientIntensity ?? lop.ambientIntensity,
					metallic: target?.metallic ?? lop.metallic,
					...surfaceProps(target, lop),
					...(modelMatrix && { modelMatrix }),
				};

				// The texture quad carries the layer's backdrop and border; a
				// text layer that drew neither needs only its glyphs.
				const quadHasContent =
					layerHasRaster ||
					Boolean(
						quadOpts.borderWidth &&
							quadOpts.borderWidth > 0 &&
							quadOpts.borderColor,
					);
				if (!glyphBatches || quadHasContent) {
					pending3DItems.push({
						kind: "quad",
						texture: renderedTex,
						opts: quadOpts,
					});
				}
				if (glyphBatches && glyphBatches.length > 0) {
					pending3DItems.push({
						kind: "slug",
						batches: glyphBatches,
						opts: quadOpts,
						stackBase: quadHasContent ? 1 : 0,
					});
				}
				return { finalTex: activeTex, finalView: activeView };
			}

			if (is3D && quad3D) {
				const renderedTex = finalTex;
				if (borderResult) {
					const borderPass = ctx.renderer.beginFrame(
						encoder,
						renderedTex.createView(),
						{ r: 0, g: 0, b: 0, a: 0 },
						texW,
						texH,
						"load",
					);
					ctx.renderer.drawTexture(
						borderPass,
						borderResult.borderTex,
						{
							x: borderResult.ox,
							y: borderResult.oy,
							width: borderResult.ow,
							height: borderResult.oh,
						},
						{ opacity: 1.0 },
					);
					borderPass.end();
				}

				if (blendMode === "normal" || blendMode === "source-over") {
					drawProjectedQuad(
						ctx,
						encoder,
						activeView,
						renderedTex,
						quad3D,
						targetW,
						targetH,
						layerOpacity,
					);
				} else {
					const layerExcludes = [
						activeTex,
						targetTexture,
						renderedTex,
						...excludes,
					];
					if (borderResult) layerExcludes.push(borderResult.borderTex);
					const layerTex = ctx.renderer.getTemporaryTexture(
						targetW,
						targetH,
						layerExcludes,
					);
					const layerView = layerTex.createView();
					const layerClearPass = ctx.renderer.beginFrame(
						encoder,
						layerView,
						{ r: 0, g: 0, b: 0, a: 0 },
						targetW,
						targetH,
						"clear",
					);
					layerClearPass.end();

					drawProjectedQuad(
						ctx,
						encoder,
						layerView,
						renderedTex,
						quad3D,
						targetW,
						targetH,
						layerOpacity,
					);

					const nextCompTex = ctx.renderer.composite(
						encoder,
						activeTex,
						layerTex,
						blendMode,
						[targetTexture, ...excludes],
					);
					activeTex = nextCompTex;
					activeView = activeTex.createView();
				}

				return { finalTex: activeTex, finalView: activeView };
			}

			if (blendMode === "normal" || blendMode === "source-over") {
				const drawPass = ctx.renderer.beginFrame(
					encoder,
					activeView,
					{ r: 0, g: 0, b: 0, a: 0 },
					targetW,
					targetH,
					"load",
				);
				ctx.renderer.pushTransform(layerMatrix);
				ctx.renderer.drawTexture(
					drawPass,
					finalTex,
					{
						x: -blurPadX,
						y: -blurPadY,
						width: layerW + blurPadX * 2,
						height: layerH + blurPadY * 2,
					},
					{ opacity: layerOpacity },
				);

				if (borderResult) {
					ctx.renderer.drawTexture(
						drawPass,
						borderResult.borderTex,
						{
							x: borderResult.ox,
							y: borderResult.oy,
							width: borderResult.ow,
							height: borderResult.oh,
						},
						{ opacity: layerOpacity },
					);
				}

				ctx.renderer.popTransform();
				drawPass.end();
			} else {
				const layerExcludes = [finalTex, activeTex, targetTexture, ...excludes];
				if (borderResult) layerExcludes.push(borderResult.borderTex);
				const layerTex = ctx.renderer.getTemporaryTexture(
					targetW,
					targetH,
					layerExcludes,
				);
				const layerView = layerTex.createView();

				const layerClearPass = ctx.renderer.beginFrame(
					encoder,
					layerView,
					{ r: 0, g: 0, b: 0, a: 0 },
					targetW,
					targetH,
					"clear",
				);
				layerClearPass.end();

				const drawPass = ctx.renderer.beginFrame(
					encoder,
					layerView,
					{ r: 0, g: 0, b: 0, a: 0 },
					targetW,
					targetH,
					"load",
				);
				ctx.renderer.pushTransform(layerMatrix);
				ctx.renderer.drawTexture(
					drawPass,
					finalTex,
					{
						x: -blurPadX,
						y: -blurPadY,
						width: layerW + blurPadX * 2,
						height: layerH + blurPadY * 2,
					},
					{ opacity: layerOpacity },
				);

				if (borderResult) {
					ctx.renderer.drawTexture(
						drawPass,
						borderResult.borderTex,
						{
							x: borderResult.ox,
							y: borderResult.oy,
							width: borderResult.ow,
							height: borderResult.oh,
						},
						{ opacity: layerOpacity },
					);
				}

				ctx.renderer.popTransform();
				drawPass.end();

				const nextCompTex = ctx.renderer.composite(
					encoder,
					activeTex,
					layerTex,
					blendMode,
					[targetTexture, ...excludes],
				);
				activeTex = nextCompTex;
				activeView = activeTex.createView();
			}

			return { finalTex: activeTex, finalView: activeView };
		};

		const initialExcludes = [
			compTex,
			targetTexture,
			...(props.excludeTextures || []),
		];
		const renderResult = await renderNodeTree(
			virtualMedia.children ?? [],
			compTex,
			compView,
			initialExcludes,
			1.0,
			new DOMMatrix(),
			null,
			nativeWidth,
			nativeHeight,
			null,
			true,
		);
		currentCompTex = renderResult.finalTex;

		ctx.renderer.popTransform();
		ctx.renderer.popScissor();

		// 4. Composite the native texture back to targetView
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
			currentCompTex,
			{
				x: 0,
				y: 0,
				width: props.containerWidth ?? targetWidth,
				height: props.containerHeight ?? targetHeight,
			},
			{ opacity },
		);

		args.pass = finalPass;
	}
};

/** Pixels of room around a border texture for its anti-aliased edge. */
const BORDER_AA_MARGIN = 2;

function createBorderTexture(
	ctx: RenderContextValue,
	encoder: GPUCommandEncoder,
	w: number,
	h: number,
	br: number,
	borderWidth: number,
	borderColor: string | Color,
	strokeAlign: string,
	excludeTextures: GPUTexture[],
): {
	borderTex: GPUTexture;
	ox: number;
	oy: number;
	ow: number;
	oh: number;
} | null {
	if (w <= 0 || h <= 0 || !borderColor || !borderWidth || borderWidth <= 0) {
		return null;
	}

	let ox = 0;
	let oy = 0;
	let ow = w;
	let oh = h;
	let outerRadius = br;
	let innerRadius = br;

	if (strokeAlign === "inside") {
		ox = 0;
		oy = 0;
		ow = w;
		oh = h;
		outerRadius = br;
		innerRadius = Math.max(0, br - borderWidth);
	} else if (strokeAlign === "outside") {
		ox = -borderWidth;
		oy = -borderWidth;
		ow = w + 2 * borderWidth;
		oh = h + 2 * borderWidth;
		outerRadius = br + borderWidth;
		innerRadius = br;
	} else {
		// center
		ox = -borderWidth / 2;
		oy = -borderWidth / 2;
		ow = w + borderWidth;
		oh = h + borderWidth;
		outerRadius = br + borderWidth / 2;
		innerRadius = Math.max(0, br - borderWidth / 2);
	}

	if (br <= 0) {
		outerRadius = 0;
		innerRadius = 0;
	}

	if (ow <= 0 || oh <= 0) {
		return null;
	}

	// A margin around the border's own box: its anti-aliased outer edge lies
	// half a pixel outside it, and a rounded border touching the texture's
	// edge would lose that fringe (flat spots, plain to see once scaled up).
	const m = BORDER_AA_MARGIN;
	const borderTexW = Math.ceil(ow + 2 * m);
	const borderTexH = Math.ceil(oh + 2 * m);

	const outerTex = ctx.renderer.getTemporaryTexture(
		borderTexW,
		borderTexH,
		excludeTextures,
	);
	const outerView = outerTex.createView();

	const outerClearPass = ctx.renderer.beginFrame(
		encoder,
		outerView,
		{ r: 0, g: 0, b: 0, a: 0 },
		borderTexW,
		borderTexH,
		"clear",
	);
	outerClearPass.end();

	const outerDrawPass = ctx.renderer.beginFrame(
		encoder,
		outerView,
		{ r: 0, g: 0, b: 0, a: 0 },
		borderTexW,
		borderTexH,
		"load",
	);
	ctx.renderer.drawRect(
		outerDrawPass,
		{ x: m, y: m, width: ow, height: oh },
		borderColor,
		outerRadius,
	);
	outerDrawPass.end();

	const innerW = ow - 2 * borderWidth;
	const innerH = oh - 2 * borderWidth;

	if (innerW > 0 && innerH > 0) {
		const innerTex = ctx.renderer.getTemporaryTexture(borderTexW, borderTexH, [
			outerTex,
			...excludeTextures,
		]);
		const innerView = innerTex.createView();

		const innerClearPass = ctx.renderer.beginFrame(
			encoder,
			innerView,
			{ r: 0, g: 0, b: 0, a: 0 },
			borderTexW,
			borderTexH,
			"clear",
		);
		innerClearPass.end();

		const innerDrawPass = ctx.renderer.beginFrame(
			encoder,
			innerView,
			{ r: 0, g: 0, b: 0, a: 0 },
			borderTexW,
			borderTexH,
			"load",
		);
		ctx.renderer.drawRect(
			innerDrawPass,
			{ x: m + borderWidth, y: m + borderWidth, width: innerW, height: innerH },
			{ r: 1, g: 1, b: 1, a: 1 },
			innerRadius,
		);
		innerDrawPass.end();

		const borderTex = ctx.renderer.composite(
			encoder,
			outerTex,
			innerTex,
			"mask-out",
			excludeTextures,
		);
		return {
			borderTex,
			ox: ox - m,
			oy: oy - m,
			ow: borderTexW,
			oh: borderTexH,
		};
	}

	return {
		borderTex: outerTex,
		ox: ox - m,
		oy: oy - m,
		ow: borderTexW,
		oh: borderTexH,
	};
}
