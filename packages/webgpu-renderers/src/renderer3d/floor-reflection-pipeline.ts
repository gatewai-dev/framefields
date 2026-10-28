/**
 * Glossy reflective floor plane and anisotropic roughness blur pipeline.
 *
 * Implements planar reflection on a horizontal floor plane (y = floor.y):
 * 1. Anisotropic separable 2-pass roughness blur where vertical radius is
 *    stretched 3.5x relative to horizontal radius (sigma_y ≈ 3.5 * sigma_x * roughness).
 * 2. Floor plane drawing via analytical ray-plane intersection and frag_depth write
 *    with Schlick Fresnel grazing angle boost, base floor color, GGX image-based
 *    lighting, and output to color, linear depth, and HDR bloom targets.
 */

import { type Environment3DFloor, linearRgb } from "../math3d/environment3d.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { lighting3dWgsl, lightsBindingsWgsl } from "../shaders/lighting3d.js";
import {
	BloomPipelineVariants,
	createBasePipelines,
	type PipelineVariantBase,
} from "./pipeline-variants.js";

const blurWgsl = /* wgsl */ `
struct BlurUniforms {
    texelStep : vec2<f32>,
    radius    : f32,
    _pad      : f32,
};

@group(0) @binding(0) var<uniform> u : BlurUniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var src : texture_2d<f32>;

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o : VsOut;
    o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2<f32>(p.x, 1.0 - p.y);
    return o;
}

@fragment
fn fs(in : VsOut) -> @location(0) vec4<f32> {
    if (u.radius <= 0.01) {
        return textureSampleLevel(src, samp, in.uv, 0.0);
    }
    let w0 = 0.227027;
    let w1 = 0.1945946;
    let w2 = 0.1216216;
    let w3 = 0.054054;
    let w4 = 0.016216;

    let step1 = u.texelStep * (1.0 * u.radius * 0.25);
    let step2 = u.texelStep * (2.0 * u.radius * 0.25);
    let step3 = u.texelStep * (3.0 * u.radius * 0.25);
    let step4 = u.texelStep * (4.0 * u.radius * 0.25);

    var col = textureSampleLevel(src, samp, in.uv, 0.0) * w0;
    col += textureSampleLevel(src, samp, in.uv + step1, 0.0) * w1;
    col += textureSampleLevel(src, samp, in.uv - step1, 0.0) * w1;
    col += textureSampleLevel(src, samp, in.uv + step2, 0.0) * w2;
    col += textureSampleLevel(src, samp, in.uv - step2, 0.0) * w2;
    col += textureSampleLevel(src, samp, in.uv + step3, 0.0) * w3;
    col += textureSampleLevel(src, samp, in.uv - step3, 0.0) * w3;
    col += textureSampleLevel(src, samp, in.uv + step4, 0.0) * w4;
    col += textureSampleLevel(src, samp, in.uv - step4, 0.0) * w4;
    return col;
}
`;

const floorWgsl = /* wgsl */ `
${lighting3dWgsl}

struct FloorUniforms {
    params0   : vec4<f32>, // x = floorY, y = reflectivity, z = roughness, w = fadeDistance
    params1   : vec4<f32>, // x = opacity, y = unused, z = unused, w = unused
    baseColor : vec4<f32>, // rgb = base linear color, a = 1.0
};

@group(0) @binding(0) var<uniform> cam : CameraUniforms;
@group(1) @binding(0) var<uniform> floorU : FloorUniforms;
@group(2) @binding(0) var reflectionTexture : texture_2d<f32>;
@group(2) @binding(1) var reflectionSampler : sampler;
${lightsBindingsWgsl}

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs_floor(@builtin(vertex_index) vid : u32) -> VsOut {
    let p = vec2<f32>(f32((vid << 1u) & 2u), f32(vid & 2u));
    var o : VsOut;
    o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2<f32>(p.x, 1.0 - p.y);
    return o;
}

struct FloorShaded {
    display     : vec3<f32>,
    hdr         : vec3<f32>,
    depth       : f32,
    linearDepth : f32,
    alpha       : f32,
};

fn shadeFloor(in: VsOut) -> FloorShaded {
    var out: FloorShaded;

    let ndcX = in.uv.x * 2.0 - 1.0;
    let ndcY = 1.0 - 2.0 * in.uv.y;

    let pNear = cam.invViewProjMatrix * vec4<f32>(ndcX, ndcY, 0.0, 1.0);
    let pFar  = cam.invViewProjMatrix * vec4<f32>(ndcX, ndcY, 1.0, 1.0);

    let p0 = pNear.xyz / pNear.w;
    let p1 = pFar.xyz / pFar.w;

    let D = normalize(p1 - p0);
    let O = p0;

    let floorY = floorU.params0.x;
    let diffY = floorY - O.y;
    if (diffY * D.y <= 0.0001) {
        discard;
    }

    let t = diffY / D.y;
    let worldP = O + t * D;

    let clip = cam.viewProjMatrix * vec4<f32>(worldP, 1.0);
    let depth = clip.z / clip.w;
    if (depth < 0.0 || depth > 1.0) {
        discard;
    }

    out.depth = depth;
    out.linearDepth = dot(worldP - cam.cameraPos.xyz, cam.cameraDir.xyz);

    let N = vec3<f32>(0.0, -1.0, 0.0);
    let toCam = cam.cameraPos.xyz - worldP;
    let dist = length(toCam);
    let V = toCam / max(dist, 0.0001);
    let NdotV = max(0.0, dot(N, V));

    let F0 = floorU.params0.y;
    let fresnel = F0 + (1.0 - F0) * pow(1.0 - NdotV, 5.0);

    let reflUV = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
    let reflSample = textureSample(reflectionTexture, reflectionSampler, reflUV);
    let reflRgb = reflSample.rgb;

    let baseColor = floorU.baseColor.rgb;
    let opacity = floorU.params1.x;

    var litBase = baseColor;
    if (lights.params.z >= 0.5) {
        litBase = shadePhysical(worldP, N, baseColor, floorU.params0.z, 0.0, 1.0);
    } else if (lights.params.y >= 0.5) {
        litBase = applyLighting3D(worldP, N, baseColor, vec4<f32>(32.0, 0.5, 0.3, 1.0));
    }

    let floorDisplay = mix(litBase, reflRgb, fresnel * floorU.params0.y);
    let finalDisplay = select(floorDisplay, reflRgb * fresnel, opacity <= 0.001);

    var display = finalDisplay;
    if (lights.params.z >= 0.5 && opacity > 0.001) {
        display = toneMap(finalDisplay);
    }

    var hdr = reflRgb * fresnel * lights.ambientLinear.w;

    if (lights.fog.w > 0.5) {
        let f = smoothstep(lights.fogRange.x, max(lights.fogRange.y, lights.fogRange.x + 1.0), dist) * lights.fogRange.z;
        display = mix(display, lights.fog.rgb, f);
        hdr = hdr * (1.0 - f);
    }

    let a = select(opacity, clamp(fresnel * floorU.params0.y, 0.0, 1.0), opacity <= 0.001);
    out.display = linearToSrgb(display);
    out.hdr = hdr;
    out.alpha = a;
    return out;
}

struct FsOutputSingle {
    @location(0) color : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

struct FsOutputMrt {
    @location(0) color : vec4<f32>,
    @location(1) linearDepth : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

struct FsOutputSingleBloom {
    @location(0) color : vec4<f32>,
    @location(1) hdr : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

struct FsOutputMrtBloom {
    @location(0) color : vec4<f32>,
    @location(1) linearDepth : vec4<f32>,
    @location(2) hdr : vec4<f32>,
    @builtin(frag_depth) depth : f32,
};

@fragment
fn fs_single(in: VsOut) -> FsOutputSingle {
    var out: FsOutputSingle;
    let s = shadeFloor(in);
    out.color = vec4<f32>(s.display * s.alpha, s.alpha);
    out.depth = s.depth;
    return out;
}

@fragment
fn fs_mrt(in: VsOut) -> FsOutputMrt {
    var out: FsOutputMrt;
    let s = shadeFloor(in);
    out.color = vec4<f32>(s.display * s.alpha, s.alpha);
    out.linearDepth = vec4<f32>(s.linearDepth, 0.0, 0.0, 1.0);
    out.depth = s.depth;
    return out;
}

@fragment
fn fs_single_bloom(in: VsOut) -> FsOutputSingleBloom {
    var out: FsOutputSingleBloom;
    let s = shadeFloor(in);
    out.color = vec4<f32>(s.display * s.alpha, s.alpha);
    out.hdr = vec4<f32>(s.hdr * s.alpha, 1.0);
    out.depth = s.depth;
    return out;
}

@fragment
fn fs_mrt_bloom(in: VsOut) -> FsOutputMrtBloom {
    var out: FsOutputMrtBloom;
    let s = shadeFloor(in);
    out.color = vec4<f32>(s.display * s.alpha, s.alpha);
    out.linearDepth = vec4<f32>(s.linearDepth, 0.0, 0.0, 1.0);
    out.hdr = vec4<f32>(s.hdr * s.alpha, 1.0);
    out.depth = s.depth;
    return out;
}
`;

export class FloorReflectionPipeline {
	private blurPipeline: GPURenderPipeline;
	private blurBindGroupLayout: GPUBindGroupLayout;
	private blurSampler: GPUSampler;
	private blurPool: BufferPool;

	private floorLayout: GPUBindGroupLayout;
	private reflectionLayout: GPUBindGroupLayout;
	private floorSampler: GPUSampler;
	private floorPool: BufferPool;

	private pipelineSingle: GPURenderPipeline;
	private pipelineMrt: GPURenderPipeline;
	private bloomVariants: BloomPipelineVariants;

	constructor(
		private device: GPUDevice,
		format: GPUTextureFormat,
		sampleCount: number,
		cameraLayout: GPUBindGroupLayout,
		lightsLayout: GPUBindGroupLayout,
		depthFormat: GPUTextureFormat = "depth24plus",
	) {
		const blurModule = device.createShaderModule({
			label: "FloorBlurShader",
			code: blurWgsl,
		});
		this.blurBindGroupLayout = device.createBindGroupLayout({
			label: "FloorBlurBindGroupLayout",
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
		this.blurPipeline = device.createRenderPipeline({
			label: "FloorBlurPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [this.blurBindGroupLayout],
			}),
			vertex: { module: blurModule, entryPoint: "vs" },
			fragment: {
				module: blurModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-list" },
		});
		this.blurSampler = device.createSampler({
			label: "FloorBlurSampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
		this.blurPool = new BufferPool(
			16,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		this.floorLayout = device.createBindGroupLayout({
			label: "FloorUniformLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});
		this.reflectionLayout = device.createBindGroupLayout({
			label: "FloorReflectionLayout",
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
		this.floorSampler = device.createSampler({
			label: "FloorReflectionSampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
		this.floorPool = new BufferPool(
			64,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);

		const floorModule = device.createShaderModule({
			label: "FloorPlaneShader",
			code: floorWgsl,
		});
		const pipelineLayout = device.createPipelineLayout({
			label: "FloorPlanePipelineLayout",
			bindGroupLayouts: [
				cameraLayout,
				this.floorLayout,
				this.reflectionLayout,
				lightsLayout,
			],
		});

		const base: PipelineVariantBase = {
			label: "FloorPlanePipeline",
			layout: pipelineLayout,
			vertex: {
				module: floorModule,
				entryPoint: "vs_floor",
			},
			module: floorModule,
			format,
			depthStencil: {
				format: depthFormat,
				depthWriteEnabled: true,
				depthCompare: "less-equal",
			},
			primitive: { topology: "triangle-list", cullMode: "none" },
			multisample: { count: sampleCount },
		};

		const { single, mrt } = createBasePipelines(device, base);
		this.pipelineSingle = single;
		this.pipelineMrt = mrt;
		this.bloomVariants = new BloomPipelineVariants(device, base);
	}

	applyBlur(
		encoder: GPUCommandEncoder,
		src: GPUTexture,
		temp: GPUTexture,
		dst: GPUTexture,
		width: number,
		height: number,
		roughness: number,
	): void {
		const sigmaX = roughness * 12.0;
		const sigmaY = sigmaX * 3.5;

		// Pass 1: Horizontal blur (src -> temp)
		{
			const uData = new Float32Array([1.0 / width, 0.0, sigmaX, 0.0]);
			const uBuf = this.blurPool.getBuffer(this.device, uData);
			const bg = this.device.createBindGroup({
				layout: this.blurBindGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: uBuf } },
					{ binding: 1, resource: this.blurSampler },
					{ binding: 2, resource: src.createView() },
				],
			});
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: temp.createView(),
						loadOp: "clear",
						storeOp: "store",
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
					},
				],
			});
			pass.setPipeline(this.blurPipeline);
			pass.setBindGroup(0, bg);
			pass.draw(3);
			pass.end();
		}

		// Pass 2: Vertical blur (temp -> dst)
		{
			const uData = new Float32Array([0.0, 1.0 / height, sigmaY, 0.0]);
			const uBuf = this.blurPool.getBuffer(this.device, uData);
			const bg = this.device.createBindGroup({
				layout: this.blurBindGroupLayout,
				entries: [
					{ binding: 0, resource: { buffer: uBuf } },
					{ binding: 1, resource: this.blurSampler },
					{ binding: 2, resource: temp.createView() },
				],
			});
			const pass = encoder.beginRenderPass({
				colorAttachments: [
					{
						view: dst.createView(),
						loadOp: "clear",
						storeOp: "store",
						clearValue: { r: 0, g: 0, b: 0, a: 0 },
					},
				],
			});
			pass.setPipeline(this.blurPipeline);
			pass.setBindGroup(0, bg);
			pass.draw(3);
			pass.end();
		}
	}

	draw(
		pass: GPURenderPassEncoder,
		cameraBindGroup: GPUBindGroup,
		lightsBindGroup: GPUBindGroup,
		reflectionTexture: GPUTexture,
		floor: Environment3DFloor,
		useMrt = false,
		useBloom = false,
	): void {
		const linColor = linearRgb(floor.color ?? "#08070a");
		const floorData = new Float32Array([
			floor.y,
			floor.reflectivity ?? 0.35,
			floor.roughness ?? 0.35,
			floor.fadeDistance ?? 900,
			floor.opacity ?? 1.0,
			0.0,
			0.0,
			0.0,
			linColor[0],
			linColor[1],
			linColor[2],
			1.0,
			0.0,
			0.0,
			0.0,
			0.0,
		]);
		const floorBuf = this.floorPool.getBuffer(this.device, floorData);
		const floorBindGroup = this.device.createBindGroup({
			layout: this.floorLayout,
			entries: [{ binding: 0, resource: { buffer: floorBuf } }],
		});

		const reflBindGroup = this.device.createBindGroup({
			layout: this.reflectionLayout,
			entries: [
				{ binding: 0, resource: reflectionTexture.createView() },
				{ binding: 1, resource: this.floorSampler },
			],
		});

		pass.setPipeline(
			useBloom
				? this.bloomVariants.get(useMrt)
				: useMrt
					? this.pipelineMrt
					: this.pipelineSingle,
		);
		pass.setBindGroup(0, cameraBindGroup);
		pass.setBindGroup(1, floorBindGroup);
		pass.setBindGroup(2, reflBindGroup);
		pass.setBindGroup(3, lightsBindGroup);
		pass.draw(3);
	}

	destroy(): void {
		this.blurPool.destroy();
		this.floorPool.destroy();
	}
}
