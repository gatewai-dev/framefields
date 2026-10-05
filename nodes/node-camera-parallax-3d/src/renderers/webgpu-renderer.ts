/// <reference types="webgpu" />
import type { SignalData, VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";

interface CameraParallax3DOp {
	op: "CameraParallax3D";
	motionPreset?:
		| "Custom"
		| "DollyZoom"
		| "Orbit"
		| "FlyThrough"
		| "HandheldShake"
		| "RackFocus";
	panX?: number;
	panY?: number;
	dollyZ?: number;
	fov?: number;
	parallaxAmount?: number;
	dofAperture?: number;
	focusPlane?: number;
	edgeDilation?: number;
	depthInvert?: boolean;
	opacity?: number;

	panXHandleId?: string | null;
	panYHandleId?: string | null;
	dollyZHandleId?: string | null;
	fovHandleId?: string | null;
	parallaxAmountHandleId?: string | null;
	dofApertureHandleId?: string | null;
	focusPlaneHandleId?: string | null;
	edgeDilationHandleId?: string | null;

	depthMedia?: VirtualMediaData | null;
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

type CameraParallaxSignalData = SignalData & { nodeId?: string };

const CAMERA_PARALLAX_SHADER = `
struct CameraParallaxUniforms {
    // vec4 0
    motionPreset          : f32, // 0=Custom, 1=DollyZoom, 2=Orbit, 3=FlyThrough, 4=HandheldShake, 5=RackFocus
    panX                  : f32,
    panY                  : f32,
    dollyZ                : f32,

    // vec4 1
    fov                   : f32,
    parallaxAmount        : f32,
    dofAperture           : f32,
    focusPlane            : f32,

    // vec4 2
    edgeDilation          : f32,
    depthInvert           : f32,
    hasDepthMap           : f32,
    timeProgress          : f32, // normalized 0.0 - 1.0 (or continuous)

    // vec4 3
    aspect                : f32,
    _pad1                 : f32,
    _pad2                 : f32,
    _pad3                 : f32,

    // vec4 4: signal flags
    hasSigPanX            : f32,
    hasSigPanY            : f32,
    hasSigDollyZ          : f32,
    hasSigFocusPlane      : f32,

    // vec4 5: signal flags
    hasSigParallax        : f32,
    hasSigAperture        : f32,
    hasSigFOV             : f32,
    hasSigEdgeDilation    : f32,
};

@group(0) @binding(0) var<uniform> u : CameraParallaxUniforms;

@group(1) @binding(0) var srcTex     : texture_2d<f32>;
@group(1) @binding(1) var srcSamp    : sampler;

@group(2) @binding(0) var depthTex   : texture_2d<f32>;
@group(2) @binding(1) var depthSamp  : sampler;

@group(3) @binding(0) var panXSigTex         : texture_2d<f32>;
@group(3) @binding(1) var panYSigTex         : texture_2d<f32>;
@group(3) @binding(2) var dollyZSigTex       : texture_2d<f32>;
@group(3) @binding(3) var focusPlaneSigTex   : texture_2d<f32>;
@group(3) @binding(4) var parallaxSigTex     : texture_2d<f32>;
@group(3) @binding(5) var apertureSigTex     : texture_2d<f32>;
@group(3) @binding(6) var fovSigTex          : texture_2d<f32>;
@group(3) @binding(7) var edgeDilationSigTex : texture_2d<f32>;
@group(3) @binding(8) var sigSamp            : sampler;

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

fn sampleDepth(uv: vec2<f32>) -> f32 {
    let clampedUV = clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0));
    var raw: f32 = 0.0;
    if (u.hasDepthMap > 0.5) {
        let dSample = textureSampleLevel(depthTex, depthSamp, clampedUV, 0.0);
        raw = dot(dSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
    } else {
        let c = textureSampleLevel(srcTex, srcSamp, clampedUV, 0.0);
        raw = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
    }
    if (u.depthInvert > 0.5) {
        raw = 1.0 - raw;
    }
    return clamp(raw, 0.0, 1.0);
}

fn sampleAlbedo(uv: vec2<f32>) -> vec4<f32> {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return textureSampleLevel(srcTex, srcSamp, uv, 0.0);
    }
    // Mirror with subtle fade for border inpainting
    let mirroredUV = abs(fract(uv * 0.5 + 0.5) * 2.0 - 1.0);
    let clampedUV = clamp(mirroredUV, vec2<f32>(0.001), vec2<f32>(0.999));
    return textureSampleLevel(srcTex, srcSamp, clampedUV, 0.0);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(srcTex));
    let texelSize = vec2<f32>(1.0 / dims.x, 1.0 / dims.y);
    let aspect = select(u.aspect, dims.x / max(1.0, dims.y), u.aspect <= 0.0);

    // Resolve signals
    var panX = u.panX;
    if (u.hasSigPanX > 0.5) {
        panX = textureSampleLevel(panXSigTex, sigSamp, in.uv, 0.0).r;
    }

    var panY = u.panY;
    if (u.hasSigPanY > 0.5) {
        panY = textureSampleLevel(panYSigTex, sigSamp, in.uv, 0.0).r;
    }

    var dollyZ = u.dollyZ;
    if (u.hasSigDollyZ > 0.5) {
        dollyZ = textureSampleLevel(dollyZSigTex, sigSamp, in.uv, 0.0).r;
    }

    var focusPlane = u.focusPlane;
    if (u.hasSigFocusPlane > 0.5) {
        focusPlane = clamp(textureSampleLevel(focusPlaneSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    var parallaxAmount = u.parallaxAmount;
    if (u.hasSigParallax > 0.5) {
        parallaxAmount = max(0.0, textureSampleLevel(parallaxSigTex, sigSamp, in.uv, 0.0).r);
    }

    var dofAperture = u.dofAperture;
    if (u.hasSigAperture > 0.5) {
        dofAperture = clamp(textureSampleLevel(apertureSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    var fov = u.fov;
    if (u.hasSigFOV > 0.5) {
        fov = clamp(textureSampleLevel(fovSigTex, sigSamp, in.uv, 0.0).r, 15.0, 120.0);
    }

    var edgeDilation = u.edgeDilation;
    if (u.hasSigEdgeDilation > 0.5) {
        edgeDilation = clamp(textureSampleLevel(edgeDilationSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    // Motion Presets Computation
    let t = u.timeProgress;
    let twoPi = 6.2831853;
    let pi = 3.14159265;

    var motionPanX: f32 = 0.0;
    var motionPanY: f32 = 0.0;
    var motionDollyZ: f32 = 0.0;
    var motionFocus: f32 = 0.0;

    let preset = u.motionPreset;

    if (preset > 0.5 && preset < 1.5) {
        // DollyZoom (Vertigo effect)
        let s = sin(t * pi);
        motionDollyZ = (s * 2.0 - 1.0) * 0.45;
        motionPanX = sin(t * twoPi) * 0.06;
        motionPanY = cos(t * twoPi) * 0.03;
    } else if (preset > 1.5 && preset < 2.5) {
        // Orbit
        let angle = t * twoPi;
        motionPanX = cos(angle) * 0.32;
        motionPanY = sin(angle) * 0.18;
        motionDollyZ = sin(angle * 2.0) * 0.12;
    } else if (preset > 2.5 && preset < 3.5) {
        // FlyThrough
        let phase = sin(t * pi);
        motionDollyZ = phase * 0.65;
        motionPanX = sin(t * twoPi) * 0.12;
        motionPanY = cos(t * pi) * 0.08;
        motionFocus = (phase - 0.5) * 0.6;
    } else if (preset > 3.5 && preset < 4.5) {
        // HandheldShake
        motionPanX = (sin(t * twoPi * 1.6) * 0.06 + sin(t * twoPi * 3.7) * 0.03);
        motionPanY = (cos(t * twoPi * 1.3) * 0.05 + sin(t * twoPi * 4.2) * 0.025);
        motionDollyZ = sin(t * twoPi * 0.8) * 0.04;
    } else if (preset > 4.5) {
        // RackFocus
        let focusWave = sin(t * pi);
        motionFocus = (focusWave - 0.5) * 0.8;
        motionPanX = sin(t * twoPi) * 0.04;
        motionPanY = cos(t * twoPi) * 0.02;
        motionDollyZ = sin(t * pi) * 0.06;
    }

    // Cumulative camera parameters
    let effectivePanX = clamp(panX + motionPanX, -1.0, 1.0);
    let effectivePanY = clamp(panY + motionPanY, -1.0, 1.0);
    let effectiveDollyZ = clamp(dollyZ + motionDollyZ, -1.0, 1.0);
    let effectiveFocusPlane = clamp(focusPlane + motionFocus, 0.0, 1.0);

    // FOV & perspective distortion factor
    let fovRad = (fov * pi) / 180.0;
    let fovScale = tan(fovRad * 0.5) / tan(50.0 * pi / 360.0);

    // 3D Camera Raymarch Offset
    let camOffset = vec2<f32>(effectivePanX * aspect, -effectivePanY) * (parallaxAmount * 0.15 * fovScale);
    let zoomFactor = max(0.5, 1.0 + effectiveDollyZ * 0.4);

    let centeredUV = (in.uv - 0.5) / zoomFactor + 0.5;

    // Steep Relief Raymarching (16 linear steps + 4 binary refinement steps)
    let numSteps = 16.0;
    let stepSize = 1.0 / numSteps;
    var currentRayZ: f32 = 1.0;
    var currentUV = centeredUV;
    var lastUV = centeredUV;
    var lastRayZ: f32 = 1.0;
    var lastDepth: f32 = sampleDepth(centeredUV);
    var foundHit = false;

    for (var i = 0; i < 16; i = i + 1) {
        let sampleUV = centeredUV + camOffset * (currentRayZ - effectiveFocusPlane);
        let sceneDepth = sampleDepth(sampleUV);

        if (sceneDepth >= currentRayZ) {
            foundHit = true;
            lastUV = sampleUV;
            break;
        }

        lastRayZ = currentRayZ;
        lastDepth = sceneDepth;
        currentRayZ = currentRayZ - stepSize;
    }

    // Binary refinement search for sub-pixel surface accuracy
    var hitUV = lastUV;
    var hitDepth = lastDepth;
    var minZ = currentRayZ;
    var maxZ = lastRayZ;

    for (var b = 0; b < 4; b = b + 1) {
        let midZ = (minZ + maxZ) * 0.5;
        let testUV = centeredUV + camOffset * (midZ - effectiveFocusPlane);
        let testDepth = sampleDepth(testUV);
        if (testDepth >= midZ) {
            minZ = midZ;
            hitUV = testUV;
            hitDepth = testDepth;
        } else {
            maxZ = midZ;
        }
    }

    // Edge inpainting / dilation clamping
    var finalUV = hitUV;
    if (hitUV.x < 0.0 || hitUV.x > 1.0 || hitUV.y < 0.0 || hitUV.y > 1.0) {
        let clampedBorderUV = clamp(hitUV, vec2<f32>(0.0), vec2<f32>(1.0));
        finalUV = mix(hitUV, clampedBorderUV, edgeDilation);
    }

    // Circle of Confusion (Physical Bokeh Blur)
    let coc = abs(hitDepth - effectiveFocusPlane) * dofAperture * 0.04;

    if (coc < 0.0008) {
        return sampleAlbedo(finalUV);
    }

    // Multi-tap Golden Spiral Bokeh Disk Blur (16 taps)
    var accumColor = vec4<f32>(0.0);
    var totalWeight: f32 = 0.0;
    let goldenAngle = 2.39996323;

    for (var tap = 0; tap < 16; tap = tap + 1) {
        let fTap = f32(tap);
        let r = sqrt((fTap + 0.5) / 16.0);
        let theta = fTap * goldenAngle;
        let offset = vec2<f32>(cos(theta), sin(theta) * aspect) * (r * coc);

        let tapUV = finalUV + offset;
        let tapColor = sampleAlbedo(tapUV);
        let tapDepth = sampleDepth(tapUV);

        // Bokeh depth weighting: prevents foreground blur from bleeding into background
        let depthDelta = tapDepth - hitDepth;
        let bokehWeight = select(1.0, smoothstep(-0.08, 0.04, depthDelta), depthDelta < 0.0) / (1.0 + r * r * 0.5);

        accumColor = accumColor + tapColor * bokehWeight;
        totalWeight = totalWeight + bokehWeight;
    }

    let finalColor = accumColor / max(totalWeight, 0.0001);
    return vec4<f32>(clamp(finalColor.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), finalColor.a);
}
`;

interface DeviceCameraParallaxResources {
	uniformLayout: GPUBindGroupLayout;
	srcTextureLayout: GPUBindGroupLayout;
	depthTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<
	GPUDevice,
	DeviceCameraParallaxResources
>();

function getDeviceLayouts(device: GPUDevice): DeviceCameraParallaxResources {
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

	const srcTextureLayout = device.createBindGroupLayout({
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

	const depthTextureLayout = device.createBindGroupLayout({
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
				texture: { sampleType: "float" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 4,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 5,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 6,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 7,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 8,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		uniformLayout,
		srcTextureLayout,
		depthTextureLayout,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getCameraParallaxResources(
	device: GPUDevice,
	format: GPUTextureFormat,
) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `camera_parallax_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);

	if (!pipeline) {
		const module = device.createShaderModule({
			label: `camera_parallax_${format}.wgsl`,
			code: CAMERA_PARALLAX_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `CameraParallaxPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.uniformLayout,
					layouts.srcTextureLayout,
					layouts.depthTextureLayout,
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
		srcTextureLayout: layouts.srcTextureLayout,
		depthTextureLayout: layouts.depthTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

function resolveSignalField(
	op: CameraParallax3DOp,
	fieldName:
		| "panX"
		| "panY"
		| "dollyZ"
		| "fov"
		| "parallaxAmount"
		| "dofAperture"
		| "focusPlane"
		| "edgeDilation",
	defaultValue: number,
	minVal: number,
	maxVal: number,
): { hasSignal: boolean; sd: CameraParallaxSignalData | null; value: number } {
	const handleIdKey = `${fieldName}HandleId` as keyof CameraParallax3DOp;
	const handleId = op[handleIdKey] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;

	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd =
		hasSignal && signalInput?.outputItem?.data
			? (signalInput.outputItem.data as CameraParallaxSignalData)
			: null;

	let value = defaultValue;
	if (!hasSignal) {
		if (
			signalInput?.connectionValid &&
			signalInput.outputItem?.type === "Number"
		) {
			const raw = Number(signalInput.outputItem.data ?? defaultValue);
			value = Math.max(minVal, Math.min(maxVal, raw));
		} else {
			const raw = Number(op[fieldName] ?? defaultValue);
			value = Math.max(minVal, Math.min(maxVal, raw));
		}
	} else if (sd) {
		const raw = Number(sd.offset ?? defaultValue);
		value = Math.max(minVal, Math.min(maxVal, raw));
	}

	return { hasSignal, sd, value };
}

export const CameraParallax3DWebGPURenderer: WebGPUNodeRenderer = async (
	args,
) => {
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
	const fps = props.fps || 60;
	const op = props.virtualMedia?.operation as CameraParallax3DOp | undefined;
	if (op?.op !== "CameraParallax3D" || !op) return;

	const sourceMedia = props.virtualMedia.children?.[0];
	if (!sourceMedia) return;

	// End the provided pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;

	// 1. Draw input source child to temporary texture
	const srcTex = ctx.renderer.getTemporaryTexture(width, height, [
		...(props.excludeTextures || []),
		targetTexture,
	]);
	const srcView = srcTex.createView();

	const srcClearPass = ctx.renderer.beginFrame(
		encoder,
		srcView,
		{ r: 0, g: 0, b: 0, a: 0 },
		width,
		height,
		"clear",
	);
	srcClearPass.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
	ctx.renderer.pushIdentity();
	await drawChild(
		sourceMedia,
		{
			...props,
			virtualMedia: sourceMedia,
			containerWidth: width,
			containerHeight: height,
		},
		srcView,
		srcTex,
		width,
		height,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// End active pass from child drawing
	args.pass.end();

	// 2. Draw depth map if provided
	const depthMedia = op.depthMedia;
	let depthTex: GPUTexture;
	let depthView: GPUTextureView;
	let hasDepthMap = false;

	if (depthMedia) {
		depthTex = ctx.renderer.getTemporaryTexture(width, height, [
			...(props.excludeTextures || []),
			targetTexture,
			srcTex,
		]);
		depthView = depthTex.createView();

		const depthClearPass = ctx.renderer.beginFrame(
			encoder,
			depthView,
			{ r: 0, g: 0, b: 0, a: 0 },
			width,
			height,
			"clear",
		);
		depthClearPass.end();

		ctx.renderer.pushScissor({ x: 0, y: 0, width, height });
		ctx.renderer.pushIdentity();
		await drawChild(
			depthMedia,
			{
				...props,
				virtualMedia: depthMedia,
				containerWidth: width,
				containerHeight: height,
			},
			depthView,
			depthTex,
			width,
			height,
		);
		ctx.renderer.popTransform();
		ctx.renderer.popScissor();

		// End active pass from depth drawing
		args.pass.end();
		hasDepthMap = true;
	} else {
		depthTex = srcTex;
		depthView = srcView;
		hasDepthMap = false;
	}

	// 3. Fetch static resources and compiled pipeline
	const {
		pipeline,
		uniformLayout: uLayout,
		srcTextureLayout: srcLayout,
		depthTextureLayout: depthLayout,
		signalTextureLayout: sigLayout,
	} = getCameraParallaxResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// 4. Resolve timing and signals
	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 4.0;

	const timeProgress =
		durationSeconds > 0
			? (elapsedSeconds % durationSeconds) / durationSeconds
			: 0.0;

	const panXInfo = resolveSignalField(op, "panX", 0.0, -1.0, 1.0);
	const panYInfo = resolveSignalField(op, "panY", 0.0, -1.0, 1.0);
	const dollyZInfo = resolveSignalField(op, "dollyZ", 0.0, -1.0, 1.0);
	const fovInfo = resolveSignalField(op, "fov", 50.0, 15.0, 120.0);
	const parallaxInfo = resolveSignalField(op, "parallaxAmount", 0.6, 0.0, 2.0);
	const apertureInfo = resolveSignalField(op, "dofAperture", 0.3, 0.0, 1.0);
	const focusPlaneInfo = resolveSignalField(op, "focusPlane", 0.4, 0.0, 1.0);
	const edgeDilationInfo = resolveSignalField(
		op,
		"edgeDilation",
		0.5,
		0.0,
		1.0,
	);

	const getSigTextureView = (
		info: { hasSignal: boolean; sd: CameraParallaxSignalData | null },
		fallbackId: string,
	) => {
		if (info.hasSignal && info.sd) {
			return signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				info.sd.nodeId ?? fallbackId,
				elapsedSeconds,
				durationSeconds,
				info.sd,
				width,
				height,
				props.renderId,
				frame,
				fps,
			);
		}
		return signalRegistry.getDummy1x1TextureView(ctx.device);
	};

	const sigPanXView = getSigTextureView(panXInfo, "cam_panx_sig");
	const sigPanYView = getSigTextureView(panYInfo, "cam_pany_sig");
	const sigDollyZView = getSigTextureView(dollyZInfo, "cam_dollyz_sig");
	const sigFocusPlaneView = getSigTextureView(focusPlaneInfo, "cam_focus_sig");
	const sigParallaxView = getSigTextureView(parallaxInfo, "cam_plax_sig");
	const sigApertureView = getSigTextureView(apertureInfo, "cam_ap_sig");
	const sigFOVView = getSigTextureView(fovInfo, "cam_fov_sig");
	const sigEdgeDilationView = getSigTextureView(
		edgeDilationInfo,
		"cam_edge_sig",
	);

	// 5. Fill Uniforms (24 floats / 6 vec4s)
	const uniformData = new Float32Array(24);

	const presetEnum =
		op.motionPreset === "DollyZoom"
			? 1
			: op.motionPreset === "Orbit"
				? 2
				: op.motionPreset === "FlyThrough"
					? 3
					: op.motionPreset === "HandheldShake"
						? 4
						: op.motionPreset === "RackFocus"
							? 5
							: 0;

	// vec4 0
	uniformData[0] = presetEnum;
	uniformData[1] = panXInfo.value;
	uniformData[2] = panYInfo.value;
	uniformData[3] = dollyZInfo.value;

	// vec4 1
	uniformData[4] = fovInfo.value;
	uniformData[5] = parallaxInfo.value;
	uniformData[6] = apertureInfo.value;
	uniformData[7] = focusPlaneInfo.value;

	// vec4 2
	uniformData[8] = edgeDilationInfo.value;
	uniformData[9] = op.depthInvert ? 1.0 : 0.0;
	uniformData[10] = hasDepthMap ? 1.0 : 0.0;
	uniformData[11] = timeProgress;

	// vec4 3
	uniformData[12] = width / Math.max(1, height);
	uniformData[13] = 0.0;
	uniformData[14] = 0.0;
	uniformData[15] = 0.0;

	// vec4 4: signal flags
	uniformData[16] = panXInfo.hasSignal ? 1.0 : 0.0;
	uniformData[17] = panYInfo.hasSignal ? 1.0 : 0.0;
	uniformData[18] = dollyZInfo.hasSignal ? 1.0 : 0.0;
	uniformData[19] = focusPlaneInfo.hasSignal ? 1.0 : 0.0;

	// vec4 5: signal flags
	uniformData[20] = parallaxInfo.hasSignal ? 1.0 : 0.0;
	uniformData[21] = apertureInfo.hasSignal ? 1.0 : 0.0;
	uniformData[22] = fovInfo.hasSignal ? 1.0 : 0.0;
	uniformData[23] = edgeDilationInfo.hasSignal ? 1.0 : 0.0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(uniformData);

	// 6. Render Shader Pass
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		srcTex,
		depthTex,
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
	renderPass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	renderPass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			srcLayout,
			srcTex,
			sampler,
		),
	);
	renderPass.setBindGroup(
		2,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			depthLayout,
			depthTex,
			sampler,
		),
	);
	renderPass.setBindGroup(
		3,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: sigPanXView },
				{ binding: 1, resource: sigPanYView },
				{ binding: 2, resource: sigDollyZView },
				{ binding: 3, resource: sigFocusPlaneView },
				{ binding: 4, resource: sigParallaxView },
				{ binding: 5, resource: sigApertureView },
				{ binding: 6, resource: sigFOVView },
				{ binding: 7, resource: sigEdgeDilationView },
				{ binding: 8, resource: sampler },
			],
		}),
	);

	renderPass.draw(4);
	renderPass.end();

	// 7. Final Pass to targetView
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
		{ opacity: op.opacity ?? 1 },
	);

	args.pass = finalPass;
};
