/// <reference types="webgpu" />
/**
 * GPU composite for the mask-family modes: the picture times the subject mask,
 * in one full-screen pass. Replaces building the RGBA result on the CPU and
 * uploading it; only the 8-bit mask goes to the GPU.
 *
 *  - matte: picture × mask (premultiplied, so the background is transparent)
 *  - mask:  white silhouette (rgb = mask, a = 1)
 *  - crop:  matte, with the subject's bounding box stretched to the frame
 */

const WGSL = /* wgsl */ `
struct Params {
	mode: u32,          // 0 matte, 1 mask, 2 crop
	_pad: u32,
	cropMin: vec2<f32>, // uv of the subject bounds (crop)
	cropMax: vec2<f32>,
	_pad2: vec2<f32>,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var picture: texture_2d<f32>;
@group(0) @binding(2) var mask: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

struct VSOut {
	@builtin(position) pos: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
	var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
	var out: VSOut;
	out.pos = vec4(p[i], 0.0, 1.0);
	out.uv = vec2(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
	return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	var uv = in.uv;
	if (params.mode == 2u) {
		uv = mix(params.cropMin, params.cropMax, uv);
	}
	let m = textureSampleLevel(mask, samp, uv, 0.0).r;
	if (params.mode == 1u) {
		return vec4(m, m, m, 1.0);
	}
	return textureSampleLevel(picture, samp, uv, 0.0) * m;
}
`;

export type MatteMode = "matte" | "mask" | "crop";

export interface MatteBounds {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export class MatteCompositor {
	private readonly pipeline: GPURenderPipeline;
	private readonly sampler: GPUSampler;
	private readonly uniforms: GPUBuffer[] = [];
	private uniformIndex = 0;
	/** One 8-bit mask texture per node, rewritten each frame. */
	private readonly masks = new Map<string, GPUTexture>();

	constructor(
		private readonly device: GPUDevice,
		format: GPUTextureFormat,
	) {
		const module = device.createShaderModule({
			label: "vision_matte_composite",
			code: WGSL,
		});
		this.pipeline = device.createRenderPipeline({
			label: "vision_matte_composite",
			layout: "auto",
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-list" },
		});
		this.sampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});
	}

	/** Uploads a frame-sized 0..255 mask for `key` and returns its texture. */
	uploadMask(
		key: string,
		mask: Uint8Array,
		width: number,
		height: number,
	): GPUTexture {
		let tex = this.masks.get(key);
		if (!tex || tex.width !== width || tex.height !== height) {
			tex?.destroy();
			tex = this.device.createTexture({
				label: `vision_mask_${key}`,
				size: [width, height],
				format: "r8unorm",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			this.masks.set(key, tex);
		}
		const aligned = Math.ceil(width / 256) * 256;
		let bytes = mask;
		if (aligned !== width) {
			bytes = new Uint8Array(aligned * height);
			for (let y = 0; y < height; y++) {
				bytes.set(mask.subarray(y * width, (y + 1) * width), y * aligned);
			}
		}
		this.device.queue.writeTexture(
			{ texture: tex },
			bytes.buffer,
			{ offset: bytes.byteOffset, bytesPerRow: aligned, rowsPerImage: height },
			{ width, height },
		);
		return tex;
	}

	/** Clears `target` and draws `picture` through `mask` into it. */
	draw(
		encoder: GPUCommandEncoder,
		target: GPUTextureView,
		picture: GPUTexture,
		mask: GPUTexture,
		mode: MatteMode,
		bounds?: MatteBounds,
	): void {
		const w = mask.width;
		const h = mask.height;
		const data = new Float32Array(8);
		const view = new Uint32Array(data.buffer);
		view[0] = mode === "matte" ? 0 : mode === "mask" ? 1 : 2;
		if (mode === "crop" && bounds) {
			data[2] = bounds.x0 / w;
			data[3] = bounds.y0 / h;
			data[4] = (bounds.x1 + 1) / w;
			data[5] = (bounds.y1 + 1) / h;
		} else {
			data[2] = 0;
			data[3] = 0;
			data[4] = 1;
			data[5] = 1;
			if (mode === "crop") view[0] = 0;
		}
		// A small ring of uniform buffers: several vision nodes may draw in one frame.
		if (this.uniformIndex >= this.uniforms.length) {
			this.uniforms.push(
				this.device.createBuffer({
					size: data.byteLength,
					usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
				}),
			);
		}
		const uniform = this.uniforms[this.uniformIndex];
		this.uniformIndex = (this.uniformIndex + 1) % 16;
		this.device.queue.writeBuffer(uniform, 0, data);

		const bindGroup = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: { buffer: uniform } },
				{ binding: 1, resource: picture.createView() },
				{ binding: 2, resource: mask.createView() },
				{ binding: 3, resource: this.sampler },
			],
		});
		const pass = encoder.beginRenderPass({
			label: "vision_matte_composite",
			colorAttachments: [
				{
					view: target,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}
}
