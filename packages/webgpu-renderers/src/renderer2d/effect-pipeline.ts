import { compositeWgsl } from "../shaders/composite.js";
import type { BindGroupCache } from "./bind-group-cache.js";
import { BufferPool } from "./buffer-pool.js";
import type { BlendMode } from "./index.js";
import type { SamplerCache } from "./sampler-cache.js";
import { UniformBindGroupCache } from "./uniform-bind-group-cache.js";

const motionBlur2DWgsl = /* wgsl */ `
struct MotionBlur2DUniforms {
    vel: vec2<f32>,
    _pad: vec2<f32>,
    shutterFraction: f32,
    samples: f32,
    viewportWidth: f32,
    viewportHeight: f32,
};

@group(0) @binding(0) var<uniform> u: MotionBlur2DUniforms;
@group(1) @binding(0) var sourceTexture: texture_2d<f32>;
@group(1) @binding(1) var colorSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -3.0),
        vec2<f32>( 3.0,  1.0),
        vec2<f32>(-1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
}

@fragment
fn fs(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    let uv = pos.xy / vec2<f32>(u.viewportWidth, u.viewportHeight);
    let sampleCount = u32(max(u.samples, 1.0));
    let velUV = u.vel * u.shutterFraction;
    let halfSamples = f32(sampleCount) * 0.5;
    
    var accum = vec4<f32>(0.0);
    var totalWeight = 0.0;
    
    for (var i = 0u; i < sampleCount; i = i + 1u) {
        let t = (f32(i) - halfSamples) / max(halfSamples, 1.0);
        let sampleUV = clamp(uv + velUV * t, vec2<f32>(0.0), vec2<f32>(1.0));
        let w = exp(-2.5 * t * t);
        accum += textureSampleLevel(sourceTexture, colorSampler, sampleUV, 0.0) * w;
        totalWeight += w;
    }
    
    return accum / max(totalWeight, 0.0001);
}
`;

class TexturePool {
	private textures: GPUTexture[] = [];
	private texturesByKey = new Map<string, GPUTexture[]>();
	private index = 0;

	getTexture(
		device: GPUDevice,
		width: number,
		height: number,
		format: GPUTextureFormat,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		const excludeSet = new Set(
			Array.isArray(exclude) ? exclude : exclude ? [exclude] : [],
		);

		const key = `${width}x${height}:${format}`;
		const pool = this.texturesByKey.get(key);
		if (pool) {
			for (let i = 0; i < pool.length; i++) {
				const tex = pool[i];
				if (!excludeSet.has(tex)) {
					// Move to front of pool for LRU behavior
					pool.splice(i, 1);
					pool.unshift(tex);
					// Also move to 'used' portion of main array
					const mainIdx = this.textures.indexOf(tex);
					if (mainIdx >= this.index) {
						this.textures.splice(mainIdx, 1);
						this.textures.splice(this.index, 0, tex);
						this.index++;
					}
					return tex;
				}
			}
		}

		const tex = device.createTexture({
			size: [width, height],
			format,
			usage:
				GPUTextureUsage.RENDER_ATTACHMENT |
				GPUTextureUsage.TEXTURE_BINDING |
				GPUTextureUsage.COPY_SRC,
		});

		// Track in key-based pool
		if (!this.texturesByKey.has(key)) {
			this.texturesByKey.set(key, []);
		}
		this.texturesByKey.get(key)!.unshift(tex);

		// Insert new texture at current index to mark it as used
		this.textures.splice(this.index, 0, tex);
		this.index++;
		return tex;
	}

	reset(): void {
		this.index = 0;
	}

	destroy(): void {
		for (const tex of this.textures) {
			tex.destroy();
		}
		this.textures = [];
		this.texturesByKey.clear();
		this.index = 0;
	}
}

const BLEND_MODE_MAP: Record<BlendMode, number> = {
	normal: 0,
	"source-over": 0,
	multiply: 1,
	screen: 2,
	overlay: 3,
	darken: 4,
	lighten: 5,
	"color-dodge": 6,
	"color-burn": 7,
	"hard-light": 8,
	"soft-light": 9,
	difference: 10,
	exclusion: 11,
	hue: 12,
	saturation: 13,
	color: 14,
	luminosity: 15,
	"mask-in": 16,
	"destination-in": 16,
	"mask-out": 17,
	"destination-out": 17,
	"source-in": 18,
	"source-out": 19,
	"source-atop": 20,
	"destination-over": 21,
	"destination-atop": 22,
	lighter: 23,
	copy: 24,
	xor: 25,
};

export class EffectPipeline {
	private device: GPUDevice;
	private compositeUniformLayout: GPUBindGroupLayout;
	private dualTextureLayout: GPUBindGroupLayout;
	private motionBlurUniformLayout: GPUBindGroupLayout;
	private singleTextureLayout: GPUBindGroupLayout;
	private compositePipeline: GPURenderPipeline;
	private motionBlurPipeline: GPURenderPipeline;
	private compositePool: BufferPool;
	private motionBlurPool: BufferPool;
	private texturePool: TexturePool;
	private compositeUniformBindGroupCache = new UniformBindGroupCache();
	private motionBlurUniformBindGroupCache = new UniformBindGroupCache();
	private compositeData = new Uint32Array(4);
	private motionBlurData = new Float32Array(8);

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;

		this.compositePool = new BufferPool(
			1024,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.motionBlurPool = new BufferPool(
			1024,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
		this.texturePool = new TexturePool();

		this.compositeUniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.dualTextureLayout = device.createBindGroupLayout({
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

		this.motionBlurUniformLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
			],
		});

		this.singleTextureLayout = device.createBindGroupLayout({
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

		const compositePipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.compositeUniformLayout, this.dualTextureLayout],
		});

		const compositeModule = device.createShaderModule({
			label: "composite.wgsl",
			code: compositeWgsl,
		});

		this.compositePipeline = device.createRenderPipeline({
			label: "CompositePipeline",
			layout: compositePipelineLayout,
			vertex: { module: compositeModule, entryPoint: "vs" },
			fragment: {
				module: compositeModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});

		const motionBlurPipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.motionBlurUniformLayout, this.singleTextureLayout],
		});

		const motionBlurModule = device.createShaderModule({
			label: "motion-blur-2d.wgsl",
			code: motionBlur2DWgsl,
		});

		this.motionBlurPipeline = device.createRenderPipeline({
			label: "MotionBlurPipeline",
			layout: motionBlurPipelineLayout,
			vertex: { module: motionBlurModule, entryPoint: "vs" },
			fragment: {
				module: motionBlurModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	resetPools(): void {
		this.compositePool.reset();
		this.motionBlurPool.reset();
		this.texturePool.reset();
	}

	getTexture(
		device: GPUDevice,
		width: number,
		height: number,
		format: GPUTextureFormat,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		return this.texturePool.getTexture(device, width, height, format, exclude);
	}

	getBuffer(device: GPUDevice, data: ArrayBufferView): GPUBuffer {
		return this.compositePool.getBuffer(device, data);
	}

	composite(
		encoder: GPUCommandEncoder,
		bindGroupCache: BindGroupCache,
		samplerCache: SamplerCache,
		baseTex: GPUTexture,
		overlayTex: GPUTexture,
		mode: BlendMode,
		format: GPUTextureFormat,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		const sampler = samplerCache.getSampler(this.device);

		const combinedExclude: GPUTexture[] = [baseTex, overlayTex];
		if (exclude) {
			if (Array.isArray(exclude)) {
				combinedExclude.push(...exclude);
			} else {
				combinedExclude.push(exclude);
			}
		}

		const outTex = this.texturePool.getTexture(
			this.device,
			baseTex.width,
			baseTex.height,
			format,
			combinedExclude,
		);

		this.compositeData[0] = BLEND_MODE_MAP[mode] ?? 0;
		const buffer = this.compositePool.getBuffer(
			this.device,
			this.compositeData,
		);

		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: outTex.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(this.compositePipeline);
		const uniformBindGroup = this.compositeUniformBindGroupCache.getBindGroup(
			this.device,
			this.compositeUniformLayout,
			buffer,
		);
		pass.setBindGroup(0, uniformBindGroup);
		const textureBindGroup = bindGroupCache.getCompositeBindGroup(
			this.device,
			this.dualTextureLayout,
			baseTex,
			overlayTex,
			sampler,
		);
		pass.setBindGroup(1, textureBindGroup);
		pass.draw(4);
		pass.end();

		return outTex;
	}

	applyMotionBlur(
		encoder: GPUCommandEncoder,
		bindGroupCache: BindGroupCache,
		samplerCache: SamplerCache,
		sourceTex: GPUTexture,
		vx: number,
		vy: number,
		shutterAngle = 180,
		samples = 16,
		format: GPUTextureFormat,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		if ((Math.abs(vx) < 0.1 && Math.abs(vy) < 0.1) || shutterAngle <= 0) {
			return sourceTex;
		}

		const sampler = samplerCache.getSampler(this.device);
		const combinedExclude: GPUTexture[] = [sourceTex];
		if (exclude) {
			if (Array.isArray(exclude)) {
				combinedExclude.push(...exclude);
			} else {
				combinedExclude.push(exclude);
			}
		}

		const outTex = this.texturePool.getTexture(
			this.device,
			sourceTex.width,
			sourceTex.height,
			format,
			combinedExclude,
		);

		// Normalized velocity per frame in UV space
		this.motionBlurData[0] = vx / sourceTex.width;
		this.motionBlurData[1] = vy / sourceTex.height;
		this.motionBlurData[2] = 0;
		this.motionBlurData[3] = 0;
		this.motionBlurData[4] = shutterAngle / 360.0;
		this.motionBlurData[5] = samples;
		this.motionBlurData[6] = sourceTex.width;
		this.motionBlurData[7] = sourceTex.height;

		const buffer = this.motionBlurPool.getBuffer(
			this.device,
			this.motionBlurData,
		);

		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: outTex.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});

		pass.setPipeline(this.motionBlurPipeline);
		const uniformBindGroup = this.motionBlurUniformBindGroupCache.getBindGroup(
			this.device,
			this.motionBlurUniformLayout,
			buffer,
		);
		pass.setBindGroup(0, uniformBindGroup);
		pass.setBindGroup(
			1,
			bindGroupCache.getBindGroup(
				this.device,
				this.singleTextureLayout,
				sourceTex,
				sampler,
			),
		);
		pass.draw(3);
		pass.end();

		return outTex;
	}

	destroy(): void {
		this.compositePool.destroy();
		this.motionBlurPool.destroy();
		this.texturePool.destroy();
		this.compositeUniformBindGroupCache.destroy();
		this.motionBlurUniformBindGroupCache.destroy();
	}
}
