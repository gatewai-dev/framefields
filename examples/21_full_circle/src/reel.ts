/**
 * Turns the planned edit into layers: one plate per cut (optionally seen
 * through a circular window), the ring that carries the eye across cuts, and
 * the catalogue caption naming each circle.
 */
import { GradientMap, Layer } from "framefields";
import type { Circle } from "./circles.js";
import {
	EDIT,
	needsMask,
	type PlannedCut,
	poseAt,
	ringAt,
	windowAt,
} from "./edit.js";
import { asset } from "./paths.js";
import { layerOffset } from "./plates.js";
import { SHOTS } from "./shots.js";
import {
	AMBER,
	BONE,
	caption,
	EMBER,
	H,
	INK,
	type Key,
	keys,
	MARGIN,
	scene,
	W,
} from "./theme.js";

/** Pose and ring tracks are sampled every other frame; the compositor interpolates between. */
const STEP = 2;

const DUOTONE = [
	{ position: 0, color: INK },
	{ position: 0.4, color: EMBER },
	{ position: 0.75, color: AMBER },
	{ position: 1, color: BONE },
];

function sampleFrames(len: number): number[] {
	const frames: number[] = [];
	for (let f = 0; f < len; f += STEP) frames.push(f);
	if (frames[frames.length - 1] !== len - 1) frames.push(len - 1);
	return frames;
}

/** x/y/width/height tracks that draw a circle-shaped layer (ellipse) at `circleAt(frame)`. */
function circleTracks(len: number, circleAt: (f: number) => Circle) {
	const x: Key[] = [];
	const y: Key[] = [];
	const d: Key[] = [];
	for (const f of sampleFrames(len)) {
		const c = circleAt(f);
		x.push([f, c.cx - c.r]);
		y.push([f, c.cy - c.r]);
		d.push([f, 2 * c.r]);
	}
	return keys("x", x, keys("y", y, keys("width", d, keys("height", d))));
}

function plate(cut: PlannedCut) {
	const shot = cut.shot as string;
	const len = cut.to - cut.from;
	const x: Key[] = [];
	const y: Key[] = [];
	const s: Key[] = [];
	for (const f of sampleFrames(len)) {
		const { c, pose } = poseAt(cut, f);
		const o = layerOffset(c, pose);
		x.push([f, o.x]);
		y.push([f, o.y]);
		s.push([f, pose.scale]);
	}
	const video = Layer.video(asset(`${shot}.mp4`), {
		id: `${cut.id}-plate`,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		muted: true,
		trimStartSec: cut.trim,
	}).animate(keys("x", x, keys("y", y, keys("scale", s))));
	return cut.treat === "duotone"
		? video.apply(new GradientMap({ stops: DUOTONE }))
		: video;
}

/** Everything outside the window is cut away by a disc composited with `mask-in`. */
function windowMask(cut: PlannedCut) {
	const len = cut.to - cut.from;
	return Layer.shape("ellipse", {
		id: `${cut.id}-window`,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fillColor: "#FFFFFF",
		blendMode: "mask-in",
	}).animate(
		circleTracks(
			len,
			(f) => windowAt(cut, f) ?? { cx: W / 2, cy: H / 2, r: Math.hypot(W, H) },
		),
	);
}

function cutLayer(cut: PlannedCut) {
	const children = cut.shot
		? [plate(cut), ...(needsMask(cut) ? [windowMask(cut)] : [])]
		: [];
	return Layer.box({
		id: cut.id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		// A painted (even transparent) background makes the box its own layer
		// group, so the mask only cuts this plate and not what is beneath it.
		background: "transparent",
		startFrame: cut.from,
		durationFrames: cut.to - cut.from,
		children,
	});
}

const RING_ON = 0.9;
const RING_CARRY = 10;

function ringOpacity(cut: PlannedCut, len: number): Key[] {
	if (cut.ring === "on") return [[0, RING_ON]];
	const out: Key[] = [[0, cut.kIn ? RING_ON : 0]];
	if (cut.kIn) out.push([Math.min(RING_CARRY, len - 2), 0, "power2.out"]);
	if (cut.kOut) {
		const start = Math.max(out[out.length - 1][0] + 1, len - RING_CARRY);
		out.push([start, 0], [len - 1, RING_ON, "power2.in"]);
	}
	return out;
}

function ring(cut: PlannedCut) {
	const len = cut.to - cut.from;
	return scene(`${cut.id}-ring-group`, cut.from, cut.to, [
		Layer.shape("ellipse", {
			id: `${cut.id}-ring`,
			position: "absolute",
			x: 0,
			y: 0,
			width: 2,
			height: 2,
			fillType: "none",
			strokeColor: BONE,
			strokeWidth: 2,
		}).animate(
			keys(
				"opacity",
				ringOpacity(cut, len),
				circleTracks(len, (f) => ringAt(cut, f)),
			),
		),
	]);
}

/** "03  Porthole" under the frame, for every cut that shows a shot. */
function label(cut: PlannedCut) {
	const index = SHOTS.findIndex((s) => s.id === cut.shot);
	const len = cut.to - cut.from;
	return scene(`${cut.id}-label-group`, cut.from, cut.to, [
		caption({
			id: `${cut.id}-label`,
			text: `${String(index + 1).padStart(2, "0")}   ${SHOTS[index].name}`,
			y: H - MARGIN - 20,
			inAt: 0,
			outAt: len > 48 ? 40 : undefined,
			settle: Math.min(18, len - 1),
		}),
	]);
}

export const plates = () => EDIT.map(cutLayer);
export const rings = () => EDIT.map(ring);
export const labels = () =>
	EDIT.filter((c) => c.shot && c.label !== false).map(label);
