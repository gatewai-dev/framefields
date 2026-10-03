/// <reference types="webgpu" />

import { getActiveMediaMetadata } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";

interface ResizerScalerOp {
	op: "ResizerScaler";
	aspectRatioPreset?: "9:16" | "16:9" | "1:1" | "4:5" | "21:9" | "custom";
	resolutionPreset?: "4k" | "1080p" | "720p" | "480p" | "custom";
	targetWidth?: number;
	targetHeight?: number;
	fitMode?: "cover" | "contain" | "stretch" | "manual";
	zoom?: number;
	offsetX?: number;
	offsetY?: number;
	backgroundMode?: "solid" | "blurred" | "gradient" | "transparent";
	backgroundColor?: string;
	backgroundColor2?: string;
	blurRadius?: number;
	backgroundBrightness?: number;
	anchorX?: "left" | "center" | "right";
	anchorY?: "top" | "center" | "bottom";
	inputs?: Record<string, unknown>;
}

export const RESIZER_SCALER_SHADER = `
struct ScalerUniforms {
    targetSize : vec2<f32>,
    srcSize    : vec2<f32>,
    fitMode    : f32, // 0 = Cover, 1 = Contain, 2 = Stretch, 3 = Manual
    bgMode     : f32, // 0 = Solid, 1 = Blurred, 2 = Gradient, 3 = Transparent
    bgColor    : vec4<f32>,
    bgColor2   : vec4<f32>, // Used for gradient mode
    blurRadius : f32,
    brightness : f32,
    zoom       : f32,
    offset     : vec2<f32>,
    anchor     : vec2<f32>, // x: 0 (left) - 1 (right), y: 0 (top) - 1 (bottom)
};

@group(0) @binding(0) var<uniform> u : ScalerUniforms;
@group(0) @binding(1) var s : sampler;
@group(0) @binding(2) var t_src : texture_2d<f32>;

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
    let uv = in.uv;
    
    // Calculate aspect ratios
    let target_ar = u.targetSize.x / u.targetSize.y;
    let src_ar = u.srcSize.x / u.srcSize.y;
    
    // Sizing logic
    var fg_uv = uv;
    var is_outside_fg = false;
    
    if (u.fitMode == 1.0) { // Contain
        if (src_ar > target_ar) {
            // Letterbox (pads top & bottom)
            let scale_y = target_ar / src_ar;
            let offset_y = (1.0 - scale_y) * u.anchor.y;
            fg_uv.y = (uv.y - offset_y) / scale_y;
            if (fg_uv.y < 0.0 || fg_uv.y > 1.0) { is_outside_fg = true; }
        } else {
            // Pillarbox (pads left & right)
            let scale_x = src_ar / target_ar;
            let offset_x = (1.0 - scale_x) * u.anchor.x;
            fg_uv.x = (uv.x - offset_x) / scale_x;
            if (fg_uv.x < 0.0 || fg_uv.x > 1.0) { is_outside_fg = true; }
        }
    } else if (u.fitMode == 0.0) { // Cover
        if (src_ar > target_ar) {
            let scale_x = target_ar / src_ar;
            let offset_x = (1.0 - scale_x) * u.anchor.x;
            fg_uv.x = uv.x * scale_x + offset_x;
        } else {
            let scale_y = src_ar / target_ar;
            let offset_y = (1.0 - scale_y) * u.anchor.y;
            fg_uv.y = uv.y * scale_y + offset_y;
        }
    } else if (u.fitMode == 3.0) { // Manual Scale & Translation
        let norm_zoom = u.zoom / 100.0;
        fg_uv = (uv - vec2<f32>(0.5)) / norm_zoom + vec2<f32>(0.5) - (u.offset / u.targetSize);
        if (fg_uv.x < 0.0 || fg_uv.x > 1.0 || fg_uv.y < 0.0 || fg_uv.y > 1.0) {
            is_outside_fg = true;
        }
    } // (fitMode == 2.0 (Stretch) uses default fg_uv without bounds check)

    // Output compositing
    if (!is_outside_fg) {
        return textureSampleLevel(t_src, s, fg_uv, 0.0);
    } else {
        // Render background based on mode
        if (u.bgMode == 0.0) { // Solid
            return u.bgColor;
        } else if (u.bgMode == 1.0) { // Blurred Background Copy
            // Sample cover-fitted coordinates for background
            var bg_uv = uv;
            if (src_ar > target_ar) {
                let scale_x = target_ar / src_ar;
                let offset_x = (1.0 - scale_x) * 0.5; // Always center background
                bg_uv.x = uv.x * scale_x + offset_x;
            } else {
                let scale_y = src_ar / target_ar;
                let offset_y = (1.0 - scale_y) * 0.5;
                bg_uv.y = uv.y * scale_y + offset_y;
            }
            
            // Apply gaussian blur approximation in shader
            var color = vec4<f32>(0.0);
            let blur_steps = 5.0;
            let blur_offset = u.blurRadius / (u.targetSize * blur_steps);
            
            for (var x = -2.0; x <= 2.0; x += 1.0) {
                for (var y = -2.0; y <= 2.0; y += 1.0) {
                    color += textureSampleLevel(t_src, s, bg_uv + vec2<f32>(x, y) * blur_offset, 0.0);
                }
            }
            color = color / 25.0;
            
            // Apply background brightness darken effect
            return vec4<f32>(color.rgb * u.brightness, color.a);
        } else if (u.bgMode == 2.0) { // Gradient
            return mix(u.bgColor, u.bgColor2, uv.y);
        } else { // Transparent
            return vec4<f32>(0.0, 0.0, 0.0, 0.0);
        }
    }
}
`;

interface DeviceScalerResources {
	scalerUniformLayout: GPUBindGroupLayout;
	textureSamplerLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceScalerResources>();

function getDeviceLayouts(device: GPUDevice): DeviceScalerResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const scalerUniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
		],
	});

	res = {
		scalerUniformLayout,
		textureSamplerLayout: scalerUniformLayout, // Shared layout for resources
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getScalerResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `scaler_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);

	if (!pipeline) {
		const scalerModule = device.createShaderModule({
			label: `scaler_${format}.wgsl`,
			code: RESIZER_SCALER_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `ResizerScalerPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [layouts.scalerUniformLayout],
			}),
			vertex: { module: scalerModule, entryPoint: "vs" },
			fragment: {
				module: scalerModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		scalerPipeline: pipeline,
		scalerUniformLayout: layouts.scalerUniformLayout,
	};
}

function parseHexToRGBA(hex: string): [number, number, number, number] {
	const cleanHex = hex.replace("#", "");
	const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
	const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
	const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
	const a =
		cleanHex.length === 8 ? parseInt(cleanHex.substring(6, 8), 16) / 255 : 1.0;
	return [r, g, b, a];
}

// 24 floats total:
// Float 0,1: targetSize (vec2)
// Float 2,3: srcSize (vec2)
// Float 4: fitMode (f32)
// Float 5: bgMode (f32)
// Float 6,7: padding
// Float 8-11: bgColor (vec4)
// Float 12-15: bgColor2 (vec4)
// Float 16: blurRadius (f32)
// Float 17: brightness (f32)
// Float 18: zoom (f32)
// Float 19: padding
// Float 20,21: offset (vec2)
// Float 22,23: anchor (vec2)
const scalerData = new Float32Array(24);

export const ResizerScalerWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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

	const op = props.virtualMedia?.operation as ResizerScalerOp | undefined;
	if (op?.op !== "ResizerScaler" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const childMeta = getActiveMediaMetadata(childMedia);
	const srcWidth = childMeta?.width || targetWidth || 1920;
	const srcHeight = childMeta?.height || targetHeight || 1080;

	// Get a temporary texture representing the native child size to draw it into
	const tmpTex = ctx.renderer.getTemporaryTexture(srcWidth, srcHeight, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const tmpView = tmpTex.createView();

	// Clear temporary texture frame
	const childPass = ctx.renderer.beginFrame(
		encoder,
		tmpView,
		{ r: 0, g: 0, b: 0, a: 0 },
		srcWidth,
		srcHeight,
		"clear",
	);
	childPass.end();

	// Draw child media in native size
	ctx.renderer.pushScissor({ x: 0, y: 0, width: srcWidth, height: srcHeight });
	ctx.renderer.pushIdentity();
	await drawChild(
		childMedia,
		{
			...props,
			virtualMedia: childMedia,
			containerWidth: srcWidth,
			containerHeight: srcHeight,
		},
		tmpView,
		tmpTex,
		srcWidth,
		srcHeight,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// Get compiled shader pipeline
	const { scalerPipeline: pipeline, scalerUniformLayout: uLayout } =
		getScalerResources(ctx.device, ctx.renderer.format);

	// Pack Uniform data structure precisely
	// Float 0,1: targetSize (vec2)
	scalerData[0] = targetWidth;
	scalerData[1] = targetHeight;

	// Float 2,3: srcSize (vec2)
	scalerData[2] = srcWidth;
	scalerData[3] = srcHeight;

	// Float 4: fitMode (0 = cover, 1 = contain, 2 = stretch, 3 = manual)
	const fitModeMap = { cover: 0.0, contain: 1.0, stretch: 2.0, manual: 3.0 };
	scalerData[4] = fitModeMap[op.fitMode ?? "contain"] ?? 1.0;

	// Float 5: bgMode (0 = solid, 1 = blurred, 2 = gradient, 3 = transparent)
	const bgModeMap = {
		solid: 0.0,
		blurred: 1.0,
		gradient: 2.0,
		transparent: 3.0,
	};
	scalerData[5] = bgModeMap[op.backgroundMode ?? "solid"] ?? 0.0;

	// Float 6,7: padding
	scalerData[6] = 0.0;
	scalerData[7] = 0.0;

	// Float 8-11: bgColor (vec4)
	const bgColor = parseHexToRGBA(op.backgroundColor ?? "#000000FF");
	scalerData[8] = bgColor[0];
	scalerData[9] = bgColor[1];
	scalerData[10] = bgColor[2];
	scalerData[11] = bgColor[3];

	// Float 12-15: bgColor2 (vec4)
	const bgColor2 = parseHexToRGBA(op.backgroundColor2 ?? "#000000FF");
	scalerData[12] = bgColor2[0];
	scalerData[13] = bgColor2[1];
	scalerData[14] = bgColor2[2];
	scalerData[15] = bgColor2[3];

	// Float 16: blurRadius (f32)
	scalerData[16] = Number(op.blurRadius ?? 40.0);

	// Float 17: brightness (f32)
	scalerData[17] = Number(op.backgroundBrightness ?? 0.6);

	// Float 18: zoom (f32)
	scalerData[18] = Number(op.zoom ?? 100.0);

	// Float 19: padding
	scalerData[19] = 0.0;

	// Float 20,21: offset (vec2)
	scalerData[20] = Number(op.offsetX ?? 0.0);
	scalerData[21] = Number(op.offsetY ?? 0.0);

	// Float 22,23: anchor (vec2)
	const anchorXMap = { left: 0.0, center: 0.5, right: 1.0 };
	const anchorYMap = { top: 0.0, center: 0.5, bottom: 1.0 };
	scalerData[22] = anchorXMap[op.anchorX ?? "center"] ?? 0.5;
	scalerData[23] = anchorYMap[op.anchorY ?? "center"] ?? 0.5;

	// Allocate a temporary buffer for uniforms
	const uBuffer = ctx.renderer.getTemporaryBuffer(scalerData);
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// Render into targetView
	const renderPass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: targetView,
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	renderPass.setPipeline(pipeline);
	renderPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [
				{ binding: 0, resource: { buffer: uBuffer } },
				{ binding: 1, resource: sampler },
				{ binding: 2, resource: tmpView },
			],
		}),
	);

	renderPass.draw(4);
	renderPass.end();

	// Create and return load render pass to continue downstream node executions
	const finalPass = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);

	args.pass = finalPass;
};
