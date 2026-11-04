/**
 * Bloom: light that spills past bright pixels, the way a lens and film do.
 *
 * A mip chain at half, quarter, … resolution: a soft-knee threshold picks the
 * bright parts (emissive surfaces, hot speculars), 13-tap downsamples spread
 * them, tent-filtered upsamples add every level back up (wide and tight glow
 * together), and the result is added over the source. Works on premultiplied
 * color: glow over a transparent pixel raises its alpha, so a bloomed 3D
 * layer still glows when composited over the 2D layers below.
 */

export interface BloomOptions {
	/** Glow strength. Default 0.2. */
	intensity?: number;
	/**
	 * Brightness where glow starts. With an HDR source (3D scenes) it is scene
	 * radiance, default 2.5 = only light well past white (emissive ≳ 3,
	 * hot speculars). Without one it is display brightness, default 0.85.
	 */
	threshold?: number;
	/** Soft transition below the threshold, 0..1. Default 0.4. */
	knee?: number;
	/** Glow spread: mip levels used, 1..8. Default 6. */
	radius?: number;
	/** Tints the glow (CSS-free rgb 0..1). Default white. */
	tint?: [number, number, number];
}

const bloomWgsl = /* wgsl */ `
struct BloomUniforms {
    texel     : vec2<f32>, // 1 / source size
    threshold : f32,
    knee      : f32,
    intensity : f32,
    mode      : f32,
    _pad      : vec2<f32>,
    tint      : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : BloomUniforms;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var src : texture_2d<f32>;
@group(0) @binding(3) var base : texture_2d<f32>;

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

fn s(uv : vec2<f32>) -> vec3<f32> {
    return textureSampleLevel(src, samp, uv, 0.0).rgb;
}

// Jimenez's 13-tap downsample (Call of Duty: AW): stable, no fireflies.
fn down13(uv : vec2<f32>) -> vec3<f32> {
    let t = u.texel;
    let a = s(uv + t * vec2<f32>(-2.0, -2.0));
    let b = s(uv + t * vec2<f32>(0.0, -2.0));
    let c = s(uv + t * vec2<f32>(2.0, -2.0));
    let d = s(uv + t * vec2<f32>(-2.0, 0.0));
    let e = s(uv);
    let f = s(uv + t * vec2<f32>(2.0, 0.0));
    let g = s(uv + t * vec2<f32>(-2.0, 2.0));
    let h = s(uv + t * vec2<f32>(0.0, 2.0));
    let i = s(uv + t * vec2<f32>(2.0, 2.0));
    let j = s(uv + t * vec2<f32>(-1.0, -1.0));
    let k = s(uv + t * vec2<f32>(1.0, -1.0));
    let l = s(uv + t * vec2<f32>(-1.0, 1.0));
    let m = s(uv + t * vec2<f32>(1.0, 1.0));
    return e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
}

// Soft-knee threshold (keeps hue, fades in below the threshold).
fn prefilter(c : vec3<f32>) -> vec3<f32> {
    let br = max(c.r, max(c.g, c.b));
    let kneeW = u.threshold * u.knee + 1e-4;
    var soft = clamp(br - u.threshold + kneeW, 0.0, 2.0 * kneeW);
    soft = soft * soft / (4.0 * kneeW);
    let w = max(soft, br - u.threshold) / max(br, 1e-4);
    return c * max(w, 0.0);
}

fn srgbToLinear(c : vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3<f32>(0.0)) + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn linearToSrgb(c : vec3<f32>) -> vec3<f32> {
    let x = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = x * 12.92;
    let hi = 1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, x <= vec3<f32>(0.0031308));
}

// mode 0: the source is linear scene radiance; mode 1: display-encoded color.
@fragment
fn fs_prefilter(in : VsOut) -> @location(0) vec4<f32> {
    var c = down13(in.uv);
    if (u.mode > 0.5) {
        c = srgbToLinear(c);
    }
    return vec4<f32>(prefilter(c), 1.0);
}

@fragment
fn fs_down(in : VsOut) -> @location(0) vec4<f32> {
    return vec4<f32>(down13(in.uv), 1.0);
}

// 3x3 tent upsample; added onto the next-larger level by the blend state.
@fragment
fn fs_up(in : VsOut) -> @location(0) vec4<f32> {
    let t = u.texel;
    var c = s(in.uv) * 4.0;
    c += (s(in.uv + vec2<f32>(-t.x, 0.0)) + s(in.uv + vec2<f32>(t.x, 0.0)) + s(in.uv + vec2<f32>(0.0, -t.y)) + s(in.uv + vec2<f32>(0.0, t.y))) * 2.0;
    c += s(in.uv + vec2<f32>(-t.x, -t.y)) + s(in.uv + vec2<f32>(t.x, -t.y)) + s(in.uv + vec2<f32>(-t.x, t.y)) + s(in.uv + vec2<f32>(t.x, t.y));
    return vec4<f32>(c / 16.0, 1.0);
}

// Adds the glow in linear light over the premultiplied display image.
@fragment
fn fs_composite(in : VsOut) -> @location(0) vec4<f32> {
    let orig = textureSampleLevel(base, samp, in.uv, 0.0);
    let glow = max(textureSampleLevel(src, samp, in.uv, 0.0).rgb * u.intensity * u.tint.rgb, vec3<f32>(0.0));
    var lin = vec3<f32>(0.0);
    if (orig.a > 0.0001) {
        lin = srgbToLinear(orig.rgb / orig.a) * orig.a;
    }
    let sum = lin + glow;
    let a = clamp(max(orig.a, max(glow.r, max(glow.g, glow.b))), 0.0, 1.0);
    if (a <= 0.0001) {
        return vec4<f32>(0.0);
    }
    return vec4<f32>(linearToSrgb(sum / a) * a, a);
}
`;

import { BufferPool } from "../renderer2d/buffer-pool.js";

const MIP_FORMAT: GPUTextureFormat = "rgba16float";

export class BloomPipeline {
	private device: GPUDevice;
	private layout: GPUBindGroupLayout;
	private prefilterPipe: GPURenderPipeline;
	private downPipe: GPURenderPipeline;
	private upPipe: GPURenderPipeline;
	private compositePipes = new Map<GPUTextureFormat, GPURenderPipeline>();
	private module: GPUShaderModule;
	private pipelineLayout: GPUPipelineLayout;
	private sampler: GPUSampler;
	/**
	 * Mip chains by size and depth. Scenes with different bloom share a frame
	 * (one command buffer), so a chain stays alive until the frame is done:
	 * chains not used in a frame are destroyed at the next `resetPools`.
	 */
	private chains = new Map<string, GPUTexture[]>();
	private usedThisFrame = new Set<string>();
	private placeholder: GPUTexture;
	private uniformPool = new BufferPool(
		48,
		GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	);

	constructor(device: GPUDevice) {
		this.device = device;
		this.module = device.createShaderModule({
			label: "bloom.wgsl",
			code: bloomWgsl,
		});
		this.layout = device.createBindGroupLayout({
			label: "BloomLayout",
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
				{
					binding: 3,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
			],
		});
		this.pipelineLayout = device.createPipelineLayout({
			bindGroupLayouts: [this.layout],
		});
		const make = (entryPoint: string, additive: boolean) =>
			device.createRenderPipeline({
				label: `Bloom:${entryPoint}`,
				layout: this.pipelineLayout,
				vertex: { module: this.module, entryPoint: "vs" },
				fragment: {
					module: this.module,
					entryPoint,
					targets: [
						{
							format: MIP_FORMAT,
							...(additive && {
								blend: {
									color: {
										srcFactor: "one",
										dstFactor: "one",
										operation: "add",
									},
									alpha: {
										srcFactor: "one",
										dstFactor: "one",
										operation: "add",
									},
								},
							}),
						},
					],
				},
				primitive: { topology: "triangle-list" },
			});
		this.prefilterPipe = make("fs_prefilter", false);
		this.downPipe = make("fs_down", false);
		this.upPipe = make("fs_up", true);
		this.sampler = device.createSampler({
			label: "BloomSampler",
			magFilter: "linear",
			minFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
		this.placeholder = device.createTexture({
			size: { width: 1, height: 1 },
			format: MIP_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});
	}

	private compositePipe(format: GPUTextureFormat): GPURenderPipeline {
		let pipe = this.compositePipes.get(format);
		if (!pipe) {
			pipe = this.device.createRenderPipeline({
				label: "Bloom:composite",
				layout: this.pipelineLayout,
				vertex: { module: this.module, entryPoint: "vs" },
				fragment: {
					module: this.module,
					entryPoint: "fs_composite",
					targets: [{ format }],
				},
				primitive: { topology: "triangle-list" },
			});
			this.compositePipes.set(format, pipe);
		}
		return pipe;
	}

	private mipChain(
		width: number,
		height: number,
		levels: number,
	): GPUTexture[] {
		const key = `${width}x${height}x${levels}`;
		this.usedThisFrame.add(key);
		const cached = this.chains.get(key);
		if (cached) return cached;
		const chain: GPUTexture[] = [];
		let w = width;
		let h = height;
		for (let i = 0; i < levels; i++) {
			w = Math.max(1, Math.floor(w / 2));
			h = Math.max(1, Math.floor(h / 2));
			chain.push(
				this.device.createTexture({
					label: `BloomMip${i}`,
					size: { width: w, height: h },
					format: MIP_FORMAT,
					usage:
						GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
				}),
			);
			if (w === 1 && h === 1) break;
		}
		this.chains.set(key, chain);
		return chain;
	}

	private uniforms(
		texelW: number,
		texelH: number,
		opts: Required<Omit<BloomOptions, "radius">> & { mode: number },
	): GPUBuffer {
		const data = new Float32Array([
			texelW,
			texelH,
			opts.threshold,
			opts.knee,
			opts.intensity,
			opts.mode,
			0,
			0,
			opts.tint[0],
			opts.tint[1],
			opts.tint[2],
			1,
		]);
		return this.uniformPool.getBuffer(this.device, data);
	}

	private pass(
		encoder: GPUCommandEncoder,
		pipe: GPURenderPipeline,
		target: GPUTextureView,
		src: GPUTexture,
		base: GPUTexture,
		uniform: GPUBuffer,
		load: GPULoadOp,
	): void {
		const bindGroup = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{ binding: 0, resource: { buffer: uniform } },
				{ binding: 1, resource: this.sampler },
				{ binding: 2, resource: src.createView() },
				{ binding: 3, resource: base.createView() },
			],
		});
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: target,
					loadOp: load,
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(pipe);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}

	/**
	 * Writes `source` (premultiplied, display-encoded) plus its bloom into
	 * `dest` (same size). `hdrSource`, when given, is linear scene radiance
	 * of the same image: glow is taken from it instead of from `source`.
	 */
	apply(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		dest: GPUTexture,
		options: BloomOptions = {},
		hdrSource?: GPUTexture,
	): void {
		const display = !hdrSource;
		const toLinear = (v: number) =>
			v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		const threshold = options.threshold ?? (display ? 0.85 : 2.5);
		const opts = {
			intensity: options.intensity ?? 0.2,
			threshold: display ? toLinear(threshold) : threshold,
			knee: options.knee ?? 0.4,
			tint: options.tint ?? ([1, 1, 1] as [number, number, number]),
			mode: display ? 1 : 0,
		};
		const levels = Math.max(1, Math.min(8, Math.round(options.radius ?? 6)));
		const mips = this.mipChain(source.width, source.height, levels);
		const u = (w: number, h: number) => this.uniforms(1 / w, 1 / h, opts);

		const glowSource = hdrSource ?? source;
		this.pass(
			encoder,
			this.prefilterPipe,
			mips[0].createView(),
			glowSource,
			this.placeholder,
			u(glowSource.width, glowSource.height),
			"clear",
		);
		for (let i = 1; i < mips.length; i++) {
			const prev = mips[i - 1];
			this.pass(
				encoder,
				this.downPipe,
				mips[i].createView(),
				prev,
				this.placeholder,
				u(prev.width, prev.height),
				"clear",
			);
		}
		for (let i = mips.length - 1; i > 0; i--) {
			const small = mips[i];
			this.pass(
				encoder,
				this.upPipe,
				mips[i - 1].createView(),
				small,
				this.placeholder,
				u(small.width, small.height),
				"load",
			);
		}
		this.pass(
			encoder,
			this.compositePipe(dest.format),
			dest.createView(),
			mips[0],
			source,
			u(mips[0].width, mips[0].height),
			"clear",
		);
	}

	/**
	 * Call once per frame before `apply`: recycles the per-pass uniforms and
	 * frees the mip chains the last frame did not use.
	 */
	resetPools(): void {
		this.uniformPool.reset();
		for (const [key, chain] of this.chains) {
			if (this.usedThisFrame.has(key)) continue;
			for (const t of chain) t.destroy();
			this.chains.delete(key);
		}
		this.usedThisFrame.clear();
	}

	destroy(): void {
		for (const chain of this.chains.values())
			for (const t of chain) t.destroy();
		this.chains.clear();
		this.placeholder.destroy();
		this.uniformPool.destroy();
	}
}
