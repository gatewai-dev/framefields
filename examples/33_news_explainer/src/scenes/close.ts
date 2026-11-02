/**
 * The close: the question left open, word by word as it is asked, "SO FAR,
 * SO FAST" marked; then the sources the film reports from, how current it
 * is, and the nine people on board.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { Annotate } from "../components/annotate/index.js";
import { TextReveal } from "../components/text-reveal/index.js";
import { riseIn, sheet, strip } from "../paper.js";
import {
	CARD,
	DISPLAY,
	INK,
	INK_SOFT,
	MONO,
	RED,
	SANS,
	sec,
	W,
} from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { kit, sceneRoot } from "./shell.js";

const SOURCES =
	"FAA · NTSB · AP · Reuters · CBS News · ABC News · FOX Weather · Aviation Safety Network";

export function closeScene(t: SceneTiming): LayoutNode {
	const question = lineIn(t, "question");
	const askedAt = wordIn(t, "question", "how").start;
	const farAt = wordIn(t, "question", "far").start;
	const settle = question.end + sec(0.5);
	const kicker = strip({
		id: "close-kicker",
		x: 200,
		y: 150,
		width: 420,
		height: 74,
		color: RED,
		seed: 81,
		rotation: -2,
		children: [
			Layer.text("THE OPEN QUESTION", {
				id: "close-kicker-text",
				position: "absolute",
				x: 0,
				y: 18,
				width: 420,
				align: "center",
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: 28,
				letterSpacing: 3,
				fill: CARD,
			}),
		],
	}).animate(
		riseIn(wordIn(t, "question", "question").start - 4, 150, 12, 16),
		LayerAnimation.keys("opacity", [
			[settle, 1],
			[settle + 12, 0, "power2.in"],
		]),
	);
	const headline = TextReveal({
		...kit,
		id: "close-headline",
		text: "HOW COULD IT FALL\nSO FAR, SO FAST?",
		style: "rise",
		by: "word",
		stagger: 9,
		fontFamily: DISPLAY,
		fontSize: 172,
		lineHeight: 1.02,
		fill: INK,
		position: "absolute",
		x: 200,
		y: 260,
		at: askedAt,
	});
	const marked = Annotate({
		...kit,
		id: "close-mark",
		target: headline.rects("SO FAR, SO FAST?"),
		mark: "highlight",
		at: farAt - 2,
		drawDuration: 18,
		padding: 6,
		seed: 7,
	});
	const lifted = LayerAnimation.keys("y", [
		[settle, 0],
		[settle + sec(0.8), -150, "power3.inOut"],
	]);
	const statement = Layer.box({
		id: "close-statement",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: 700,
		children: [kicker, marked, headline],
	}).animate(lifted);
	const card = { x: 200, y: 700, width: 1520, height: 250 };
	const sources = sheet({
		id: "close-sources",
		...card,
		rotation: 0.6,
		color: CARD,
		lift: 1.3,
		children: [
			Layer.text("SOURCES", {
				id: "close-sources-title",
				position: "absolute",
				x: 48,
				y: 36,
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: 22,
				letterSpacing: 4,
				fill: INK_SOFT,
			}),
			Layer.text(SOURCES, {
				id: "close-sources-list",
				position: "absolute",
				x: 48,
				y: 74,
				width: card.width - 96,
				fontFamily: SANS,
				fontWeight: 700,
				fontSize: 32,
				fill: INK,
			}),
			Layer.text(
				"Reporting as of Nov. 2, 2026. The cause has not been determined; early details may change.",
				{
					id: "close-sources-asof",
					position: "absolute",
					x: 48,
					y: 132,
					width: card.width - 96,
					fontFamily: SANS,
					fontWeight: 500,
					fontSize: 26,
					fill: INK_SOFT,
				},
			),
			Layer.text("In memory of the nine people on board.", {
				id: "close-memory",
				position: "absolute",
				x: 48,
				y: 182,
				fontFamily: SANS,
				fontWeight: 700,
				fontSize: 26,
				fill: RED,
			}),
		],
	}).animate(riseIn(settle + sec(0.3), card.y, sec(0.9), 60));
	return sceneRoot(t, { stage: [statement, sources], push: 1.03 });
}
