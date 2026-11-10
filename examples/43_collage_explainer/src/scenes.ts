/**
 * One scene per line of narration, in the Explainer's beats. Every scene is
 * the look's collage: paper landing on paper, photos pushing in, the
 * highlighter and the rust pen arriving on the words that need them.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { still } from "./assets.js";
import { INK, MONO, PAPER, RUST } from "./direction.js";
import {
	box,
	clipping,
	footnote,
	ground,
	label,
	photoCard,
	push,
} from "./paper.js";
import { cue, type SceneTiming } from "./timeline.js";

/**
 * Question: the headline of the day, already landed on the first frame (a
 * still that works on its own), the key words highlighted as they're said.
 */
function question(t: SceneTiming): LayoutNode {
	return ground("question", [
		box("q-set", 0, 0, 1920, 1080, {
			children: [
				label({
					id: "q-year",
					text: "1931",
					x: 260,
					y: 170,
					size: 64,
					at: cue(t, "1931"),
				}),
				clipping({
					id: "q-clip",
					x: 420,
					y: 300,
					w: 1100,
					kicker: "THE DAILY RECORD · MAY 1931",
					lines: ["A river in", "the wrong place"],
					size: 96,
					rotation: -1.5,
					at: -1,
					highlight: {
						line: 1,
						from: "the wrong place",
						at: cue(t, "wrong") - 4,
					},
				}),
			],
		}).animate(push(t.duration)),
	]);
}

/** Context: the floods, as the town saw them. */
function context(t: SceneTiming): LayoutNode {
	return ground("context", [
		box("c-set", 0, 0, 1920, 1080, {
			children: [
				photoCard({
					id: "c-photo",
					src: still("flood"),
					x: 150,
					y: 140,
					w: 960,
					h: 720,
					rotation: -2,
					at: 0,
					frames: t.duration,
				}),
				label({
					id: "c-place",
					text: "THE LOWLANDS",
					x: 1210,
					y: 300,
					size: 26,
					mono: true,
					at: cue(t, "lowlands"),
					rotation: 1.5,
				}),
				label({
					id: "c-floods",
					text: "Flooded every spring",
					x: 1170,
					y: 620,
					size: 48,
					at: cue(t, "flooded") - 2,
					rotation: 2,
				}),
			],
		}).animate(push(t.duration)),
	]);
}

/** The map card's old river: a loop through the lowlands, in card coordinates. */
const OLD_RIVER =
	"M0 560 C 180 560 240 760 470 730 S 760 390 920 610 S 1180 790 1320 600";
/** The new course, straight through the middle of the city. */
const NEW_COURSE = "M0 420 L1320 420";

/** Steps, 1: the engineer's plan, drawn on the map as it's described. */
function plan(t: SceneTiming): LayoutNode {
	const blocks: LayoutNode[] = [];
	for (let row = 0; row < 4; row++)
		for (let col = 0; col < 9; col++) {
			const x = 330 + col * 76 + (row % 2) * 20;
			const y = 290 + row * 66;
			blocks.push(
				box(`p-block-${row}-${col}`, x, y, 56, 44, { background: "#d6ccb6" }),
			);
		}
	const drawn = (
		id: string,
		d: string,
		color: string,
		width: number,
		from: number,
		frames: number,
		dash?: string,
	) =>
		Layer.shape("path", {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: 1320,
			height: 800,
			d,
			fillType: "none",
			strokeColor: color,
			strokeWidth: width,
			strokeDashArray: dash,
			trimEnd: 0,
		}).animate(
			LayerAnimation.create().keys("trimEnd", [
				[from, 0],
				[from + frames, 1, "power2.inOut"],
			]),
		);
	const map = box("p-map", 300, 140, 1320, 800, {
		background: PAPER,
		rotation: -1,
		overflow: "hidden",
		children: [
			Layer.text("CITY ENGINEER'S PLAN · 1931", {
				id: "p-kicker",
				position: "absolute",
				x: 40,
				y: 32,
				fontFamily: MONO,
				fontSize: 22,
				letterSpacing: 2,
				fill: "#7a7264",
			}),
			...blocks,
			drawn("p-old", OLD_RIVER, INK, 14, 4, 26),
			drawn("p-new", NEW_COURSE, RUST, 26, cue(t, "straight") - 4, 20),
			Layer.text("old course", {
				id: "p-old-label",
				position: "absolute",
				x: 470,
				y: 750,
				fontFamily: MONO,
				fontSize: 24,
				fill: INK,
			}),
			Layer.text("new course", {
				id: "p-new-label",
				position: "absolute",
				x: 1080,
				y: 360,
				fontFamily: MONO,
				fontSize: 26,
				fill: RUST,
				opacity: 0,
			}).animate(
				LayerAnimation.create().keys("opacity", [
					[cue(t, "course"), 0],
					[cue(t, "course") + 8, 1],
				]),
			),
		],
	}).animate(
		LayerAnimation.create()
			.keys("y", [
				[0, 210],
				[16, 140, "power3.out"],
			])
			.keys("opacity", [
				[0, 0],
				[4, 1],
			]),
	);
	return ground("plan", [
		box("p-set", 0, 0, 1920, 1080, { children: [map] }).animate(
			push(t.duration, 1.04),
		),
	]);
}

/** Steps, 2: the dig, its numbers pinned beside it. */
function dig(t: SceneTiming): LayoutNode {
	const shovels = cue(t, "shovels");
	return ground("dig", [
		box("d-set", 0, 0, 1920, 1080, {
			children: [
				photoCard({
					id: "d-photo",
					src: still("dig"),
					x: 560,
					y: 130,
					w: 1000,
					h: 750,
					rotation: 1.5,
					at: 0,
					frames: t.duration,
				}),
				label({
					id: "d-workers",
					text: "3,000 workers",
					x: 130,
					y: 300,
					size: 64,
					at: cue(t, "thousand"),
				}),
				label({
					id: "d-years",
					text: "2 years",
					x: 200,
					y: 470,
					size: 64,
					at: cue(t, "years"),
					rotation: 1.5,
				}),
				Layer.shape("ellipse", {
					id: "d-circle",
					position: "absolute",
					x: 610,
					y: 700,
					width: 900,
					height: 200,
					fillType: "none",
					strokeColor: RUST,
					strokeWidth: 7,
					trimEnd: 0,
					rotation: -2,
				}).animate(
					LayerAnimation.create().keys("trimEnd", [
						[shovels - 2, 0],
						[shovels + 16, 1, "power2.out"],
					]),
				),
			],
		}).animate(push(t.duration)),
	]);
}

/** Payoff: the opening day, and the paper's headline. */
function payoff(t: SceneTiming): LayoutNode {
	return ground("payoff", [
		box("o-set", 0, 0, 1920, 1080, {
			children: [
				photoCard({
					id: "o-photo",
					src: still("opened"),
					x: 140,
					y: 120,
					w: 960,
					h: 720,
					rotation: -1.5,
					at: 0,
					frames: t.duration,
				}),
				clipping({
					id: "o-clip",
					x: 1050,
					y: 520,
					w: 760,
					kicker: "THE DAILY RECORD · APRIL 1934",
					lines: ["The floods", "have stopped"],
					size: 72,
					rotation: 2,
					at: cue(t, "1934"),
					highlight: { line: 1, from: "have stopped", at: cue(t, "floods") },
					body: 2,
				}),
			],
		}).animate(push(t.duration)),
	]);
}

/** Recap: the opening headline's answer, highlighted, and an honest footnote. */
function recap(t: SceneTiming): LayoutNode {
	const moved = cue(t, "moved");
	return ground("recap", [
		box("r-set", 0, 0, 1920, 1080, {
			children: [
				clipping({
					id: "r-clip",
					x: 380,
					y: 280,
					w: 1160,
					kicker: "THE DAILY RECORD · 1934",
					lines: ["The city that", "moved its river"],
					size: 104,
					rotation: -1,
					at: 2,
					highlight: { line: 1, from: "moved", to: "river", at: moved - 2 },
					circle: { line: 1, from: "river", at: moved + 14 },
				}),
				footnote("r-note", moved + 30),
			],
		}).animate(push(t.duration, 1.04)),
	]);
}

export const SCENES: Record<SceneTiming["id"], (t: SceneTiming) => LayoutNode> =
	{
		question,
		context,
		plan,
		dig,
		payoff,
		recap,
	};
