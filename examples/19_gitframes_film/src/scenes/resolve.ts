/**
 * 26.4–30.0 s — Back to paper. The ember line from the first frame returns,
 * the wordmark rises out of it on the final chord, the promise drops beneath.
 */
import { Layer, LayerAnimation } from "gitframes";
import { TRACK_TO } from "./track.js";
import { EASE_IN_OUT, EMBER, INK, PAPER, SERIF_ITALIC, STONE, W, headline, keys, label, scene } from "../theme.js";

export const RESOLVE_FROM = TRACK_TO;
export const RESOLVE_TO = RESOLVE_FROM + 108;

const LINE_Y = 624;
const LINE_W = 760;

export function resolveScene() {
	const markSize = 250;
	const markH = Math.round(markSize * 1.25);
	const len = RESOLVE_TO - RESOLVE_FROM;
	return scene({
		id: "resolve",
		from: RESOLVE_FROM,
		to: RESOLVE_TO,
		background: PAPER,
		children: [
			Layer.box({
				id: "resolve-group",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: 1080,
				overflow: "visible",
				children: [
					Layer.shape("path", {
						id: "resolve-line",
						position: "absolute",
						x: (W - LINE_W) / 2,
						y: LINE_Y - 2,
						width: LINE_W,
						height: 4,
						d: `M0 2 L${LINE_W} 2`,
						fillType: "none",
						strokeColor: EMBER,
						strokeWidth: 4,
						strokeLineCap: "butt",
					}).animate(
						LayerAnimation.create()
							.fromTo("trimStart", 0.5, 0, { start: 0, end: 22, ease: EASE_IN_OUT })
							.fromTo("trimEnd", 0.5, 1, { start: 0, end: 22, ease: EASE_IN_OUT }),
					),
					headline({
						id: "resolve-mark",
						text: "Gitframes",
						x: 0,
						y: LINE_Y - 10 - markH,
						size: markSize,
						color: INK,
						align: "center",
						inAt: 2,
						sweep: 18,
						letterSpacing: -4,
					}),
					headline({
						id: "resolve-tagline",
						text: "Programmable video, rendered on WebGPU.",
						x: 0,
						y: LINE_Y + 18,
						size: 58,
						color: "#6E655A",
						font: SERIF_ITALIC,
						align: "center",
						from: "down",
						inAt: 16,
						sweep: 16,
					}),
					label({
						id: "resolve-footer",
						text: "Composite  ·  Grade  ·  Animate  ·  Render",
						x: 0,
						y: 960,
						width: W,
						align: "center",
						size: 20,
						color: STONE,
						inAt: 28,
					}),
				],
			}).animate(
				keys("scale", [[0, 1.0], [len, 1.035, "sine.inOut"]], LayerAnimation.create().fadeOut(len - 20, len - 4, "power2.inOut")),
			),
		],
	});
}
