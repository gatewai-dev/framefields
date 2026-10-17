/**
 * Frame preprocessing on the GPU: a texture becomes a model's NCHW float input
 * in a storage buffer, so a frame drawn by the renderer reaches the model
 * without a round trip through the CPU. The math is `imageToTensor`'s
 * (pixel-centre bilinear sampling, letterbox padding, channel order,
 * normalisation); see decode/preprocess.ts for the per-model contracts.
 *
 * Also: a content hash of a texture (two order-independent 32-bit sums, read
 * back as 8 bytes), so layers showing the same pixels can share a pass, and a
 * plain RGBA readback for paths that need pixels on the CPU.
 */

import {
	computeInputTransform,
	type InputTransform,
	type PreprocessSpec,
} from "../decode/preprocess.js";
import type { VisionGpuImage, VisionImageInput } from "../types.js";

const TENSOR_WGSL = /* wgsl */ `
struct Params {
	src: vec2u,
	dst: vec2u,
	scale: vec2f,
	offset: vec2f,
	lo: vec2i,
	hi: vec2i,
	mean: vec4f,
	invStd: vec4f,
	pad: vec4f,
	order: vec4u,
};

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var<storage, read_write> dst: array<f32>;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) id: vec3u) {
	if (id.x >= p.dst.x || id.y >= p.dst.y) { return; }
	let x = i32(id.x);
	let y = i32(id.y);
	let plane = p.dst.x * p.dst.y;
	let o = id.y * p.dst.x + id.x;
	var v = p.pad.xyz;
	if (x >= p.lo.x && x <= p.hi.x && y >= p.lo.y && y <= p.hi.y) {
		let maxX = i32(p.src.x) - 1;
		let maxY = i32(p.src.y) - 1;
		let sy = max(0.0, (f32(y) + 0.5 - p.offset.y) / p.scale.y - 0.5);
		let iy0 = min(maxY, i32(floor(sy)));
		let iy1 = min(maxY, iy0 + 1);
		let fy = sy - f32(iy0);
		let sx = max(0.0, (f32(x) + 0.5 - p.offset.x) / p.scale.x - 0.5);
		let ix0 = min(maxX, i32(floor(sx)));
		let ix1 = min(maxX, ix0 + 1);
		let fx = sx - f32(ix0);
		var rgba =
			textureLoad(src, vec2i(ix0, iy0), 0) * ((1.0 - fx) * (1.0 - fy)) +
			textureLoad(src, vec2i(ix1, iy0), 0) * (fx * (1.0 - fy)) +
			textureLoad(src, vec2i(ix0, iy1), 0) * ((1.0 - fx) * fy) +
			textureLoad(src, vec2i(ix1, iy1), 0) * (fx * fy);
		rgba = rgba * 255.0;
		let s = vec3f(rgba[p.order.x], rgba[p.order.y], rgba[p.order.z]);
		v = (s - p.mean.xyz) * p.invStd.xyz;
	}
	dst[o] = v.x;
	dst[plane + o] = v.y;
	dst[2u * plane + o] = v.z;
}
`;

const HASH_WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> acc: array<atomic<u32>, 2>;

var<workgroup> local: array<atomic<u32>, 2>;

@compute @workgroup_size(16, 16)
fn main(
	@builtin(global_invocation_id) id: vec3u,
	@builtin(local_invocation_index) li: u32,
) {
	let dim = textureDimensions(src);
	if (id.x < dim.x && id.y < dim.y) {
		let c = pack4x8unorm(textureLoad(src, vec2i(id.xy), 0));
		let i = id.y * dim.x + id.x;
		let a = (c ^ (i * 0x9e3779b9u)) * 0x85ebca6bu;
		let b = (c + i * 0xc2b2ae35u) * 0x27d4eb2fu;
		atomicAdd(&local[0], a ^ (a >> 15u));
		atomicAdd(&local[1], b ^ (b >> 13u));
	}
	workgroupBarrier();
	if (li == 0u) {
		atomicAdd(&acc[0], atomicLoad(&local[0]));
		atomicAdd(&acc[1], atomicLoad(&local[1]));
	}
}
`;

const PARAMS_BYTES = 112;

const pipelines = new WeakMap<GPUDevice, FrameTensorPipeline>();

export class FrameTensorPipeline {
	private readonly tensorPipeline: GPUComputePipeline;
	private readonly hashPipeline: GPUComputePipeline;
	private readonly params: GPUBuffer;

	/** One per device. */
	public static for(device: GPUDevice): FrameTensorPipeline {
		let pipeline = pipelines.get(device);
		if (!pipeline) {
			pipeline = new FrameTensorPipeline(device);
			pipelines.set(device, pipeline);
		}
		return pipeline;
	}

	private constructor(private readonly device: GPUDevice) {
		this.tensorPipeline = device.createComputePipeline({
			label: "vision_frame_tensor",
			layout: "auto",
			compute: {
				module: device.createShaderModule({ code: TENSOR_WGSL }),
				entryPoint: "main",
			},
		});
		this.hashPipeline = device.createComputePipeline({
			label: "vision_frame_hash",
			layout: "auto",
			compute: {
				module: device.createShaderModule({ code: HASH_WGSL }),
				entryPoint: "main",
			},
		});
		this.params = device.createBuffer({
			label: "vision_frame_tensor_params",
			size: PARAMS_BYTES,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
	}

	/** Bytes of the NCHW float tensor for `spec`. */
	public static tensorBytes(spec: PreprocessSpec): number {
		return 3 * spec.width * spec.height * 4;
	}

	/**
	 * Writes `image` as the model input described by `spec` into `out` (at least
	 * `tensorBytes(spec)`, STORAGE usage). Submits its own command buffer, so it
	 * runs before anything submitted later (e.g. the inference reading `out`).
	 */
	public toTensor(
		image: VisionGpuImage,
		spec: PreprocessSpec,
		out: GPUBuffer,
	): InputTransform {
		const transform = computeInputTransform(image.width, image.height, spec);
		const { scaleX, scaleY, offsetX, offsetY } = transform;
		const params = new ArrayBuffer(PARAMS_BYTES);
		const u32 = new Uint32Array(params);
		const f32 = new Float32Array(params);
		const i32 = new Int32Array(params);
		u32.set([image.width, image.height, spec.width, spec.height], 0);
		f32.set([scaleX, scaleY, offsetX, offsetY], 4);
		i32.set(
			[
				Math.ceil(offsetX),
				Math.ceil(offsetY),
				Math.min(spec.width, Math.floor(offsetX + image.width * scaleX)) - 1,
				Math.min(spec.height, Math.floor(offsetY + image.height * scaleY)) - 1,
			],
			8,
		);
		const inv = spec.std.map((s) => 1 / s);
		f32.set([...spec.mean, 0], 12);
		f32.set([...inv, 0], 16);
		f32.set(
			[0, 1, 2].map(
				(c) => (spec.padValue - (spec.mean[c] as number)) * (inv[c] as number),
			),
			20,
		);
		u32.set(spec.channels === "bgr" ? [2, 1, 0, 3] : [0, 1, 2, 3], 24);
		this.device.queue.writeBuffer(this.params, 0, params);

		const encoder = this.device.createCommandEncoder({
			label: "vision_frame_tensor",
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.tensorPipeline);
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.tensorPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: this.params } },
					{ binding: 1, resource: image.texture.createView() },
					{ binding: 2, resource: { buffer: out } },
				],
			}),
		);
		pass.dispatchWorkgroups(
			Math.ceil(spec.width / 16),
			Math.ceil(spec.height / 16),
		);
		pass.end();
		this.device.queue.submit([encoder.finish()]);
		return transform;
	}

	/** A key that is equal for textures with equal size and pixels. */
	public async contentKey(image: VisionGpuImage): Promise<string> {
		const acc = this.device.createBuffer({
			size: 8,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
		});
		const staging = this.device.createBuffer({
			size: 8,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		const encoder = this.device.createCommandEncoder({
			label: "vision_frame_hash",
		});
		const pass = encoder.beginComputePass();
		pass.setPipeline(this.hashPipeline);
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.hashPipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: image.texture.createView() },
					{ binding: 1, resource: { buffer: acc } },
				],
			}),
		);
		pass.dispatchWorkgroups(
			Math.ceil(image.width / 16),
			Math.ceil(image.height / 16),
		);
		pass.end();
		encoder.copyBufferToBuffer(acc, 0, staging, 0, 8);
		this.device.queue.submit([encoder.finish()]);
		await staging.mapAsync(GPUMapMode.READ);
		const [a, b] = new Uint32Array(staging.getMappedRange().slice(0));
		staging.unmap();
		staging.destroy();
		acc.destroy();
		return `${image.width}x${image.height}:gpu:${(a as number).toString(36)}:${(b as number).toString(36)}`;
	}
}

/** Reads an 8-bit RGBA/BGRA texture back as RGBA pixels. */
export async function readTexturePixels(
	image: VisionGpuImage,
): Promise<VisionImageInput> {
	const { device, texture, width, height } = image;
	const unaligned = width * 4;
	const bytesPerRow = Math.ceil(unaligned / 256) * 256;
	const staging = device.createBuffer({
		size: bytesPerRow * height,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
		label: "vision_frame_readback",
	});
	const encoder = device.createCommandEncoder({
		label: "vision_frame_readback",
	});
	encoder.copyTextureToBuffer(
		{ texture },
		{ buffer: staging, bytesPerRow, rowsPerImage: height },
		[width, height, 1],
	);
	device.queue.submit([encoder.finish()]);
	await staging.mapAsync(GPUMapMode.READ);
	const mapped = new Uint8Array(staging.getMappedRange());
	const data = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y++) {
		data.set(
			mapped.subarray(y * bytesPerRow, y * bytesPerRow + unaligned),
			y * unaligned,
		);
	}
	staging.unmap();
	staging.destroy();
	if (texture.format.startsWith("bgra")) {
		for (let i = 0; i < data.length; i += 4) {
			const b = data[i] as number;
			data[i] = data[i + 2] as number;
			data[i + 2] = b;
		}
	}
	return { data, width, height };
}
