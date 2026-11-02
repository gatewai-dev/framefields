/**
 * The title: a yellow strip torn off the roll, "WHAT WE KNOW" slammed onto
 * it as the question is asked, what it is about on a white strip below, and
 * a stamp dating what the film can know.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { TextReveal } from "../components/text-reveal/index.js";
import { stamp, stampIn, strip } from "../paper.js";
import { DISPLAY, INK, SANS, SHEET, W, YELLOW } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const BAND = { x: -60, y: 330, width: W + 120, height: 300 } as const;

export function titleScene(t: SceneTiming): LayoutNode {
	const know = lineIn(t, "know");
	const title = TextReveal({
		...kit,
		id: "title-text",
		text: "WHAT WE KNOW",
		style: "slam",
		by: "word",
		stagger: 5,
		fontFamily: DISPLAY,
		fontSize: 236,
		fill: INK,
		align: "center",
		position: "absolute",
		x: 60,
		y: 14,
		width: W,
		at: wordIn(t, "know", "what").start,
	});
	const band = strip({
		id: "title-band",
		...BAND,
		color: YELLOW,
		seed: 41,
		rotation: -2,
		children: [title],
	}).animate(
		LayerAnimation.create().keys("x", [
			[0, BAND.x - W],
			[know.start - 2, BAND.x, "expo.out"],
		]),
	);
	const subtitle = strip({
		id: "title-sub",
		x: 520,
		y: 660,
		width: 880,
		height: 96,
		color: SHEET,
		seed: 77,
		rotation: 1.2,
		children: [
			Layer.text("about the jet crash in Palm Beach County, Florida", {
				id: "title-sub-text",
				position: "absolute",
				x: 0,
				y: 26,
				width: 880,
				align: "center",
				fontFamily: SANS,
				fontWeight: 600,
				fontSize: 36,
				fill: INK,
			}),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[wordIn(t, "know", "happened").start - 6, 0],
				[wordIn(t, "know", "happened").start, 1],
			])
			.keys("y", [
				[wordIn(t, "know", "happened").start - 6, 700],
				[wordIn(t, "know", "happened").start + 10, 660, "expo.out"],
			]),
	);
	const asOf = stamp({
		id: "title-stamp",
		text: "AS OF NOV. 2, 2026",
		x: 1360,
		y: 210,
		rotation: 6,
		fontSize: 30,
	}).animate(stampIn(know.end - 4));
	return sceneRoot(t, { stage: [band, subtitle, asOf], push: 1.03 });
}
