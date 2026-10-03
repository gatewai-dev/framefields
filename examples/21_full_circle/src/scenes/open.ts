/**
 * 0 – bar 2 — Out of black: the eclipse fades up, a ring draws itself around
 * the moon's disc on the first downbeat and lets go, the kicker names the film.
 */
import { Layer, LayerAnimation } from "gitframes";
import { bar } from "../grid.js";
import { sourceCircle } from "../plates.js";
import {
	BONE,
	caption,
	EASE_IN_OUT,
	FPS,
	INK,
	type Key,
	keys,
	MARGIN,
	plane,
	scene,
} from "../theme.js";

const BLEED = 4;
/** The disc's rim is the corona's brightest edge; the ring is drawn just inside it, on black. */
const INSET = 16;

export function openScene() {
	const to = bar(2);
	const drawAt = bar(0);
	const c0 = sourceCircle("eclipse", drawAt / FPS);
	const size = 2 * (c0.r + BLEED);
	// The disc grows with the push-in; the drawn ring scales with it.
	const grow: Key[] = [];
	for (let f = drawAt; f <= bar(1.5); f += 6)
		grow.push([f - drawAt, sourceCircle("eclipse", f / FPS).r / c0.r]);

	return scene("open", 0, to, [
		Layer.box({
			id: "open-ring-box",
			position: "absolute",
			x: c0.cx - size / 2,
			y: c0.cy - size / 2,
			width: size,
			height: size,
			startFrame: drawAt,
			durationFrames: bar(1.5) - drawAt,
			children: [
				Layer.shape("path", {
					id: "open-ring",
					position: "absolute",
					x: 0,
					y: 0,
					width: size,
					height: size,
					d: circlePath(size / 2, c0.r - INSET),
					fillType: "none",
					strokeColor: BONE,
					strokeWidth: 2,
				}).animate(
					LayerAnimation.create()
						.fromTo("trimEnd", 0, 1, {
							start: 0,
							end: bar(1) - drawAt,
							ease: EASE_IN_OUT,
						})
						.fadeOut(bar(1.25) - drawAt, bar(1.5) - drawAt - 1, "power2.in"),
				),
			],
		}).animate(keys("scale", grow)),
		caption({
			id: "open-kicker",
			text: "A film in eight circles",
			y: MARGIN,
			inAt: bar(0.5),
			outAt: to - 12,
		}),
		plane("open-black", INK).animate(
			LayerAnimation.create().fadeOut(0, drawAt, "sine.inOut"),
		),
	]);
}

/** A full circle as two arcs, starting at 12 o'clock and running clockwise. */
function circlePath(c: number, r: number): string {
	return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c} ${c + r} A ${r} ${r} 0 1 1 ${c} ${c - r}`;
}
