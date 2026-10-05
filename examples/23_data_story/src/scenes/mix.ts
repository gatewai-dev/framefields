import { Layer, type LayoutNode } from "framefields";
import { liveDonut } from "../donut.js";
import { morph } from "../morph.js";
import { odometer } from "../motion.js";
import {
	ACCENT,
	AMBER,
	CHART_H,
	CHART_TEXT,
	CHART_Y,
	CYAN,
	CYAN_TEXT,
	GRID,
	MARGIN,
	MONO,
	MUTED,
	PINK,
	SANS,
	W,
} from "../theme.js";
import { MIX } from "../timeline.js";
import { header, riseAt, scene } from "../ui.js";

export const CHANNELS = [
	{ label: "Direct", color: ACCENT },
	{ label: "Search", color: CYAN },
	{ label: "Social", color: AMBER },
	{ label: "Email", color: PINK },
];

/** Share of traffic per channel, month by month: search overtakes direct. */
export const MONTHLY = [
	{ month: "01", at: 0, shares: [46, 24, 18, 12] },
	{ month: "02", at: 70, shares: [41, 29, 18, 12] },
	{ month: "03", at: 108, shares: [37, 33, 19, 11] },
	{ month: "04", at: 146, shares: [33, 38, 18, 11] },
];

const DONUT = {
	cx: MARGIN + 300,
	cy: CHART_Y + CHART_H / 2 + 10,
	radius: 230,
	thickness: 58,
};
const BARS_X = MARGIN + 900;

/** One month's share bars; each channel is its own series so it keeps its colour. */
function sharesView(shares: number[]): LayoutNode {
	return Layer.chart(
		{
			type: "bar",
			stacked: true,
			width: W - MARGIN - BARS_X,
			height: CHART_H,
			categories: CHANNELS.map((c) => c.label),
			series: CHANNELS.map((c, i) => ({
				name: c.label,
				color: c.color,
				data: CHANNELS.map((_, j) => (j === i ? shares[i] : 0)),
			})),
			yAxis: { min: 0, max: 50, ticks: 5, format: (v) => `${v}%` },
			legend: false,
			fontFamily: SANS,
			fontSize: 24,
			textColor: CHART_TEXT,
			gridColor: GRID,
			cornerRadius: 10,
			// Stacked series reveal in turn; this one is done by frame 67, before the first change.
			animate: { start: 16, duration: 16, stagger: 2, ease: "back.out(1.6)" },
		},
		{ id: "mix-bars", position: "absolute", x: BARS_X, y: CHART_Y },
	);
}

/**
 * Four months of traffic mix. The donut's slices and the share bars ease to
 * each month's numbers together, the search share rolls in the donut's hole,
 * and the month counter ticks over.
 */
export function mixScene(): LayoutNode {
	const bars = morph(
		MONTHLY.map((m) => ({ at: m.at, node: sharesView(m.shares) })),
		{ duration: 22, ease: "power3.inOut" },
	);
	const donut = liveDonut({
		id: "mix-donut",
		...DONUT,
		slices: CHANNELS,
		states: MONTHLY.map((m) => ({
			at: m.at === 0 ? 10 : m.at,
			values: m.shares,
		})),
		change: 22,
	});
	const shareSize = 92;
	const searchShare = odometer(
		MONTHLY.map((m) => ({
			at: m.at === 0 ? 20 : m.at,
			value: `${m.shares[1]}%`,
		})),
		{
			id: "mix-search",
			x: DONUT.cx - (Math.round(shareSize * 0.62) * 3) / 2,
			y: DONUT.cy - 70,
			size: shareSize,
			color: CYAN_TEXT,
			change: 26,
			duration: 26,
		},
	);
	const monthSize = 76;
	return scene("mix", MIX.from, MIX.to, [
		...header("mix", "03  ·  WHERE THEY COME FROM", "Search overtakes direct."),
		donut,
		searchShare,
		Layer.text("SEARCH", {
			id: "mix-search-label",
			position: "absolute",
			x: DONUT.cx - 120,
			y: DONUT.cy + 44,
			width: 240,
			height: 30,
			fontFamily: MONO,
			fontSize: 22,
			fontWeight: 700,
			letterSpacing: 4,
			fill: MUTED,
			align: "center",
		}).animate(riseAt(24, DONUT.cy + 44, 16)),
		bars,
		odometer(
			MONTHLY.map((m) => ({ at: m.at === 0 ? 14 : m.at, value: m.month })),
			{
				id: "mix-month",
				x: W - MARGIN - Math.round(monthSize * 0.62) * 2,
				y: 104,
				size: monthSize,
				color: CYAN_TEXT,
				change: 22,
			},
		),
		Layer.text("MONTH", {
			id: "mix-month-caption",
			position: "absolute",
			x: W - MARGIN - 400,
			y: 204,
			width: 400,
			height: 32,
			fontFamily: MONO,
			fontSize: 22,
			fontWeight: 600,
			letterSpacing: 3,
			fill: MUTED,
			align: "end",
		}).animate(riseAt(20, 204, 16)),
	]);
}
