/**
 * Swiss: a data story's opening frame on a twelve-column grid. A huge number
 * flush left, its caption small under it, a bar chart in gray with one red
 * bar, rules drawing on along the grid. Everything moves on the grid's axes.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { at, full } from "../place.js";

const look = lookTokens("swiss");
const [PAPER, INK, RED, GRAY] = look.palette;
const EASE = "power3.inOut";
const FONT = look.fonts.display;

/** Trips per resident per year, 2016–2026: the last bar is the finding. */
const BARS = [41, 44, 46, 39, 52, 58, 63, 71, 84, 102, 131];

interface Grid {
	left: number;
	top: number;
	width: number;
	height: number;
	col: number;
	gutter: number;
}

/** Twelve columns inside the safe edges. */
function grid(c: Crop): Grid {
	const e = edges(c, 96 * c.u);
	const gutter = 24 * c.u;
	const width = e.right - e.left;
	return {
		left: e.left,
		top: e.top,
		width,
		height: e.bottom - e.top,
		gutter,
		col: (width - gutter * 11) / 12,
	};
}
const span = (g: Grid, n: number) => g.col * n + g.gutter * (n - 1);
const colX = (g: Grid, i: number) => g.left + i * (g.col + g.gutter);

function chart(
	x: number,
	y: number,
	w: number,
	h: number,
	u: number,
): LayoutNode[] {
	const gap = 8 * u;
	const bw = (w - gap * (BARS.length - 1)) / BARS.length;
	const max = Math.max(...BARS);
	const bars: LayoutNode[] = BARS.map((v, i) => {
		const bh = (v / max) * h;
		const last = i === BARS.length - 1;
		const start = 18 + i * 2;
		return at(`s-bar-${i}`, x + i * (bw + gap), y + h - bh, bw, bh, {
			background: last ? RED : GRAY,
		}).animate(
			LayerAnimation.create()
				.keys("height", [
					[start, 0],
					[start + 14, bh, EASE],
				])
				.keys("y", [
					[start, y + h],
					[start + 14, y + h - bh, EASE],
				]),
		);
	});
	return bars.concat([
		at("s-axis", x, y + h + 10 * u, 0, 2 * u, { background: INK }).animate(
			LayerAnimation.create().keys("width", [
				[10, 0],
				[30, w, EASE],
			]),
		),
		Layer.text("2016", {
			id: "s-y0",
			position: "absolute",
			x,
			y: y + h + 22 * u,
			fontFamily: FONT,
			fontSize: 20 * u,
			fill: INK,
		}),
		Layer.text("2026", {
			id: "s-y1",
			position: "absolute",
			x: x + w - bw,
			y: y + h + 22 * u,
			fontFamily: FONT,
			fontSize: 20 * u,
			fontWeight: 700,
			fill: RED,
		}),
	]);
}

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const g = grid(c);
	const numberSize = (tall ? 420 : c.id === "1:1" ? 300 : 340) * u;
	const text = (
		id: string,
		s: string,
		x: number,
		y: number,
		size: number,
		weight: number,
		fill: string,
		from: number,
	) =>
		Layer.text(s, {
			id,
			position: "absolute",
			x,
			y,
			fontFamily: FONT,
			fontSize: size,
			fontWeight: weight,
			letterSpacing: size > 100 ? -0.04 * size : 0,
			lineHeight: 0.95,
			fill,
		}).animate(
			LayerAnimation.create()
				.keys("x", [
					[from, x - g.col - g.gutter],
					[from + 14, x, EASE],
				])
				.keys("opacity", [
					[from, 0],
					[from + 4, 1],
				]),
		);
	// Wide: the number on columns 1–6, the chart on 7–12. Tall and square: stacked.
	const numberX = g.left;
	const numberY = g.top + (tall ? 160 * u : 40 * u);
	const chartBox = tall
		? { x: g.left, y: g.top + g.height * 0.6, w: g.width, h: g.height * 0.3 }
		: c.id === "1:1"
			? {
					x: colX(g, 5),
					y: g.top + g.height * 0.5,
					w: span(g, 7),
					h: g.height * 0.36,
				}
			: {
					x: colX(g, 6),
					y: g.top + 120 * u,
					w: span(g, 6),
					h: g.height * 0.62,
				};
	return [
		full(
			"s-root",
			W,
			H,
			[
				at("s-rule-top", g.left, g.top, 0, 2 * u, { background: INK }).animate(
					LayerAnimation.create().keys("width", [
						[0, 0],
						[20, g.width, EASE],
					]),
				),
				text(
					"s-kicker",
					"Cycling, city of Basel",
					g.left,
					g.top + 16 * u,
					22 * u,
					700,
					INK,
					4,
				),
				text("s-index", "01", colX(g, 11), g.top + 16 * u, 22 * u, 400, INK, 4),
				text(
					"s-number",
					"3.2×",
					numberX,
					numberY + 40 * u,
					numberSize,
					700,
					INK,
					8,
				),
				text(
					"s-caption-1",
					"more bike trips per resident",
					numberX,
					numberY + 64 * u + numberSize,
					32 * u,
					700,
					INK,
					14,
				),
				text(
					"s-caption-2",
					"than in 2016. Most of the rise came in the last two years.",
					numberX,
					numberY + 64 * u + numberSize + 42 * u,
					26 * u,
					400,
					INK,
					16,
				),
				...chart(chartBox.x, chartBox.y, chartBox.w, chartBox.h, u),
				text(
					"s-source",
					"Source: illustrative data",
					g.left,
					g.top + g.height - 26 * u,
					18 * u,
					400,
					INK,
					24,
				),
			],
			PAPER,
		),
	];
}

export const swiss: Reference = {
	look: "swiss",
	alt: "A huge black 3.2× flush left on off-white, with a caption under it and a gray bar chart whose last bar is red, on a strict grid",
	frames: 90,
	hero: 72,
	build,
};
