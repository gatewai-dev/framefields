/**
 * "No browser, no Chromium, no screenshots, just the GPU." The drop. Each
 * thing it is not appears as it is sung and is redacted by an accent bar a
 * beat later; on "just" the frame floods with the accent and the answer
 * lands word by word.
 */
import { Layer } from "framefields";
import { BEAT, bar } from "../grid.js";
import { bare, lineWords, type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	BG,
	EASE_IN,
	EASE_OUT,
	FG,
	flashes,
	H,
	keys,
	label,
	MUTED,
	plane,
	scene,
	W,
	word,
} from "../theme.js";
import { CH } from "../timeline.js";

const CY = H / 2;

/** The answer's first word ("just") ends this sequence; the next scene starts on "A". */
export const NOT_TO = Math.floor(sung("a", sung("gpu").at).at / BEAT) * BEAT;

interface Denial {
	no: SungWord;
	thing: SungWord;
	until: number;
}

function denials(): Denial[] {
	const things = ["browser", "chromium", "screenshots"].map((t) => sung(t));
	const answer = sung("just", things[2].at);
	return things.map((thing, i) => ({
		// The "no" that precedes the thing; the transcript may merge it into the thing's onset.
		no:
			lineWords(thing.line)
				.filter((w) => w.at <= thing.at && bare(w).toLowerCase() === "no")
				.pop() ?? thing,
		thing,
		until: i < 2 ? things[i + 1].at - 4 : answer.at,
	}));
}

function denial(d: Denial, i: number, from: number) {
	const at = Math.min(d.no.at, d.thing.at) - from;
	const until = d.until - from;
	// The bar lands a beat after the word, but never so late that its 8-frame
	// sweep would run past the clip (the last word is followed quickly).
	const strikeAt = Math.min(d.thing.at - from + BEAT, until - 9);
	const step = until - at;
	return [
		word({
			id: `not-no-${i}`,
			text: "NO",
			at,
			outAt: until - 6,
			y: CY - 230,
			size: 90,
			weight: 300,
			color: MUTED,
		}),
		word({
			id: `not-word-${i}`,
			text: bare(d.thing).toUpperCase(),
			at: d.thing.at - from,
			outAt: until - 4,
			size: 150,
		}),
		// The redaction: an accent bar sweeps through the word, then wipes off as the next one comes.
		Layer.shape("path", {
			id: `not-strike-${i}`,
			position: "absolute",
			x: 0,
			y: CY - 2,
			width: W,
			height: 40,
			d: `M 120 20 L ${W - 120} 20`,
			fillType: "none",
			strokeColor: ACCENT,
			strokeWidth: 30,
			strokeLineCap: "butt",
			startFrame: at,
			durationFrames: step,
		} as never).animate(
			keys(
				"trimEnd",
				[
					[0, 0],
					[strikeAt - at, 0],
					[strikeAt - at + 8, 1, EASE_OUT],
				],
				keys("trimStart", [
					[0, 0],
					[step - 10, 0],
					[step - 2, 1, EASE_IN],
				]),
			),
		),
	];
}

export function notScene() {
	const from = bar(CH.not);
	const to = NOT_TO;
	const list = denials();
	const just = sung("just", list[2].thing.at);
	const answer = [just, sung("the", just.at), sung("gpu", just.at)];
	const floodAt = just.at - from;
	const column = W / answer.length;
	return scene("not", from, to, [
		...list.flatMap((d, i) => denial(d, i, from)),
		plane("not-flood", ACCENT).animate(
			keys("opacity", [
				[0, 0],
				[floodAt - 1, 0],
				[floodAt, 1, "none"],
			]),
		),
		...answer.map((w, i) =>
			word({
				id: `not-answer-${i}`,
				text: bare(w).toUpperCase(),
				at: w.at - from,
				size: 150,
				color: BG,
				x: i * column,
				width: column,
			}),
		),
		label({
			id: "not-answer-sub",
			text: "Dawn  ·  Metal  ·  Vulkan  ·  D3D12",
			y: CY + 130,
			inAt: answer[2].at - from + 8,
			color: BG,
			size: 24,
			until: to - from,
		}),
		plane("not-drop", FG, "difference").animate(
			flashes([{ at: 0, peak: 1 }], 8),
		),
	]);
}
