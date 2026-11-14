/**
 * Recorded poses ("we render, you simulate"): body trajectories from any
 * simulator (Isaac, Genesis, PyBullet, MJX, a lab's own) replayed as the
 * same per-frame signals the physics worlds produce, so layers follow them
 * and `renderTruth` labels them like any other run.
 *
 * Positions and quaternions come in the simulator's axes and units
 * (`z-up` or `y-up` meters, or scene pixels) and are turned into the
 * scene's (y down, px) by a proper rotation, so nothing is mirrored.
 */
import {
	type AnimatableProp,
	LayerAnimation,
} from "@framefields/compositions/program";
import type { FrameSignal } from "@framefields/core";
import type { LayoutNode } from "../index.js";
import type { Quat, Vec3 } from "./backend.js";
import { Recording } from "./core.js";
import { eulerFromQuat } from "./world3d.js";

/** Axes a trajectory is given in. */
export type PoseAxes = "z-up" | "y-up" | "scene";

/** One body's trajectory, one entry per frame. */
export interface BodyTrack {
	/** Positions: `[x, y, z]` per frame, or one flat array of frames × 3. */
	position: ArrayLike<number> | ArrayLike<number>[];
	/** Unit quaternions per frame (or flat frames × 4). Omitted: no rotation. */
	rotation?: ArrayLike<number> | ArrayLike<number>[];
}

export interface PoseTrackOptions {
	fps: number;
	/** Each body's trajectory, by name. All have the same number of frames. */
	bodies: Record<string, BodyTrack>;
	/**
	 * The trajectories' axes: `z-up` (MuJoCo, Isaac, PyBullet, Genesis;
	 * meters), `y-up` (glTF, Unity-style right-handed; meters) or `scene`
	 * (already scene pixels, y down). Default `z-up`.
	 */
	axes?: PoseAxes;
	/** Quaternion component order. Default `xyzw` (MuJoCo and Isaac use `wxyz`). */
	quaternion?: "xyzw" | "wxyz";
	/** Scene pixels per meter (not for `scene`). Default 100. */
	pixelsPerMeter?: number;
	/** Where the trajectories' origin lands in the scene, px. Default [0, 0, 0]. */
	origin?: Vec3;
	/** Composition frame the track starts at; before it, the first pose. Default 0. */
	startFrame?: number;
}

const POSE_CHANNELS = ["x", "y", "z", "rotateX", "rotateY", "rotateZ"] as const;
type PoseChannel = (typeof POSE_CHANNELS)[number];

/**
 * Each axes' rotation C into the scene (x right, y down, z away from the
 * default camera): a point p lands at C·p, an orientation R at C·R·Cᵀ.
 */
const AXES: Record<PoseAxes, number[]> = {
	// (x, y, z) → (x, -z, y)
	"z-up": [1, 0, 0, 0, 0, -1, 0, 1, 0],
	// (x, y, z) → (x, -y, -z): half a turn about x
	"y-up": [1, 0, 0, 0, -1, 0, 0, 0, -1],
	scene: [1, 0, 0, 0, 1, 0, 0, 0, 1],
};

/** Row-major 3×3 product. */
function mul3(a: number[], b: number[]): number[] {
	const out = new Array<number>(9);
	for (let i = 0; i < 3; i++)
		for (let j = 0; j < 3; j++)
			out[i * 3 + j] =
				a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
	return out;
}

function transpose3(m: number[]): number[] {
	return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/** The row-major rotation of a unit quaternion [x, y, z, w]. */
export function matrixFromQuat([x, y, z, w]: Quat): number[] {
	return [
		1 - 2 * (y * y + z * z),
		2 * (x * y - w * z),
		2 * (x * z + w * y),
		2 * (x * y + w * z),
		1 - 2 * (x * x + z * z),
		2 * (y * z - w * x),
		2 * (x * z - w * y),
		2 * (y * z + w * x),
		1 - 2 * (x * x + y * y),
	];
}

/** The unit quaternion [x, y, z, w] of a row-major rotation matrix. */
export function quatFromMatrix(m: number[]): Quat {
	const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
	const trace = m00 + m11 + m22;
	if (trace > 0) {
		const s = Math.sqrt(trace + 1) * 2;
		return [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
	}
	if (m00 > m11 && m00 > m22) {
		const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
		return [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
	}
	if (m11 > m22) {
		const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
		return [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
	}
	const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
	return [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
}

/** Rows of `width` values: nested as given, or cut from a flat array. */
function rows(
	data: ArrayLike<number> | ArrayLike<number>[],
	width: number,
	what: string,
): ArrayLike<number>[] {
	const first = (data as ArrayLike<unknown>)[0];
	if (typeof first === "number" || data.length === 0) {
		const flat = data as ArrayLike<number>;
		if (flat.length % width !== 0)
			throw new Error(
				`Physics.poses: ${what} has ${flat.length} values, not a multiple of ${width}.`,
			);
		return Array.from({ length: flat.length / width }, (_, f) =>
			Array.prototype.slice.call(flat, f * width, f * width + width),
		);
	}
	const nested = data as ArrayLike<number>[];
	for (let f = 0; f < nested.length; f++)
		if (nested[f].length !== width)
			throw new Error(
				`Physics.poses: ${what} frame ${f} has ${nested[f].length} values, expected ${width}.`,
			);
	return Array.from(nested);
}

/** Recorded body trajectories as per-frame pose signals. */
export class PoseTrack {
	readonly fps: number;
	/** Frames in each trajectory. */
	readonly frames: number;
	readonly startFrame: number;
	/** Body names, in the order given. */
	readonly names: string[];
	private readonly recordings = new Map<string, Recording>();

	constructor(options: PoseTrackOptions) {
		this.fps = options.fps;
		this.startFrame = Math.max(0, Math.round(options.startFrame ?? 0));
		this.names = Object.keys(options.bodies);
		if (this.names.length === 0)
			throw new Error("Physics.poses: `bodies` names no trajectory.");
		const axes = options.axes ?? "z-up";
		const c = AXES[axes];
		const ct = transpose3(c);
		const ppm = axes === "scene" ? 1 : (options.pixelsPerMeter ?? 100);
		const origin = options.origin ?? [0, 0, 0];
		const wxyz = options.quaternion === "wxyz";
		let frames = -1;
		for (const name of this.names) {
			const track = options.bodies[name];
			const positions = rows(track.position, 3, `${name}.position`);
			const rotations = track.rotation
				? rows(track.rotation, 4, `${name}.rotation`)
				: undefined;
			if (frames < 0) frames = positions.length;
			if (
				positions.length !== frames ||
				(rotations && rotations.length !== frames)
			)
				throw new Error(
					`Physics.poses: "${name}" has ${positions.length} positions${rotations ? ` and ${rotations.length} rotations` : ""}; the first body has ${frames} frames.`,
				);
			const rec = new Recording(this.startFrame + frames, this.fps, () => {});
			const channel = Object.fromEntries(
				POSE_CHANNELS.map((k) => [k, rec.channel(k)]),
			) as Record<PoseChannel, Float32Array>;
			let previous: Vec3 | undefined;
			for (let f = 0; f < frames; f++) {
				const p = positions[f];
				const at = this.startFrame + f;
				const values: number[] = [
					origin[0] + ppm * (c[0] * p[0] + c[1] * p[1] + c[2] * p[2]),
					origin[1] + ppm * (c[3] * p[0] + c[4] * p[1] + c[5] * p[2]),
					origin[2] + ppm * (c[6] * p[0] + c[7] * p[1] + c[8] * p[2]),
				];
				if (rotations) {
					const r = rotations[f];
					const q: Quat = wxyz
						? [r[1], r[2], r[3], r[0]]
						: [r[0], r[1], r[2], r[3]];
					const len = Math.hypot(...q) || 1;
					const scene = mul3(
						mul3(c, matrixFromQuat(q.map((v) => v / len) as Quat)),
						ct,
					);
					previous = eulerFromQuat(quatFromMatrix(scene), previous);
					values.push(...previous);
				} else values.push(0, 0, 0);
				POSE_CHANNELS.forEach((k, i) => {
					channel[k][at] = values[i];
					if (f === 0) channel[k].fill(values[i], 0, at);
				});
			}
			this.recordings.set(name, rec);
		}
		this.frames = frames;
	}

	/** A body's center (px) and rotation (degrees) as per-frame signals. */
	body(name: string): Record<PoseChannel, FrameSignal<number>> {
		const rec = this.recording(name);
		return Object.fromEntries(
			POSE_CHANNELS.map((c) => [c, rec.signal(c)]),
		) as Record<PoseChannel, FrameSignal<number>>;
	}

	/**
	 * Makes `layer` follow a body: its position and rotation become the
	 * body's every frame (the layer's own origin is the body's origin).
	 * Returns the layer.
	 */
	follow<T extends LayoutNode>(name: string, layer: T): T {
		const rec = this.recording(name);
		const anim = LayerAnimation.create();
		for (const c of POSE_CHANNELS)
			anim.signal(c as AnimatableProp, rec.signal(c));
		(layer as unknown as { animate(a: LayerAnimation): unknown }).animate(anim);
		return layer;
	}

	private recording(name: string): Recording {
		const rec = this.recordings.get(name);
		if (!rec)
			throw new Error(
				`Physics.poses: no body "${name}" (bodies: ${this.names.join(", ")}).`,
			);
		return rec;
	}
}
