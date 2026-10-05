import { Layer, LayerAnimation, type LayoutNode } from "gitframes";
import { boxOf } from "../chart-geometry.js";
import { type DataState, morph, segment } from "../morph.js";
import { odometer } from "../motion.js";
import { PULSE } from "../signals.js";
import {
	CHART_H,
	CHART_TEXT,
	CHART_Y,
	CYAN,
	CYAN_TEXT,
	GRID,
	MARGIN,
	MONO,
	RED,
	SANS,
	TEXT,
	W,
} from "../theme.js";
import { LIVE } from "../timeline.js";
import { header, scene } from "../ui.js";

export const WINDOW = 10;
export const TICKS = 11;
/** First new sample, and frames between samples. */
const FIRST_TICK = 48;
const TICK = 11;
const LINE = 4;

/** A deterministic stream of concurrent users that trends up with noise. */
export function userStream(count = WINDOW + TICKS): number[] {
	let seed = 11;
	const rand = () => {
		seed = (seed * 16807) % 2147483647;
		return seed / 2147483647;
	};
	const out: number[] = [];
	let v = 38_000;
	for (let i = 0; i < count; i++) {
		v += (rand() - 0.36) * 7_500;
		out.push(Math.round(Math.min(66_000, Math.max(33_000, v))));
	}
	return out;
}

const SLOTS = Array.from({ length: WINDOW }, (_, i) =>
	i === WINDOW - 1 ? "now" : `-${WINDOW - 1 - i}s`,
);

/** The window of samples visible at state `k`, as points, segments, halo and level line. */
function windowView(values: number[], k: number): LayoutNode {
	const chart = Layer.chart(
		{
			type: "line",
			width: W - 2 * MARGIN,
			height: CHART_H,
			categories: SLOTS,
			series: [
				{
					name: "Users",
					data: values.slice(k, k + WINDOW),
					color: CYAN,
					strokeWidth: 0,
					pointRadius: 6,
				},
			],
			yAxis: {
				min: 30_000,
				max: 50_000,
				format: (v) => `${Number(v) / 1000}k`,
				ticks: 4,
			},
			legend: false,
			fontFamily: SANS,
			fontSize: 24,
			textColor: CHART_TEXT,
			gridColor: GRID,
			animate: { start: 8, duration: 18, stagger: 2 },
		},
		{ id: "live-chart", position: "absolute", x: MARGIN, y: CHART_Y },
	);
	const pts = SLOTS.map((_, i) => {
		const b = boxOf(chart, `live-chart-point-0-${i}`);
		return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
	});
	const last = pts[pts.length - 1];
	const segs = pts.slice(1).map((p, j) => {
		const s = segment(pts[j], p, LINE);
		const node = Layer.box({
			id: `live-seg-${j}`,
			position: "absolute",
			...s,
			background: CYAN,
			borderRadius: LINE / 2,
			anchorX: 0,
			anchorY: 0.5,
		});
		// The line draws on left to right; only the first state's reveal is used.
		const at = 10 + j * 2;
		return node.animate(
			LayerAnimation.create().fromTo("width", 0, s.width, {
				start: at,
				end: at + 5,
			}),
		);
	});
	return Layer.box({
		id: "live-view",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: CHART_Y + CHART_H,
		children: [
			// The latest level, across the plot.
			Layer.box({
				id: "live-level",
				position: "absolute",
				x: pts[0].x,
				y: last.y - 1,
				width: last.x - pts[0].x,
				height: 2,
				background: "rgba(8, 145, 178, 0.28)",
			}),
			chart,
			...segs,
			Layer.shape("circle", {
				id: "live-halo",
				position: "absolute",
				x: last.x - 22,
				y: last.y - 22,
				width: 44,
				height: 44,
				fillColor: "rgba(34, 211, 238, 0.35)",
				startFrame: FIRST_TICK - 10,
			}).animate(
				LayerAnimation.create().signal("opacity", PULSE, {
					multiplier: 0.9,
					offset: 0.1,
				}),
			),
		],
	});
}

/**
 * A live feed: a ten-second window over a stream of samples. Every tick the
 * window slides one sample, and every point, segment, the halo on the newest
 * sample and the level line ease to the new numbers; the latest value rolls on
 * an odometer and a LIVE dot blinks on the beat.
 */
export function liveScene(): LayoutNode {
	const values = userStream();
	const states: DataState[] = Array.from({ length: TICKS + 1 }, (_, k) => ({
		at: FIRST_TICK + (k - 1) * TICK,
		node: windowView(values, k),
	}));
	const view = morph(states, { duration: 9, ease: "power2.out" });

	const latest = (k: number) => values[k + WINDOW - 1].toLocaleString("en-US");
	const size = 76;
	return scene("live", LIVE.from, LIVE.to, [
		...header("live", "02  ·  ACTIVE USERS", "Live, and climbing."),
		view,
		odometer(
			states.map((s, k) => ({ at: k === 0 ? 20 : s.at, value: latest(k) })),
			{
				id: "live-readout",
				x: W - MARGIN - Math.round(size * 0.62) * 6,
				y: 104,
				size,
				color: CYAN_TEXT,
				change: 9,
			},
		),
		Layer.shape("circle", {
			id: "live-dot",
			position: "absolute",
			x: W - MARGIN - 150,
			y: 214,
			width: 14,
			height: 14,
			fillColor: RED,
		}).animate(
			LayerAnimation.create().signal("opacity", PULSE, {
				multiplier: 0.85,
				offset: 0.15,
			}),
		),
		Layer.text("LIVE", {
			id: "live-badge",
			position: "absolute",
			x: W - MARGIN - 126,
			y: 204,
			width: 126,
			height: 32,
			fontFamily: MONO,
			fontSize: 22,
			fontWeight: 700,
			letterSpacing: 4,
			fill: TEXT,
			align: "end",
		}),
	]);
}
