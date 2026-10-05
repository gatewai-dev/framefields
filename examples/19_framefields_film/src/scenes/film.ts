/**
 * 2.2–6.6 s — The line splits open into a window onto the salt flat, the
 * window grows to full frame, letterbox bars settle into 2.39:1 and the first
 * verb lands in the sky.
 */
import { Layer, LayerAnimation, Vignette } from "framefields";
import { LINE_WIDTH } from "./open.js";
import {
	EASE_IN_OUT,
	EASE_OUT,
	EMBER,
	H,
	INK,
	PAPER,
	SAND,
	W,
	asset,
	chapter,
	headline,
	keys,
	label,
	scene,
} from "../theme.js";

export const FILM_FROM = 68;
export const FILM_TO = 198;

/** 2.39:1 inside 16:9 → 138 px bars. */
const BAR = Math.round((H - W / 2.39) / 2);
/** Once the bars are in, tilt down so she walks inside the frame, not under the bar. */
const REFRAME = 110;

type Key = [number, number, string?];

/**
 * The window's geometry: a slit that opens to 640×360, then grows to full frame.
 * The window, the plate inside it and its edge all derive from these keys (same
 * frames, same eases), so they move as one piece.
 */
const WIDTHS: Key[] = [[18, LINE_WIDTH], [42, W, EASE_IN_OUT]];
const HEIGHTS: Key[] = [[0, 4], [16, 360, EASE_IN_OUT], [18, 360], [42, H, EASE_IN_OUT]];
const map = (list: Key[], fn: (v: number) => number): Key[] => list.map(([f, v, e]) => [f, fn(v), e]);
const sized = (anim = LayerAnimation.create()) => keys("width", WIDTHS, keys("height", HEIGHTS, anim));

export function filmScene() {
	const len = FILM_TO - FILM_FROM;
	return scene({
		id: "film",
		from: FILM_FROM,
		to: FILM_TO,
		children: [
			Layer.box({
				id: "film-window",
				position: "absolute",
				x: (W - LINE_WIDTH) / 2,
				y: (H - 4) / 2,
				width: LINE_WIDTH,
				height: 4,
				overflow: "hidden",
				children: [
					Layer.video(asset("frame.mp4"), {
						id: "film-plate",
						position: "absolute",
						x: (LINE_WIDTH - W) / 2,
						y: (4 - H) / 2,
						width: W,
						height: H,
						muted: true,
					})
						.apply(new Vignette({ strength: 0.35, radius: 0.85, softness: 0.6 }))
						.animate(
							keys("x", map(WIDTHS, (w) => (w - W) / 2),
								keys("y", [...map(HEIGHTS, (h) => (h - H) / 2), [46, 0], [70, -REFRAME, EASE_OUT]],
									keys("scale", [[0, 1.22], [len, 1.0, "power2.out"]]))),
						),
					// The ember line's last trace: the window's frame, fading as it grows.
					Layer.box({
						id: "film-window-edge",
						position: "absolute",
						x: 0,
						y: 0,
						width: LINE_WIDTH,
						height: 4,
						borderColor: EMBER,
						borderWidth: 4,
						strokeAlign: "inside",
					}).animate(sized(keys("opacity", [[20, 1], [38, 0, "power2.in"]]))),
				],
			}).animate(sized(keys("x", map(WIDTHS, (w) => (W - w) / 2), keys("y", map(HEIGHTS, (h) => (H - h) / 2))))),
			letterbox("film-bar-top", 0, 44),
			letterbox("film-bar-bottom", H - BAR, 44, true),
			headline({
				id: "film-title",
				text: "Compose it.",
				x: 96,
				y: BAR + 40,
				width: 800,
				size: 112,
				color: INK,
				inAt: 52,
				outAt: len - 16,
			}),
			...chapter({ id: "film-ch", index: "01", name: "Composite", color: PAPER, inAt: 60, outAt: len - 12, y: H - BAR / 2 - 11 }),
			label({
				id: "film-caption",
				text: "Layers  ·  Masks  ·  Transforms",
				x: W - 96 - 700,
				y: H - BAR / 2 - 11,
				width: 700,
				align: "end",
				color: SAND,
				inAt: 66,
				outAt: len - 12,
			}),
		],
	});
}

function letterbox(id: string, y: number, at: number, fromBottom = false) {
	return Layer.shape("rect", {
		id,
		position: "absolute",
		x: 0,
		y: fromBottom ? H : y,
		width: W,
		height: BAR,
		fillColor: INK,
	}).animate(
		LayerAnimation.create().fromTo("y", fromBottom ? H : -BAR, y, { start: at, end: at + 22, ease: EASE_OUT }),
	);
}
