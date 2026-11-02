/**
 * The weather, as a cross-section on graph paper: altitude up the side, the
 * jet cruising at 35,000 ft, and a thunderstorm over Palm Beach County that
 * grows puff by puff to an anvil near 44,000 ft as it is described. The
 * forecasters' warning is pinned item by item as it is read; then the crew's
 * report, and the 2,000 ft climb they asked for.
 */
import { Color, Layer, LayerAnimation, type LayoutNode } from "framefields";
import { rng, type Vec2 } from "framefields/components";
import { Annotate } from "../components/annotate/index.js";
import { jetSide, sideView } from "../jet.js";
import { layDown, popIn, riseIn, sheet, strip, tape } from "../paper.js";
import {
	CARD,
	DISPLAY,
	INK,
	INK_FAINT,
	INK_SOFT,
	MONO,
	RED,
	SHEET,
	STORM,
	STORM_LIGHT,
	sec,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const PAPER_BOX = { x: 70, y: 50, width: 1780, height: 980 } as const;
const GRID = 40;
const GRID_INK = "#c7d4da";
/** Where the ground is, and how many px a thousand feet climbs. */
const GROUND = 840;
const PER_KFT = 14;
const AXIS_X = 190;
const RIGHT = PAPER_BOX.width - 60;
const alt = (feet: number) => GROUND - (feet / 1000) * PER_KFT;

const JET_LENGTH = 200;
const JET_X = 360;

function gridPath(): string {
	const lines: string[] = [];
	for (let x = GRID; x < PAPER_BOX.width; x += GRID)
		lines.push(`M${x} 0 L${x} ${PAPER_BOX.height}`);
	for (let y = GRID; y < PAPER_BOX.height; y += GRID)
		lines.push(`M0 ${y} L${PAPER_BOX.width} ${y}`);
	return lines.join(" ");
}

const line = (
	id: string,
	d: string,
	color: string,
	width: number,
	extra: Record<string, unknown> = {},
) =>
	Layer.shape("path", {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: PAPER_BOX.width,
		height: PAPER_BOX.height,
		d,
		fillType: "none",
		fill: "transparent",
		strokeColor: color,
		strokeWidth: width,
		strokeLineCap: "round",
		...extra,
	});

function axis(): LayoutNode[] {
	const ticks = [0, 10, 20, 30, 40, 50];
	return [
		line("storm-axis", `M${AXIS_X} ${alt(52000)} L${AXIS_X} ${GROUND}`, INK, 3),
		...ticks.flatMap((k) => [
			line(
				`storm-tick-${k}`,
				`M${AXIS_X - 12} ${alt(k * 1000)} L${AXIS_X} ${alt(k * 1000)}`,
				INK,
				3,
			),
			Layer.text(k === 0 ? "GROUND" : `${k},000 FT`, {
				id: `storm-tick-label-${k}`,
				position: "absolute",
				x: 0,
				y: alt(k * 1000) - 12,
				width: AXIS_X - 22,
				align: "end",
				fontFamily: MONO,
				fontWeight: 600,
				fontSize: 19,
				fill: INK_SOFT,
			}),
		]),
	];
}

interface Puff {
	x: number;
	y: number;
	r: number;
	/** 0 at the base, 1 at the top: the order it grows in. */
	h: number;
	lit: boolean;
}

/** The thunderstorm as puffs: a base, a tower and an anvil spread at the top. */
function stormPuffs(): Puff[] {
	const r = rng(44);
	const puffs: Puff[] = [];
	const cx = 1230;
	const base = alt(5000);
	const top = alt(44000);
	// The base: a broad, low row.
	for (let x = cx - 330; x <= cx + 330; x += 70)
		puffs.push({
			x: x + r.spread(14),
			y: base - r.range(0, 30),
			r: r.range(70, 92),
			h: 0,
			lit: false,
		});
	// The tower: narrowing columns rising to the anvil.
	for (let y = base - 80; y > top + 110; y -= 62) {
		const h = (base - y) / (base - top);
		const half = 250 - 110 * h;
		for (let x = cx - half; x <= cx + half; x += 95)
			puffs.push({
				x: x + r.spread(26),
				y: y + r.spread(18),
				r: r.range(78, 112) * (1 - 0.25 * h),
				h,
				lit: x < cx - half * 0.2,
			});
	}
	// The anvil: wide and flat, leaning downwind.
	for (let x = cx - 420; x <= cx + 470; x += 64)
		puffs.push({
			x: x + r.spread(10),
			y: top + 58 + Math.abs(x - cx) * 0.06 + r.spread(10),
			r: r.range(42, 60),
			h: 1,
			lit: x < cx,
		});
	return puffs;
}

function storm(grow: number, tops: number): LayoutNode[] {
	const puffs = stormPuffs();
	const span = tops - grow;
	const at = (p: Puff) => Math.round(grow + p.h * span);
	const shadow = puffs.map((p, i) =>
		Layer.shape("circle", {
			id: `storm-puff-${i}`,
			position: "absolute",
			x: p.x - p.r,
			y: p.y - p.r,
			width: p.r * 2,
			height: p.r * 2,
			fill: STORM,
		}).animate(popIn(at(p), 14)),
	);
	const light = puffs
		.filter((p) => p.lit)
		.map((p, i) =>
			Layer.shape("circle", {
				id: `storm-lit-${i}`,
				position: "absolute",
				x: p.x - p.r * 0.75 - p.r * 0.18,
				y: p.y - p.r * 0.75 - p.r * 0.22,
				width: p.r * 1.5,
				height: p.r * 1.5,
				fill: STORM_LIGHT,
				opacity: 0.85,
			}).animate(popIn(at(p) + 4, 14)),
		);
	const rain: string[] = [];
	const r = rng(7);
	for (let x = 940; x < 1540; x += 26) {
		const y0 = alt(4200) + r.range(0, 30);
		rain.push(`M${x} ${y0} L${x - 22} ${GROUND - 6}`);
	}
	const rainAt = grow + 18;
	return [
		line("storm-rain", rain.join(" "), STORM_LIGHT, 3, { opacity: 0 }).animate(
			LayerAnimation.keys("opacity", [
				[rainAt, 0],
				[rainAt + 12, 0.8],
			]),
		),
		...shadow,
		...light,
	];
}

/** A horizontal reference line across the plot with its name at the left end, above or below it. */
function level(
	id: string,
	feet: number,
	text: string,
	color: string,
	appear: number,
	side: "above" | "below" = "above",
): LayoutNode[] {
	const y = alt(feet);
	const labelY = side === "above" ? y - 34 : y + 20;
	return [
		line(id, `M${AXIS_X} ${y} L${RIGHT} ${y}`, color, 2.5, {
			strokeDashArray: "12 10",
			trimEnd: 0,
		}).animate(
			LayerAnimation.keys("trimEnd", [
				[appear, 0],
				[appear + 24, 1, "power2.inOut"],
			]),
		),
		Layer.text(text, {
			id: `${id}-label`,
			position: "absolute",
			x: AXIS_X + 16,
			y: labelY,
			fontFamily: MONO,
			fontWeight: 700,
			fontSize: 20,
			letterSpacing: 1.5,
			fill: color,
		}).animate(riseIn(appear + 6, labelY, 12, 8)),
	];
}

/** The forecasters' warning, one hazard per word. */
function warning(t: SceneTiming): LayoutNode {
	const warned = lineIn(t, "warned");
	const box = { x: 230, y: 470, width: 560, height: 270 };
	const items: Array<[string, string]> = [
		["SEVERE TURBULENCE", "turbulence"],
		["ICING", "icing"],
		["HAIL", "hail"],
	];
	const rows = items.flatMap(([label, word], i) => {
		const at = wordIn(t, "warned", word).start - 3;
		const y = 112 + i * 48;
		return [
			Layer.shape("rect", {
				id: `warning-box-${i}`,
				position: "absolute",
				x: 36,
				y: y + 4,
				width: 24,
				height: 24,
				fill: "transparent",
				strokeColor: INK,
				strokeWidth: 3,
			}),
			Layer.shape("path", {
				id: `warning-check-${i}`,
				position: "absolute",
				x: 0,
				y: 0,
				width: box.width,
				height: box.height,
				d: `M40 ${y + 16} L49 ${y + 26} L66 ${y - 2}`,
				fillType: "none",
				fill: "transparent",
				strokeColor: RED,
				strokeWidth: 5,
				strokeLineCap: "round",
				strokeLineJoin: "round",
				trimEnd: 0,
			}).animate(
				LayerAnimation.keys("trimEnd", [
					[at, 0],
					[at + 8, 1, "power2.out"],
				]),
			),
			Layer.text(label, {
				id: `warning-item-${i}`,
				position: "absolute",
				x: 84,
				y,
				fontFamily: MONO,
				fontWeight: 700,
				fontSize: 28,
				fill: INK,
			}).animate(riseIn(at, y, 10, 8)),
		];
	});
	return Layer.box({
		id: "warning",
		position: "absolute",
		...box,
		children: [
			sheet({
				id: "warning-sheet",
				x: 0,
				y: 0,
				width: box.width,
				height: box.height,
				color: CARD,
				lift: 1.5,
				children: [
					Layer.shape("rect", {
						id: "warning-band",
						position: "absolute",
						x: 0,
						y: 0,
						width: box.width,
						height: 86,
						fill: RED,
					}),
					Layer.text("WEATHER WARNING", {
						id: "warning-title",
						position: "absolute",
						x: 32,
						y: 14,
						fontFamily: DISPLAY,
						fontSize: 48,
						letterSpacing: 1,
						fill: SHEET,
					}),
					Layer.text("SIGMET IN EFFECT", {
						id: "warning-kind",
						position: "absolute",
						x: 340,
						y: 34,
						fontFamily: MONO,
						fontWeight: 700,
						fontSize: 18,
						letterSpacing: 2,
						fill: SHEET,
					}),
					...rows,
				],
			}),
			tape({
				id: "warning-tape",
				x: 60,
				y: 6,
				rotation: -24,
				seed: 23,
				width: 120,
			}),
		],
	}).animate(
		layDown(warned.start - 8, { y: box.y, rotation: -2.5, from: -60 }),
	);
}

export function stormScene(t: SceneTiming): LayoutNode {
	const grow = wordIn(t, "storm", "thunderstorm").start;
	const tops = wordIn(t, "storm", "tops").start + 6;
	const reported = wordIn(t, "climb", "reported").start;
	const asked = wordIn(t, "climb", "climb").start - 4;
	const view = sideView(JET_LENGTH);
	const jet = Layer.box({
		id: "storm-plane",
		position: "absolute",
		x: JET_X,
		y: alt(35000) - view.axisY,
		width: view.width,
		height: view.height,
		children: jetSide({
			id: "storm-jet",
			length: JET_LENGTH,
			color: INK,
			window: SHEET,
		}),
	}).animate(
		LayerAnimation.create()
			.keys("x", [
				[0, -260],
				[sec(1.4), JET_X - 40, "expo.out"],
				[t.duration, JET_X + 110, "none"],
			])
			.wiggle("y", { frequency: 0.6, amplitude: 3, seed: 5 }),
	);
	const nose: Vec2 = [JET_X + JET_LENGTH + 40, alt(35000) - 8];
	const climbTo: Vec2 = [JET_X + JET_LENGTH + 250, alt(37000) - 4];
	const climbArrow = Annotate({
		...kit,
		id: "storm-climb",
		target: { x: climbTo[0], y: climbTo[1] - 6, width: 12, height: 12 },
		from: { x: nose[0], y: nose[1], width: 1, height: 1 },
		mark: "arrow",
		curve: "arc",
		color: RED,
		texture: "ink",
		width: 4,
		at: asked,
		drawDuration: 14,
		padding: 0,
		seed: 8,
	});
	const report = strip({
		id: "storm-report",
		x: JET_X - 40,
		y: alt(35000) - 170,
		width: 330,
		height: 64,
		color: SHEET,
		seed: 91,
		rotation: -2,
		children: [
			Layer.text("CREW: ICE, TURBULENCE", {
				id: "storm-report-text",
				position: "absolute",
				x: 0,
				y: 18,
				width: 330,
				align: "center",
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: 22,
				fill: INK,
			}),
		],
	}).animate(popIn(reported, 10));
	const topsNote = Annotate({
		...kit,
		id: "storm-tops-note",
		target: { x: 1180, y: alt(44000) - 6, width: 60, height: 20 },
		from: { x: 900, y: alt(50500), width: 1, height: 1 },
		mark: "arrow",
		curve: "swoop",
		color: INK,
		texture: "marker",
		width: 4,
		at: tops + 6,
		drawDuration: 14,
		padding: 4,
		label: { text: "storm tops ≈ 44,000 ft", size: 34 },
		seed: 12,
	});
	const ground = [
		Layer.shape("rect", {
			id: "storm-ground",
			position: "absolute",
			x: AXIS_X,
			y: GROUND,
			width: RIGHT - AXIS_X,
			height: 46,
			fill: "#cdbf9c",
		}),
		Layer.text("PALM BEACH COUNTY", {
			id: "storm-ground-label",
			position: "absolute",
			x: 1000,
			y: GROUND + 58,
			width: 460,
			align: "center",
			fontFamily: MONO,
			fontWeight: 700,
			fontSize: 22,
			letterSpacing: 3,
			fill: INK_SOFT,
		}),
	];
	const paper = sheet({
		id: "storm-paper",
		...PAPER_BOX,
		rotation: 0.5,
		color: "#f7f4ec",
		lift: 1.2,
		children: [
			line("storm-grid", gridPath(), GRID_INK, 1.2, { opacity: 0.8 }),
			...axis(),
			...ground,
			...storm(grow, tops),
			...level(
				"storm-cruise",
				35000,
				"CRUISING · 35,000 FT",
				INK,
				sec(0.6),
				"below",
			),
			...level("storm-tops", 44000, "", Color.alpha(INK_FAINT, 0.9), tops),
			...level(
				"storm-climb-level",
				37000,
				"REQUESTED · 37,000 FT",
				RED,
				asked + 6,
			),
			jet,
			report,
			climbArrow,
			topsNote,
			Layer.text("Not to scale horizontally", {
				id: "storm-note",
				position: "absolute",
				x: PAPER_BOX.width - 420,
				y: PAPER_BOX.height - 48,
				width: 380,
				align: "end",
				fontFamily: MONO,
				fontWeight: 600,
				fontSize: 17,
				fill: INK_SOFT,
			}),
		],
	});
	return sceneRoot(t, { stage: [paper, warning(t)], push: 1.03 });
}
