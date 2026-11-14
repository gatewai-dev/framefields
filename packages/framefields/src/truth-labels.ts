/**
 * Labels of a ground-truth pass (`Composition.renderTruth`): the camera as
 * datasets describe one (intrinsics, view and projection), and per object
 * its visible pixels and box, its oriented 3D box and the box that box
 * projects to (amodal, as if nothing covered it).
 */
import {
	Camera3D,
	type Mat4,
	Matrix4Math,
	type Scene3DTruth,
	type Scene3DTruthObject,
} from "@framefields/webgpu-renderers";

type Vec3 = [number, number, number];
/** [x0, y0, x1, y1] in pixels, the max edge exclusive. */
export type Box2D = [number, number, number, number];

export interface CameraLabels {
	eye: Vec3;
	target: Vec3;
	up: Vec3;
	/** Vertical field of view, degrees (before zoom). */
	fov: number;
	near: number;
	far: number;
	width: number;
	height: number;
	/** Pinhole intrinsics in pixels, origin at the top-left, y down. */
	intrinsics: { fx: number; fy: number; cx: number; cy: number };
	/** World to camera, column-major. */
	view: Mat4;
	/** Camera to clip (WebGPU depth 0..1), column-major. */
	projection: Mat4;
}

export interface ObjectBox3D {
	/** Scene px, y down. */
	center: Vec3;
	/** Edge lengths along the object's own axes, scene px. */
	size: Vec3;
	/** Object axes in the world, row-major 3×3 (columns are the axes). */
	rotation: number[];
}

export interface ObjectLabels {
	id: number;
	kind: Scene3DTruthObject["kind"];
	layer?: string;
	/** Its layer's `label`: what it is. */
	label?: string;
	part: number;
	/** Pixels where it is the nearest surface. */
	pixels: number;
	/** Box of those pixels; null when nothing of it shows. */
	box2d: Box2D | null;
	/**
	 * `renderTruth({ amodal: true })`: pixels it covers drawn alone, hidden
	 * or not, their box, and the share of them that shows (1: nothing in
	 * front of it; 0: wholly hidden or off screen).
	 */
	amodalPixels?: number;
	amodalBox2d?: Box2D | null;
	visibleFraction?: number;
	/** Oriented box of its geometry (absent for the floor). */
	box3d?: ObjectBox3D;
	/** Where `box3d` lands on screen, clipped to the image: covered or not. */
	projectedBox2d?: Box2D | null;
	/** Instanced draws: each instance's pixels and visible box. */
	instances?: Array<{
		instance: number;
		pixels: number;
		box2d: Box2D;
		amodalPixels?: number;
		visibleFraction?: number;
	}>;
}

export interface TruthLabels {
	camera: CameraLabels;
	objects: ObjectLabels[];
}

function cameraLabels(s: Scene3DTruth): CameraLabels {
	const camera = { ...s.camera, aspect: s.width / s.height };
	const projection = Camera3D.computeProjectionMatrix(camera);
	return {
		eye: [...camera.eye],
		target: [...camera.target],
		up: [...camera.up],
		fov: camera.fov,
		near: camera.near,
		far: camera.far,
		width: s.width,
		height: s.height,
		intrinsics: {
			fx: (projection[0] * s.width) / 2,
			fy: (projection[5] * s.height) / 2,
			cx: s.width / 2,
			cy: s.height / 2,
		},
		view: Camera3D.computeViewMatrix(camera),
		projection,
	};
}

/** Grows a box (or starts one) to hold pixel (x, y). */
function grow(box: Box2D | null, x: number, y: number): Box2D {
	if (!box) return [x, y, x + 1, y + 1];
	if (x < box[0]) box[0] = x;
	if (y < box[1]) box[1] = y;
	if (x + 1 > box[2]) box[2] = x + 1;
	if (y + 1 > box[3]) box[3] = y + 1;
	return box;
}

interface PixelStats {
	pixels: number;
	box: Box2D | null;
	instances: Map<number, { pixels: number; box: Box2D }>;
}

/** One pass over the id image: each object's pixels and boxes. */
function pixelStats(s: Scene3DTruth): Map<number, PixelStats> {
	const stats = new Map<number, PixelStats>();
	for (let i = 0; i < s.object.length; i++) {
		const id = s.object[i];
		if (id === 0) continue;
		const x = i % s.width;
		const y = (i - x) / s.width;
		let st = stats.get(id);
		if (!st) {
			st = { pixels: 0, box: null, instances: new Map() };
			stats.set(id, st);
		}
		st.pixels++;
		st.box = grow(st.box, x, y);
		const inst = s.instance[i];
		const per = st.instances.get(inst) ?? {
			pixels: 0,
			box: [x, y, x + 1, y + 1],
		};
		per.pixels++;
		per.box = grow(per.box, x, y);
		st.instances.set(inst, per);
	}
	return stats;
}

function apply(m: Mat4, p: Vec3): Vec3 {
	return [
		m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
		m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
		m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
	];
}

function box3d(o: Scene3DTruthObject): ObjectBox3D | undefined {
	if (!o.matrix || !o.bounds) return undefined;
	const m = o.matrix;
	const { min, max } = o.bounds;
	const center = apply(m, [
		(min[0] + max[0]) / 2,
		(min[1] + max[1]) / 2,
		(min[2] + max[2]) / 2,
	]);
	const axes = [0, 1, 2].map((k) => [m[k * 4], m[k * 4 + 1], m[k * 4 + 2]]);
	const scales = axes.map((a) => Math.hypot(a[0], a[1], a[2]) || 1);
	const unit = axes.map((a, k) => a.map((v) => v / scales[k]));
	return {
		center,
		size: [0, 1, 2].map((k) => (max[k] - min[k]) * scales[k]) as Vec3,
		// Row-major with the axes as columns.
		rotation: [0, 1, 2].flatMap((r) => unit.map((axis) => axis[r])),
	};
}

/**
 * Where an object's local box projects, clipped to the image; null when it
 * is wholly outside or behind the camera.
 */
function projectedBox(
	o: Scene3DTruthObject,
	viewProj: Mat4,
	width: number,
	height: number,
): Box2D | null | undefined {
	if (!o.matrix || !o.bounds) return undefined;
	const { min, max } = o.bounds;
	const clip = Matrix4Math.multiply(viewProj, o.matrix);
	let box: Box2D | null = null;
	for (let c = 0; c < 8; c++) {
		const p: Vec3 = [
			c & 1 ? max[0] : min[0],
			c & 2 ? max[1] : min[1],
			c & 4 ? max[2] : min[2],
		];
		const w = clip[3] * p[0] + clip[7] * p[1] + clip[11] * p[2] + clip[15];
		if (w <= 1e-6) continue;
		const [cx, cy] = apply(clip, p);
		const x = ((cx / w + 1) / 2) * width;
		const y = ((1 - cy / w) / 2) * height;
		box = box ? grow(box, x, y) : [x, y, x, y];
	}
	if (!box) return null;
	const clipped: Box2D = [
		Math.max(0, box[0]),
		Math.max(0, box[1]),
		Math.min(width, box[2]),
		Math.min(height, box[3]),
	];
	return clipped[0] < clipped[2] && clipped[1] < clipped[3] ? clipped : null;
}

/** The camera and every object's labels for one ground-truth pass. */
export function truthLabels(scene: Scene3DTruth): TruthLabels {
	const camera = cameraLabels(scene);
	const viewProj = Matrix4Math.multiply(camera.projection, camera.view);
	const stats = pixelStats(scene);
	const amodal = new Map((scene.amodal ?? []).map((a) => [a.id, a]));
	const objects = scene.objects.map((o): ObjectLabels => {
		const st = stats.get(o.id);
		const labels: ObjectLabels = {
			id: o.id,
			kind: o.kind,
			...(o.layer !== undefined && { layer: o.layer }),
			...(o.label !== undefined && { label: o.label }),
			part: o.part,
			pixels: st?.pixels ?? 0,
			box2d: st?.box ?? null,
		};
		const b3 = box3d(o);
		if (b3 && !o.instances) {
			labels.box3d = b3;
			labels.projectedBox2d = projectedBox(
				o,
				viewProj,
				scene.width,
				scene.height,
			);
		}
		const alone = amodal.get(o.id);
		if (alone) {
			labels.amodalPixels = alone.pixels;
			labels.amodalBox2d = alone.box;
			labels.visibleFraction = alone.pixels ? labels.pixels / alone.pixels : 0;
		}
		if (o.instances && st) {
			const whole = new Map(
				(alone?.instances ?? []).map((a) => [a.instance, a.pixels]),
			);
			labels.instances = [...st.instances]
				.sort(([a], [b]) => a - b)
				.map(([instance, v]) => {
					const all = whole.get(instance);
					return {
						instance,
						pixels: v.pixels,
						box2d: v.box,
						...(all !== undefined && {
							amodalPixels: all,
							visibleFraction: all ? v.pixels / all : 0,
						}),
					};
				});
		}
		return labels;
	});
	return { camera, objects };
}
