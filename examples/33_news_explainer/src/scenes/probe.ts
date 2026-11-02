/**
 * The investigation, as a case folder: who leads it, the weather marked as a
 * major focus, the signs of a break-up circled, then what comes next on a
 * short timeline (a preliminary report within weeks, a cause in a year or
 * more), and a stamp: no cause yet.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { Annotate } from "../components/annotate/index.js";
import {
	layDown,
	popIn,
	riseIn,
	sheet,
	stamp,
	stampIn,
	tape,
} from "../paper.js";
import {
	CARD,
	DISPLAY,
	INK,
	INK_FAINT,
	INK_SOFT,
	MONO,
	RED,
	SANS,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const FOLDER = { x: 230, y: 120, width: 1460, height: 880 } as const;
const MANILA = "#d9c08e";
const NOTES = { x: 70, y: 70, width: 1320, height: 760 } as const;
const ROW_X = 70;

function note(
	id: string,
	text: string,
	y: number,
	at: number,
	o: { size?: number; color?: string; font?: string; weight?: number } = {},
) {
	return Layer.text(text, {
		id,
		position: "absolute",
		x: ROW_X,
		y,
		fontFamily: o.font ?? MONO,
		fontWeight: o.weight ?? 700,
		fontSize: o.size ?? 36,
		fill: o.color ?? INK,
	}).animate(riseIn(at, y, 12, 10));
}

function milestone(
	id: string,
	x: number,
	y: number,
	title: string,
	when: string,
	at: number,
): LayoutNode[] {
	return [
		Layer.shape("circle", {
			id: `${id}-dot`,
			position: "absolute",
			x: x - 14,
			y: y - 14,
			width: 28,
			height: 28,
			fill: INK,
		}).animate(popIn(at, 10)),
		Layer.text(title, {
			id: `${id}-title`,
			position: "absolute",
			x: x - 230,
			y: y + 30,
			width: 460,
			align: "center",
			fontFamily: SANS,
			fontWeight: 800,
			fontSize: 32,
			fill: INK,
		}).animate(riseIn(at + 3, y + 30, 12, 10)),
		Layer.text(when, {
			id: `${id}-when`,
			position: "absolute",
			x: x - 230,
			y: y + 76,
			width: 460,
			align: "center",
			fontFamily: MONO,
			fontWeight: 700,
			fontSize: 26,
			letterSpacing: 1.5,
			fill: RED,
		}).animate(riseIn(at + 6, y + 76, 12, 10)),
	];
}

export function probeScene(t: SceneTiming): LayoutNode {
	const ntsb = lineIn(t, "ntsb");
	const report = lineIn(t, "report");
	const leadAt = wordIn(t, "ntsb", "national").start;
	const weatherAt = wordIn(t, "ntsb", "weather").start;
	const focusAt = wordIn(t, "ntsb", "focus").start;
	const signsAt = wordIn(t, "breakup", "signs").start;
	const apartAt = wordIn(t, "breakup", "apart").start;
	const prelimAt = wordIn(t, "report", "preliminary").start;
	const finalAt = wordIn(t, "report", "final").start;

	const lead = note("probe-lead", "LEAD: NTSB   ·   SUPPORT: FAA", 150, leadAt);
	const weather = note(
		"probe-weather",
		"WEATHER IS A MAJOR FOCUS",
		240,
		weatherAt,
	);
	const breakup = note(
		"probe-breakup",
		"SIGNS OF A POSSIBLE IN-FLIGHT BREAKUP",
		330,
		signsAt,
	);
	const marks = [
		Annotate({
			...kit,
			id: "probe-weather-mark",
			target: { text: weather, match: "MAJOR FOCUS" },
			mark: "highlight",
			at: focusAt - 4,
			drawDuration: 12,
			padding: 4,
			seed: 41,
		}),
		Annotate({
			...kit,
			id: "probe-breakup-mark",
			target: { text: breakup, match: "IN-FLIGHT BREAKUP" },
			mark: "circle",
			color: RED,
			texture: "marker",
			width: 4,
			at: apartAt - 4,
			drawDuration: 16,
			padding: 10,
			seed: 42,
		}),
	];
	const lineY = 560;
	const fromX = 330;
	const toX = 990;
	const next = [
		note("probe-next", "WHAT COMES NEXT", 450, report.start - 8, {
			size: 24,
			color: INK_SOFT,
		}),
		Layer.shape("path", {
			id: "probe-timeline",
			position: "absolute",
			x: 0,
			y: 0,
			width: NOTES.width,
			height: NOTES.height,
			d: `M${fromX} ${lineY} L${toX} ${lineY}`,
			fillType: "none",
			fill: "transparent",
			strokeColor: INK,
			strokeWidth: 4,
			strokeDashArray: "4 10",
			strokeLineCap: "round",
			trimEnd: 0,
		}).animate(
			LayerAnimation.keys("trimEnd", [
				[prelimAt + 8, 0],
				[finalAt, 1, "power2.inOut"],
			]),
		),
		...milestone(
			"probe-prelim",
			fromX,
			lineY,
			"PRELIMINARY REPORT",
			"WITHIN WEEKS",
			prelimAt,
		),
		...milestone(
			"probe-final",
			toX,
			lineY,
			"FINAL CAUSE",
			"A YEAR OR MORE",
			finalAt,
		),
	];
	const notes = sheet({
		id: "probe-notes",
		...NOTES,
		rotation: 0.8,
		color: CARD,
		lift: 1.1,
		children: [
			Layer.text("CASE NOTES", {
				id: "probe-heading",
				position: "absolute",
				x: ROW_X,
				y: 40,
				fontFamily: DISPLAY,
				fontSize: 64,
				fill: INK,
			}),
			Layer.text("LEARJET 60 · PALM BEACH COUNTY, FLA. · NOV. 1, 2026", {
				id: "probe-subject",
				position: "absolute",
				x: ROW_X + 330,
				y: 66,
				fontFamily: MONO,
				fontWeight: 600,
				fontSize: 22,
				letterSpacing: 1,
				fill: INK_FAINT,
			}),
			...marks,
			lead,
			weather,
			breakup,
			...next,
		],
	}).animate(
		layDown(Math.max(0, ntsb.start - 18), { y: NOTES.y, rotation: 0.8 }),
	);
	const folder = Layer.box({
		id: "probe-folder",
		position: "absolute",
		...FOLDER,
		children: [
			Layer.shape("rect", {
				id: "probe-folder-tab",
				position: "absolute",
				x: 40,
				y: -56,
				width: 460,
				height: 80,
				radiusTL: 14,
				radiusTR: 14,
				fill: MANILA,
			}),
			Layer.text("NTSB INVESTIGATION", {
				id: "probe-folder-label",
				position: "absolute",
				x: 70,
				y: -40,
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: 26,
				letterSpacing: 3,
				fill: INK_SOFT,
			}),
			sheet({
				id: "probe-folder-body",
				x: 0,
				y: 0,
				width: FOLDER.width,
				height: FOLDER.height,
				color: MANILA,
				lift: 1.4,
				clip: false,
			}),
			notes,
			tape({
				id: "probe-tape",
				x: NOTES.x + NOTES.width - 40,
				y: NOTES.y + 4,
				rotation: 32,
				seed: 19,
			}),
		],
	});
	const undetermined = stamp({
		id: "probe-stamp",
		text: "CAUSE NOT YET DETERMINED",
		x: 1120,
		y: 900,
		rotation: -5,
		fontSize: 38,
	}).animate(stampIn(report.end - 8));
	return sceneRoot(t, { stage: [folder, undetermined], push: 1.035 });
}
