/**
 * Half-resolution Volumetric Fog & Shadowed Light-Shaft (God Ray) pipeline
 * with depth-aware bilateral upsampling.
 *
 * Reuses the 3D scene's @group(0) CameraUniforms and @group(3) Lights/ShadowMap
 * bind groups directly so every directional, spot, point, and rect light —
 * including multi-light PCF / omnidirectional shadow maps — carves volumetric
 * shafts through the participating medium with zero extra shadow passes.
 */

import type { ResolvedVolumetricFog } from "../math3d/environment3d.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { lighting3dWgsl, lightsBindingsWgsl } from "../shaders/lighting3d.js";
import { createLightsLayout } from "./quad3d-pipeline.js";

const VOLUMETRIC_UNIFORM_FLOATS = 24;
const VOLUMETRIC_UNIFORM_BYTES = VOLUMETRIC_UNIFORM_FLOATS * 4;

const volumetricFogWgsl = `
${lighting3dWgsl}

struct VolumetricFogUniforms {
    fogColorDensity : vec4<f32>, // rgb = linear fog scatter color, w = base density
    scatterParams   : vec4<f32>, // x = anisotropy g, y = heightFalloff, z = baseHeight, w = maxDistance
    marchParams     : vec4<f32>, // x = steps, y = lightIntensity, z = ambientIntensity, w = frameIndex
    noiseParams     : vec4<f32>, // x = noiseScale, y = noiseStrength, z = octaves, w = timeSeconds
    windVelocity    : vec4<f32>, // xyz = wind speed (px/s), w = depthSigma
    resParams       : vec4<f32>, // xy = halfRes (w, h), zw = fullRes (w, h)
};

@group(0) @binding(0) var<uniform> cam : CameraUniforms;
@group(1) @binding(0) var<uniform> vfog : VolumetricFogUniforms;
@group(1) @binding(1) var linearDepthTex : texture_2d<f32>;
@group(1) @binding(2) var sceneColorTex : texture_2d<f32>;
@group(1) @binding(3) var halfFogTex : texture_2d<f32>;
@group(1) @binding(4) var linearSampler : sampler;
${lightsBindingsWgsl}

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs_fullscreen(@builtin(vertex_index) vid : u32) -> VsOut {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0)
    );
    var out : VsOut;
    let p = pos[vid];
    out.pos = vec4<f32>(p, 0.0, 1.0);
    out.uv = vec2<f32>(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5);
    return out;
}

// Jorge Jimenez's Interleaved Gradient Noise for jittering raymarch steps.
fn interleavedGradientNoise(pixel : vec2<f32>, frame : f32) -> f32 {
    let p = pixel + 5.588238 * (frame % 64.0);
    return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y));
}

fn hash31(p3 : vec3<f32>) -> f32 {
    var p = fract(p3 * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
}

fn valueNoise3D(x : vec3<f32>) -> f32 {
    let i = floor(x);
    let f = fract(x);
    let u = f * f * (3.0 - 2.0 * f);
    let n000 = hash31(i + vec3<f32>(0.0, 0.0, 0.0));
    let n100 = hash31(i + vec3<f32>(1.0, 0.0, 0.0));
    let n010 = hash31(i + vec3<f32>(0.0, 1.0, 0.0));
    let n110 = hash31(i + vec3<f32>(1.0, 1.0, 0.0));
    let n001 = hash31(i + vec3<f32>(0.0, 0.0, 1.0));
    let n101 = hash31(i + vec3<f32>(1.0, 0.0, 1.0));
    let n011 = hash31(i + vec3<f32>(0.0, 1.0, 1.0));
    let n111 = hash31(i + vec3<f32>(1.0, 1.0, 1.0));
    let nx00 = mix(n000, n100, u.x);
    let nx10 = mix(n010, n110, u.x);
    let nx01 = mix(n001, n101, u.x);
    let nx11 = mix(n101, n111, u.x);
    let nxy0 = mix(nx00, nx10, u.y);
    let nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

fn fbmNoise3D(worldPos : vec3<f32>, scale : f32, octaves : i32) -> f32 {
    var q = (worldPos - vfog.windVelocity.xyz * vfog.noiseParams.w) * scale;
    var val = 0.0;
    var amp = 0.55;
    var norm = 0.0;
    for (var o = 0; o < 3; o++) {
        if (o >= octaves) {
            break;
        }
        val += amp * valueNoise3D(q);
        norm += amp;
        q = q * 2.03 + vec3<f32>(17.1, 31.7, 11.3);
        amp *= 0.5;
    }
    return select(0.5, val / max(norm, 1e-4), norm > 0.0);
}

// Henyey-Greenstein phase function P(cosTheta, g).
fn henyeyGreenstein(cosTheta : f32, g : f32) -> f32 {
    let g2 = g * g;
    let denom = max(1e-4, 1.0 + g2 - 2.0 * g * cosTheta);
    return (1.0 - g2) / (4.0 * PI * denom * sqrt(denom));
}

fn reconstructRayDir(uv : vec2<f32>) -> vec3<f32> {
    let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
    let worldH = cam.invViewProjMatrix * vec4<f32>(ndc, 0.5, 1.0);
    let worldPt = worldH.xyz / max(abs(worldH.w), 1e-6);
    return normalize(worldPt - cam.cameraPos.xyz);
}

@fragment
fn fs_raymarch(in : VsOut) -> @location(0) vec4<f32> {
    let baseDensity = vfog.fogColorDensity.w;
    if (baseDensity <= 1e-6) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    let rayOrigin = cam.cameraPos.xyz;
    let rayDir = reconstructRayDir(in.uv);
    let camFwd = normalize(cam.cameraDir.xyz);
    let cosView = max(0.1, dot(rayDir, camFwd));

    let rawDepth = textureSampleLevel(linearDepthTex, linearSampler, in.uv, 0.0).r;
    let maxDist = vfog.scatterParams.w;
    let surfaceDist = select(maxDist, rawDepth / cosView, rawDepth > 0.05);
    let marchDist = clamp(surfaceDist, 0.0, maxDist);
    if (marchDist <= 1.0) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    let steps = clamp(i32(vfog.marchParams.x), 8, 64);
    let dt = marchDist / f32(steps);
    let jitter = interleavedGradientNoise(in.pos.xy, vfog.marchParams.w);

    let g = vfog.scatterParams.x;
    let heightFalloff = vfog.scatterParams.y;
    let baseHeight = vfog.scatterParams.z;
    let lightScale = vfog.marchParams.y;
    let ambientScale = vfog.marchParams.z;
    let noiseScale = vfog.noiseParams.x;
    let noiseStrength = vfog.noiseParams.y;
    let noiseOctaves = i32(vfog.noiseParams.z);
    let fogTint = vfog.fogColorDensity.rgb;
    let ambientIrr = (lights.envHorizon.rgb + lights.ambientLinear.rgb + srgbToLinear(lights.ambientColor.rgb) * 0.35) * ambientScale;

    // Scale user density (e.g. 0.02) into world-px extinction (1 / px).
    let sigmaBase = baseDensity * 0.012;
    let numLights = i32(lights.params.x);

    var transmittance = 1.0;
    var accumLight = vec3<f32>(0.0);

    for (var s = 0; s < 64; s++) {
        if (s >= steps || transmittance < 0.01) {
            break;
        }
        let t = (f32(s) + jitter) * dt;
        let samplePos = rayOrigin + rayDir * t;

        // Exponential height falloff (in Y-down coordinates, ground is at +baseHeight;
        // higher altitude above ground means smaller Y, i.e. baseHeight - samplePos.y > 0).
        let altitudeAboveGround = max(0.0, baseHeight - samplePos.y);
        let heightFactor = exp(-heightFalloff * altitudeAboveGround);

        var densityMod = heightFactor;
        if (noiseStrength > 0.001 && noiseOctaves > 0) {
            let n = fbmNoise3D(samplePos, noiseScale, noiseOctaves);
            densityMod *= mix(1.0, clamp(n * 1.65, 0.0, 2.0), noiseStrength);
        }

        let sigmaT = sigmaBase * densityMod;
        if (sigmaT <= 1e-6) {
            continue;
        }

        var stepScatter = ambientIrr;
        if (lightScale > 0.001) {
            for (var i = 0; i < numLights; i++) {
                let ls = sampleLight(i, samplePos);
                if (!ls.valid) {
                    continue;
                }
                let vis = volumetricShadowFactor(samplePos, i);
                if (vis <= 0.001) {
                    continue;
                }
                let light = directLights[i];
                // Forward scattering angle: incoming light (-ls.L) vs outgoing view ray to eye (-rayDir),
                // i.e. dot(-ls.L, -rayDir) == dot(rayDir, ls.L).
                let cosTheta = dot(rayDir, ls.L);
                let phase = henyeyGreenstein(cosTheta, g);
                let lightRad = srgbToLinear(light.colorIntensity.rgb) * light.colorIntensity.w * ls.attenuation;
                stepScatter += lightRad * (phase * vis * lightScale * 4.0 * PI);
            }
        }

        let stepTrans = exp(-sigmaT * dt);
        let integWeight = 1.0 - stepTrans;
        accumLight += transmittance * stepScatter * fogTint * integWeight;
        transmittance *= stepTrans;
    }

    return vec4<f32>(accumLight, clamp(transmittance, 0.0, 1.0));
}

@fragment
fn fs_upsample(in : VsOut) -> @location(0) vec4<f32> {
    let baseSrgb = textureSampleLevel(sceneColorTex, linearSampler, in.uv, 0.0);
    let centerDepth = textureSampleLevel(linearDepthTex, linearSampler, in.uv, 0.0).r;
    let halfTexel = 1.0 / max(vfog.resParams.xy, vec2<f32>(1.0));

    let depthSigma = max(10.0, vfog.windVelocity.w);
    var sumFog = vec4<f32>(0.0);
    var sumWeight = 0.0;

    for (var oy = -1; oy <= 1; oy++) {
        let wy = select(1.0, 2.0, oy == 0);
        for (var ox = -1; ox <= 1; ox++) {
            let wx = select(1.0, 2.0, ox == 0);
            let spatialW = (wx * wy) * 0.0625;
            let offset = vec2<f32>(f32(ox), f32(oy)) * 0.75 * halfTexel;
            let sampleUv = clamp(in.uv + offset, vec2<f32>(0.001), vec2<f32>(0.999));
            let fogSample = textureSampleLevel(halfFogTex, linearSampler, sampleUv, 0.0);
            let sampleDepth = textureSampleLevel(linearDepthTex, linearSampler, sampleUv, 0.0).r;
            let depthDiff = abs(centerDepth - sampleDepth);
            let wDepth = exp(-depthDiff / depthSigma);
            let w = spatialW * max(wDepth, 1e-3);
            sumFog += fogSample * w;
            sumWeight += w;
        }
    }

    let fog = select(vec4<f32>(0.0, 0.0, 0.0, 1.0), sumFog / sumWeight, sumWeight > 1e-5);
    let transmittance = clamp(fog.a, 0.0, 1.0);
    let fogAlpha = clamp(1.0 - transmittance, 0.0, 1.0);
    let inScattered = max(vec3<f32>(0.0), fog.rgb);
    let straightFogLinear = inScattered / max(fogAlpha, 1e-4);
    let mappedFogLinear = select(
        clamp(straightFogLinear, vec3<f32>(0.0), vec3<f32>(1.0)),
        toneMap(straightFogLinear),
        lights.params.z > 0.5
    );
    let premulFogSrgb = linearToSrgb(mappedFogLinear) * fogAlpha;
    let finalRgb = baseSrgb.rgb * transmittance + premulFogSrgb;
    let finalAlpha = clamp(baseSrgb.a * transmittance + fogAlpha, 0.0, 1.0);
    return vec4<f32>(clamp(finalRgb, vec3<f32>(0.0), vec3<f32>(1.0)), finalAlpha);
}
`;

export interface VolumetricFogRenderParams {
	encoder: GPUCommandEncoder;
	sourceColorTex: GPUTexture;
	linearDepthTex: GPUTexture;
	halfFogTex: GPUTexture;
	destView: GPUTextureView;
	cameraBindGroup: GPUBindGroup;
	lightsBindGroup: GPUBindGroup;
	fog: ResolvedVolumetricFog;
	fullWidth: number;
	fullHeight: number;
	halfWidth: number;
	halfHeight: number;
	timeSeconds: number;
	frameIndex: number;
}

export class VolumetricFogPipeline {
	private device: GPUDevice;
	private raymarchPipeline: GPURenderPipeline;
	private upsamplePipeline: GPURenderPipeline;
	private fogBindGroupLayout: GPUBindGroupLayout;
	private emptyGroup2Layout: GPUBindGroupLayout;
	private emptyGroup2BindGroup: GPUBindGroup;
	private linearSampler: GPUSampler;
	private bufferPool: BufferPool;
	private uniformScratch = new Float32Array(VOLUMETRIC_UNIFORM_FLOATS);

	constructor(device: GPUDevice, format: GPUTextureFormat = "bgra8unorm") {
		this.device = device;
		this.bufferPool = new BufferPool(
			VOLUMETRIC_UNIFORM_BYTES,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.linearSampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});

		const cameraLayout = device.createBindGroupLayout({
			label: "VolumetricFogCameraLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		const lightsLayout = createLightsLayout(device);

		this.fogBindGroupLayout = device.createBindGroupLayout({
			label: "VolumetricFogBindGroupLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
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
					sampler: { type: "filtering" },
				},
			],
		});

		this.emptyGroup2Layout = device.createBindGroupLayout({
			label: "VolumetricFogEmptyGroup2Layout",
			entries: [],
		});
		this.emptyGroup2BindGroup = device.createBindGroup({
			layout: this.emptyGroup2Layout,
			entries: [],
		});

		const pipelineLayout = device.createPipelineLayout({
			label: "VolumetricFogPipelineLayout",
			bindGroupLayouts: [
				cameraLayout,
				this.fogBindGroupLayout,
				this.emptyGroup2Layout,
				lightsLayout,
			],
		});

		const shaderModule = device.createShaderModule({
			label: "VolumetricFogShader",
			code: volumetricFogWgsl,
		});

		this.raymarchPipeline = device.createRenderPipeline({
			label: "VolumetricFogRaymarchPipeline",
			layout: pipelineLayout,
			vertex: {
				module: shaderModule,
				entryPoint: "vs_fullscreen",
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fs_raymarch",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});

		this.upsamplePipeline = device.createRenderPipeline({
			label: "VolumetricFogUpsamplePipeline",
			layout: pipelineLayout,
			vertex: {
				module: shaderModule,
				entryPoint: "vs_fullscreen",
			},
			fragment: {
				module: shaderModule,
				entryPoint: "fs_upsample",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	resetPools(): void {
		this.bufferPool.reset();
	}

	destroy(): void {
		this.bufferPool.destroy();
	}

	render(params: VolumetricFogRenderParams): void {
		const {
			encoder,
			sourceColorTex,
			linearDepthTex,
			halfFogTex,
			destView,
			cameraBindGroup,
			lightsBindGroup,
			fog,
			fullWidth,
			fullHeight,
			halfWidth,
			halfHeight,
			timeSeconds,
			frameIndex,
		} = params;

		const u = this.uniformScratch;
		u[0] = fog.color[0];
		u[1] = fog.color[1];
		u[2] = fog.color[2];
		u[3] = fog.density;

		u[4] = fog.anisotropy;
		u[5] = fog.heightFalloff;
		u[6] = fog.baseHeight;
		u[7] = fog.maxDistance;

		u[8] = fog.steps;
		u[9] = fog.lightIntensity;
		u[10] = fog.ambientIntensity;
		u[11] = frameIndex;

		u[12] = fog.noiseScale;
		u[13] = fog.noiseStrength;
		u[14] = fog.noiseOctaves;
		u[15] = timeSeconds;

		u[16] = fog.noiseSpeed[0];
		u[17] = fog.noiseSpeed[1];
		u[18] = fog.noiseSpeed[2];
		u[19] = 85.0; // bilateral depth sigma in world px

		u[20] = halfWidth;
		u[21] = halfHeight;
		u[22] = fullWidth;
		u[23] = fullHeight;

		const uniformBuffer = this.bufferPool.getBuffer(this.device, u);

		const depthView = linearDepthTex.createView();
		const colorView = sourceColorTex.createView();
		const halfFogView = halfFogTex.createView();

		// Pass 1: Half-resolution volumetric raymarching into halfFogView
		const raymarchBindGroup = this.device.createBindGroup({
			layout: this.fogBindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: depthView },
				{ binding: 2, resource: colorView },
				{ binding: 3, resource: depthView },
				{ binding: 4, resource: this.linearSampler },
			],
		});

		const rayPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: halfFogView,
					loadOp: "clear",
					clearValue: { r: 0, g: 0, b: 0, a: 1 },
					storeOp: "store",
				},
			],
		});
		rayPass.setPipeline(this.raymarchPipeline);
		rayPass.setBindGroup(0, cameraBindGroup);
		rayPass.setBindGroup(1, raymarchBindGroup);
		rayPass.setBindGroup(2, this.emptyGroup2BindGroup);
		rayPass.setBindGroup(3, lightsBindGroup);
		rayPass.draw(3, 1, 0, 0);
		rayPass.end();

		// Pass 2: Full-resolution depth-aware bilateral upsample & composite into destView
		const upsampleBindGroup = this.device.createBindGroup({
			layout: this.fogBindGroupLayout,
			entries: [
				{ binding: 0, resource: { buffer: uniformBuffer } },
				{ binding: 1, resource: depthView },
				{ binding: 2, resource: colorView },
				{ binding: 3, resource: halfFogView },
				{ binding: 4, resource: this.linearSampler },
			],
		});

		const upPass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: destView,
					loadOp: "clear",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
					storeOp: "store",
				},
			],
		});
		upPass.setPipeline(this.upsamplePipeline);
		upPass.setBindGroup(0, cameraBindGroup);
		upPass.setBindGroup(1, upsampleBindGroup);
		upPass.setBindGroup(2, this.emptyGroup2BindGroup);
		upPass.setBindGroup(3, lightsBindGroup);
		upPass.draw(3, 1, 0, 0);
		upPass.end();
	}
}
