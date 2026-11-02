/**
 * The cold open. A dateline card lands on the desk; the headline rises word
 * by word as it is read, "SOUTH FLORIDA" is marked as it is said, and a scrap
 * of map pins Palm Beach County. On "nine", nine figures, one by one.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { Annotate } from "../components/annotate/index.js";
import { TextReveal } from "../components/text-reveal/index.js";
import { FLORIDA, PLACES, stateOutline } from "../geo.js";
import { layDown, pin, popIn, riseIn, sheet, strip, tape } from "../paper.js";
import {
	CARD,
	DISPLAY,
	HAND,
	INK,
	INK_SOFT,
	LAND_HOME,
	MONO,
	RED,
	SEA,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const CARD_BOX = { x: 150, y: 140, width: 1020, height: 760 } as const;
const SCRAP = { x: 1250, y: 150, width: 500, height: 640 } as const;

/** One of the nine aboard: a head and shoulders. */
function figure(id: string, x: number, y: number) {
	return Layer.box({
		id,
		position: "absolute",
		x,
		y,
		width: 44,
		height: 64,
		children: [
			Layer.shape("circle", {
				id: `${id}-head`,
				position: "absolute",
				x: 10,
				y: 0,
				width: 24,
				height: 24,
				fill: INK,
			}),
			Layer.shape("rect", {
				id: `${id}-body`,
				position: "absolute",
				x: 0,
				y: 28,
				width: 44,
				height: 36,
				radiusTL: 22,
				radiusTR: 22,
				radiusBL: 4,
				radiusBR: 4,
				fill: INK,
			}),
		],
	});
}

export function openScene(t: SceneTiming): LayoutNode {
	const fell = lineIn(t, "fell");
	const nine = wordIn(t, "nine", "nine");

	const dateline = Layer.text("SUNDAY, NOV. 1, 2026  ·  12:50 P.M. EST", {
		id: "open-dateline",
		position: "absolute",
		x: 64,
		y: 58,
		fontFamily: MONO,
		fontWeight: 600,
		fontSize: 26,
		letterSpacing: 2,
		fill: INK_SOFT,
	}).animate(riseIn(fell.start - 6, 58, 12, 12));
	const rule = Layer.shape("rect", {
		id: "open-rule",
		position: "absolute",
		x: 64,
		y: 108,
		width: 892,
		height: 4,
		fill: INK,
		anchorX: 0,
	}).animate(
		LayerAnimation.keys("scaleX", [
			[fell.start - 4, 0],
			[fell.start + 14, 1, "expo.out"],
		]),
	);
	const headline = TextReveal({
		...kit,
		id: "open-headline",
		text: "BUSINESS JET\nCRASHES IN\nSOUTH FLORIDA",
		style: "rise",
		by: "word",
		stagger: 7,
		fontFamily: DISPLAY,
		fontSize: 128,
		lineHeight: 1.02,
		fill: INK,
		position: "absolute",
		x: 64,
		y: 150,
		at: wordIn(t, "fell", "business").start,
	});
	const marked = Annotate({
		...kit,
		id: "open-mark",
		target: headline.rects("SOUTH FLORIDA"),
		mark: "highlight",
		at: wordIn(t, "fell", "south").start,
		drawDuration: 14,
		padding: 6,
		seed: 3,
	});
	const figures = Array.from({ length: 9 }, (_, i) =>
		figure(`open-figure-${i}`, 64 + i * 66, 590).animate(
			popIn(nine.start + i * 3, 10),
		),
	);
	const aboard = Layer.text("9 ON BOARD  ·  NO SURVIVORS", {
		id: "open-aboard",
		position: "absolute",
		x: 64,
		y: 682,
		fontFamily: MONO,
		fontWeight: 700,
		fontSize: 28,
		letterSpacing: 1.5,
		fill: RED,
	}).animate(riseIn(nine.start + 30, 682, 14, 10));

	const card = sheet({
		id: "open-card",
		...CARD_BOX,
		rotation: -1.8,
		color: CARD,
		lift: 1.4,
		children: [dateline, rule, marked, headline, ...figures, aboard],
	}).animate(
		layDown(Math.max(0, fell.start - 24), { y: CARD_BOX.y, rotation: -1.8 }),
	);

	const florida = stateOutline(FLORIDA, SCRAP.width, SCRAP.height, 50);
	const site = florida.project(PLACES.crash);
	const scrapIn = wordIn(t, "fell", "florida").start - 4;
	const pulse = Layer.shape("circle", {
		id: "open-pulse",
		position: "absolute",
		x: site[0] - 40,
		y: site[1] - 40,
		width: 80,
		height: 80,
		fill: "transparent",
		strokeColor: RED,
		strokeWidth: 4,
	}).animate(
		LayerAnimation.create()
			.keys("scale", [
				[scrapIn + 14, 0.2],
				[scrapIn + 44, 1.4, "power2.out"],
			])
			.keys("opacity", [
				[scrapIn + 14, 1],
				[scrapIn + 44, 0, "power2.in"],
			]),
	);
	const scrap = sheet({
		id: "open-scrap",
		...SCRAP,
		rotation: 3.5,
		color: SEA,
		children: [
			Layer.shape("path", {
				id: "open-florida",
				position: "absolute",
				x: 0,
				y: 0,
				width: SCRAP.width,
				height: SCRAP.height,
				d: florida.d,
				fill: LAND_HOME,
				strokeColor: INK,
				strokeWidth: 2.5,
				strokeLineJoin: "round",
			}),
			pulse,
			pin({ id: "open-site", at: site, color: RED, size: 26 }).animate(
				popIn(scrapIn + 12),
			),
			strip({
				id: "open-county",
				x: site[0] - 300,
				y: site[1] + 46,
				width: 270,
				height: 58,
				color: CARD,
				seed: 13,
				rotation: -4,
				children: [
					Layer.text("PALM BEACH COUNTY", {
						id: "open-county-text",
						position: "absolute",
						x: 0,
						y: 14,
						width: 270,
						align: "center",
						fontFamily: HAND,
						fontSize: 26,
						fill: INK,
					}),
				],
			}).animate(popIn(scrapIn + 20, 10)),
		],
	}).animate(layDown(scrapIn, { y: SCRAP.y, rotation: 3.5, from: -60 }));

	return sceneRoot(t, {
		stage: [
			card,
			scrap,
			tape({
				id: "open-tape",
				x: SCRAP.x + SCRAP.width / 2,
				y: SCRAP.y + 6,
				rotation: -4,
				seed: 9,
			}).animate(
				LayerAnimation.keys("opacity", [
					[scrapIn + 8, 0],
					[scrapIn + 12, 1],
				]),
			),
		],
	});
}
