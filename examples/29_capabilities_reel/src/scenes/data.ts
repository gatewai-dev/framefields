/**
 * 10 — Data + color. First the engine counts itself: its 74 nodes by category as an animated bar
 * chart and donut (built from native layers). Then a grade: the portrait clip, with a wipe that
 * reveals Curves → SelectiveColor → ColorBalance → ShadowsHighlights → Vignette on the right.
 */
import {
	ColorBalance,
	Curves,
	FilmGrain,
	Layer,
	SelectiveColor,
	ShadowsHighlights,
	Vignette,
} from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import { REPO } from "../paths.js";
import {
	BAR,
	BEAT,
	BG,
	COBALT,
	DISPLAY,
	FG,
	H,
	LINE,
	MONO,
	MUTED,
	NAVY,
	PAPER,
	ROYAL,
	SANS,
	SIGNAL,
	SKY,
	W,
} from "../theme.js";

const PORTRAIT = `${REPO}/examples/19_framefields_film/assets/portrait.mp4`;

/** framefields' 74 nodes (nodes/*), by what they do. */
const NODES: Array<[string, number, string]> = [
	["Stylize", 16, NAVY],
	["Color", 11, ROYAL],
	["Warp", 10, COBALT],
	["Generate", 10, SIGNAL],
	["Audio", 8, "#60A5FA"],
	["Optics", 6, "#38BDF8"],
	["Matte", 6, SKY],
	["Signal", 4, "#93C5FD"],
	["3D light", 3, "#BFDBFE"],
];

export function dataScene(): Node {
	const split = BAR + BEAT * 2;
	const total = NODES.reduce((n, [, v]) => n + v, 0);

	const charts = full({
		id: "data-charts",
		durationFrames: split + 10,
		children: [
			Layer.text("74 nodes. Counted.", {
				id: "data-title",
				position: "absolute",
				x: 110,
				y: 90,
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 76,
				letterSpacing: -2,
				fill: FG,
			}).animate(
				keys("opacity", [
					[0, 0],
					[8, 1],
				]),
			),
			Layer.chart(
				{
					type: "bar",
					width: 1050,
					height: 620,
					categories: NODES.map(([name]) => name),
					series: [
						{ name: "nodes", data: NODES.map(([, v]) => v), color: SIGNAL },
					],
					colors: NODES.map(([, , c]) => c),
					yAxis: { min: 0, max: 18, ticks: 6, grid: true },
					valueLabels: true,
					fontFamily: SANS,
					fontSize: 18,
					textColor: MUTED,
					gridColor: LINE,
					cornerRadius: 8,
					animate: {
						start: 6,
						duration: 26,
						stagger: 3,
						ease: "back.out(1.4)",
					},
				} as never,
				{ id: "data-bars", position: "absolute", x: 90, y: 230 },
			),
			Layer.chart(
				{
					type: "donut",
					width: 560,
					height: 560,
					data: NODES.map(([label, value, color]) => ({ label, value, color })),
					innerRadius: 0.62,
					cornerRadius: 6,
					legend: false,
					fontFamily: SANS,
					fontSize: 16,
					textColor: FG,
					animate: { start: 14, duration: 30, stagger: 2, ease: "expo.out" },
				} as never,
				{ id: "data-donut", position: "absolute", x: 1240, y: 250 },
			),
			Layer.text(String(total), {
				id: "data-total",
				position: "absolute",
				x: 1240,
				y: 455,
				width: 560,
				align: "center",
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 130,
				fill: FG,
			}).animate(
				keys("scale", [
					[0, 0],
					[30, 0],
					[44, 1, "back.out(2)"],
				]),
			),
			Layer.text(
				"Layer.chart({ type: bar | donut }) — d3 scales, native layers",
				{
					id: "data-sub",
					position: "absolute",
					x: 112,
					y: 186,
					fontFamily: MONO,
					fontSize: 20,
					fill: MUTED,
				},
			).animate(
				keys("opacity", [
					[0, 0],
					[12, 0],
					[24, 1],
				]),
			),
		],
	});

	// The grade: the same clip twice, the graded copy revealed by a wipe matte.
	const clip = (id: string) =>
		Layer.video(PORTRAIT, {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fit: "cover",
			muted: true,
			trimStartSec: 1,
		});
	const wipeX = (f: number) => {
		const t = Math.max(0, Math.min(1, (f - 8) / 50));
		const e = t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
		return W * (0.92 - 0.6 * e + 0.12 * Math.sin(f / 14) * e);
	};
	const graded = clip("data-graded")
		.withEffects([
			new Curves({
				master: [
					{ x: 0, y: 0.04 },
					{ x: 0.25, y: 0.2 },
					{ x: 0.75, y: 0.84 },
					{ x: 1, y: 0.97 },
				],
			} as never),
			new SelectiveColor({
				method: "Relative",
				reds: { cyan: -10, magenta: 8, yellow: 14, black: 0 },
				yellows: { cyan: 6, magenta: 0, yellow: -12, black: 0 },
			} as never),
			new ColorBalance({
				shadows: { cyanRed: -8, magentaGreen: 0, yellowBlue: 6 },
				highlights: { cyanRed: 8, magentaGreen: 0, yellowBlue: -8 },
				preserveLuminosity: true,
			}),
			new ShadowsHighlights({
				shadowAmount: 30,
				highlightAmount: 20,
				midtoneContrast: 18,
			}),
			new Vignette({ strength: 45, radius: 0.95, softness: 0.6 }),
			new FilmGrain({ strength: 18, size: 1.6 }),
		])
		.withMatte(
			Layer.box({
				id: "data-wipe",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				background: "#ffffff",
			}).animate(drive(wipeX)),
		);
	const grade = full({
		id: "data-grade",
		startFrame: split,
		children: [
			clip("data-raw"),
			graded,
			Layer.box({
				id: "data-divider",
				position: "absolute",
				x: 0,
				y: 0,
				width: 4,
				height: H,
				background: PAPER,
			}).animate(drive((f) => wipeX(f) - 2)),
			Layer.text("ungraded", {
				id: "data-before",
				position: "absolute",
				x: 80,
				y: 90,
				fontFamily: MONO,
				fontSize: 24,
				fill: PAPER,
			}),
			Layer.text(
				"Curves · SelectiveColor · ColorBalance · ShadowsHighlights · Vignette · FilmGrain",
				{
					id: "data-after",
					position: "absolute",
					x: 80,
					y: H - 210,
					fontFamily: MONO,
					fontSize: 22,
					fill: PAPER,
				},
			).animate(
				keys("opacity", [
					[0, 0],
					[20, 0],
					[32, 1],
				]),
			),
		],
	}).animate(
		keys("opacity", [
			[0, 0],
			[6, 1],
		]),
	);

	return scene("data", BG, [
		charts,
		grade,
		hud("data", ["Layer.chart", "withEffects([...grade])", "withMatte(wipe)"]),
	]);
}

/** A layer's x keyed every 2 frames from a function (the wipe follows a curve). */
function drive(fn: (localFrame: number) => number) {
	return keys(
		"x",
		Array.from(
			{ length: 46 },
			(_, i) =>
				[i * 2, Math.round(fn(i * 2)), "none"] as [number, number, string],
		),
	);
}
