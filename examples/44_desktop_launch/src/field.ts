/**
 * The field: a grid of small frames standing on a dark mirror, every one
 * placed each frame by `poseField`. They sleep leaning back, wake in a ring
 * that spreads from the window and turn to face it, ripple as the playhead
 * crosses, and at the end some lift off and stand along the strokes of the
 * mark while the rest go dark.
 *
 * World: px, y down, the floor at y = 0, the window at the origin facing -z.
 */
import { Layer3D, type LayoutNode } from "framefields";
import { type MarkSlot, markSlots } from "./mark.js";
import { films } from "./screens.js";
import {
	BEAT,
	BEAT_FRAMES,
	clamp01,
	ease,
	easeOut,
	hash,
	lerp,
	PROMPT,
	ramp,
} from "./theme.js";

export const FRAME_W = 160;
export const FRAME_H = 90;
const PITCH = 240;
const NX = 131;
const NZ = 141;
/** Grid row that sits on z = 0. */
const ROW0 = 55;
export const COUNT = NX * NZ;

/** Where the mark is laid out, beyond the window, and its size on the floor. */
export const MARK = { x: 0, z: 6480, size: 2700 } as const;
const UNIT = MARK.size / 512;
/** Frames this close to the mark step aside, so it stands on clear floor. */
const MARK_CLEARING = 2550;

/** How far the wake travels per frame, and the playhead's reach in x. */
export const WAKE_SPEED = 280;
export const PLAYHEAD_REACH = 8600;
const PLAYHEAD_WIDTH = 720;

const SLEEP_TILT = 1.33;
const AWAKE_TILT = 0.1;
/** In the mark the frames lean on each other like fallen dominoes, faces up. */
const MARK_TILT = 0.95;
/** How bright a sleeping screen is: off, but not a hole. */
const ASLEEP = 0.012;
/** Distance between rows of frames along a stroke of the mark. */
const MARK_ROW = 46;
const TAU = Math.PI * 2;

/** The playhead's x at `frame`: the field and the window's timeline share it. */
export function playheadX(frame: number): number {
	return lerp(
		-PLAYHEAD_REACH,
		PLAYHEAD_REACH,
		(frame - BEAT.play) / (BEAT.played - BEAT.play),
	);
}

interface Cell {
	x: number;
	z: number;
	/** Distance from the window and from the mark. */
	fromWindow: number;
	fromMark: number;
	/** Yaw that faces the window. */
	facing: number;
	a: number;
	b: number;
	/** Which of the films its screen plays. */
	film: number;
	/** Which colour of a checkerboard it stands on. */
	parity: number;
	hidden: boolean;
	slot?: MarkSlot & {
		x: number;
		z: number;
		yaw: number;
		scale: number;
		at: number;
	};
}

/** When each stroke of the mark starts to assemble, frames after `gather`. */
const STROKE_START = [0, 5, 10, 15, 34, 48, 60];
const STROKE_SPAN = [26, 26, 26, 26, 24, 16, 18];
const FLIGHT = 44;

function buildCells(): Cell[] {
	const cells: Cell[] = [];
	for (let k = 0; k < COUNT; k++) {
		const x = ((k % NX) - (NX - 1) / 2) * PITCH;
		const z = (Math.floor(k / NX) - ROW0) * PITCH;
		cells.push({
			x,
			z,
			fromWindow: Math.hypot(x, z),
			fromMark: Math.hypot(x - MARK.x, z - MARK.z),
			facing: Math.atan2(-x, -z),
			a: hash(k, 1),
			b: hash(k, 2),
			film: Math.floor(hash(k, 3) * FILMS) % FILMS,
			parity: ((k % NX) + Math.floor(k / NX)) % 2,
			// The clearing the window stands in.
			hidden: (x / 2150) ** 2 + (z / 1250) ** 2 < 1,
		});
	}
	// Each place in the mark takes the nearest frame still free.
	const taken = new Set<number>();
	for (const slot of markSlots(MARK_ROW / UNIT, (FRAME_W * 1.08) / UNIT)) {
		const x = MARK.x + (slot.u - 256) * UNIT;
		const z = MARK.z - (slot.v - 256) * UNIT;
		let best = -1;
		let bestD = Number.POSITIVE_INFINITY;
		for (let k = 0; k < COUNT; k++) {
			const c = cells[k] as Cell;
			if (c.hidden || taken.has(k)) continue;
			const d = (c.x - x) ** 2 + (c.z - z) ** 2;
			if (d < bestD) {
				bestD = d;
				best = k;
			}
		}
		if (best < 0) continue;
		taken.add(best);
		(cells[best] as Cell).slot = {
			...slot,
			x,
			z,
			yaw: Math.atan2(slot.tu, -slot.tv),
			scale: (slot.width * UNIT) / FRAME_W,
			at:
				BEAT.gather +
				(STROKE_START[slot.stroke] as number) +
				slot.along * (STROKE_SPAN[slot.stroke] as number),
		};
	}
	return cells;
}

/**
 * The field plays: on each of four beats one colour of the checkerboard
 * jumps and flares while the other dims, the flip running out from the
 * window. `jump` is how far into its hop a frame is, `dim` how far the
 * others fall back.
 */
function flip(frame: number, c: Cell): { jump: number; dim: number } {
	let jump = 0;
	let dim = 0;
	for (let n = 0; n < 4; n++) {
		const t = frame - (BEAT.flips + n * BEAT_FRAMES) - c.fromWindow / 1100;
		if (t <= 0 || t > 40) continue;
		const pulse = Math.min(1, t / 2) * Math.exp(-t / 5);
		if (c.parity === n % 2) jump = Math.max(jump, pulse);
		else dim = Math.max(dim, pulse);
	}
	return { jump, dim };
}

/** A glint that runs across the finished mark, left to right: how much of it is on `x`. */
function glint(frame: number, x: number): number {
	const t = (frame - BEAT.glint) / 24;
	if (t < -0.2 || t > 1.2) return 0;
	const at = MARK.x + lerp(-MARK.size * 0.62, MARK.size * 0.62, t);
	return Math.exp(-(((x - at) / 230) ** 2));
}

/** Values per instance in a pose buffer. */
const STRIDE = 13;
const FILMS = 4;

/** Shortest way round from angle `a` to `b`. */
function turn(a: number, b: number, t: number): number {
	let d = (b - a) % TAU;
	if (d > Math.PI) d -= TAU;
	if (d < -Math.PI) d += TAU;
	return a + d * t;
}

/** Frames a typed key's ripple travels per frame, and the gap between keys. */
const RIPPLE_SPEED = 320;
const KEY_GAP = (BEAT.typed - BEAT.type) / PROMPT.length;

/**
 * What a sleeping frame does before the wake reaches it: dreams (faint
 * bands of light drifting in toward the window), stirs as each typed key
 * sends a ripple out from the window, and trembles more and more while the
 * render fills. `glow` adds to its screen's level, `lift` raises its lean.
 */
function stirring(
	frame: number,
	fromWindow: number,
	jitter: number,
): { glow: number; lift: number } {
	const dream = Math.max(0, Math.sin(fromWindow / 900 + frame * 0.11)) ** 10;
	let glow = 0.05 * dream;
	let lift = 0.02 * dream;
	// One ripple per key, fading with distance.
	const since = frame - BEAT.type - fromWindow / RIPPLE_SPEED;
	const key = Math.floor(since / KEY_GAP);
	if (since > 0 && key < PROMPT.length) {
		const age = since - key * KEY_GAP;
		const ripple = Math.exp(-((age / 2.2) ** 2)) * Math.exp(-fromWindow / 5200);
		glow += 0.16 * ripple;
		lift += 0.07 * ripple;
	}
	// The render fills: the field can feel it coming.
	const coming = ramp(frame, BEAT.work, BEAT.wake) ** 2;
	if (coming > 0) {
		const tremble = Math.sin(frame * 1.1 + jitter * 40);
		glow += 0.05 * coming * (0.5 + 0.5 * tremble);
		lift += 0.05 * coming * tremble;
	}
	return { glow, lift };
}

/**
 * Every frame's pose at `frame`: x, y, z, scale, quaternion, the screen's
 * tint and level (how bright it plays), and whether it has become a plain
 * blue light of the mark. `STRIDE` values each; scale 0 means not there.
 */
function poseField(cells: Cell[], frame: number, out: Float32Array): void {
	const playing = frame > BEAT.play - 30 && frame < BEAT.played + 30;
	const head = playheadX(frame);
	for (let k = 0; k < cells.length; k++) {
		const c = cells[k] as Cell;
		const o = k * STRIDE;
		if (c.hidden) {
			out[o + 3] = 0;
			continue;
		}
		let x = c.x;
		let z = c.z;
		let lift = 0;
		let scale = 1;
		let plain = 0;

		// Asleep, then awake: the ring reaches each frame in turn.
		const woke = frame - (BEAT.wake + c.fromWindow / WAKE_SPEED);
		let tilt = SLEEP_TILT;
		let yaw = Math.PI;
		let level = ASLEEP;
		let r = 1;
		let g = 1;
		let b = 1;
		if (woke > 0) {
			tilt =
				AWAKE_TILT +
				(SLEEP_TILT - AWAKE_TILT) * Math.exp(-woke / 5) * Math.cos(woke / 2.3);
			yaw = turn(Math.PI, c.facing, easeOut(woke / 16));
			const steady = lerp(0.42, 1.45, c.a ** 2);
			const shimmer = 0.82 + 0.18 * Math.sin(frame * 0.13 + c.b * 40);
			// Light keeps rolling out from the window in slow rings.
			const swell =
				0.72 +
				0.5 * Math.max(0, Math.sin(c.fromWindow / 1300 - frame * 0.16)) ** 2;
			level =
				ASLEEP +
				2.6 * Math.exp(-woke / 5) +
				steady * shimmer * swell * (1 - Math.exp(-woke / 9));
			const played = flip(frame, c);
			lift += 86 * played.jump;
			tilt -= 0.1 * played.jump;
			level = level * (1 - 0.6 * played.dim) + 1.5 * played.jump;
		} else if (frame < BEAT.wake + 400) {
			const stir = stirring(frame, c.fromWindow, c.b);
			level += stir.glow;
			tilt -= stir.lift;
		}

		// The playhead: a turn, a hop and a flash of signal yellow as it passes.
		if (playing) {
			const u = (c.x - head) / PLAYHEAD_WIDTH;
			const near = Math.exp(-u * u);
			yaw += TAU * ramp(-u, -1.3, 1.3);
			lift += 46 * near;
			tilt += 0.22 * near;
			level += 1.5 * near;
			g = lerp(g, 0.9, near);
			b = lerp(b, 0.08, near);
		}

		const slot = c.slot;
		if (slot) {
			// Off the ground, over to the mark, down into its place.
			const t = clamp01((frame - slot.at) / FLIGHT);
			if (t > 0) {
				const e = ease(t);
				const arc = Math.sin(Math.PI * t);
				const side = (c.a - 0.5) * 520 * arc;
				x = lerp(c.x, slot.x, e) - slot.tv * side;
				z = lerp(c.z, slot.z, e) - slot.tu * side;
				lift += arc * (380 + 520 * c.b);
				yaw = turn(yaw, slot.yaw, e) + TAU * (1 - e) * e * (c.a - 0.5);
				tilt = lerp(tilt, MARK_TILT, e) + 0.7 * arc * (c.b - 0.3);
				scale = lerp(1, slot.scale, e);
				// The film on its screen gives way to the mark's blue.
				plain = 1;
				const landed = Math.max(0, frame - slot.at - FLIGHT);
				// It turns blue as it leaves the ground, and flares once as it lands.
				const blue = ease(t * 3);
				level =
					lerp(Math.min(1.1, Math.max(level, 0.8)), 1.5, e) +
					(t >= 1 ? 0.9 * Math.exp(-landed / 6) : 0);
				r = lerp(1, 0.2, blue);
				g = lerp(1, 0.5, blue);
				b = lerp(1, 0.98, blue);
				// Whole on the bar: the mark flares as one; later a glint crosses it.
				if (frame >= BEAT.mark)
					level += 1.7 * Math.exp(-(frame - BEAT.mark) / 7);
				const shine = glint(frame, slot.x);
				level += 1.4 * shine;
				r = lerp(r, 1, 0.7 * shine);
				g = lerp(g, 1, 0.7 * shine);
			}
		} else if (frame > BEAT.gather) {
			if (c.fromMark < MARK_CLEARING) {
				// Step aside: the mark stands on clear floor.
				scale =
					1 - ramp(frame, BEAT.gather + c.a * 16, BEAT.gather + 20 + c.a * 16);
			}
			// Back to sleep, the dark spreading out from the mark.
			const slept = ramp(frame - (BEAT.gather + 16 + c.fromMark / 420), 0, 16);
			tilt = lerp(tilt, SLEEP_TILT, slept);
			level = lerp(level, ASLEEP, slept);
		}

		// Yaw, then lean back about the bottom edge, which stays on the floor.
		const half = (FRAME_H / 2) * scale;
		const sy = Math.sin(yaw / 2);
		const cy = Math.cos(yaw / 2);
		const sx = Math.sin(tilt / 2);
		const cx = Math.cos(tilt / 2);
		out[o] = x - half * Math.sin(yaw) * Math.sin(tilt);
		out[o + 1] = -lift - half * Math.cos(tilt) - 1.5;
		out[o + 2] = z - half * Math.cos(yaw) * Math.sin(tilt);
		out[o + 3] = scale;
		out[o + 4] = cy * sx;
		out[o + 5] = sy * cx;
		out[o + 6] = -sy * sx;
		out[o + 7] = cy * cx;
		out[o + 8] = r;
		out[o + 9] = g;
		out[o + 10] = b;
		out[o + 11] = level;
		out[o + 12] = plain;
	}
}

function roundedRect(
	w: number,
	h: number,
	r: number,
	reverse: boolean,
): string {
	const x = w / 2;
	const y = h / 2;
	const forward = `M ${-x + r} ${-y} L ${x - r} ${-y} Q ${x} ${-y} ${x} ${-y + r} L ${x} ${y - r} Q ${x} ${y} ${x - r} ${y} L ${-x + r} ${y} Q ${-x} ${y} ${-x} ${y - r} L ${-x} ${-y + r} Q ${-x} ${-y} ${-x + r} ${-y} Z`;
	const backward = `M ${-x + r} ${-y} Q ${-x} ${-y} ${-x} ${-y + r} L ${-x} ${y - r} Q ${-x} ${y} ${-x + r} ${y} L ${x - r} ${y} Q ${x} ${y} ${x} ${y - r} L ${x} ${-y + r} Q ${x} ${-y} ${x - r} ${-y} Z`;
	return reverse ? backward : forward;
}

const BEZEL = 5;

/** A layer of the field: the rims, the screens playing one film, or the mark's plain lights. */
type Part = "rims" | "plain" | number;

/**
 * The field as instanced layers sharing one pose: metal rims, the screens
 * inside them (a layer per film they play) and the plain lights the mark's
 * frames turn into.
 */
export function field(): LayoutNode[] {
	const cells = buildCells();
	// Every layer (and motion blur's extra samples) reads the same poses.
	const poses = new Map<number, Float32Array>();
	const poseAt = (frame: number): Float32Array => {
		let pose = poses.get(frame);
		if (!pose) {
			if (poses.size >= 6) poses.delete(poses.keys().next().value as number);
			pose = new Float32Array(COUNT * STRIDE);
			poseField(cells, frame, pose);
			poses.set(frame, pose);
		}
		return pose;
	};
	const instance = (part: Part) => {
		const t = {
			x: 0,
			y: 0,
			z: 0,
			scale: 1,
			rotation: [0, 0, 0, 1] as [number, number, number, number],
			color: [1, 1, 1, 1] as [number, number, number, number],
			emissive: [0, 0, 0] as [number, number, number],
			emissiveIntensity: 0,
		};
		return (k: number, frame: number) => {
			const p = poseAt(frame);
			const o = k * STRIDE;
			const scale = p[o + 3] as number;
			if (scale <= 0.001) return undefined;
			const plain = (p[o + 12] as number) > 0.5;
			if (part === "plain" ? !plain : part !== "rims" && plain)
				return undefined;
			if (typeof part === "number" && (cells[k] as Cell).film !== part)
				return undefined;
			t.x = p[o] as number;
			t.y = p[o + 1] as number;
			t.z = p[o + 2] as number;
			t.scale = scale;
			t.rotation[0] = p[o + 4] as number;
			t.rotation[1] = p[o + 5] as number;
			t.rotation[2] = p[o + 6] as number;
			t.rotation[3] = p[o + 7] as number;
			const level = p[o + 11] as number;
			if (part === "rims") {
				// A rim catches a little of its own screen's light.
				t.emissive[0] = p[o + 8] as number;
				t.emissive[1] = p[o + 9] as number;
				t.emissive[2] = p[o + 10] as number;
				t.emissiveIntensity = level * 0.05;
			} else {
				t.color[0] = (p[o + 8] as number) * level;
				t.color[1] = (p[o + 9] as number) * level;
				t.color[2] = (p[o + 10] as number) * level;
			}
			return t;
		};
	};

	const rims = Layer3D.instances({
		id: "field-rims",
		mesh: Layer3D.extrude({
			d: `${roundedRect(FRAME_W, FRAME_H, 11, false)} ${roundedRect(FRAME_W - BEZEL * 2, FRAME_H - BEZEL * 2, 7, true)}`,
			depth: 7,
			bevelThickness: 1.2,
			bevelSegments: 2,
			color: "#d9dcdd",
			roughness: 0.34,
			metallic: 1,
		}),
		count: COUNT,
		roughness: 0.34,
		metallic: 1,
		instanceAt: instance("rims"),
	});
	const pane = (depth: number) =>
		Layer3D.roundedBox({
			width: FRAME_W - BEZEL * 2 + 1,
			height: FRAME_H - BEZEL * 2 + 1,
			depth,
			radius: 1,
			color: "#ffffff",
		});
	const screens = films().map((film, i) =>
		Layer3D.instances({
			id: `field-screens-${i}`,
			mesh: pane(2),
			count: COUNT,
			material: "unlit",
			texture: film,
			instanceAt: instance(i),
		}),
	);
	const lights = Layer3D.instances({
		id: "field-lights",
		mesh: pane(2.6),
		count: COUNT,
		material: "unlit",
		instanceAt: instance("plain"),
	});
	return [rims, ...screens, lights] as LayoutNode[];
}
