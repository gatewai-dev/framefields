/// <reference types="webgpu" />
import type { SignalData, VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { parseColor, signalRegistry } from "@framefields/webgpu-renderers";

interface Relight3DOp {
	op: "Relight3D";
	lightType?: "Point" | "Spot" | "Directional" | "Rim";
	intensity?: number;
	lightPosX?: number;
	lightPosY?: number;
	lightPosZ?: number;
	lightRadius?: number;
	spotConeAngle?: number;
	specularRoughness?: number;
	specularStrength?: number;
	metallic?: number;
	ambientIntensity?: number;
	volumetricDensity?: number;
	depthScale?: number;
	depthInvert?: boolean;
	lightColor?: string;
	ambientColor?: string;
	opacity?: number;

	intensityHandleId?: string | null;
	lightPosXHandleId?: string | null;
	lightPosYHandleId?: string | null;
	lightPosZHandleId?: string | null;
	lightRadiusHandleId?: string | null;
	spotConeAngleHandleId?: string | null;
	specularRoughnessHandleId?: string | null;
	specularStrengthHandleId?: string | null;
	metallicHandleId?: string | null;
	ambientIntensityHandleId?: string | null;
	volumetricDensityHandleId?: string | null;
	depthScaleHandleId?: string | null;

	depthMedia?: VirtualMediaData | null;
	normalMedia?: VirtualMediaData | null;
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

type RelightSignalData = SignalData & { nodeId?: string };

const RELIGHT_SHADER = `
struct RelightUniforms {
    // vec4 0
    lightType             : f32, // 0=Point, 1=Spot, 2=Directional, 3=Rim
    intensity             : f32,
    lightPosX             : f32,
    lightPosY             : f32,

    // vec4 1
    lightPosZ             : f32,
    lightRadius           : f32,
    spotConeAngle         : f32, // in radians
    specularRoughness     : f32,

    // vec4 2
    specularStrength      : f32,
    metallic              : f32,
    ambientIntensity      : f32,
    volumetricDensity     : f32,

    // vec4 3
    depthScale            : f32,
    depthInvert           : f32,
    hasDepthMap           : f32,
    hasNormalMap          : f32,

    // vec4 4: signal flags
    hasSigIntensity       : f32,
    hasSigPosX            : f32,
    hasSigPosY            : f32,
    hasSigPosZ            : f32,

    // vec4 5: signal flags
    hasSigRadius          : f32,
    hasSigRoughness       : f32,
    hasSigSpecular        : f32,
    hasSigVolumetric      : f32,

    // vec4 6 & 7: colors
    lightColor            : vec4<f32>,
    ambientColor          : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : RelightUniforms;

@group(1) @binding(0) var srcTex     : texture_2d<f32>;
@group(1) @binding(1) var srcSamp    : sampler;

@group(2) @binding(0) var depthTex   : texture_2d<f32>;
@group(2) @binding(1) var depthSamp  : sampler;

@group(3) @binding(0) var intensitySigTex  : texture_2d<f32>;
@group(3) @binding(1) var posXSigTex       : texture_2d<f32>;
@group(3) @binding(2) var posYSigTex       : texture_2d<f32>;
@group(3) @binding(3) var posZSigTex       : texture_2d<f32>;
@group(3) @binding(4) var radiusSigTex     : texture_2d<f32>;
@group(3) @binding(5) var roughnessSigTex  : texture_2d<f32>;
@group(3) @binding(6) var specularSigTex   : texture_2d<f32>;
@group(3) @binding(7) var volumetricSigTex : texture_2d<f32>;
@group(3) @binding(8) var sigSamp          : sampler;

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
    var raw: f32 = 0.0;
    if (u.hasDepthMap > 0.5) {
        let dSample = textureSampleLevel(depthTex, depthSamp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
        raw = dot(dSample.rgb, vec3<f32>(0.299, 0.587, 0.114));
    } else {
        let c = textureSampleLevel(srcTex, srcSamp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0);
        raw = dot(c.rgb, vec3<f32>(0.299, 0.587, 0.114));
    }
    if (u.depthInvert > 0.5) {
        raw = 1.0 - raw;
    }
    return raw;
}

fn sampleSmoothDepth(uv: vec2<f32>, texelSize: vec2<f32>) -> f32 {
    let d0 = sampleDepth(uv);
    let d1 = sampleDepth(uv + vec2<f32>(texelSize.x, 0.0));
    let d2 = sampleDepth(uv - vec2<f32>(texelSize.x, 0.0));
    let d3 = sampleDepth(uv + vec2<f32>(0.0, texelSize.y));
    let d4 = sampleDepth(uv - vec2<f32>(0.0, texelSize.y));
    return (d0 * 4.0 + d1 + d2 + d3 + d4) * 0.125;
}

fn computeNormal(uv: vec2<f32>, texelSize: vec2<f32>) -> vec3<f32> {
    if (u.hasNormalMap > 0.5) {
        let rawNormal = textureSampleLevel(depthTex, depthSamp, clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)), 0.0).rgb;
        return normalize(rawNormal * 2.0 - 1.0);
    }
    let step = texelSize * 2.5;
    let dL = sampleSmoothDepth(uv - vec2<f32>(step.x, 0.0), texelSize);
    let dR = sampleSmoothDepth(uv + vec2<f32>(step.x, 0.0), texelSize);
    let dD = sampleSmoothDepth(uv - vec2<f32>(0.0, step.y), texelSize);
    let dU = sampleSmoothDepth(uv + vec2<f32>(0.0, step.y), texelSize);

    let dx = (dR - dL) * u.depthScale * 1.5;
    let dy = (dU - dD) * u.depthScale * 1.5;
    return normalize(vec3<f32>(-dx, -dy, 1.0));
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
    let albedo = textureSampleLevel(srcTex, srcSamp, in.uv, 0.0);
    if (albedo.a <= 0.0) {
        return albedo;
    }

    let dims = vec2<f32>(textureDimensions(srcTex));
    let texelSize = vec2<f32>(1.0 / dims.x, 1.0 / dims.y);
    let aspect = dims.x / dims.y;

    // Resolve signals
    var intensity = u.intensity;
    if (u.hasSigIntensity > 0.5) {
        intensity = textureSampleLevel(intensitySigTex, sigSamp, in.uv, 0.0).r;
    }

    var posX = u.lightPosX;
    if (u.hasSigPosX > 0.5) {
        posX = textureSampleLevel(posXSigTex, sigSamp, in.uv, 0.0).r;
    }

    var posY = u.lightPosY;
    if (u.hasSigPosY > 0.5) {
        posY = textureSampleLevel(posYSigTex, sigSamp, in.uv, 0.0).r;
    }

    var posZ = u.lightPosZ;
    if (u.hasSigPosZ > 0.5) {
        posZ = textureSampleLevel(posZSigTex, sigSamp, in.uv, 0.0).r;
    }

    var radius = u.lightRadius;
    if (u.hasSigRadius > 0.5) {
        radius = max(0.05, textureSampleLevel(radiusSigTex, sigSamp, in.uv, 0.0).r);
    }

    var roughness = u.specularRoughness;
    if (u.hasSigRoughness > 0.5) {
        roughness = clamp(textureSampleLevel(roughnessSigTex, sigSamp, in.uv, 0.0).r, 0.01, 1.0);
    }

    var specularStrength = u.specularStrength;
    if (u.hasSigSpecular > 0.5) {
        specularStrength = max(0.0, textureSampleLevel(specularSigTex, sigSamp, in.uv, 0.0).r);
    }

    var volumetricDensity = u.volumetricDensity;
    if (u.hasSigVolumetric > 0.5) {
        volumetricDensity = clamp(textureSampleLevel(volumetricSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    // Geometry & Surface Normals
    let depth = sampleSmoothDepth(in.uv, texelSize) * u.depthScale;
    let N = computeNormal(in.uv, texelSize);
    let V = vec3<f32>(0.0, 0.0, 1.0);

    // 3D coordinates (Aspect corrected for uniform radius)
    let pSurface = vec3<f32>((in.uv.x - 0.5) * aspect, in.uv.y - 0.5, - (1.0 - depth) * 0.4);
    let pLight = vec3<f32>((posX - 0.5) * aspect, posY - 0.5, max(0.02, posZ));

    let toLight = pLight - pSurface;
    let dist3D = length(toLight);
    var L = normalize(toLight);

    // Attenuation
    var att = 1.0 / (1.0 + (dist3D / max(0.05, radius)) * (dist3D / max(0.05, radius)));
    var diffuse = max(dot(N, L), 0.0);
    let H = normalize(L + V);
    let NdotH = max(dot(N, H), 0.0);
    let specPower = max(2.0, 2.0 / (roughness * roughness) - 2.0);
    var specular = pow(NdotH, specPower) * specularStrength;

    let lightMode = u.lightType;

    if (lightMode > 0.5 && lightMode < 1.5) {
        // Spot Light
        let spotDir = normalize(vec3<f32>(0.0, 0.0, -1.0));
        let spotAngleCos = dot(-L, spotDir);
        let coneCos = cos(u.spotConeAngle);
        let spotAtt = smoothstep(coneCos, coneCos + 0.15, spotAngleCos);

        diffuse = diffuse * spotAtt;
        specular = specular * spotAtt;
    } else if (lightMode > 1.5 && lightMode < 2.5) {
        // Directional Light
        L = normalize(vec3<f32>(posX - 0.5, posY - 0.5, max(0.1, posZ)));
        att = 1.0;
        diffuse = max(dot(N, L), 0.0);
        let dirH = normalize(L + V);
        specular = pow(max(dot(N, dirH), 0.0), specPower) * specularStrength;
    } else if (lightMode > 2.5) {
        // Rim Light
        let rimTerm = 1.0 - max(dot(N, V), 0.0);
        let rim = pow(rimTerm, 2.5) * (0.5 + depth * 0.8) * 1.5;
        diffuse = max(dot(N, L), 0.0) * 0.2 + rim;
    }

    // Volumetric Atmospheric Light Scatter / Glow
    let dist2D = length(vec2<f32>((in.uv.x - posX) * aspect, in.uv.y - posY));
    let volGlow = volumetricDensity * (1.0 / (1.0 + (dist2D / (radius * 0.5)) * (dist2D / (radius * 0.5)))) * (1.0 - clamp(depth * 0.3, 0.0, 0.8));

    let lightCol = u.lightColor.rgb;
    let ambientCol = u.ambientColor.rgb;

    // Natural Relighting Energy Distribution
    let ambientLighting = ambientCol * clamp(u.ambientIntensity, 0.0, 1.5);
    let diffuseLighting = lightCol * (diffuse * att * intensity * 0.6);
    let specularLighting = mix(vec3<f32>(1.0), albedo.rgb, u.metallic) * (specular * att * intensity * 0.35);
    let volLighting = lightCol * (volGlow * intensity * 0.2);

    let litRgb = albedo.rgb * (ambientLighting + diffuseLighting) + specularLighting + volLighting;

    return vec4<f32>(clamp(litRgb, vec3<f32>(0.0), vec3<f32>(1.0)), albedo.a);
}
`;

interface DeviceRelightResources {
	uniformLayout: GPUBindGroupLayout;
	srcTextureLayout: GPUBindGroupLayout;
	depthTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceRelightResources>();

function getDeviceLayouts(device: GPUDevice): DeviceRelightResources {
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

function getRelightResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `relight_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);

	if (!pipeline) {
		const module = device.createShaderModule({
			label: `relight_${format}.wgsl`,
			code: RELIGHT_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `RelightPipeline_${format}`,
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

function resolveVal(
	val: unknown,
	fallback: number,
	frame: number,
	fps: number,
): number {
	if (val === undefined || val === null) return fallback;
	if (typeof val === "number") return Number.isFinite(val) ? val : fallback;
	if (typeof val === "object" && val !== null) {
		if (
			"get" in (val as Record<string, unknown>) &&
			typeof (val as { get: unknown }).get === "function"
		) {
			try {
				const res = (val as { get: (ctx?: unknown) => unknown }).get({
					frame,
					fps,
					time: fps > 0 ? frame / fps : 0,
					duration: 0,
					durationMs: 0,
					progress: 0,
					deltaTime: fps > 0 ? 1 / fps : 0,
				});
				const n = Number(res);
				if (Number.isFinite(n)) return n;
			} catch {
				// fallback
			}
		}
		if ("value" in (val as Record<string, unknown>)) {
			const n = Number((val as { value: unknown }).value);
			if (Number.isFinite(n)) return n;
		}
	}
	if (typeof val === "function") {
		try {
			const n = Number(val({ frame, fps, time: fps > 0 ? frame / fps : 0 }));
			if (Number.isFinite(n)) return n;
		} catch {
			// fallback
		}
	}
	const n = Number(val);
	return Number.isFinite(n) ? n : fallback;
}

function resolveSignalField(
	op: Relight3DOp,
	fieldName:
		| "intensity"
		| "lightPosX"
		| "lightPosY"
		| "lightPosZ"
		| "lightRadius"
		| "spotConeAngle"
		| "specularRoughness"
		| "specularStrength"
		| "metallic"
		| "ambientIntensity"
		| "volumetricDensity"
		| "depthScale",
	defaultValue: number,
	minVal: number,
	maxVal: number,
	frame: number = 0,
	fps: number = 30,
): { hasSignal: boolean; sd: RelightSignalData | null; value: number } {
	const handleIdKey = `${fieldName}HandleId` as keyof Relight3DOp;
	const handleId = op[handleIdKey] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;

	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd =
		hasSignal && signalInput?.outputItem?.data
			? (signalInput.outputItem.data as RelightSignalData)
			: null;

	let value = defaultValue;
	if (!hasSignal) {
		if (
			signalInput?.connectionValid &&
			signalInput.outputItem?.type === "Number"
		) {
			const raw = resolveVal(signalInput.outputItem.data, defaultValue, frame, fps);
			value = Math.max(minVal, Math.min(maxVal, raw));
		} else {
			const raw = resolveVal(op[fieldName], defaultValue, frame, fps);
			value = Math.max(minVal, Math.min(maxVal, raw));
		}
	} else if (sd) {
		const raw = resolveVal(sd.offset, defaultValue, frame, fps);
		value = Math.max(minVal, Math.min(maxVal, raw));
	}

	return { hasSignal, sd, value };
}

export const Relight3DWebGPURenderer: WebGPUNodeRenderer = async (args) => {
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
	const op = props.virtualMedia?.operation as Relight3DOp | undefined;
	if (op?.op !== "Relight3D" || !op) return;

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

	// 2. Draw normal map or depth map if provided
	const normalMedia =
		op.normalMedia ??
		(op.inputs?.normalMap?.connectionValid
			? (op.inputs.normalMap.outputItem?.data as VirtualMediaData | null)
			: null);
	const depthMedia = normalMedia ?? op.depthMedia;
	let depthTex: GPUTexture;
	let depthView: GPUTextureView;
	let hasDepthMap = false;
	const hasNormalMap = Boolean(normalMedia);

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
	} = getRelightResources(ctx.device, ctx.renderer.format);

	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	// 4. Resolve signal textures
	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 4.0;

	const intensityInfo = resolveSignalField(op, "intensity", 1.0, 0.0, 10.0, frame, fps);
	const posXInfo = resolveSignalField(op, "lightPosX", 0.5, 0.0, 1.0, frame, fps);
	const posYInfo = resolveSignalField(op, "lightPosY", 0.5, 0.0, 1.0, frame, fps);
	const posZInfo = resolveSignalField(op, "lightPosZ", 0.3, -2.0, 2.0, frame, fps);
	const radiusInfo = resolveSignalField(op, "lightRadius", 0.8, 0.05, 5.0, frame, fps);
	const spotConeInfo = resolveSignalField(op, "spotConeAngle", 45, 5, 90, frame, fps);
	const roughnessInfo = resolveSignalField(
		op,
		"specularRoughness",
		0.35,
		0.01,
		1.0,
		frame,
		fps,
	);
	const specularInfo = resolveSignalField(
		op,
		"specularStrength",
		0.7,
		0.0,
		3.0,
		frame,
		fps,
	);
	const metallicInfo = resolveSignalField(op, "metallic", 0.0, 0.0, 1.0, frame, fps);
	const ambientInfo = resolveSignalField(op, "ambientIntensity", 0.4, 0.0, 2.0, frame, fps);
	const volumetricInfo = resolveSignalField(
		op,
		"volumetricDensity",
		0.2,
		0.0,
		1.0,
		frame,
		fps,
	);
	const depthScaleInfo = resolveSignalField(op, "depthScale", 1.0, 0.1, 10.0, frame, fps);

	const getSigTextureView = (
		info: { hasSignal: boolean; sd: RelightSignalData | null },
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

	const sigIntensityView = getSigTextureView(intensityInfo, "relight_int_sig");
	const sigPosXView = getSigTextureView(posXInfo, "relight_posx_sig");
	const sigPosYView = getSigTextureView(posYInfo, "relight_posy_sig");
	const sigPosZView = getSigTextureView(posZInfo, "relight_posz_sig");
	const sigRadiusView = getSigTextureView(radiusInfo, "relight_rad_sig");
	const sigRoughnessView = getSigTextureView(
		roughnessInfo,
		"relight_rough_sig",
	);
	const sigSpecularView = getSigTextureView(specularInfo, "relight_spec_sig");
	const sigVolumetricView = getSigTextureView(
		volumetricInfo,
		"relight_vol_sig",
	);

	// 5. Fill Uniforms
	const uniformData = new Float32Array(32);
	const lightColorParsed = parseColor(op.lightColor ?? "#ffffff");
	const ambientColorParsed = parseColor(op.ambientColor ?? "#ffffff");

	const lightTypeEnum =
		op.lightType === "Spot"
			? 1
			: op.lightType === "Directional"
				? 2
				: op.lightType === "Rim"
					? 3
					: 0;

	uniformData[0] = lightTypeEnum;
	uniformData[1] = intensityInfo.value;
	uniformData[2] = posXInfo.value;
	uniformData[3] = posYInfo.value;

	uniformData[4] = posZInfo.value;
	uniformData[5] = radiusInfo.value;
	uniformData[6] = (spotConeInfo.value * Math.PI) / 180;
	uniformData[7] = roughnessInfo.value;

	uniformData[8] = specularInfo.value;
	uniformData[9] = metallicInfo.value;
	uniformData[10] = ambientInfo.value;
	uniformData[11] = volumetricInfo.value;

	uniformData[12] = depthScaleInfo.value;
	uniformData[13] = op.depthInvert ? 1.0 : 0.0;
	uniformData[14] = (hasDepthMap || hasNormalMap) ? 1.0 : 0.0;
	uniformData[15] = hasNormalMap ? 1.0 : 0.0;

	uniformData[16] = intensityInfo.hasSignal ? 1.0 : 0.0;
	uniformData[17] = posXInfo.hasSignal ? 1.0 : 0.0;
	uniformData[18] = posYInfo.hasSignal ? 1.0 : 0.0;
	uniformData[19] = posZInfo.hasSignal ? 1.0 : 0.0;

	uniformData[20] = radiusInfo.hasSignal ? 1.0 : 0.0;
	uniformData[21] = roughnessInfo.hasSignal ? 1.0 : 0.0;
	uniformData[22] = specularInfo.hasSignal ? 1.0 : 0.0;
	uniformData[23] = volumetricInfo.hasSignal ? 1.0 : 0.0;

	uniformData[24] = lightColorParsed.r;
	uniformData[25] = lightColorParsed.g;
	uniformData[26] = lightColorParsed.b;
	uniformData[27] = lightColorParsed.a;

	uniformData[28] = ambientColorParsed.r;
	uniformData[29] = ambientColorParsed.g;
	uniformData[30] = ambientColorParsed.b;
	uniformData[31] = ambientColorParsed.a;

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
				{ binding: 0, resource: sigIntensityView },
				{ binding: 1, resource: sigPosXView },
				{ binding: 2, resource: sigPosYView },
				{ binding: 3, resource: sigPosZView },
				{ binding: 4, resource: sigRadiusView },
				{ binding: 5, resource: sigRoughnessView },
				{ binding: 6, resource: sigSpecularView },
				{ binding: 7, resource: sigVolumetricView },
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
