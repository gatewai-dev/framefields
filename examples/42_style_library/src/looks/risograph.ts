/**
 * Risograph: a zine cover printed in two inks. Drawn in grays and separated
 * by `Styles.risograph`, as a print shop would: dark becomes blue, mid tones
 * pink, light the paper. A second, offset pass of the big circle is the
 * misregistration; everything moves on twos.
 */
import {
	FilmGrain,
	HalftoneScreen,
	Layer,
	LayerAnimation,
	type LayoutNode,
	Styles,
} from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { at, full } from "../place.js";

const look = lookTokens("risograph");
const [PAPER, BLUE, PINK] = look.palette;
/** What each gray prints as, after the separation. */
const DARK = "#141414"; // blue
const MID = "#8a8a8a"; // pink
const LIGHT = "#f2f2f2"; // paper
const FONT = look.fonts.display;
const MONO = look.fonts.mono ?? FONT;

const twos = (anim: LayerAnimation) => anim.stepped(2);

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const e = edges(c, 72 * u);
	const r = (tall ? 360 : c.id === "1:1" ? 300 : 330) * u;
	const cx = tall ? W / 2 : c.id === "1:1" ? W * 0.58 : W * 0.66;
	const cy = tall ? e.top + r + 40 * u : H * 0.5;
	const size = (tall ? 150 : c.id === "1:1" ? 150 : 170) * u;
	const circle = (
		id: string,
		dx: number,
		dy: number,
		fill: string,
		from: number,
	) =>
		Layer.shape("circle", {
			id,
			position: "absolute",
			x: cx - r + dx,
			y: cy - r + dy,
			width: r * 2,
			height: r * 2,
			fill,
		}).animate(
			twos(
				LayerAnimation.create().keys("scale", [
					[from, 0.6],
					[from + 10, 1.06, "back.out(2)"],
					[from + 16, 1],
				]),
			),
		);
	const halftoned = Layer.box({
		id: "r-dots",
		position: "absolute",
		x: cx - r * 0.9,
		y: cy - r * 0.9,
		width: r * 1.8,
		height: r * 1.8,
		borderRadius: r,
		overflow: "hidden",
		background: `radial-gradient(circle at 35% 30%, ${LIGHT} 0%, ${MID} 55%, ${DARK} 100%)`,
	}).withEffect(
		new HalftoneScreen({
			mode: "Monochrome",
			dotShape: "Circle",
			frequency: Math.round((r * 1.8) / (9 * u)),
			dotColor: DARK,
			paperColor: LIGHT,
			opacity: 0.6,
		}),
	);
	const word = (id: string, s: string, y: number, from: number) =>
		Layer.text(s, {
			id,
			position: "absolute",
			x: e.left,
			y,
			fontFamily: FONT,
			fontSize: size,
			fontWeight: 900,
			fontVariations: { wdth: 112 },
			letterSpacing: -0.03 * size,
			lineHeight: 0.9,
			fill: DARK,
			rotation: -3,
		}).animate(
			twos(
				LayerAnimation.create()
					.keys("y", [
						[from, y + 40 * u],
						[from + 8, y, "power3.out"],
					])
					.keys("opacity", [
						[from, 0],
						[from + 2, 1],
					]),
			),
		);
	const textY = tall ? cy + r + 80 * u : e.top + 60 * u;
	return [
		full(
			"r-root",
			W,
			H,
			[
				// The pink pass, then its outline in blue's dark, a few px off: misregistration.
				circle("r-circle", 0, 0, MID, 6),
				halftoned,
				Layer.shape("circle", {
					id: "r-outline",
					position: "absolute",
					x: cx - r + 10 * u,
					y: cy - r - 7 * u,
					width: r * 2,
					height: r * 2,
					fillType: "none",
					strokeColor: DARK,
					strokeWidth: 6 * u,
				}).animate(
					twos(
						LayerAnimation.create().keys("trimEnd", [
							[14, 0],
							[30, 1, "power2.out"],
						]),
					),
				),
				word("r-w1", "LOUD", textY, 10),
				word("r-w2", "& CLEAR", textY + size * 0.9, 16),
				Layer.text("ISSUE 07 · PRINTED IN TWO INKS", {
					id: "r-stamp",
					position: "absolute",
					x: e.left,
					y: e.bottom - 30 * u,
					fontFamily: MONO,
					fontSize: 22 * u,
					letterSpacing: 3 * u,
					fill: DARK,
				}),
				at("r-bar", e.left, e.bottom - 52 * u, 260 * u, 10 * u, {
					background: MID,
				}),
			],
			LIGHT,
		),
	];
}

export const risograph: Reference = {
	look: "risograph",
	alt: "A cream zine cover printed in blue and fluorescent pink: a big halftoned pink circle with an offset blue outline, and the words LOUD & CLEAR in heavy tilted type",
	frames: 90,
	hero: 60,
	build,
	grade: (comp) => {
		for (const effect of Styles.risograph({
			inkA: BLUE,
			inkB: PINK,
			paper: PAPER,
		}))
			comp.apply(effect);
		comp.apply(
			new FilmGrain({
				strength: 14,
				size: 1.5,
				monochrome: true,
				animated: true,
			}),
		);
	},
};
