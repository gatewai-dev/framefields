/**
 * Where it came down, as a schematic street plan (not to scale): Military
 * Trail marked as "a busy road" is said, the mobile home park boxed on
 * "mobile", the crater beside the road, then the evacuation ring opening on
 * "six hundred", and a stamp for the people on the ground.
 */
import { Color, Layer, LayerAnimation, type LayoutNode } from "framefields";
import { rng, toPathData, type Vec2 } from "framefields/components";
import { Annotate } from "../components/annotate/index.js";
import { popIn, riseIn, sheet, stamp, stampIn, strip } from "../paper.js";
import {
	CARD,
	HAND,
	INK,
	INK_SOFT,
	MONO,
	RED,
	SANS,
	SHEET,
	YELLOW,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const PLAN = { x: 70, y: 50, width: 1780, height: 980 } as const;
const BLOCK = "#e9e3d5";
const STREET = "#d2c9b7";
const PARK = "#dde3c9";
const HOME = "#f6f2e6";

/** Military Trail runs north–south, 10th Avenue North east–west. */
const TRAIL = { x: 800, width: 90 } as const;
const AVENUE = { y: 430, height: 70 } as const;
const MINOR = 44;
const PARK_BOX = { x: 960, y: 560, width: 560, height: 330 } as const;
const SITE: Vec2 = [925, 640];

const rect = (
	id: string,
	r: { x: number; y: number; width: number; height: number },
	fill: string,
	extra: Record<string, unknown> = {},
) => Layer.shape("rect", { id, position: "absolute", ...r, fill, ...extra });

function streets(): LayoutNode[] {
	const minorX = [280, 1640];
	const minorY = [170, 940];
	return [
		rect(
			"plan-blocks",
			{ x: 0, y: 0, width: PLAN.width, height: PLAN.height },
			BLOCK,
		),
		...minorX.map((x, i) =>
			rect(
				`plan-street-x-${i}`,
				{ x, y: 0, width: MINOR, height: PLAN.height },
				STREET,
				{ opacity: 0.7 },
			),
		),
		...minorY.map((y, i) =>
			rect(
				`plan-street-y-${i}`,
				{ x: 0, y, width: PLAN.width, height: MINOR },
				STREET,
				{ opacity: 0.7 },
			),
		),
		rect(
			"plan-avenue",
			{ x: 0, y: AVENUE.y, width: PLAN.width, height: AVENUE.height },
			STREET,
		),
		rect(
			"plan-trail",
			{ x: TRAIL.x, y: 0, width: TRAIL.width, height: PLAN.height },
			STREET,
		),
		Layer.shape("path", {
			id: "plan-trail-centre",
			position: "absolute",
			x: 0,
			y: 0,
			width: PLAN.width,
			height: PLAN.height,
			d: `M${TRAIL.x + TRAIL.width / 2} 0 L${TRAIL.x + TRAIL.width / 2} ${PLAN.height} M0 ${AVENUE.y + AVENUE.height / 2} L${PLAN.width} ${AVENUE.y + AVENUE.height / 2}`,
			fillType: "none",
			fill: "transparent",
			strokeColor: Color.alpha("#ffffff", 0.9),
			strokeWidth: 3,
			strokeDashArray: "18 14",
		}),
		Layer.text("MILITARY TRAIL", {
			id: "plan-trail-name",
			position: "absolute",
			x: TRAIL.x + TRAIL.width / 2 - 180,
			y: 230,
			width: 360,
			align: "center",
			rotation: -90,
			fontFamily: MONO,
			fontWeight: 800,
			fontSize: 26,
			letterSpacing: 6,
			fill: INK_SOFT,
		}),
		Layer.text("10TH AVE. N.", {
			id: "plan-avenue-name",
			position: "absolute",
			x: 1180,
			y: AVENUE.y + 20,
			fontFamily: MONO,
			fontWeight: 800,
			fontSize: 24,
			letterSpacing: 5,
			fill: INK_SOFT,
		}),
	];
}

function park(): LayoutNode[] {
	const homes: LayoutNode[] = [];
	for (let row = 0; row < 5; row++)
		for (let col = 0; col < 9; col++)
			homes.push(
				rect(
					`plan-home-${row}-${col}`,
					{
						x: PARK_BOX.x + 40 + col * 56,
						y: PARK_BOX.y + 34 + row * 56,
						width: 30,
						height: 40,
					},
					HOME,
					{ borderRadius: 3 },
				),
			);
	return [
		rect("plan-park", PARK_BOX, PARK, { borderRadius: 8 }),
		...homes,
		Layer.text("MOBILE HOME PARK", {
			id: "plan-park-name",
			position: "absolute",
			x: PARK_BOX.x,
			y: PARK_BOX.y + PARK_BOX.height + 14,
			width: PARK_BOX.width,
			align: "center",
			fontFamily: MONO,
			fontWeight: 800,
			fontSize: 22,
			letterSpacing: 4,
			fill: INK_SOFT,
		}),
	];
}

/** The blocks around it, filled with house footprints (seeded, some lots empty). */
function neighbourhood(): LayoutNode {
	const blocks = [
		{ x: 20, y: 20, width: 240, height: 130 },
		{ x: 344, y: 20, width: 436, height: 130 },
		{ x: 910, y: 20, width: 710, height: 130 },
		{ x: 20, y: 234, width: 240, height: 176 },
		{ x: 344, y: 234, width: 436, height: 176 },
		{ x: 910, y: 234, width: 710, height: 176 },
		{ x: 20, y: 520, width: 240, height: 400 },
		{ x: 344, y: 520, width: 436, height: 400 },
	];
	const r = rng(12);
	const lots: string[] = [];
	for (const b of blocks)
		for (let y = b.y + 14; y + 26 <= b.y + b.height - 10; y += 46)
			for (let x = b.x + 14; x + 34 <= b.x + b.width - 10; x += 52)
				if (r.next() > 0.22) {
					const w = r.range(26, 36);
					const h = r.range(20, 28);
					lots.push(
						`M${x.toFixed(1)} ${y.toFixed(1)} h${w.toFixed(1)} v${h.toFixed(1)} h${(-w).toFixed(1)} Z`,
					);
				}
	return Layer.shape("path", {
		id: "plan-houses",
		position: "absolute",
		x: 0,
		y: 0,
		width: PLAN.width,
		height: PLAN.height,
		d: lots.join(" "),
		fill: "#ddd4c2",
		opacity: 0.8,
	});
}

/** North, top right. */
function north(): LayoutNode[] {
	const x = PLAN.width - 90;
	const y = 40;
	return [
		Layer.shape("path", {
			id: "plan-north-arrow",
			position: "absolute",
			x: 0,
			y: 0,
			width: PLAN.width,
			height: PLAN.height,
			d: `M${x} ${y} L${x + 16} ${y + 44} L${x} ${y + 34} L${x - 16} ${y + 44} Z`,
			fill: INK,
		}),
		Layer.text("N", {
			id: "plan-north",
			position: "absolute",
			x: x - 20,
			y: y + 50,
			width: 40,
			align: "center",
			fontFamily: MONO,
			fontWeight: 800,
			fontSize: 24,
			fill: INK,
		}),
	];
}

/** A ragged scorch with a darker core, `radius` px across at most. */
function craterPath(radius: number, seed: number): string {
	const r = rng(seed);
	const points: Vec2[] = Array.from({ length: 22 }, (_, i) => {
		const a = (i / 22) * Math.PI * 2;
		const d = radius * r.range(0.72, 1);
		return [radius + Math.cos(a) * d, radius + Math.sin(a) * d * 0.86];
	});
	return toPathData(points, true);
}

export function groundScene(t: SceneTiming): LayoutNode {
	const road = wordIn(t, "road", "road").start;
	const mobile = wordIn(t, "road", "mobile").start;
	const crater = wordIn(t, "crater", "crater").start;
	const six = wordIn(t, "crater", "six").start;
	const ground = lineIn(t, "ground");

	const roadMark = Annotate({
		...kit,
		id: "plan-road-mark",
		target: { x: TRAIL.x, y: 40, width: TRAIL.width, height: PLAN.height - 80 },
		mark: "highlight",
		at: road - 10,
		drawDuration: 16,
		padding: 0,
		seed: 31,
	});
	const parkMark = Annotate({
		...kit,
		id: "plan-park-mark",
		target: PARK_BOX,
		mark: "box",
		color: INK,
		texture: "marker",
		width: 4,
		at: mobile,
		drawDuration: 16,
		padding: 14,
		seed: 32,
	});
	const scorch = Layer.box({
		id: "plan-crater",
		position: "absolute",
		x: SITE[0] - 60,
		y: SITE[1] - 52,
		width: 120,
		height: 104,
		children: [
			Layer.shape("path", {
				id: "plan-crater-scorch",
				position: "absolute",
				x: 0,
				y: 0,
				width: 120,
				height: 104,
				d: craterPath(60, 5),
				fill: "#4a3d33",
			}),
			Layer.shape("path", {
				id: "plan-crater-core",
				position: "absolute",
				x: 24,
				y: 20,
				width: 72,
				height: 62,
				d: craterPath(36, 8),
				fill: "#231c17",
			}),
		],
	}).animate(popIn(crater - 4, 12));
	const craterNote = Annotate({
		...kit,
		id: "plan-crater-note",
		target: { x: SITE[0] - 50, y: SITE[1] - 40, width: 100, height: 80 },
		from: { x: 560, y: 760, width: 1, height: 1 },
		mark: "arrow",
		curve: "arc",
		color: RED,
		texture: "marker",
		width: 5,
		at: crater + 6,
		drawDuration: 14,
		padding: 10,
		label: { text: "crater by the road", side: "left", size: 38 },
		seed: 33,
	});
	const ringR = 360;
	const ring = Layer.shape("circle", {
		id: "plan-evacuation",
		position: "absolute",
		x: SITE[0] - ringR,
		y: SITE[1] - ringR,
		width: ringR * 2,
		height: ringR * 2,
		fill: Color.alpha(RED, 0.07),
		strokeColor: RED,
		strokeWidth: 4,
		strokeDashArray: "16 12",
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[six - 4, 0.1],
				[six + 26, 1, "expo.out"],
			])
			.keys("opacity", [
				[six - 4, 0],
				[six + 2, 1],
			]),
	);
	const evacuated = strip({
		id: "plan-evacuated",
		x: 1240,
		y: 150,
		width: 470,
		height: 120,
		color: YELLOW,
		seed: 52,
		rotation: 2.5,
		children: [
			Layer.text("≈ 600 RESIDENTS\nEVACUATED", {
				id: "plan-evacuated-text",
				position: "absolute",
				x: 0,
				y: 14,
				width: 470,
				align: "center",
				fontFamily: SANS,
				fontWeight: 900,
				fontSize: 38,
				lineHeight: 1.1,
				fill: INK,
			}),
		],
	}).animate(popIn(six + 10, 12));
	const safe = stamp({
		id: "plan-ground-stamp",
		text: "NO DEATHS ON THE GROUND",
		x: 180,
		y: 110,
		rotation: -5,
		color: INK,
		fontSize: 34,
	}).animate(stampIn(ground.start + 4));
	const plan = sheet({
		id: "plan",
		...PLAN,
		rotation: 0.4,
		color: SHEET,
		lift: 1.2,
		children: [
			...streets(),
			neighbourhood(),
			...park(),
			...north(),
			roadMark,
			ring,
			parkMark,
			scorch,
			craterNote,
			Layer.text("SCHEMATIC · NOT TO SCALE · POSITIONS APPROXIMATE", {
				id: "plan-note",
				position: "absolute",
				x: PLAN.width - 720,
				y: PLAN.height - 46,
				width: 690,
				align: "end",
				fontFamily: MONO,
				fontWeight: 600,
				fontSize: 17,
				letterSpacing: 1.5,
				fill: INK_SOFT,
			}),
		],
	});
	const place = strip({
		id: "plan-place",
		x: 120,
		y: 880,
		width: 640,
		height: 84,
		color: CARD,
		seed: 64,
		rotation: -1.5,
		children: [
			Layer.text("Cresthaven, Palm Beach County", {
				id: "plan-place-text",
				position: "absolute",
				x: 0,
				y: 20,
				width: 640,
				align: "center",
				fontFamily: HAND,
				fontSize: 36,
				fill: INK,
			}),
		],
	}).animate(riseIn(Math.max(0, lineIn(t, "road").start - 6), 880, 14, 20));
	return sceneRoot(t, { stage: [plan, evacuated, safe, place], push: 1.04 });
}
