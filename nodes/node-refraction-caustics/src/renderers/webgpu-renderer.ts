/// <reference types="webgpu" />
import type { SignalData, VirtualMediaData } from "@gitframes/core";
import type { WebGPUNodeRenderer } from "@gitframes/node-sdk";
import { parseColor, signalRegistry } from "@gitframes/webgpu-renderers";

interface RefractionCaustics3DOp {
	op: "RefractionCaustics3D";
	ior?: number;
	dispersion?: number;
	refractionScale?: number;
	causticBrightness?: number;
	causticScale?: number;
	fluidRipples?: number;
	rippleSpeed?: number;
	roughness?: number;
	specularIntensity?: number;
	lightPosX?: number;
	lightPosY?: number;
	tintColor?: string;
	tintStrength?: number;
	depthInvert?: boolean;
	depthScale?: number;
	opacity?: number;

	iorHandleId?: string | null;
	dispersionHandleId?: string | null;
	refractionScaleHandleId?: string | null;
	causticBrightnessHandleId?: string | null;
	causticScaleHandleId?: string | null;
	fluidRipplesHandleId?: string | null;
	rippleSpeedHandleId?: string | null;
	roughnessHandleId?: string | null;
	specularIntensityHandleId?: string | null;
	lightPosXHandleId?: string | null;
	lightPosYHandleId?: string | null;
	tintStrengthHandleId?: string | null;
	depthScaleHandleId?: string | null;

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

type RefractionSignalData = SignalData & { nodeId?: string };

const REFRACTION_CAUSTICS_SHADER = `
struct RefractionCausticsUniforms {
    // vec4 0
    _pad0                : f32,
    ior                  : f32,
    dispersion           : f32,
    refractionScale      : f32,

    // vec4 1
    causticBrightness    : f32,
    causticScale         : f32,
    fluidRipples         : f32,
    rippleSpeed          : f32,

    // vec4 2
    roughness            : f32,
    specularIntensity    : f32,
    lightPosX            : f32,
    lightPosY            : f32,

    // vec4 3
    tintStrength         : f32,
    depthInvert          : f32,
    depthScale           : f32,
    hasDepthMap          : f32,

    // vec4 4
    timeProgress         : f32,
    aspect               : f32,
    _pad1                : f32,
    _pad2                : f32,

    // vec4 5: signal flags
    hasSigIOR            : f32,
    hasSigDispersion     : f32,
    hasSigRefractScale   : f32,
    hasSigCaustic        : f32,

    // vec4 6: signal flags
    hasSigRipples        : f32,
    hasSigRoughness      : f32,
    hasSigLightPosX      : f32,
    hasSigLightPosY      : f32,

    // vec4 7: reserved
    _pad3                : f32,
    _pad4                : f32,
    _pad5                : f32,
    _pad6                : f32,

    // vec4 8: color
    tintColor            : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : RefractionCausticsUniforms;

@group(1) @binding(0) var srcTex     : texture_2d<f32>;
@group(1) @binding(1) var srcSamp    : sampler;

@group(2) @binding(0) var depthTex   : texture_2d<f32>;
@group(2) @binding(1) var depthSamp  : sampler;

@group(3) @binding(0) var iorSigTex           : texture_2d<f32>;
@group(3) @binding(1) var dispersionSigTex    : texture_2d<f32>;
@group(3) @binding(2) var refractScaleSigTex  : texture_2d<f32>;
@group(3) @binding(3) var causticSigTex       : texture_2d<f32>;
@group(3) @binding(4) var ripplesSigTex       : texture_2d<f32>;
@group(3) @binding(5) var roughnessSigTex     : texture_2d<f32>;
@group(3) @binding(6) var lightPosXSigTex     : texture_2d<f32>;
@group(3) @binding(7) var lightPosYSigTex     : texture_2d<f32>;
@group(3) @binding(8) var sigSamp             : sampler;

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

fn sampleSmoothDepth(uv: vec2<f32>, texelSize: vec2<f32>) -> f32 {
    let d0 = sampleDepth(uv);
    let d1 = sampleDepth(uv + vec2<f32>(texelSize.x, 0.0));
    let d2 = sampleDepth(uv - vec2<f32>(texelSize.x, 0.0));
    let d3 = sampleDepth(uv + vec2<f32>(0.0, texelSize.y));
    let d4 = sampleDepth(uv - vec2<f32>(0.0, texelSize.y));
    return (d0 * 4.0 + d1 + d2 + d3 + d4) * 0.125;
}

// Analytical fluid ripple wave height and normal gradient
fn getFluidWave(uv: vec2<f32>, time: f32, freqScale: f32) -> vec3<f32> {
    let p = uv * freqScale * 18.0;
    let t = time * 3.0;

    let a1 = sin(p.x * 1.4 + p.y * 1.0 + t * 1.2);
    let a2 = sin(p.x * -1.8 + p.y * 1.6 + t * 0.9);
    let a3 = cos((p.x + p.y) * 2.2 - t * 1.4);

    let height = (a1 + a2 + a3) * 0.333;

    let dx = (1.4 * cos(p.x * 1.4 + p.y * 1.0 + t * 1.2)
            - 1.8 * cos(p.x * -1.8 + p.y * 1.6 + t * 0.9)
            - 2.2 * sin((p.x + p.y) * 2.2 - t * 1.4)) * freqScale * 18.0 * 0.333;

    let dy = (1.0 * cos(p.x * 1.4 + p.y * 1.0 + t * 1.2)
            + 1.6 * cos(p.x * -1.8 + p.y * 1.6 + t * 0.9)
            - 2.2 * sin((p.x + p.y) * 2.2 - t * 1.4)) * freqScale * 18.0 * 0.333;

    return vec3<f32>(dx, dy, height);
}

// Photometric cellular water caustic web (swimming pool / sunlight underwater filaments)
fn getWaterCaustics(uv: vec2<f32>, time: f32, scale: f32) -> f32 {
    let p = uv * scale * 32.0;
    let t1 = time * 0.8;
    let t2 = time * 1.1;

    var p1 = p;
    p1.x = p1.x + sin(p.y * 0.45 + t1) * 1.6;
    p1.y = p1.y + cos(p.x * 0.45 + t1 * 0.8) * 1.6;

    var p2 = p * 1.2 + vec2<f32>(4.7, 2.1);
    p2.x = p2.x + cos(p2.y * 0.5 - t2 * 0.9) * 1.4;
    p2.y = p2.y + sin(p2.x * 0.5 + t2) * 1.4;

    let k1 = 1.0 - abs(sin(p1.x) * sin(p1.y));
    let k2 = 1.0 - abs(cos(p2.x) * cos(p2.y));

    // Sharp interconnected caustic web filaments
    let web = pow(k1 * k2, 3.5);
    return web;
}

fn computeSurfaceNormal(uv: vec2<f32>, texelSize: vec2<f32>, fluidRippleAmount: f32, rippleTime: f32, depthScaleVal: f32, causticScaleVal: f32) -> vec3<f32> {
    let step = texelSize * 2.0;
    let dL = sampleSmoothDepth(uv - vec2<f32>(step.x, 0.0), texelSize);
    let dR = sampleSmoothDepth(uv + vec2<f32>(step.x, 0.0), texelSize);
    let dD = sampleSmoothDepth(uv - vec2<f32>(0.0, step.y), texelSize);
    let dU = sampleSmoothDepth(uv + vec2<f32>(0.0, step.y), texelSize);

    var dx = (dR - dL) * depthScaleVal * 2.0;
    var dy = (dU - dD) * depthScaleVal * 2.0;

    if (fluidRippleAmount > 0.001) {
        let wave = getFluidWave(uv, rippleTime, causticScaleVal);
        dx = dx + wave.x * fluidRippleAmount * 0.08;
        dy = dy + wave.y * fluidRippleAmount * 0.08;
    }

    return normalize(vec3<f32>(-dx, -dy, 1.0));
}

// Snell's Law ray refraction with Total Internal Reflection (TIR) fallback
fn calcRefractOffset(I: vec3<f32>, N: vec3<f32>, eta: f32, thickness: f32) -> vec2<f32> {
    let cosi = dot(-I, N);
    let cost2 = 1.0 - eta * eta * (1.0 - cosi * cosi);
    if (cost2 < 0.0) {
        // Total internal reflection -> reflect
        let R = reflect(I, N);
        return R.xy * thickness * 0.5;
    }
    let R = eta * I + (eta * cosi - sqrt(cost2)) * N;
    return R.xy * (thickness / max(0.2, abs(R.z)));
}

fn sampleAlbedoSafe(uv: vec2<f32>) -> vec4<f32> {
    if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
        return textureSampleLevel(srcTex, srcSamp, uv, 0.0);
    }
    // Mirror with subtle clamp for border inpainting / anti-tearing
    let mirroredUV = abs(fract(uv * 0.5 + 0.5) * 2.0 - 1.0);
    let clampedUV = clamp(mirroredUV, vec2<f32>(0.001), vec2<f32>(0.999));
    return textureSampleLevel(srcTex, srcSamp, clampedUV, 0.0);
}

fn spectralWavelength(t: f32) -> vec3<f32> {
    let x = clamp(t, 0.0, 1.0) * 6.0;
    var r: f32 = 0.0;
    var g: f32 = 0.0;
    var b: f32 = 0.0;

    if (x < 1.0) {
        r = 1.0;
        g = x;
        b = 0.0;
    } else if (x < 2.0) {
        r = 2.0 - x;
        g = 1.0;
        b = 0.0;
    } else if (x < 3.0) {
        r = 0.0;
        g = 1.0;
        b = x - 2.0;
    } else if (x < 4.0) {
        r = 0.0;
        g = 4.0 - x;
        b = 1.0;
    } else if (x < 5.0) {
        r = x - 4.0;
        g = 0.0;
        b = 1.0;
    } else {
        r = 1.0;
        g = 0.0;
        b = max(0.4, 6.0 - x);
    }
    return vec3<f32>(r, g, b);
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
    let dims = vec2<f32>(textureDimensions(srcTex));
    let texelSize = vec2<f32>(1.0 / dims.x, 1.0 / dims.y);
    let aspect = select(u.aspect, dims.x / max(1.0, dims.y), u.aspect <= 0.0);

    // Resolve signals
    var ior = u.ior;
    if (u.hasSigIOR > 0.5) {
        ior = clamp(textureSampleLevel(iorSigTex, sigSamp, in.uv, 0.0).r, 1.0, 2.5);
    }

    var dispersion = u.dispersion;
    if (u.hasSigDispersion > 0.5) {
        dispersion = clamp(textureSampleLevel(dispersionSigTex, sigSamp, in.uv, 0.0).r, 0.0, 0.2);
    }

    var refractionScale = u.refractionScale;
    if (u.hasSigRefractScale > 0.5) {
        refractionScale = clamp(textureSampleLevel(refractScaleSigTex, sigSamp, in.uv, 0.0).r, 0.0, 2.0);
    }

    var causticBrightness = u.causticBrightness;
    if (u.hasSigCaustic > 0.5) {
        causticBrightness = clamp(textureSampleLevel(causticSigTex, sigSamp, in.uv, 0.0).r, 0.0, 2.0);
    }

    var fluidRipples = u.fluidRipples;
    if (u.hasSigRipples > 0.5) {
        fluidRipples = clamp(textureSampleLevel(ripplesSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    var roughness = u.roughness;
    if (u.hasSigRoughness > 0.5) {
        roughness = clamp(textureSampleLevel(roughnessSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    var lightPosX = u.lightPosX;
    if (u.hasSigLightPosX > 0.5) {
        lightPosX = clamp(textureSampleLevel(lightPosXSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    var lightPosY = u.lightPosY;
    if (u.hasSigLightPosY > 0.5) {
        lightPosY = clamp(textureSampleLevel(lightPosYSigTex, sigSamp, in.uv, 0.0).r, 0.0, 1.0);
    }

    let depthScaleVal = u.depthScale;
    let causticScaleVal = max(0.1, u.causticScale);
    let rippleSpeedVal = u.rippleSpeed;
    let rippleTime = u.timeProgress * rippleSpeedVal * 6.2831853;

    // Surface Normal & Incident Vectors
    let N = computeSurfaceNormal(in.uv, texelSize, fluidRipples, rippleTime, depthScaleVal, causticScaleVal);
    let I = vec3<f32>(0.0, 0.0, -1.0); // View vector towards surface
    let V = vec3<f32>(0.0, 0.0, 1.0);  // View vector towards camera

    // Base Snell's Law Refraction
    let eta = 1.0 / max(1.001, ior);
    let refractVec = calcRefractOffset(I, N, eta, refractionScale * 0.16);
    let baseUV = in.uv + vec2<f32>(refractVec.x / aspect, refractVec.y);

    // Multi-Spectral Chromatic Rainbow Dispersion
    var accumColor = vec3<f32>(0.0);
    var accumWeight = vec3<f32>(0.0);
    var accumAlpha: f32 = 0.0;

    let dispersionStrength = dispersion * refractionScale * 0.6;
    let dispDirection = vec2<f32>(N.x / aspect, N.y);

    // 7-tap spectral rainbow integration across wavelength spectrum (Red -> Yellow -> Green -> Cyan -> Blue -> Violet)
    for (var s = 0; s < 7; s = s + 1) {
        let t = f32(s) / 6.0; // 0.0 (Red) to 1.0 (Violet)
        let specColor = spectralWavelength(t);
        let lambdaOffset = dispDirection * ((t - 0.5) * dispersionStrength);
        let sampleUV = baseUV + lambdaOffset;

        var sampledTex = sampleAlbedoSafe(sampleUV);

        // Microfacet frosted blur if roughness is enabled
        if (roughness > 0.005) {
            let blurRad = roughness * 0.018;
            let j1 = sampleAlbedoSafe(sampleUV + vec2<f32>(blurRad / aspect, blurRad * 0.5));
            let j2 = sampleAlbedoSafe(sampleUV - vec2<f32>(blurRad / aspect, blurRad * 0.5));
            sampledTex = (sampledTex * 2.0 + j1 + j2) * 0.25;
        }

        accumColor = accumColor + sampledTex.rgb * specColor;
        accumWeight = accumWeight + specColor;
        accumAlpha = accumAlpha + sampledTex.a;
    }

    let finalRefractedRGB = accumColor / max(accumWeight, vec3<f32>(0.001));
    let finalAlpha = accumAlpha / 7.0;

    // Incident light vector
    let lightPos3D = vec3<f32>((lightPosX - 0.5) * aspect, lightPosY - 0.5, 0.85);
    let surfPos3D = vec3<f32>((in.uv.x - 0.5) * aspect, in.uv.y - 0.5, 0.0);
    let L = normalize(lightPos3D - surfPos3D);

    // 1. Dynamic Fluid Caustics (active when fluidRipples > 0.001)
    var fluidCaustic = 0.0;
    if (fluidRipples > 0.001) {
        let web = getWaterCaustics(in.uv, rippleTime, causticScaleVal);
        let pLight = vec2<f32>(lightPosX, lightPosY);
        let distLight = length((in.uv - pLight) * vec2<f32>(aspect, 1.0));
        let lightAtt = 1.0 / (1.0 + distLight * distLight * 1.2);
        fluidCaustic = web * lightAtt * fluidRipples * causticBrightness * 0.45;
    }

    // 2. Specular Highlights & Fresnel Reflectance (Schlick's approximation)
    let f0 = pow((ior - 1.0) / (ior + 1.0), 2.0);
    let NdotV = max(dot(N, V), 0.0);
    let fresnel = f0 + (1.0 - f0) * pow(1.0 - NdotV, 5.0);

    let H = normalize(L + V);
    let NdotH = max(dot(N, H), 0.0);
    let specShininess = mix(256.0, 32.0, roughness);
    let specular = pow(NdotH, specShininess) * u.specularIntensity * fresnel * 1.5;

    // Glass Absorption & Tinting
    let tintStrengthVal = u.tintStrength;
    let tintedBase = mix(finalRefractedRGB, finalRefractedRGB * u.tintColor.rgb, tintStrengthVal);

    // Final Composite (Refracted Rainbow Spectrum + Fluid Caustics + Crisp Specular)
    let finalRGB = tintedBase + vec3<f32>(fluidCaustic) * u.tintColor.rgb + vec3<f32>(specular);

    return vec4<f32>(clamp(finalRGB, vec3<f32>(0.0), vec3<f32>(1.0)), finalAlpha);
}
`;

interface DeviceRefractionCausticsResources {
	uniformLayout: GPUBindGroupLayout;
	srcTextureLayout: GPUBindGroupLayout;
	depthTextureLayout: GPUBindGroupLayout;
	signalTextureLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<
	GPUDevice,
	DeviceRefractionCausticsResources
>();

function getDeviceLayouts(
	device: GPUDevice,
): DeviceRefractionCausticsResources {
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

function getRefractionCausticsResources(
	device: GPUDevice,
	format: GPUTextureFormat,
) {
	const layouts = getDeviceLayouts(device);
	const cacheKey = `refraction_caustics_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);

	if (!pipeline) {
		const module = device.createShaderModule({
			label: `refraction_caustics_${format}.wgsl`,
			code: REFRACTION_CAUSTICS_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `RefractionCausticsPipeline_${format}`,
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
	op: RefractionCaustics3DOp,
	fieldName:
		| "ior"
		| "dispersion"
		| "refractionScale"
		| "causticBrightness"
		| "causticScale"
		| "fluidRipples"
		| "roughness"
		| "lightPosX"
		| "lightPosY"
		| "specularIntensity"
		| "depthScale"
		| "tintStrength"
		| "rippleSpeed",
	defaultValue: number,
	minVal: number,
	maxVal: number,
): { hasSignal: boolean; sd: RefractionSignalData | null; value: number } {
	const handleIdKey = `${fieldName}HandleId` as keyof RefractionCaustics3DOp;
	const handleId = op[handleIdKey] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;

	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd =
		hasSignal && signalInput?.outputItem?.data
			? (signalInput.outputItem.data as RefractionSignalData)
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

export const RefractionCaustics3DWebGPURenderer: WebGPUNodeRenderer = async (
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
	const op = props.virtualMedia?.operation as
		| RefractionCaustics3DOp
		| undefined;
	if (op?.op !== "RefractionCaustics3D" || !op) return;

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
	} = getRefractionCausticsResources(ctx.device, ctx.renderer.format);

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

	const iorInfo = resolveSignalField(op, "ior", 1.52, 1.0, 2.5);
	const dispersionInfo = resolveSignalField(op, "dispersion", 0.04, 0.0, 0.2);
	const refractScaleInfo = resolveSignalField(
		op,
		"refractionScale",
		0.5,
		0.0,
		2.0,
	);
	const causticInfo = resolveSignalField(
		op,
		"causticBrightness",
		0.6,
		0.0,
		2.0,
	);
	const causticScaleInfo = resolveSignalField(
		op,
		"causticScale",
		1.0,
		0.1,
		5.0,
	);
	const ripplesInfo = resolveSignalField(op, "fluidRipples", 0.0, 0.0, 1.0);
	const roughnessInfo = resolveSignalField(op, "roughness", 0.0, 0.0, 1.0);
	const lightPosXInfo = resolveSignalField(op, "lightPosX", 0.5, 0.0, 1.0);
	const lightPosYInfo = resolveSignalField(op, "lightPosY", 0.2, 0.0, 1.0);
	const specularInfo = resolveSignalField(
		op,
		"specularIntensity",
		0.8,
		0.0,
		2.0,
	);
	const depthScaleInfo = resolveSignalField(op, "depthScale", 1.0, 0.1, 5.0);
	const tintStrengthInfo = resolveSignalField(
		op,
		"tintStrength",
		0.0,
		0.0,
		1.0,
	);
	const rippleSpeedInfo = resolveSignalField(op, "rippleSpeed", 1.0, 0.0, 5.0);

	const getSigTextureView = (
		info: { hasSignal: boolean; sd: RefractionSignalData | null },
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

	const sigIORView = getSigTextureView(iorInfo, "refr_ior_sig");
	const sigDispersionView = getSigTextureView(dispersionInfo, "refr_disp_sig");
	const sigRefractScaleView = getSigTextureView(
		refractScaleInfo,
		"refr_scale_sig",
	);
	const sigCausticView = getSigTextureView(causticInfo, "refr_caust_sig");
	const sigRipplesView = getSigTextureView(ripplesInfo, "refr_rip_sig");
	const sigRoughnessView = getSigTextureView(roughnessInfo, "refr_rough_sig");
	const sigLightPosXView = getSigTextureView(lightPosXInfo, "refr_lightx_sig");
	const sigLightPosYView = getSigTextureView(lightPosYInfo, "refr_lighty_sig");

	// 5. Fill Uniforms (36 floats / 9 vec4s)
	const uniformData = new Float32Array(36);

	// vec4 0
	uniformData[0] = 0.0;
	uniformData[1] = iorInfo.value;
	uniformData[2] = dispersionInfo.value;
	uniformData[3] = refractScaleInfo.value;

	// vec4 1
	uniformData[4] = causticInfo.value;
	uniformData[5] = causticScaleInfo.value;
	uniformData[6] = ripplesInfo.value;
	uniformData[7] = rippleSpeedInfo.value;

	// vec4 2
	uniformData[8] = roughnessInfo.value;
	uniformData[9] = specularInfo.value;
	uniformData[10] = lightPosXInfo.value;
	uniformData[11] = lightPosYInfo.value;

	// vec4 3
	uniformData[12] = tintStrengthInfo.value;
	uniformData[13] = op.depthInvert ? 1.0 : 0.0;
	uniformData[14] = depthScaleInfo.value;
	uniformData[15] = hasDepthMap ? 1.0 : 0.0;

	// vec4 4
	uniformData[16] = timeProgress;
	uniformData[17] = width / Math.max(1, height);
	uniformData[18] = 0.0;
	uniformData[19] = 0.0;

	// vec4 5: signal flags
	uniformData[20] = iorInfo.hasSignal ? 1.0 : 0.0;
	uniformData[21] = dispersionInfo.hasSignal ? 1.0 : 0.0;
	uniformData[22] = refractScaleInfo.hasSignal ? 1.0 : 0.0;
	uniformData[23] = causticInfo.hasSignal ? 1.0 : 0.0;

	// vec4 6: signal flags
	uniformData[24] = ripplesInfo.hasSignal ? 1.0 : 0.0;
	uniformData[25] = roughnessInfo.hasSignal ? 1.0 : 0.0;
	uniformData[26] = lightPosXInfo.hasSignal ? 1.0 : 0.0;
	uniformData[27] = lightPosYInfo.hasSignal ? 1.0 : 0.0;

	// vec4 7: reserved
	uniformData[28] = 0.0;
	uniformData[29] = 0.0;
	uniformData[30] = 0.0;
	uniformData[31] = 0.0;

	// vec4 8: color
	const tintParsed = parseColor(op.tintColor ?? "#ffffff");
	uniformData[32] = tintParsed.r;
	uniformData[33] = tintParsed.g;
	uniformData[34] = tintParsed.b;
	uniformData[35] = tintParsed.a;

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
				{ binding: 0, resource: sigIORView },
				{ binding: 1, resource: sigDispersionView },
				{ binding: 2, resource: sigRefractScaleView },
				{ binding: 3, resource: sigCausticView },
				{ binding: 4, resource: sigRipplesView },
				{ binding: 5, resource: sigRoughnessView },
				{ binding: 6, resource: sigLightPosXView },
				{ binding: 7, resource: sigLightPosYView },
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
