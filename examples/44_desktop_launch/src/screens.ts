/**
 * What the frames in the field play: four small films in the brand's
 * palette, each a layout tree drawn once a frame and worn by a quarter of
 * the screens (`Layer3D.instances({ texture })`).
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { BLUE, DURATION, SIGNAL } from "./theme.js";

const TW = 480;
const TH = 270;
const PAPER = "#eef0ee";
const INK = "#0a0b0d";

type Key = [number, number, string?];

const LAST = DURATION - 1;

/** A value that swings between `a` and `b` every `period` frames, for the whole take. */
function swing(a: number, b: number, period: number, phase = 0): Key[] {
	const half = period / 2;
	const value = (i: number) => (i % 2 === 0 ? a : b);
	// Where the swing is at `frame`, between turn `i` and the next.
	const at = (frame: number, i: number) => {
		const p = (frame - (i * half - phase)) / half;
		return (
			value(i) + (value(i + 1) - value(i)) * (0.5 - 0.5 * Math.cos(Math.PI * p))
		);
	};
	const first = Math.floor(phase / half);
	const keys: Key[] = [[0, at(0, first)]];
	for (let i = first + 1; ; i++) {
		const frame = Math.round(i * half - phase);
		if (frame >= LAST) {
			keys.push([LAST, at(LAST, i - 1), "sine.inOut"]);
			return keys;
		}
		if (frame > 0) keys.push([frame, value(i), "sine.inOut"]);
	}
}

/** A value that runs from `a` to `b` and starts again, every `period` frames. */
function loop(a: number, b: number, period: number): Key[] {
	const keys: Key[] = [];
	for (let f = 0; f < LAST; f += period) {
		const end = Math.min(LAST, f + period - 1);
		keys.push([f, a, "hold"]);
		keys.push([end, a + ((b - a) * (end - f)) / (period - 1), "none"]);
	}
	return keys;
}

const tile = (id: string, background: string, children: unknown[]) =>
	Layer.box({
		id,
		width: TW,
		height: TH,
		background,
		overflow: "hidden",
		children: children as LayoutNode[],
	}) as LayoutNode;

const at = (x: number, y: number, width: number, height: number) => ({
	position: "absolute" as const,
	x,
	y,
	width,
	height,
});

/** First light: a night sky going blue to a bright horizon, the sun coming up. */
function dawn() {
	return tile(
		"film-dawn",
		"linear-gradient(180deg, #030716 0%, #0c2466 40%, #3b82f6 60%, #e9f0ff 68%, #07090d 69%, #040506 100%)",
		[
			Layer.shape("circle", { ...at(214, 150, 52, 52), fill: PAPER }).animate(
				LayerAnimation.create().keys("y", swing(168, 112, 220)),
			),
			Layer.box({ ...at(0, 186, TW, 84), background: "#05070a" }),
			Layer.box({
				...at(0, 184, TW, 3),
				background: "#f4f7ff",
			}),
		],
	);
}

/** Motion: paper, an ink disc and a blue bar that never sit still. */
function motion() {
	return tile("film-motion", PAPER, [
		Layer.shape("circle", { ...at(70, 75, 120, 120), fill: INK }).animate(
			LayerAnimation.create().keys("x", swing(50, 180, 130)),
		),
		Layer.box({
			...at(300, 40, 34, 190),
			background: BLUE,
			borderRadius: 17,
		}).animate(LayerAnimation.create().keys("rotation", loop(0, 360, 150))),
		Layer.box({ ...at(360, 150, 76, 76), background: INK }).animate(
			LayerAnimation.create().keys("y", swing(150, 44, 96, 20)),
		),
	]);
}

/** The mark's own move: a curve easing out of a node, into play. */
function curve() {
	const stroke = {
		strokeColor: PAPER,
		strokeWidth: 20,
		fill: "transparent",
	} as const;
	return tile("film-curve", BLUE, [
		Layer.shape("path", {
			...at(0, 0, TW, TH),
			d: "M 150 76 L 150 196",
			...stroke,
		}),
		Layer.shape("path", {
			...at(0, 0, TW, TH),
			d: "M 150 76 C 150 135 205 135 262 135",
			...stroke,
		}).animate(LayerAnimation.create().keys("trimEnd", loop(0, 1, 110))),
		Layer.shape("circle", { ...at(124, 44, 52, 52), fill: PAPER }),
		Layer.shape("circle", { ...at(124, 176, 52, 52), fill: PAPER }),
		Layer.shape("path", {
			...at(0, 0, TW, TH),
			d: "M 290 92 L 356 135 L 290 178 Z",
			fill: PAPER,
			strokeColor: PAPER,
			strokeWidth: 22,
		}).animate(LayerAnimation.create().keys("opacity", swing(0.35, 1, 110))),
	]);
}

/** A timeline: tracks of clips and the playhead crossing them. */
function tracks() {
	const clips: Array<[number, number, number, string]> = [
		[36, 44, 150, PAPER],
		[200, 44, 96, "#5c6066"],
		[310, 44, 130, BLUE],
		[36, 100, 86, BLUE],
		[136, 100, 210, PAPER],
		[360, 100, 84, "#5c6066"],
		[36, 156, 240, "#5c6066"],
		[290, 156, 150, PAPER],
		[36, 212, 120, PAPER],
		[170, 212, 110, BLUE],
	];
	return tile("film-tracks", INK, [
		...clips.map(([x, y, w, fill]) =>
			Layer.box({ ...at(x, y, w, 30), background: fill, borderRadius: 6 }),
		),
		Layer.box({ ...at(30, 24, 5, 236), background: SIGNAL }).animate(
			LayerAnimation.create().keys("x", loop(30, 446, 120)),
		),
	]);
}

/** The films, one per screen layer. */
export function films(): LayoutNode[] {
	return [dawn(), motion(), curve(), tracks()];
}
