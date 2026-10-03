/**
 * 0.0–3.0 s — A blank sheet. An ember line draws itself, the first sentence
 * rises out of it and sinks back in; the line then becomes the window the
 * film opens through (see film.ts).
 */
import { Layer, LayerAnimation } from "gitframes";
import { EASE_IN_OUT, EMBER, H, INK, PAPER, SERIF_ITALIC, STONE, W, headline, scene } from "../theme.js";

export const LINE_WIDTH = 640;
export const LINE_Y = H / 2;

export function openScene() {
	const size = 150;
	const lineH = Math.round(size * 1.25);
	return scene({
		id: "open",
		from: 0,
		to: 120,
		background: PAPER,
		children: [
			Layer.shape("path", {
				id: "open-line",
				position: "absolute",
				x: (W - LINE_WIDTH) / 2,
				y: LINE_Y - 2,
				width: LINE_WIDTH,
				height: 4,
				d: `M0 2 L${LINE_WIDTH} 2`,
				fillType: "none",
				strokeColor: EMBER,
				strokeWidth: 4,
				strokeLineCap: "butt",
			}).animate(
				LayerAnimation.create()
					.fromTo("trimStart", 0.5, 0, { start: 2, end: 24, ease: EASE_IN_OUT })
					.fromTo("trimEnd", 0.5, 1, { start: 2, end: 24, ease: EASE_IN_OUT }),
			),
			headline({
				id: "open-every",
				text: "Every frame",
				x: 0,
				y: LINE_Y - 6 - lineH,
				size,
				color: INK,
				align: "center",
				inAt: 8,
				sweep: 22,
				outAt: 56,
				exit: "return",
			}),
			headline({
				id: "open-empty",
				text: "begins empty.",
				x: 0,
				y: LINE_Y + 10,
				size,
				color: STONE,
				font: SERIF_ITALIC,
				align: "center",
				from: "down",
				inAt: 16,
				sweep: 22,
				outAt: 54,
				exit: "return",
			}),
		],
	});
}
