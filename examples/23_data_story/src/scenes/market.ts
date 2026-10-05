import {
	type ChartCandle,
	Layer,
	LayerAnimation,
	type LayoutNode,
} from "gitframes";
import { boxOf } from "../chart-geometry.js";
import { morph } from "../morph.js";
import { odometer } from "../motion.js";
import {
	CHART_H,
	CHART_TEXT,
	CHART_Y,
	EASE_IN,
	GREEN,
	GREEN_TEXT,
	GRID,
	MARGIN,
	MONO,
	MUTED,
	RED,
	SANS,
	W,
} from "../theme.js";
import { MARKET } from "../timeline.js";
import { beatRing, header, riseAt, scene } from "../ui.js";

/** 24 sessions of a deterministic random walk that ends on its high. */
export function sessions(count = 24): ChartCandle[] {
	let seed = 7;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const out: ChartCandle[] = [];
	let close = 128;
	for (let i = 0; i < count; i++) {
		const open = close;
		const drift = i === count - 1 ? 7 : (rand() - 0.42) * 9;
		close = Math.round((open + drift) * 100) / 100;
		out.push({
			x: `${i + 1}`,
			open,
			close,
			high: Math.max(open, close) + rand() * 3,
			low: Math.min(open, close) - rand() * 3,
		});
	}
	return out;
}

/** The live candle's close at each tick after the stream lands. */
export const TICKS = [0, 1.4, -0.8, 2.1, 1.2, 3.0, 2.2, 3.6];
const FIRST_TICK = 96;
const TICK = 10;

/** The session as of one tick: the last candle's close (and high) moved by `delta`. */
function tickView(base: ChartCandle[], delta: number): LayoutNode {
	const data = base.map((c, i) => {
		if (i !== base.length - 1) return c;
		const close = Math.round((c.close + delta) * 100) / 100;
		return { ...c, close, high: Math.max(c.high, close + 0.6) };
	});
	const chart = Layer.chart(
		{
			type: "candlestick",
			width: W - 2 * MARGIN,
			height: CHART_H,
			data,
			upColor: GREEN,
			downColor: RED,
			yAxis: { min: 110, max: 160, format: (v) => `$${v}`, ticks: 5 },
			xAxis: { show: false },
			fontFamily: SANS,
			fontSize: 24,
			textColor: CHART_TEXT,
			gridColor: GRID,
			animate: { start: 10, duration: 10, stagger: 3 },
		},
		{
			id: "market-chart",
			position: "absolute",
			x: MARGIN,
			y: CHART_Y,
			anchorX: 0.5,
			anchorY: 1,
		},
	).animate(
		LayerAnimation.create()
			.fromTo("scale", 0.94, 1, { start: 0, end: 36, ease: EASE_IN })
			.fromTo("opacity", 0, 1, { start: 0, end: 12 }),
	);
	const last = boxOf(chart, `market-chart-candle-0-${data.length - 1}-body`);
	const plotLeft = MARGIN + 70;
	const pad = 10;
	return Layer.box({
		id: "market-view",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: CHART_Y + CHART_H,
		children: [
			// The last price, across the plot.
			Layer.box({
				id: "market-level",
				position: "absolute",
				x: plotLeft,
				y: last.y - 1,
				width: last.x - plotLeft,
				height: 2,
				background: "rgba(34, 197, 94, 0.35)",
				startFrame: FIRST_TICK - 8,
			}),
			chart,
			beatRing(
				"market-ring",
				last.x - pad,
				last.y - pad,
				last.width + 2 * pad,
				last.height + 2 * pad,
				FIRST_TICK - 8,
				GREEN,
			),
		],
	});
}

/**
 * The session streams in candle by candle, then goes live: every tick the
 * newest candle's close moves, and its body, wick, ring and the price line
 * follow while the price rolls on an odometer.
 */
export function marketScene(): LayoutNode {
	const data = sessions();
	const view = morph(
		TICKS.map((delta, k) => ({
			at: FIRST_TICK + (k - 1) * TICK,
			node: tickView(data, delta),
		})),
		{ duration: 7, ease: "power2.out" },
	);
	const close = data[data.length - 1].close;
	const size = 76;
	return scene("market", MARKET.from, MARKET.to, [
		...header(
			"market",
			"04  ·  THE MARKET NOTICED",
			"GFRM is trading at a high.",
		),
		view,
		odometer(
			TICKS.map((delta, k) => ({
				at: k === 0 ? 58 : FIRST_TICK + (k - 1) * TICK,
				value: `$${(close + delta).toFixed(2)}`,
			})),
			{
				id: "market-price",
				x: W - MARGIN - Math.round(size * 0.62) * 7,
				y: 104,
				size,
				color: GREEN_TEXT,
				change: 7,
				duration: 20,
				stagger: 2,
			},
		),
		Layer.text("GFRM · LAST", {
			id: "market-price-caption",
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
		}).animate(riseAt(60, 204, 16)),
	]);
}
