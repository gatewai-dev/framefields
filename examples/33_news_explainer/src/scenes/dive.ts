/**
 * The fall, on a dark board: altitude against time. The cruise holds at
 * 35,250 ft; on "dropped" the line plunges to 8,750 ft over just over a
 * minute while a counter reads it off. The panel on the right takes one
 * figure at a time: the 26,500 ft lost, the descent rate climbing to 30,000
 * ft a minute (marked on the curve as each rate is reached), its speed in
 * miles an hour, and the 35 seconds between the emergency call and the last
 * transmission.
 *
 * The curve is illustrative: it passes through the FAA's two altitudes and
 * reaches the rates reported from flight tracking (10,000, 20,000, then up to
 * 30,000 ft/min), as altitude = 35,250 − 26,500 · (t / 76 s)^1.47.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { toPathData, type Vec2 } from "framefields/components";
import { Annotate } from "../components/annotate/index.js";
import { Counter } from "../components/counter/index.js";
import { popIn, riseIn, sheet } from "../paper.js";
import { DISPLAY, HAND, MONO, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const BOARD = "#202427";
const CHALK = "#efe8da";
const CHALK_SOFT = "#a9adae";
const CHALK_FAINT = "#5b6266";
const HOT = "#ff5b3d";
const HIGHLIGHT = "#f7d94c";

const SHEET_BOX = { x: 50, y: 36, width: W - 100, height: 1008 } as const;
/** The plot, in sheet px: seconds since the dive began across, feet up. */
const T0 = -15;
const T1 = 95;
const X0 = 210;
const X1 = 1170;
const BASE = 870;
const PER_FT = 0.0175;
const tx = (t: number) => X0 + ((t - T0) / (T1 - T0)) * (X1 - X0);
const ay = (feet: number) => BASE - feet * PER_FT;

const START_FT = 35250;
const LOW_FT = 8750;
/** "A little over a minute" from 35,250 to 8,750 ft. */
const DIVE_S = 76;
const POWER = 1.47;
export const altitudeAt = (t: number) =>
	START_FT - (START_FT - LOW_FT) * (Math.max(0, t) / DIVE_S) ** POWER;
/** Feet per minute, at `t` seconds. */
export const rateAt = (t: number) =>
	(60 * POWER * (START_FT - LOW_FT) * (t / DIVE_S) ** (POWER - 1)) / DIVE_S;
/** When the descent reaches `perMinute`. */
export const timeAtRate = (perMinute: number) =>
	DIVE_S *
	((perMinute * DIVE_S) / (60 * POWER * (START_FT - LOW_FT))) **
		(1 / (POWER - 1));

const PANEL_X = 1260;

function plotLine(
	id: string,
	d: string,
	color: string,
	width: number,
	extra: Record<string, unknown> = {},
) {
	return Layer.shape("path", {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: SHEET_BOX.width,
		height: SHEET_BOX.height,
		d,
		fillType: "none",
		fill: "transparent",
		strokeColor: color,
		strokeWidth: width,
		strokeLineCap: "round",
		strokeLineJoin: "round",
		...extra,
	});
}

const label = (
	id: string,
	text: string,
	o: {
		x: number;
		y: number;
		size?: number;
		color?: string;
		width?: number;
		align?: "start" | "center" | "end";
		font?: string;
		weight?: number;
	},
) =>
	Layer.text(text, {
		id,
		position: "absolute",
		x: o.x,
		y: o.y,
		...(o.width !== undefined && { width: o.width }),
		align: o.align ?? "start",
		fontFamily: o.font ?? MONO,
		fontWeight: o.weight ?? 600,
		fontSize: o.size ?? 20,
		letterSpacing: (o.size ?? 20) * 0.06,
		fill: o.color ?? CHALK_SOFT,
	});

function axes(): LayoutNode[] {
	const grid = [10000, 20000, 30000, 40000]
		.map((f) => `M${X0} ${ay(f)} L${X1} ${ay(f)}`)
		.join(" ");
	const minutes = [0, 30, 60, 90];
	return [
		plotLine("dive-grid", grid, CHALK_FAINT, 1.5, { strokeDashArray: "4 10" }),
		plotLine(
			"dive-axes",
			`M${X0} ${ay(42000)} L${X0} ${BASE} L${X1} ${BASE}`,
			CHALK_SOFT,
			3,
		),
		...[0, 10000, 20000, 30000, 40000].map((f) =>
			label(`dive-y-${f}`, f === 0 ? "0 FT" : `${f / 1000},000`, {
				x: 0,
				y: ay(f) - 12,
				width: X0 - 18,
				align: "end",
			}),
		),
		...minutes.map((s) =>
			label(
				`dive-x-${s}`,
				`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
				{
					x: tx(s) - 40,
					y: BASE + 14,
					width: 80,
					align: "center",
				},
			),
		),
		label("dive-x-title", "TIME SINCE THE DIVE BEGAN (MIN:SEC)", {
			x: X0,
			y: BASE + 50,
			size: 17,
			color: CHALK_FAINT,
		}),
		label("dive-y-title", "ALTITUDE (FT)", {
			x: X0 - 4,
			y: ay(42000) - 44,
			size: 18,
		}),
	];
}

/** A point on the curve with a value beside it. */
function marker(
	id: string,
	at: Vec2,
	text: string,
	appear: number,
	side: "right" | "above-right" | "above-left" = "right",
): LayoutNode[] {
	const left = side === "above-left";
	const x = left ? at[0] - 262 : at[0] + 22;
	const y = side === "right" ? at[1] - 13 : at[1] - 50;
	return [
		Layer.shape("circle", {
			id: `${id}-dot`,
			position: "absolute",
			x: at[0] - 10,
			y: at[1] - 10,
			width: 20,
			height: 20,
			fill: CHALK,
			strokeColor: HOT,
			strokeWidth: 5,
		}).animate(popIn(appear, 10)),
		label(`${id}-label`, text, {
			x,
			y,
			width: 240,
			align: left ? "end" : "start",
			size: 21,
			weight: 800,
			color: CHALK,
		}).animate(riseIn(appear + 3, y, 10, 8)),
	];
}

/**
 * One figure in the panel: a big number and a note under it, risen in on
 * `appear` (the note on `noteAt`), dimmed on `dim` when the next arrives.
 */
function panelFigure(
	id: string,
	figure: string,
	note: string,
	o: {
		y: number;
		size: number;
		color: string;
		appear: number;
		noteAt?: number;
		dim: number;
	},
): LayoutNode[] {
	const noteY = o.y + o.size * 1.34;
	return [
		label(id, figure, {
			x: PANEL_X,
			y: o.y,
			font: DISPLAY,
			size: o.size,
			weight: 400,
			color: o.color,
		}).animate(riseIn(o.appear, o.y, 14, 16), dimAt(o.dim)),
		label(`${id}-note`, note, {
			x: PANEL_X + 4,
			y: noteY,
			size: 24,
			color: CHALK,
		}).animate(riseIn(o.noteAt ?? o.appear + 4, noteY, 14, 12), dimAt(o.dim)),
	];
}

/** Dims a panel figure once the next one arrives, so the eye goes to the new one. */
const dimAt = (at: number) =>
	LayerAnimation.keys("opacity", [
		[at, 1],
		[at + 10, 0.4, "power2.inOut"],
	]);

export function diveScene(t: SceneTiming): LayoutNode {
	const fall = lineIn(t, "fall");
	const mayday = lineIn(t, "mayday");
	const dropFrom = wordIn(t, "minute", "dropped").start;
	const dropTo = Math.max(dropFrom + sec(3), wordIn(t, "minute", "minute").end);
	const speedAt = wordIn(t, "speed", "vertical").start;

	// The cruise, then the dive drawn in time with "dropped … just over a minute".
	const cruise = plotLine(
		"dive-cruise",
		`M${tx(T0)} ${ay(START_FT)} L${tx(0)} ${ay(START_FT)}`,
		CHALK,
		5,
		{ trimEnd: 0 },
	).animate(
		LayerAnimation.keys("trimEnd", [
			[0, 0],
			[fall.start + 12, 1, "power2.inOut"],
		]),
	);
	const samples = 64;
	const divePoints: Vec2[] = Array.from({ length: samples + 1 }, (_, i) => {
		const s = (i / samples) * DIVE_S;
		return [tx(s), ay(altitudeAt(s))];
	});
	const progressKeys: Array<[number, number]> = [];
	const dotX: Array<[number, number]> = [];
	const dotY: Array<[number, number]> = [];
	const counterKeys: Array<[number, number]> = [];
	const frames = Array.from(
		{ length: Math.floor((dropTo - dropFrom) / 2) },
		(_, i) => dropFrom + i * 2,
	);
	for (const f of [...frames, dropTo]) {
		const share = (f - dropFrom) / (dropTo - dropFrom);
		const s = share * DIVE_S;
		progressKeys.push([f, share]);
		dotX.push([f, tx(s)]);
		dotY.push([f, ay(altitudeAt(s))]);
		counterKeys.push([f - dropFrom, Math.round(altitudeAt(s))]);
	}
	// The plunge is close to straight in x, so trim (arc length) and time agree
	// only roughly; trim follows the arc share of each sample instead.
	const arc = arcShares(divePoints);
	const dive = plotLine("dive-plunge", toPathData(divePoints), HOT, 6, {
		trimEnd: 0,
	}).animate(
		LayerAnimation.keys(
			"trimEnd",
			progressKeys.map(([f, share]) => [f, arc(share)] as [number, number]),
		),
	);
	const tip = Layer.shape("circle", {
		id: "dive-tip",
		position: "absolute",
		x: tx(0) - 11,
		y: ay(START_FT) - 11,
		width: 22,
		height: 22,
		fill: HOT,
	}).animate(
		LayerAnimation.create()
			.keys(
				"x",
				dotX.map(([f, x]) => [f, x - 11] as [number, number]),
			)
			.keys(
				"y",
				dotY.map(([f, y]) => [f, y - 11] as [number, number]),
			)
			.keys("opacity", [
				[fall.start, 0],
				[fall.start + 4, 1],
			]),
	);
	const unknown = plotLine(
		"dive-unknown",
		`M${tx(DIVE_S)} ${ay(LOW_FT)} L${tx(DIVE_S + 17)} ${ay(0)}`,
		HOT,
		4,
		{ strokeDashArray: "8 10", trimEnd: 0 },
	).animate(
		LayerAnimation.keys("trimEnd", [
			[mayday.start, 0],
			[mayday.start + 20, 1, "power2.out"],
		]),
	);

	const markers = [
		...marker(
			"dive-start",
			[tx(0), ay(START_FT)],
			"35,250 FT",
			fall.start + 8,
			"above-left",
		),
		...marker("dive-low", [tx(DIVE_S), ay(LOW_FT)], "8,750 FT", dropTo),
	];
	const rates = [10000, 20000, 30000].map((perMinute, i) => {
		const s = timeAtRate(perMinute);
		return marker(
			`dive-rate-${i}`,
			[tx(s), ay(altitudeAt(s))],
			`${perMinute / 1000},000 FT/MIN`,
			wordIn(t, "rate", "fastest").start + i * 9,
			"above-right",
		);
	});
	const fastest = timeAtRate(30000);
	const fastestRing = Annotate({
		...kit,
		id: "dive-fastest",
		target: {
			x: tx(fastest) - 16,
			y: ay(altitudeAt(fastest)) - 16,
			width: 32,
			height: 32,
		},
		mark: "circle",
		color: HIGHLIGHT,
		texture: "marker",
		width: 4,
		at: wordIn(t, "rate", "thirty").start,
		drawDuration: 12,
		padding: 8,
		seed: 21,
	});
	const since = plotLine(
		"dive-span",
		`M${tx(0)} ${BASE - 34} L${tx(DIVE_S)} ${BASE - 34}`,
		HIGHLIGHT,
		3,
		{ trimEnd: 0 },
	).animate(
		LayerAnimation.keys("trimEnd", [
			[dropFrom, 0],
			[dropTo, 1, "none"],
		]),
	);
	const spanLabel = label("dive-span-label", "just over a minute", {
		x: tx(DIVE_S / 2) - 200,
		y: BASE - 82,
		width: 400,
		align: "center",
		font: HAND,
		size: 30,
		weight: 400,
		color: HIGHLIGHT,
	}).animate(riseIn(dropTo - 4, BASE - 82, 10, 8));

	// The panel: one figure at a time. The counter reads the cruise from
	// "Then the jet started to fall", and runs with the line from "dropped".
	const counterAt = fall.start + 6;
	const holdFor = dropFrom - counterAt;
	const altitude = [
		label("dive-alt-label", "ALTITUDE", { x: PANEL_X, y: 96, size: 22 }),
		Counter({
			...kit,
			id: "dive-counter",
			from: START_FT,
			values: [
				[0, START_FT],
				...counterKeys.map(([f, v]) => [f + holdFor, v] as [number, number]),
			],
			style: "count",
			format: ",d",
			suffix: " FT",
			fontFamily: DISPLAY,
			fontSize: 120,
			fill: CHALK,
			position: "absolute",
			x: PANEL_X,
			y: 130,
			at: counterAt,
			hold: t.duration,
		}),
	];
	const rateAt = wordIn(t, "rate", "thirty").start;
	const mphAt = wordIn(t, "speed", "three").start;
	const lost = panelFigure("dive-lost", "−26,500 FT", "IN JUST OVER A MINUTE", {
		y: 290,
		size: 96,
		color: HOT,
		appear: dropTo + 6,
		dim: rateAt,
	});
	const rateFigure = panelFigure(
		"dive-rate",
		"30,000 FT/MIN",
		"AT ITS FASTEST",
		{
			y: 480,
			size: 84,
			color: CHALK,
			appear: rateAt,
			dim: mphAt,
		},
	);
	const mph = panelFigure("dive-mph", "≈ 340 MPH", "VERTICAL SPEED", {
		y: 650,
		size: 84,
		color: HIGHLIGHT,
		appear: mphAt,
		noteAt: speedAt,
		dim: wordIn(t, "mayday", "emergency").start,
	});

	const radio = radioStrip(t);
	const board = sheet({
		id: "dive-board",
		...SHEET_BOX,
		rotation: -0.4,
		color: BOARD,
		lift: 2,
		children: [
			...axes(),
			since,
			spanLabel,
			cruise,
			dive,
			unknown,
			...markers,
			...rates.flat(),
			fastestRing,
			tip,
			...altitude,
			...lost,
			...rateFigure,
			...mph,
			...radio,
			label(
				"dive-source",
				"ILLUSTRATIVE PROFILE THROUGH FAA ALTITUDES AND REPORTED DESCENT RATES · FINAL SECONDS NOT PUBLISHED",
				{ x: X0, y: SHEET_BOX.height - 52, size: 15, color: CHALK_FAINT },
			),
		],
	});
	return sceneRoot(t, { stage: [board], push: 1.025 });
}

/** The radio, under the panel: the emergency call, 35 seconds, the last transmission. */
function radioStrip(t: SceneTiming): LayoutNode[] {
	const y = 860;
	const left = PANEL_X;
	const right = PANEL_X + 470;
	const called = wordIn(t, "mayday", "emergency").start;
	const quiet = wordIn(t, "mayday", "quiet").start;
	const counting = wordIn(t, "mayday", "later").start - 12;
	const tick = (id: string, x: number, at: number) =>
		Layer.shape("rect", {
			id,
			position: "absolute",
			x: x - 2,
			y: y - 16,
			width: 4,
			height: 32,
			fill: CHALK,
		}).animate(popIn(at, 8));
	return [
		tick("radio-start", left, called),
		label("radio-called", "MAYDAY", {
			x: left - 6,
			y: y - 52,
			size: 22,
			weight: 800,
			color: HOT,
		}).animate(riseIn(called + 2, y - 52, 10, 8)),
		plotLine("radio-bar", `M${left} ${y} L${right} ${y}`, CHALK, 4, {
			strokeDashArray: "2 9",
			trimEnd: 0,
		}).animate(
			LayerAnimation.keys("trimEnd", [
				[counting, 0],
				[quiet, 1, "none"],
			]),
		),
		label("radio-span", "≈ 35 SECONDS", {
			x: left,
			y: y + 26,
			width: right - left,
			align: "center",
			size: 22,
			weight: 800,
			color: CHALK,
		}).animate(riseIn(counting + 6, y + 26, 10, 8)),
		tick("radio-end", right, quiet),
		label("radio-last", "LAST CALL", {
			x: right - 200,
			y: y - 52,
			width: 206,
			align: "end",
			size: 22,
			weight: 800,
			color: CHALK,
		}).animate(riseIn(quiet + 2, y - 52, 10, 8)),
	];
}

/** Maps a share of the samples to the share of the polyline's length drawn by then. */
function arcShares(points: Vec2[]): (share: number) => number {
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const a = points[i - 1] as Vec2;
		const b = points[i] as Vec2;
		lengths.push((lengths[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]));
	}
	const total = lengths.at(-1) ?? 1;
	return (share) => {
		const f = Math.min(1, Math.max(0, share)) * (points.length - 1);
		const i = Math.floor(f);
		const a = lengths[i] ?? total;
		const b = lengths[Math.min(points.length - 1, i + 1)] ?? total;
		return (a + (b - a) * (f - i)) / total;
	};
}
