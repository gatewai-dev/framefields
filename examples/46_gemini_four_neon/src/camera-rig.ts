/**
 * Reusable Hermite-spline 3D camera rig with impulse hit shakes, dynamic
 * FOV punch, and native WebGPU camera motion blur. Baked frame-by-frame so
 * seeks, contact sheets, and video exports match identically.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { clamp01, hash } from "./theme.js";

export type Vec3 = readonly [number, number, number];

export interface CameraStation {
	readonly at: number;
	readonly eye: Vec3;
	readonly look: Vec3;
	readonly roll?: number;
	readonly fov?: number;
	/** 0 = linear speed between stations, 1 = quintic ease at both ends. Default 0.75. */
	readonly snap?: number;
}

export interface CameraHit {
	readonly at: number;
	readonly amount: number;
	readonly frames: number;
	readonly fovKick?: number;
}

export interface CameraRigOptions {
	readonly id: string;
	readonly duration: number;
	readonly stations: readonly CameraStation[];
	readonly hits?: readonly CameraHit[];
	readonly baseFov?: number;
	readonly near?: number;
	readonly far?: number;
	readonly motionBlur?: { readonly shutter: number; readonly samples: number };
}

function ramped(s: number, snap: number): number {
	const c = clamp01(s);
	const eased = c < 0.5 ? 16 * c ** 5 : 1 - (-2 * c + 2) ** 5 / 2;
	return c + (eased - c) * snap;
}

function buildSpline(
	stations: readonly CameraStation[],
	pick: (s: CameraStation) => number,
): (frame: number) => number {
	const n = stations.length;
	const p = stations.map(pick);
	const m = p.map((_, i) =>
		i === 0 || i === n - 1
			? 0
			: (((p[i + 1] ?? 0) - (p[i - 1] ?? 0)) / 2) * 0.55,
	);
	return (frame: number) => {
		let i = 0;
		while (i < n - 2 && frame > (stations[i + 1]?.at ?? 0)) i++;
		const a = stations[i] as CameraStation;
		const b = stations[i + 1] as CameraStation;
		const span = Math.max(1, b.at - a.at);
		const s = ramped((frame - a.at) / span, b.snap ?? 0.75);
		const s2 = s * s;
		const s3 = s2 * s;
		return (
			(2 * s3 - 3 * s2 + 1) * (p[i] ?? 0) +
			(s3 - 2 * s2 + s) * (m[i] ?? 0) +
			(-2 * s3 + 3 * s2) * (p[i + 1] ?? 0) +
			(s3 - s2) * (m[i + 1] ?? 0)
		);
	};
}

function shakeAt(
	hits: readonly CameraHit[],
	frame: number,
	axis: number,
): number {
	let offset = 0;
	for (const hit of hits) {
		const t = frame - hit.at;
		if (t < 0 || t > hit.frames) continue;
		const fade = (1 - t / hit.frames) ** 2;
		offset += hit.amount * fade * (hash(frame, axis * 13 + hit.at) * 2 - 1);
	}
	return offset;
}

function fovPunchAt(hits: readonly CameraHit[], frame: number): number {
	let kick = 0;
	for (const hit of hits) {
		if (!hit.fovKick) continue;
		const t = frame - hit.at;
		if (t < 0 || t > hit.frames * 2) continue;
		kick += hit.fovKick * Math.min(1, t / 3) * Math.exp(-t / 9);
	}
	return kick;
}

const isConstant = (keys: ReadonlyArray<[number, number, string]>): boolean => {
	const first = keys[0]?.[1] ?? 0;
	return keys.every(([, v]) => Math.abs(v - first) < 1e-4);
};

export function buildCameraRig(options: CameraRigOptions): LayoutNode {
	const { id, duration, stations, hits = [], baseFov = 38 } = options;
	const lastFrame = Math.max(1, duration - 1);
	const frames = Array.from({ length: lastFrame + 1 }, (_, f) => f);

	const xCurve = buildSpline(stations, (s) => s.eye[0]);
	const yCurve = buildSpline(stations, (s) => s.eye[1]);
	const zCurve = buildSpline(stations, (s) => s.eye[2]);
	const txCurve = buildSpline(stations, (s) => s.look[0]);
	const tyCurve = buildSpline(stations, (s) => s.look[1]);
	const tzCurve = buildSpline(stations, (s) => s.look[2]);
	const rollCurve = buildSpline(stations, (s) => s.roll ?? 0);
	const fovCurve = buildSpline(stations, (s) => s.fov ?? baseFov);

	const bake = (fn: (f: number) => number): Array<[number, number, string]> =>
		frames.map((f) => [f, Math.round(fn(f) * 100) / 100, "none"]);

	const anim = LayerAnimation.create();
	const addIfDynamic = (
		prop:
			| "x"
			| "y"
			| "z"
			| "targetX"
			| "targetY"
			| "targetZ"
			| "cameraRoll"
			| "cameraFov",
		keys: Array<[number, number, string]>,
	) => {
		if (!isConstant(keys)) anim.keys(prop, keys);
	};

	addIfDynamic(
		"x",
		bake((f) => xCurve(f) + shakeAt(hits, f, 1)),
	);
	addIfDynamic(
		"y",
		bake((f) => yCurve(f) + shakeAt(hits, f, 2)),
	);
	addIfDynamic("z", bake(zCurve));
	addIfDynamic(
		"targetX",
		bake((f) => txCurve(f) + shakeAt(hits, f, 3) * 0.5),
	);
	addIfDynamic(
		"targetY",
		bake((f) => tyCurve(f) + shakeAt(hits, f, 4) * 0.5),
	);
	addIfDynamic("targetZ", bake(tzCurve));
	addIfDynamic("cameraRoll", bake(rollCurve));
	addIfDynamic(
		"cameraFov",
		bake((f) => fovCurve(f) + fovPunchAt(hits, f)),
	);

	return Layer.camera({
		id,
		x: xCurve(0),
		y: yCurve(0),
		z: zCurve(0),
		targetX: txCurve(0),
		targetY: tyCurve(0),
		targetZ: tzCurve(0),
		fov: fovCurve(0),
		lens: {
			near: options.near ?? 10,
			far: options.far ?? 45000,
		},
		...(options.motionBlur ? { motionBlur: options.motionBlur } : {}),
	}).animate(anim) as LayoutNode;
}
