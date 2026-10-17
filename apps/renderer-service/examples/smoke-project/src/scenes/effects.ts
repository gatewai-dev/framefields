import {
	Blur,
	type Effect,
	Flip,
	GradientMap,
	HalftoneScreen,
	Layer,
	Levels,
	Modulate,
	SelectiveColor,
	ShadowsHighlights,
	sineSignal,
	TileOffset,
	UnsharpMask,
} from "framefields";
import { asset, H, INK, label, PAPER, W } from "../theme.js";

export const EFFECTS_FRAMES = 90;

const COLS = 4;
const ROWS = 2;
const GAP = 16;
const CELL_W = (W - GAP * (COLS + 1)) / COLS;
const CELL_H = (H - 120 - GAP * (ROWS + 1)) / ROWS;

/** One image per cell, each through a different effect (one of them animated). */
const CELLS: Array<[name: string, effect: Effect<object>]> = [
	[
		"Blur (animated)",
		new Blur({
			blurType: "Gaussian",
			strength: sineSignal({ frequency: 1, min: 0, max: 24 }),
		}),
	],
	[
		"HalftoneScreen",
		new HalftoneScreen({
			mode: "Monochrome",
			dotShape: "Circle",
			frequency: 40,
		}),
	],
	[
		"GradientMap",
		new GradientMap({
			stops: [
				{ position: 0, color: "#1e1b4b" },
				{ position: 0.5, color: "#ff5a1f" },
				{ position: 1, color: "#fef3c7" },
			],
		}),
	],
	["Modulate (sepia)", new Modulate({ sepia: 0.8, contrast: 1.1 })],
	["UnsharpMask", new UnsharpMask({ amount: 180, radius: 2, threshold: 2 })],
	["Flip (symmetry)", new Flip({ symmetry: "leftToRight" })],
	[
		"Shadows/Highlights",
		new ShadowsHighlights({ shadowAmount: 60, highlightAmount: 40 }),
	],
	[
		"Levels + SelectiveColor",
		new Levels({
			// All four fields: a partial channel renders black in 2.2.0-beta.0.
			master: { inBlack: 0.08, inWhite: 0.85, outBlack: 0, outWhite: 1 },
		}),
	],
];

/** A grid of effects on the same photo. */
export function effectsScene() {
	const cells = CELLS.flatMap(([name, effect], i) => {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const x = GAP + col * (CELL_W + GAP);
		const y = 80 + GAP + row * (CELL_H + GAP);
		let image = Layer.image(asset("portrait.jpg"), {
			id: `cell-${i}`,
			position: "absolute",
			x,
			y,
			width: CELL_W,
			height: CELL_H,
			fit: "cover",
			borderRadius: 12,
		}).withEffect(effect);
		if (i === CELLS.length - 1) {
			image = image.withEffect(
				new SelectiveColor({ reds: { cyan: -30, yellow: 20 } }),
			);
		}
		return [
			image,
			Layer.text(name, {
				position: "absolute",
				x: x + 10,
				y: y + CELL_H - 34,
				fontFamily: "Inter",
				fontSize: 18,
				fill: PAPER,
			}),
		];
	});

	return Layer.box({
		id: "effects",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: INK,
		children: [
			Layer.text("effects", {
				position: "absolute",
				x: GAP,
				y: 22,
				fontFamily: "Syne",
				fontSize: 40,
				fill: PAPER,
			}),
			...cells,
			// A scrolling pattern band (tile offset).
			Layer.image(asset("portrait.jpg"), {
				position: "absolute",
				x: W - 420,
				y: 24,
				width: 400,
				height: 40,
				fit: "cover",
				borderRadius: 8,
			}).withEffect(
				new TileOffset({
					offsetX: sineSignal({ frequency: 0.5, min: 0, max: 1 }),
					wrap: true,
				}),
			),
			label(
				"blur · halftone · gradient map · modulate · sharpen · flip · tones · levels · tile",
			),
		],
	});
}
