/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { parseColor, signalRegistry } from "@framefields/webgpu-renderers";
import type { HalftoneScreenOperation } from "../shared/config.js";

interface HalftoneScreenOp extends HalftoneScreenOperation {
	frequencyHandleId?: string | null;
	angleHandleId?: string | null;
	contrastHandleId?: string | null;
	cyanAngleHandleId?: string | null;
	magentaAngleHandleId?: string | null;
	yellowAngleHandleId?: string | null;
	blackAngleHandleId?: string | null;
	opacityHandleId?: string | null;
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

type HalftoneSignalData = SignalData & { nodeId?: string };

const WGSL_HALFTONE_SHADER = `
struct HalftoneUniforms {
    mode           : f32, // 0 = Monochrome, 1 = CMYK
    dotShape       : f32, // 0 = Circle, 1 = Diamond, 2 = Line, 3 = Square
    frequency      : f32,
    angle          : f32,

    contrast       : f32,
    invert         : f32,
    isSmooth       : f32,
    opacity        : f32,

    dotColor       : vec4<f32>,
    paperColor     : vec4<f32>,

    cyanAngle      : f32,
    magentaAngle   : f32,
    yellowAngle    : f32,
    blackAngle     : f32,

    hasFreqSig     : f32,
    hasAngleSig    : f32,
    hasContrastSig : f32,
    hasCyanSig     : f32,

    hasMagSig      : f32,
    hasYelSig      : f32,
    hasBlkSig      : f32,
    hasOpacitySig  : f32,
};

@group(0) @binding(0) var<uniform> u : HalftoneUniforms;
@group(1) @binding(0) var tex        : texture_2d<f32>;
@group(1) @binding(1) var samp       : sampler;

@group(2) @binding(0) var freqSigTex     : texture_2d<f32>;
@group(2) @binding(1) var angleSigTex    : texture_2d<f32>;
@group(2) @binding(2) var contrastSigTex : texture_2d<f32>;
@group(2) @binding(3) var cyanSigTex     : texture_2d<f32>;
@group(2) @binding(4) var magSigTex      : texture_2d<f32>;
@group(2) @binding(5) var yelSigTex      : texture_2d<f32>;
@group(2) @binding(6) var blkSigTex      : texture_2d<f32>;
@group(2) @binding(7) var opacitySigTex  : texture_2d<f32>;
@group(2) @binding(8) var signalSamp     : sampler;

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

const PI: f32 = 3.141592653589793;

fn getCellCenterUV(
    uv: vec2<f32>,
    dimensions: vec2<f32>,
    screenAngleDeg: f32,
    freq: f32
) -> vec2<f32> {
    let rad = screenAngleDeg * PI / 180.0;
    let cosA = cos(rad);
    let sinA = sin(rad);
    let rot = mat2x2<f32>(cosA, -sinA, sinA, cosA);
    let invRot = mat2x2<f32>(cosA, sinA, -sinA, cosA);

    let minDim = min(dimensions.x, dimensions.y);
    let cellSize = max(minDim / max(freq, 1.0), 1.0);

    let center = dimensions * 0.5;
    let pixelPos = (uv * dimensions) - center;
    let rotPos = rot * pixelPos;

    let cellIndex = floor(rotPos / cellSize) + vec2<f32>(0.5);
    let cellCenterRot = cellIndex * cellSize;
    let cellCenterPixelPos = invRot * cellCenterRot;
    let cellCenterUV = (cellCenterPixelPos + center) / dimensions;
    return clamp(cellCenterUV, vec2<f32>(0.0), vec2<f32>(1.0));
}

fn evalDotCoverage(
    uv: vec2<f32>,
    dimensions: vec2<f32>,
    screenAngleDeg: f32,
    freq: f32,
    shape: f32,
    density: f32,
    contrastMultiplier: f32,
    isSmooth: f32
) -> f32 {
    var d = clamp((density - 0.5) * contrastMultiplier + 0.5, 0.0, 1.0);
    if (d <= 0.0001) { return 0.0; }
    if (d >= 0.9999) { return 1.0; }

    let rad = screenAngleDeg * PI / 180.0;
    let cosA = cos(rad);
    let sinA = sin(rad);
    let rot = mat2x2<f32>(cosA, -sinA, sinA, cosA);

    let minDim = min(dimensions.x, dimensions.y);
    let cellSize = max(minDim / max(freq, 1.0), 1.0);

    let center = dimensions * 0.5;
    let pixelPos = (uv * dimensions) - center;
    let rotPos = rot * pixelPos;

    let cellUV = fract(rotPos / cellSize) - vec2<f32>(0.5);

    var spot: f32 = 0.0;

    if (shape < 0.5) {
        // 0: Euclidean Round Dot
        spot = 0.5 * (1.0 - (cos(cellUV.x * 2.0 * PI) + cos(cellUV.y * 2.0 * PI)) * 0.5);
    } else if (shape < 1.5) {
        // 1: Diamond
        spot = abs(cellUV.x) + abs(cellUV.y);
    } else if (shape < 2.5) {
        // 2: Line
        spot = abs(cellUV.y) * 2.0;
    } else {
        // 3: Square
        spot = max(abs(cellUV.x), abs(cellUV.y)) * 2.0;
    }

    let edgeWidth = select(0.001, max(1.5 / cellSize, 0.003), isSmooth > 0.5);

    return select(
        step(spot, d),
        smoothstep(d + edgeWidth, d - edgeWidth, spot),
        isSmooth > 0.5
    );
}

@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let sourceCol = textureSampleLevel(tex, samp, in.uv, 0.0);
    if (sourceCol.a < 1e-5) {
        return sourceCol;
    }

    // Resolve parameter overrides or dynamic signals
    var frequency = u.frequency;
    if (u.hasFreqSig > 0.5) {
        frequency = textureSampleLevel(freqSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var baseAngle = u.angle;
    if (u.hasAngleSig > 0.5) {
        baseAngle = textureSampleLevel(angleSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var contrast = u.contrast;
    if (u.hasContrastSig > 0.5) {
        contrast = textureSampleLevel(contrastSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var cyanAngle = u.cyanAngle;
    if (u.hasCyanSig > 0.5) {
        cyanAngle = textureSampleLevel(cyanSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var magentaAngle = u.magentaAngle;
    if (u.hasMagSig > 0.5) {
        magentaAngle = textureSampleLevel(magSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var yellowAngle = u.yellowAngle;
    if (u.hasYelSig > 0.5) {
        yellowAngle = textureSampleLevel(yelSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var blackAngle = u.blackAngle;
    if (u.hasBlkSig > 0.5) {
        blackAngle = textureSampleLevel(blkSigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    var effectOpacity = u.opacity;
    if (u.hasOpacitySig > 0.5) {
        effectOpacity = textureSampleLevel(opacitySigTex, signalSamp, vec2<f32>(0.5, 0.5), 0.0).r;
    }

    let dimensions = vec2<f32>(textureDimensions(tex));
    let unpremult = sourceCol.rgb / sourceCol.a;

    var screenedRgb: vec3<f32>;

    if (u.mode < 0.5) {
        // --- Monochrome Mode ---
        let cellCenterUV = getCellCenterUV(in.uv, dimensions, baseAngle, frequency);
        let cellCol = textureSampleLevel(tex, samp, cellCenterUV, 0.0);
        let cellRgb = select(cellCol.rgb, cellCol.rgb / cellCol.a, cellCol.a > 1e-5);
        let luminance = dot(cellRgb, vec3<f32>(0.2126, 0.7152, 0.0722));
        var inkDensity = 1.0 - luminance;
        if (u.invert > 0.5) {
            inkDensity = luminance;
        }

        let coverage = evalDotCoverage(
            in.uv,
            dimensions,
            baseAngle,
            frequency,
            u.dotShape,
            inkDensity,
            contrast,
            u.isSmooth
        );

        screenedRgb = mix(u.paperColor.rgb, u.dotColor.rgb, coverage);
    } else {
        // --- CMYK Mode ---
        let cellCenterUVC = getCellCenterUV(in.uv, dimensions, baseAngle + cyanAngle, frequency);
        let colC = textureSampleLevel(tex, samp, cellCenterUVC, 0.0);
        let rgbC = select(colC.rgb, colC.rgb / colC.a, colC.a > 1e-5);
        let kC = 1.0 - max(max(rgbC.r, rgbC.g), rgbC.b);
        let invKC = 1.0 - kC;
        var densC = select(0.0, clamp((1.0 - rgbC.r - kC) / max(invKC, 0.0001), 0.0, 1.0), invKC > 0.0001);

        let cellCenterUVM = getCellCenterUV(in.uv, dimensions, baseAngle + magentaAngle, frequency);
        let colM = textureSampleLevel(tex, samp, cellCenterUVM, 0.0);
        let rgbM = select(colM.rgb, colM.rgb / colM.a, colM.a > 1e-5);
        let kM = 1.0 - max(max(rgbM.r, rgbM.g), rgbM.b);
        let invKM = 1.0 - kM;
        var densM = select(0.0, clamp((1.0 - rgbM.g - kM) / max(invKM, 0.0001), 0.0, 1.0), invKM > 0.0001);

        let cellCenterUVY = getCellCenterUV(in.uv, dimensions, baseAngle + yellowAngle, frequency);
        let colY = textureSampleLevel(tex, samp, cellCenterUVY, 0.0);
        let rgbY = select(colY.rgb, colY.rgb / colY.a, colY.a > 1e-5);
        let kY = 1.0 - max(max(rgbY.r, rgbY.g), rgbY.b);
        let invKY = 1.0 - kY;
        var densY = select(0.0, clamp((1.0 - rgbY.b - kY) / max(invKY, 0.0001), 0.0, 1.0), invKY > 0.0001);

        let cellCenterUVK = getCellCenterUV(in.uv, dimensions, baseAngle + blackAngle, frequency);
        let colK = textureSampleLevel(tex, samp, cellCenterUVK, 0.0);
        let rgbK = select(colK.rgb, colK.rgb / colK.a, colK.a > 1e-5);
        var densK = 1.0 - max(max(rgbK.r, rgbK.g), rgbK.b);

        if (u.invert > 0.5) {
            densC = 1.0 - densC;
            densM = 1.0 - densM;
            densY = 1.0 - densY;
            densK = 1.0 - densK;
        }

        let covC = evalDotCoverage(in.uv, dimensions, baseAngle + cyanAngle, frequency, u.dotShape, densC, contrast, u.isSmooth);
        let covM = evalDotCoverage(in.uv, dimensions, baseAngle + magentaAngle, frequency, u.dotShape, densM, contrast, u.isSmooth);
        let covY = evalDotCoverage(in.uv, dimensions, baseAngle + yellowAngle, frequency, u.dotShape, densY, contrast, u.isSmooth);
        let covK = evalDotCoverage(in.uv, dimensions, baseAngle + blackAngle, frequency, u.dotShape, densK, contrast, u.isSmooth);

        // Subtractive synthesis onto paper substrate
        let outR = u.paperColor.r * (1.0 - covC) * (1.0 - covK);
        let outG = u.paperColor.g * (1.0 - covM) * (1.0 - covK);
        let outB = u.paperColor.b * (1.0 - covY) * (1.0 - covK);

        screenedRgb = clamp(vec3<f32>(outR, outG, outB), vec3<f32>(0.0), vec3<f32>(1.0));
    }

    // Apply effect opacity blend
    let finalRgb = mix(unpremult, screenedRgb, clamp(effectOpacity, 0.0, 1.0));
    return vec4<f32>(finalRgb * sourceCol.a, sourceCol.a);
}
`;

interface DeviceHalftoneResources {
	uniformLayout: GPUBindGroupLayout;
	singleTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceHalftoneResources>();

function getDeviceLayouts(device: GPUDevice): DeviceHalftoneResources {
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
		singleTextureLayout,
		signalTextureLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getHalftoneResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `halftone_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const halftoneModule = device.createShaderModule({
			label: `halftone_${format}.wgsl`,
			code: WGSL_HALFTONE_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `HalftonePipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [
					layouts.uniformLayout,
					layouts.singleTextureLayout,
					layouts.signalTextureLayout,
				],
			}),
			vertex: { module: halftoneModule, entryPoint: "vs" },
			fragment: {
				module: halftoneModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		halftonePipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		singleTextureLayout: layouts.singleTextureLayout,
		signalTextureLayout: layouts.signalTextureLayout,
	};
}

export const HalftoneScreenWebGPURenderer: WebGPUNodeRenderer = async (
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
	const fps = props.fps || 30;
	const op = props.virtualMedia?.operation as unknown as
		| HalftoneScreenOp
		| undefined;
	if (op?.op !== "HalftoneScreen" || !op) return;

	const childMedia = props.virtualMedia.children?.[0];
	if (!childMedia) return;

	// End the provided pass
	pass.end();

	const width = targetWidth;
	const height = targetHeight;
	const nodeId = op.inputs ? Object.keys(op.inputs)[0] : "halftone_node";

	// 1. Resolve Bindable Parameters
	const resolveBindable = (
		configKey:
			| "frequency"
			| "angle"
			| "contrast"
			| "cyanAngle"
			| "magentaAngle"
			| "yellowAngle"
			| "blackAngle"
			| "opacity",
		defaultValue: number,
		minVal: number,
		maxVal: number,
	) => {
		const handleIdKey = `${configKey}HandleId` as keyof HalftoneScreenOp;
		const handleId = op[handleIdKey] as string | null | undefined;
		const input = handleId ? op.inputs?.[handleId] : null;

		const hasSignal = !!(
			input?.connectionValid && input.outputItem?.type === "Signal"
		);

		const sd =
			hasSignal && input?.outputItem?.data
				? (input.outputItem.data as HalftoneSignalData)
				: null;

		let val = defaultValue;
		let hasStaticSig = false;

		if (!hasSignal) {
			if (input?.connectionValid && input.outputItem?.type === "Number") {
				val = Math.max(
					minVal,
					Math.min(maxVal, Number(input.outputItem.data ?? defaultValue)),
				);
			} else {
				val = Math.max(
					minVal,
					Math.min(maxVal, Number(op[configKey] ?? defaultValue)),
				);
			}
		} else if (sd) {
			val = Math.max(minVal, Math.min(maxVal, Number(sd.offset ?? 0.0)));
			hasStaticSig = true;
		}

		return { val, hasStaticSig, sd };
	};

	const freqRes = resolveBindable("frequency", 30, 1, 200);
	const angleRes = resolveBindable("angle", 45, 0, 360);
	const contrastRes = resolveBindable("contrast", 1.0, 0.1, 5.0);
	const cyanRes = resolveBindable("cyanAngle", 15, 0, 360);
	const magRes = resolveBindable("magentaAngle", 75, 0, 360);
	const yelRes = resolveBindable("yellowAngle", 0, 0, 360);
	const blkRes = resolveBindable("blackAngle", 45, 0, 360);
	const opacityRes = resolveBindable("opacity", 1.0, 0.0, 1.0);

	// 2. Draw child media
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

	// 3. Fetch layout and resources
	const {
		halftonePipeline: pipeline,
		uniformLayout: uLayout,
		singleTextureLayout: tLayout,
		signalTextureLayout: sigLayout,
	} = getHalftoneResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const getSignalView = (
		res: { val: number; hasStaticSig: boolean; sd: HalftoneSignalData | null },
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

	const freqView = getSignalView(freqRes, "freq_sig");
	const angleView = getSignalView(angleRes, "angle_sig");
	const contrastView = getSignalView(contrastRes, "contrast_sig");
	const cyanView = getSignalView(cyanRes, "cyan_sig");
	const magView = getSignalView(magRes, "mag_sig");
	const yelView = getSignalView(yelRes, "yel_sig");
	const blkView = getSignalView(blkRes, "blk_sig");
	const opacityView = getSignalView(opacityRes, "opacity_sig");

	// 4. Fill uniform array
	const modeVal = op.mode === "CMYK" ? 1.0 : 0.0;
	let dotShapeVal = 0.0; // Circle
	if (op.dotShape === "Diamond") dotShapeVal = 1.0;
	else if (op.dotShape === "Line") dotShapeVal = 2.0;
	else if (op.dotShape === "Square") dotShapeVal = 3.0;

	const dotCol = parseColor(op.dotColor ?? "#000000");
	const paperCol = parseColor(op.paperColor ?? "#ffffff");

	const halftoneUniformData = new Float32Array(28);
	halftoneUniformData[0] = modeVal;
	halftoneUniformData[1] = dotShapeVal;
	halftoneUniformData[2] = freqRes.val;
	halftoneUniformData[3] = angleRes.val;

	halftoneUniformData[4] = contrastRes.val;
	halftoneUniformData[5] = op.invert ? 1.0 : 0.0;
	halftoneUniformData[6] = op.smooth !== false ? 1.0 : 0.0;
	halftoneUniformData[7] = opacityRes.val;

	halftoneUniformData[8] = dotCol.r;
	halftoneUniformData[9] = dotCol.g;
	halftoneUniformData[10] = dotCol.b;
	halftoneUniformData[11] = dotCol.a;

	halftoneUniformData[12] = paperCol.r;
	halftoneUniformData[13] = paperCol.g;
	halftoneUniformData[14] = paperCol.b;
	halftoneUniformData[15] = paperCol.a;

	halftoneUniformData[16] = cyanRes.val;
	halftoneUniformData[17] = magRes.val;
	halftoneUniformData[18] = yelRes.val;
	halftoneUniformData[19] = blkRes.val;

	halftoneUniformData[20] = freqRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[21] = angleRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[22] = contrastRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[23] = cyanRes.hasStaticSig ? 1.0 : 0.0;

	halftoneUniformData[24] = magRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[25] = yelRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[26] = blkRes.hasStaticSig ? 1.0 : 0.0;
	halftoneUniformData[27] = opacityRes.hasStaticSig ? 1.0 : 0.0;

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(halftoneUniformData);

	// 5. Output Texture
	const outTex = ctx.renderer.getTemporaryTexture(width, height, [
		tmpTex,
		targetTexture,
		...(props.excludeTextures || []),
	]);

	// 6. Run Halftone Screen Render Pass
	const halftonePass = encoder.beginRenderPass({
		colorAttachments: [
			{
				view: outTex.createView(),
				loadOp: "clear",
				storeOp: "store",
				clearValue: { r: 0, g: 0, b: 0, a: 0 },
			},
		],
	});

	halftonePass.setPipeline(pipeline);
	halftonePass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	halftonePass.setBindGroup(
		1,
		ctx.renderer.bindGroupCache.getBindGroup(
			ctx.device,
			tLayout,
			tmpTex,
			sampler,
		),
	);
	halftonePass.setBindGroup(
		2,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: freqView },
				{ binding: 1, resource: angleView },
				{ binding: 2, resource: contrastView },
				{ binding: 3, resource: cyanView },
				{ binding: 4, resource: magView },
				{ binding: 5, resource: yelView },
				{ binding: 6, resource: blkView },
				{ binding: 7, resource: opacityView },
				{ binding: 8, resource: sampler },
			],
		}),
	);
	halftonePass.draw(4);
	halftonePass.end();

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
		{ opacity: 1.0 },
	);

	args.pass = finalPass;
};
