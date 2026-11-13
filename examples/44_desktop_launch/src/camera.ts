/**
 * The take: one camera, no cuts. It moves from station to station on a
 * smooth curve, slow at each and fast between (so every move is a ramp into
 * the next beat), rolls into its turns and is shaken by the two hits. Baked
 * to a key per frame, so the move reads the same in the preview, a seek and
 * the render.
 */
import { Layer, LayerAnimation } from "framefields";
import { BEAT, clamp01, DURATION, hash } from "./theme.js";
import { COMPOSER, PREVIEW } from "./window.js";

type Vec = [number, number, number];
interface Station {
	at: number;
	eye: Vec;
	look: Vec;
	/** Degrees the horizon tips here. */
	roll?: number;
	/**
	 * How hard the move arriving here is ramped: 0 glides at one speed, 1
	 * all but stops at both ends. Default 0.8.
	 */
	snap?: number;
}

/** The typed line's middle: what the lens reads while the keys land. */
const LINE: Vec = [COMPOSER.left + 330, COMPOSER.cy, 0];

const STATIONS: Station[] = [
	// In fast and low over the sleeping field, the window rising ahead.
	{ at: 0, eye: [160, -130, -9200], look: [60, -520, 0] },
	{
		at: BEAT.arrive,
		eye: [-760, -760, -2950],
		look: [150, -800, 0],
		roll: -3,
		snap: 0.9,
	},
	// In on the composer for the line.
	{
		at: BEAT.type + 6,
		eye: [LINE[0] - 230, LINE[1] - 170, -1650],
		look: [LINE[0] - 60, LINE[1] - 50, 0],
		snap: 0.9,
	},
	{
		at: BEAT.typed,
		eye: [LINE[0] + 150, LINE[1] - 90, -1240],
		look: [LINE[0] + 40, LINE[1] - 16, 0],
		snap: 0.2,
	},
	// Sent: across to where the line lands and the render begins.
	{
		at: BEAT.send + 14,
		eye: [COMPOSER.cx + 360, LINE[1] - 240, -1480],
		look: [COMPOSER.cx + 320, LINE[1] - 150, 0],
		roll: 2,
		snap: 0.9,
	},
	// Back for the wake.
	{
		at: BEAT.wake - 6,
		eye: [-560, -1050, -3500],
		look: [200, -760, 0],
		snap: 0.7,
	},
	// Thrown back and up by it.
	{
		at: BEAT.wake + 36,
		eye: [-2500, -2500, -6900],
		look: [0, -420, 900],
		roll: -5,
		snap: 0.95,
	},
	// Round the window while the field plays.
	{
		at: BEAT.flips + 30,
		eye: [1200, -2900, -7400],
		look: [0, -300, 1200],
		roll: 4,
		snap: 0.5,
	},
	{
		at: BEAT.play + 22,
		eye: [3300, -2100, -5600],
		look: [0, -300, 1300],
		roll: 6,
		snap: 0.5,
	},
	// Down with the playhead, at the preview …
	{
		at: BEAT.played + 22,
		eye: [PREVIEW.cx + 260, PREVIEW.cy - 120, -2300],
		look: [PREVIEW.cx, PREVIEW.cy, 2600],
		roll: -8,
		snap: 0.6,
	},
	// … through it …
	{
		at: BEAT.through,
		eye: [PREVIEW.cx, PREVIEW.cy, 0],
		look: [PREVIEW.cx - 80, PREVIEW.cy + 150, 4600],
		roll: 6,
		snap: 0.3,
	},
	// … and up in a turn over the field, where the mark gathers.
	{
		at: BEAT.gather + 40,
		eye: [260, -2100, 1700],
		look: [0, -200, 6200],
		roll: 14,
		snap: 0.3,
	},
	{
		at: BEAT.mark - 12,
		eye: [0, -5350, 2900],
		look: [0, 0, 6120],
		roll: 0,
		snap: 0.85,
	},
	// Hold on the mark, still drifting in.
	{ at: DURATION, eye: [0, -5800, 2720], look: [0, 0, 6060], snap: 0 },
];

/** The two hits that shake the lens: the wake and the mark. */
const HITS: Array<{ at: number; amount: number; frames: number }> = [
	{ at: BEAT.wake, amount: 46, frames: 22 },
	{ at: BEAT.mark, amount: 26, frames: 16 },
];

/** Slow at both ends, fast between: `snap` of the way from linear to a full ramp. */
function ramped(s: number, snap: number): number {
	const eased = s < 0.5 ? 16 * s ** 5 : 1 - (-2 * s + 2) ** 5 / 2;
	return s + (eased - s) * snap;
}

/** A curve through the stations (Hermite spans, softened Catmull-Rom tangents), ramped in time. */
function curve(pick: (s: Station) => number): (frame: number) => number {
	const n = STATIONS.length;
	const p = STATIONS.map(pick);
	const m = p.map((_, i) =>
		i === 0 || i === n - 1
			? 0
			: (((p[i + 1] as number) - (p[i - 1] as number)) / 2) * 0.6,
	);
	return (frame) => {
		let i = 0;
		while (i < n - 2 && frame > (STATIONS[i + 1] as Station).at) i++;
		const a = STATIONS[i] as Station;
		const b = STATIONS[i + 1] as Station;
		const s = ramped(clamp01((frame - a.at) / (b.at - a.at)), b.snap ?? 0.8);
		const s2 = s * s;
		const s3 = s2 * s;
		return (
			(2 * s3 - 3 * s2 + 1) * (p[i] as number) +
			(s3 - 2 * s2 + s) * (m[i] as number) +
			(-2 * s3 + 3 * s2) * (p[i + 1] as number) +
			(s3 - s2) * (m[i + 1] as number)
		);
	};
}

/** How far a hit throws the lens at `frame`, along one axis. */
function shake(frame: number, axis: number): number {
	let offset = 0;
	for (const hit of HITS) {
		const t = frame - hit.at;
		if (t < 0 || t > hit.frames) continue;
		const fade = (1 - t / hit.frames) ** 2;
		offset += hit.amount * fade * (hash(frame, axis + hit.at) * 2 - 1);
	}
	return offset;
}

const PATH = {
	x: curve((s) => s.eye[0]),
	y: curve((s) => s.eye[1]),
	z: curve((s) => s.eye[2]),
	targetX: curve((s) => s.look[0]),
	targetY: curve((s) => s.look[1]),
	targetZ: curve((s) => s.look[2]),
	roll: curve((s) => s.roll ?? 0),
};

/** The lens widens for a moment on the wake, as if pushed back by it. */
function fovAt(frame: number): number {
	const t = frame - BEAT.wake;
	const kick = t < 0 ? 0 : Math.min(1, t / 4) * Math.exp(-t / 12);
	return FOV + 9 * kick;
}
const FOV = 36;

export function camera() {
	const frames = Array.from({ length: DURATION + 1 }, (_, f) => f);
	const bake = (fn: (frame: number) => number) =>
		frames.map(
			(f) =>
				[f, Math.round(fn(f) * 100) / 100, "none"] as [number, number, string],
		);
	const animation = LayerAnimation.create()
		.keys(
			"x",
			bake((f) => PATH.x(f) + shake(f, 1)),
		)
		.keys(
			"y",
			bake((f) => PATH.y(f) + shake(f, 2)),
		)
		.keys("z", bake(PATH.z))
		.keys(
			"targetX",
			bake((f) => PATH.targetX(f) + shake(f, 3) * 0.6),
		)
		.keys(
			"targetY",
			bake((f) => PATH.targetY(f) + shake(f, 4) * 0.6),
		)
		.keys("targetZ", bake(PATH.targetZ))
		.keys("cameraRoll", bake(PATH.roll))
		.keys("cameraFov", bake(fovAt));
	return Layer.camera({
		id: "lens",
		x: PATH.x(0),
		y: PATH.y(0),
		z: PATH.z(0),
		targetX: PATH.targetX(0),
		targetY: PATH.targetY(0),
		targetZ: PATH.targetZ(0),
		fov: FOV,
		lens: { near: 8, far: 60000 },
		// Fast moves streak; nothing else is ever soft.
		motionBlur: { shutter: 150, samples: 24 },
	}).animate(animation);
}
