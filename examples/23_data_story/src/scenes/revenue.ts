import { Layer, type LayoutNode } from "gitframes";
import { boxOf } from "../chart-geometry.js";
import { morph } from "../morph.js";
import { odometer } from "../motion.js";
import {
	ACCENT,
	CHART_H,
	CHART_TEXT,
	CHART_Y,
	CYAN,
	CYAN_TEXT,
	GRID,
	MARGIN,
	MONO,
	MUTED,
	SANS,
	W,
} from "../theme.js";
import { REVENUE } from "../timeline.js";
import { beatRing, header, note, riseAt, scene } from "../ui.js";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug"];

export interface FiscalYear {
	year: string;
	/** Scene frame the chart starts morphing to this year. */
	at: number;
	revenue: number[];
	costs: number[];
}

export const YEARS: FiscalYear[] = [
	{
		year: "2023",
		at: 0,
		revenue: [8, 11, 9, 14, 16, 15, 18, 21],
		costs: [7, 9, 8, 11, 12, 12, 13, 15],
	},
	{
		year: "2024",
		at: 76,
		revenue: [10, 15, 12, 18, 22, 20, 25, 29],
		costs: [8, 10, 9, 13, 12, 15, 14, 17],
	},
	{
		year: "2025",
		at: 136,
		revenue: [12, 19, 14, 22, 28, 25, 31, 36],
		costs: [8, 11, 9, 15, 13, 17, 16, 19],
	},
];

/** One year's chart, ring and caption. Every year has the same axes and node ids. */
function yearView(y: FiscalYear): LayoutNode {
	const chart = Layer.chart(
		{
			type: "bar",
			width: W - 2 * MARGIN,
			height: CHART_H,
			categories: MONTHS,
			series: [
				{ name: "Revenue", data: y.revenue, color: ACCENT },
				{ name: "Costs", data: y.costs, color: CYAN },
			],
			yAxis: { min: 0, max: 40, format: (v) => `$${v}k`, ticks: 4 },
			fontFamily: SANS,
			fontSize: 24,
			textColor: CHART_TEXT,
			gridColor: GRID,
			cornerRadius: 8,
			animate: { start: 10, duration: 28, ease: "back.out(1.4)" },
		},
		{ id: "revenue-chart", position: "absolute", x: MARGIN, y: CHART_Y },
	);
	const best = y.revenue.indexOf(Math.max(...y.revenue));
	const bar = boxOf(chart, `revenue-chart-bar-0-${best}`);
	const pad = 10;
	return Layer.box({
		id: "revenue-view",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: CHART_Y + CHART_H,
		children: [
			chart,
			beatRing(
				"revenue-ring",
				bar.x - pad,
				bar.y - pad,
				bar.width + 2 * pad,
				bar.height + 2 * pad,
				48,
			),
			note(
				"revenue-note",
				`Best month: ${MONTHS[best]}`,
				bar.x - pad - 500,
				bar.y + 8,
				46,
				480,
				"end",
			),
		],
	});
}

/**
 * Three fiscal years of the same chart, morphed into each other: bars, the
 * best-month ring and its caption ease to each year's numbers while the year
 * rolls over on an odometer.
 */
export function revenueScene(): LayoutNode {
	const view = morph(
		YEARS.map((y) => ({ at: y.at, node: yearView(y) })),
		{ duration: 30, ease: "power3.inOut" },
	);
	const size = 76;
	return scene("revenue", REVENUE.from, REVENUE.to, [
		...header("revenue", "01  ·  REVENUE", "Three years, one direction."),
		view,
		odometer(
			YEARS.map((y, i) => ({ at: i === 0 ? 14 : y.at, value: y.year })),
			{
				id: "revenue-year",
				x: W - MARGIN - Math.round(size * 0.62) * 4,
				y: 104,
				size,
				color: CYAN_TEXT,
				change: 24,
			},
		),
		Layer.text("FISCAL YEAR", {
			id: "revenue-year-caption",
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
