/**
 * GPU data copied out while a frame is encoded and read once it has run:
 * textures (as stored, through `DisplayBlit`) and buffer ranges. A capture
 * encodes the copies into the frame's own command encoder, because the
 * frame may reuse or release its textures and buffers right after.
 */
import type { DisplayBlit } from "../renderer3d/display-blit.js";

/** An rgba8 picture, rows top to bottom. */
export interface Rgba8Image {
	width: number;
	height: number;
	data: Uint8Array;
}

const ROW_ALIGN = 256;

export class TextureReadback {
	readonly width: number;
	readonly height: number;
	private readonly buffer: GPUBuffer;
	/** Kept until read: the frame's commands, not yet submitted, write it. */
	private readonly target: GPUTexture;
	private readonly bytesPerRow: number;
	private image: Promise<Rgba8Image> | null = null;

	/** Encodes the copy of `source`, its longer side capped at `maxSize`. */
	constructor(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		blit: DisplayBlit,
		source: GPUTexture,
		maxSize: number,
	) {
		const k = Math.min(1, maxSize / Math.max(source.width, source.height));
		const width = Math.max(1, Math.round(source.width * k));
		const height = Math.max(1, Math.round(source.height * k));
		const target = device.createTexture({
			label: "GltfExportTexture",
			size: { width, height },
			format: "rgba8unorm",
			usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
		});
		this.target = target;
		blit.draw(encoder, source, target.createView(), [0, 0, width, height]);
		this.bytesPerRow = Math.ceil((width * 4) / ROW_ALIGN) * ROW_ALIGN;
		this.buffer = device.createBuffer({
			label: "GltfExportTextureRead",
			size: this.bytesPerRow * height,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		encoder.copyTextureToBuffer(
			{ texture: target },
			{ buffer: this.buffer, bytesPerRow: this.bytesPerRow },
			{ width, height },
		);
		this.width = width;
		this.height = height;
	}

	/** The pixels, once the frame's commands have run. Read once, then cached. */
	read(): Promise<Rgba8Image> {
		this.image ??= this.map();
		return this.image;
	}

	private async map(): Promise<Rgba8Image> {
		await this.buffer.mapAsync(GPUMapMode.READ);
		const rows = new Uint8Array(this.buffer.getMappedRange());
		const data = new Uint8Array(this.width * this.height * 4);
		for (let y = 0; y < this.height; y++)
			data.set(
				rows.subarray(
					y * this.bytesPerRow,
					y * this.bytesPerRow + this.width * 4,
				),
				y * this.width * 4,
			);
		this.buffer.unmap();
		this.buffer.destroy();
		this.target.destroy();
		return { width: this.width, height: this.height, data };
	}
}

export class BufferReadback {
	private readonly buffer: GPUBuffer;
	private data: Promise<Float32Array> | null = null;

	/** Encodes the copy of `size` bytes of `source` from `offset` (both multiples of 4). */
	constructor(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		source: GPUBuffer,
		offset: number,
		size: number,
	) {
		this.buffer = device.createBuffer({
			label: "GltfExportBufferRead",
			size,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		encoder.copyBufferToBuffer(source, offset, this.buffer, 0, size);
	}

	read(): Promise<Float32Array> {
		this.data ??= this.map();
		return this.data;
	}

	private async map(): Promise<Float32Array> {
		await this.buffer.mapAsync(GPUMapMode.READ);
		const out = new Float32Array(this.buffer.getMappedRange().slice(0));
		this.buffer.unmap();
		this.buffer.destroy();
		return out;
	}
}

/** Straight alpha from premultiplied, in place (glTF colors are not premultiplied). */
export function unpremultiply(image: Rgba8Image): Rgba8Image {
	const d = image.data;
	for (let i = 0; i < d.length; i += 4) {
		const a = d[i + 3];
		if (a === 0 || a === 255) continue;
		for (let c = 0; c < 3; c++)
			d[i + c] = Math.min(255, Math.round((d[i + c] * 255) / a));
	}
	return image;
}
