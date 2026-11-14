/**
 * Ground truth of a frame's 3D passes: per pixel linear depth, surface
 * normal, screen motion and object, measured by the renderer rather than estimated
 * from the picture. The compositor hands each raster 3D pass to
 * `NodeRenderProps.truth` when one is attached; nothing else changes in the
 * frame (the picture is the same as without it).
 */

import type { Camera3DPose } from "../math3d/camera3d.js";
import { float16BitsToFloat32 } from "../signals/float16.js";

/** A draw of a 3D pass, as its pixels name it in `Scene3DTruth.object`. */
export interface Scene3DTruthObject {
	/** The id its pixels carry (1 and up; 0 is no object). */
	id: number;
	kind: "mesh" | "quad" | "text" | "floor";
	/** Id of the layer that drew it (absent for the environment's floor). */
	layer?: string;
	/** Which of the layer's draws this is, in draw order (a model's meshes). */
	part: number;
}

/** What the compositor hands a truth capture for one 3D pass. */
export interface Scene3DTruthPass {
	camera: Camera3DPose;
	/** The pass's size in pixels. */
	width: number;
	height: number;
	/**
	 * The f32 velocity pass (`TRUTH_MOTION_FORMAT`): rg screen motion since
	 * the previous frame in px (x right, y down), b linear depth, a coverage.
	 */
	motion: GPUTexture;
	/** `TRUTH_OBJECT_FORMAT` (rg32uint): r object id (0 = none), g instance index. */
	objects: GPUTexture;
	/** What each object id stands for. */
	objectTable: Scene3DTruthObject[];
	/**
	 * `Renderer3D.truthGeometry` (rgba16float): r linear depth, gb the world
	 * normal octahedral-encoded to 0..1. Absent when the pass has no raster
	 * geometry (path traced).
	 */
	geometry?: GPUTexture;
}

export interface Scene3DTruthCapture {
	/**
	 * Called once per 3D pass while the frame is being encoded: copy what is
	 * needed with `encoder` now, since the frame reuses its targets afterwards.
	 */
	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DTruthPass,
	): void;
}

/** One 3D pass's ground truth, row-major from the top-left pixel. */
export interface Scene3DTruth {
	camera: Camera3DPose;
	width: number;
	height: number;
	/** Distance along the camera's forward axis, scene px; Infinity where no surface. */
	depth: Float32Array;
	/** Unit world-space normal (xyz per pixel, y down); zero where no surface. */
	normal?: Float32Array;
	/** Screen motion since the previous frame, px (xy per pixel); zero on a scene's first frame. */
	motion: Float32Array;
	/** 1 where a surface covers the pixel, else 0. */
	mask: Uint8Array;
	/** The object at each pixel: an id in `objects`, 0 where none. */
	object: Uint32Array;
	/** The instance of an instanced object at each pixel (0 when not instanced). */
	instance: Uint32Array;
	/** The objects of the pass by id, in draw order. */
	objects: Scene3DTruthObject[];
}

const ROW_ALIGN = 256;

/** A texture copied into a mappable buffer in the frame's encoder. */
class RawReadback {
	private readonly buffer: GPUBuffer;
	private readonly bytesPerRow: number;
	private readonly rowBytes: number;

	constructor(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		private readonly texture: GPUTexture,
		bytesPerPixel: number,
	) {
		this.rowBytes = texture.width * bytesPerPixel;
		this.bytesPerRow = Math.ceil(this.rowBytes / ROW_ALIGN) * ROW_ALIGN;
		this.buffer = device.createBuffer({
			label: "Scene3DTruthRead",
			size: this.bytesPerRow * texture.height,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		encoder.copyTextureToBuffer(
			{ texture },
			{ buffer: this.buffer, bytesPerRow: this.bytesPerRow },
			{ width: texture.width, height: texture.height },
		);
	}

	/** The rows packed tightly, once the frame's commands have run. */
	async read(): Promise<ArrayBuffer> {
		await this.buffer.mapAsync(GPUMapMode.READ);
		const rows = new Uint8Array(this.buffer.getMappedRange());
		const out = new Uint8Array(this.rowBytes * this.texture.height);
		for (let y = 0; y < this.texture.height; y++) {
			const start = y * this.bytesPerRow;
			out.set(rows.subarray(start, start + this.rowBytes), y * this.rowBytes);
		}
		this.buffer.unmap();
		this.buffer.destroy();
		return out.buffer;
	}
}

/** The unit vector an octahedral-encoded normal (0..1 per channel) stands for. */
function decodeOctahedral(u: number, v: number): [number, number, number] {
	let x = u * 2 - 1;
	let y = v * 2 - 1;
	const z = 1 - Math.abs(x) - Math.abs(y);
	const t = Math.max(-z, 0);
	x += x >= 0 ? -t : t;
	y += y >= 0 ? -t : t;
	const len = Math.hypot(x, y, z) || 1;
	return [x / len, y / len, z / len];
}

interface PendingPass {
	camera: Camera3DPose;
	width: number;
	height: number;
	motion: RawReadback;
	objects: RawReadback;
	objectTable: Scene3DTruthObject[];
	geometry?: RawReadback;
}

/**
 * Attach as a frame's `truth`, render the frame (submitting its commands),
 * then `finish()` for each 3D pass's depth, normals and motion.
 */
export class Scene3DTruthReader implements Scene3DTruthCapture {
	private readonly passes: PendingPass[] = [];

	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DTruthPass,
	): void {
		this.passes.push({
			camera: pass.camera,
			width: pass.width,
			height: pass.height,
			motion: new RawReadback(device, encoder, pass.motion, 16),
			objects: new RawReadback(device, encoder, pass.objects, 8),
			objectTable: pass.objectTable,
			geometry:
				pass.geometry && new RawReadback(device, encoder, pass.geometry, 8),
		});
	}

	async finish(): Promise<Scene3DTruth[]> {
		return Promise.all(this.passes.map((pass) => this.decode(pass)));
	}

	private async decode(pass: PendingPass): Promise<Scene3DTruth> {
		const count = pass.width * pass.height;
		const raw = new Float32Array(await pass.motion.read());
		const depth = new Float32Array(count);
		const motion = new Float32Array(count * 2);
		const mask = new Uint8Array(count);
		for (let i = 0; i < count; i++) {
			const covered = raw[i * 4 + 3] > 0.5;
			mask[i] = covered ? 1 : 0;
			depth[i] = covered ? raw[i * 4 + 2] : Number.POSITIVE_INFINITY;
			motion[i * 2] = covered ? raw[i * 4] : 0;
			motion[i * 2 + 1] = covered ? raw[i * 4 + 1] : 0;
		}
		const ids = new Uint32Array(await pass.objects.read());
		const object = new Uint32Array(count);
		const instance = new Uint32Array(count);
		for (let i = 0; i < count; i++) {
			if (!mask[i]) continue;
			object[i] = ids[i * 2];
			instance[i] = ids[i * 2 + 1];
		}
		const truth: Scene3DTruth = {
			camera: pass.camera,
			width: pass.width,
			height: pass.height,
			depth,
			motion,
			mask,
			object,
			instance,
			objects: pass.objectTable,
		};
		if (pass.geometry) {
			const half = new Uint16Array(await pass.geometry.read());
			const normal = new Float32Array(count * 3);
			for (let i = 0; i < count; i++) {
				if (!mask[i]) continue;
				const n = decodeOctahedral(
					float16BitsToFloat32(half[i * 4 + 1]),
					float16BitsToFloat32(half[i * 4 + 2]),
				);
				normal.set(n, i * 3);
			}
			truth.normal = normal;
		}
		return truth;
	}
}
