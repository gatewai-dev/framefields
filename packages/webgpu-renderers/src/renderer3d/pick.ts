/**
 * Picking: what a 3D pass drew at one pixel, read from the same ground-truth
 * targets `Scene3DTruthReader` reads (object id, depth, normal), one texel
 * each. Attach a `PickCapture` as a frame's `truth`, render the frame, then
 * `finish()`. The picture is unchanged.
 */
import { Camera3D, type Camera3DPose } from "../math3d/camera3d.js";
import { Matrix4Math } from "../math3d/matrix4.js";
import type { Vec3 } from "../math3d/vector3.js";
import { float16BitsToFloat32 } from "../signals/float16.js";
import type {
	Scene3DTruthCapture,
	Scene3DTruthObject,
	Scene3DTruthPass,
} from "./truth-capture.js";

/** A ray in scene space (px, y down). */
export interface Ray3D {
	origin: Vec3;
	/** Unit direction. */
	direction: Vec3;
}

/** What a pixel shows. */
export interface PickHit {
	/** The drawn object (its layer, kind, part). */
	object: Scene3DTruthObject;
	/** Instance of an instanced draw (0 otherwise). */
	instance: number;
	/** Distance along the camera's forward axis, scene px. */
	depth: number;
	/** The surface point, scene px. */
	point: Vec3;
	/** The surface's unit world normal, when the pass measures it. */
	normal?: Vec3;
}

/** The result of a pick: the hit (if any) and the camera that drew the pixel. */
export interface PickResult {
	hit: PickHit | null;
	/** The camera of the topmost 3D pass, for rays through other pixels. */
	camera?: Camera3DPose;
	/** That pass's size in pixels. */
	width: number;
	height: number;
}

/**
 * The ray from `camera`'s eye through pixel (`x`, `y`) of a `width` ×
 * `height` view (pixel centers at +0.5), as the pass projects it.
 */
export function cameraRay(
	camera: Camera3DPose,
	width: number,
	height: number,
	x: number,
	y: number,
): Ray3D {
	const view = Camera3D.computeViewMatrix(camera);
	const projection = Camera3D.computeProjectionMatrix(camera);
	const inverse = Matrix4Math.invert(Matrix4Math.multiply(projection, view));
	if (!inverse) throw new Error("cameraRay: the camera's matrix is singular.");
	const nx = (2 * x) / width - 1;
	const ny = 1 - (2 * y) / height;
	const near = Matrix4Math.projectPoint(inverse, [nx, ny, 0]);
	const far = Matrix4Math.projectPoint(inverse, [nx, ny, 1]);
	const d: Vec3 = [far[0] - near[0], far[1] - near[1], far[2] - near[2]];
	const l = Math.hypot(d[0], d[1], d[2]) || 1;
	return { origin: camera.eye, direction: [d[0] / l, d[1] / l, d[2] / l] };
}

/** Where a ray meets the plane through `point` with normal `normal`; null if parallel or behind. */
export function rayPlane(ray: Ray3D, point: Vec3, normal: Vec3): Vec3 | null {
	const denom =
		ray.direction[0] * normal[0] +
		ray.direction[1] * normal[1] +
		ray.direction[2] * normal[2];
	if (Math.abs(denom) < 1e-9) return null;
	const t =
		((point[0] - ray.origin[0]) * normal[0] +
			(point[1] - ray.origin[1]) * normal[1] +
			(point[2] - ray.origin[2]) * normal[2]) /
		denom;
	if (t < 0) return null;
	return [
		ray.origin[0] + ray.direction[0] * t,
		ray.origin[1] + ray.direction[1] * t,
		ray.origin[2] + ray.direction[2] * t,
	];
}

const ALIGN = 256;

interface PendingPick {
	camera: Camera3DPose;
	width: number;
	height: number;
	objectTable: Scene3DTruthObject[];
	/** Texel byte offsets in `buffer`: objects, motion, geometry. */
	buffer: GPUBuffer;
	hasGeometry: boolean;
}

/** Reads one pixel of each 3D pass a frame draws. */
export class PickCapture implements Scene3DTruthCapture {
	private readonly passes: PendingPick[] = [];

	/**
	 * (`x`, `y`) is a pixel of the frame, `frameWidth` × `frameHeight`; a
	 * pass drawn at another size reads the matching pixel of its own.
	 */
	constructor(
		readonly x: number,
		readonly y: number,
		readonly frameWidth: number,
		readonly frameHeight: number,
	) {}

	capture(
		device: GPUDevice,
		encoder: GPUCommandEncoder,
		pass: Scene3DTruthPass,
	): void {
		const px = this.texel(pass.width, this.x, this.frameWidth);
		const py = this.texel(pass.height, this.y, this.frameHeight);
		const buffer = device.createBuffer({
			label: "PickCapture",
			size: ALIGN * 3,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});
		const copy = (texture: GPUTexture, offset: number) =>
			encoder.copyTextureToBuffer(
				{ texture, origin: { x: px, y: py } },
				{ buffer, offset, bytesPerRow: ALIGN },
				{ width: 1, height: 1 },
			);
		copy(pass.objects, 0);
		copy(pass.motion, ALIGN);
		if (pass.geometry) copy(pass.geometry, ALIGN * 2);
		this.passes.push({
			camera: pass.camera,
			width: pass.width,
			height: pass.height,
			objectTable: pass.objectTable,
			buffer,
			hasGeometry: Boolean(pass.geometry),
		});
	}

	private texel(size: number, at: number, frame: number): number {
		return Math.max(0, Math.min(size - 1, Math.floor((at * size) / frame)));
	}

	/** Once the frame's commands are submitted: the topmost pass's hit at the pixel. */
	async finish(): Promise<PickResult> {
		const reads = await Promise.all(this.passes.map((p) => this.read(p)));
		const top = this.passes.at(-1);
		// Later passes draw over earlier ones: the last that hit wins.
		const hit = reads.filter((r) => r !== null).at(-1) ?? null;
		return {
			hit,
			...(top && { camera: top.camera }),
			width: top?.width ?? this.frameWidth,
			height: top?.height ?? this.frameHeight,
		};
	}

	private async read(pass: PendingPick): Promise<PickHit | null> {
		await pass.buffer.mapAsync(GPUMapMode.READ);
		const bytes = pass.buffer.getMappedRange().slice(0);
		pass.buffer.unmap();
		pass.buffer.destroy();
		const [id, instance] = new Uint32Array(bytes, 0, 2);
		const object = pass.objectTable.find((o) => o.id === id);
		if (!id || !object) return null;
		const depth = new Float32Array(bytes, ALIGN, 4)[2];
		const sx = ((this.x + 0.5) * pass.width) / this.frameWidth;
		const sy = ((this.y + 0.5) * pass.height) / this.frameHeight;
		const ray = cameraRay(pass.camera, pass.width, pass.height, sx, sy);
		const forward = normalize(sub(pass.camera.target, pass.camera.eye));
		const along = depth / dot(ray.direction, forward);
		const point: Vec3 = [
			ray.origin[0] + ray.direction[0] * along,
			ray.origin[1] + ray.direction[1] * along,
			ray.origin[2] + ray.direction[2] * along,
		];
		let normal: Vec3 | undefined;
		if (pass.hasGeometry) {
			const g = new Uint16Array(bytes, ALIGN * 2, 4);
			normal = octahedral(
				float16BitsToFloat32(g[1]),
				float16BitsToFloat32(g[2]),
			);
		}
		return { object, instance, depth, point, ...(normal && { normal }) };
	}
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const normalize = (v: Vec3): Vec3 => {
	const l = Math.hypot(v[0], v[1], v[2]) || 1;
	return [v[0] / l, v[1] / l, v[2] / l];
};

/** The unit vector an octahedral-encoded normal (0..1 per channel) stands for. */
function octahedral(u: number, v: number): Vec3 {
	let x = u * 2 - 1;
	let y = v * 2 - 1;
	const z = 1 - Math.abs(x) - Math.abs(y);
	const t = Math.max(-z, 0);
	x += x >= 0 ? -t : t;
	y += y >= 0 ? -t : t;
	return normalize([x, y, z]);
}
