/**
 * "A hundred twenty frames a second, every pixel rendered true, watch it
 * move." Rendering speed, shown rather than claimed: three lanes render the
 * same clip, each bar filling left to right at its renderer's frames per
 * second and starting over when the clip is done, the clips counted at the
 * end. framefields laps the others; on "watch it move" the slow lanes drop out.
 */
import { Layer, LayerAnimation } from "framefields";
import { BEAT, bar } from "../grid.js";
import { kickPulse } from "../hits.js";
import { lineWords, sung } from "../lyrics.js";
import {
	ACCENT,
	DISPLAY,
	EASE_IN,
	EASE_OUT,
	FG,
	H,
	HAIRLINE,
	type Key,
	keys,
	label,
	MONO,
	MUTED,
	plane,
	SNAP,
	scene,
	sungLine,
	W,
} from "../theme.js";
import { CH } from "../timeline.js";
import { NOT_TO } from "./not.js";

const CX = W / 2;
const TRACK_X0 = 620;
const TRACK_X1 = 1620;
const PUCK = 44;
/** Film frames framefields takes to render the clip: two beats. The others take 120 / fps times as long. */
const HERO_CLIP = 2 * BEAT;

interface Lane {
	name: string;
	fps: number;
	y: number;
	hero: boolean;
}

const LANES: Lane[] = [
	{ name: "headless chromium", fps: 12, y: 610, hero: false },
	{ name: "canvas 2d", fps: 30, y: 770, hero: false },
	{ name: "framefields", fps: 120, y: 930, hero: true },
];

/**
 * Render progress, left to right only: the head runs across at the lane's
 * rendering speed and starts the next clip from the left when it gets there.
 * Returns the x keys of the head and the scene frames each clip finished.
 */
function progress(l: Lane, start: number, until: number) {
	const clip = (HERO_CLIP * 120) / l.fps;
	const span = TRACK_X1 - TRACK_X0;
	const x: Key[] = [[start, TRACK_X0]];
	const done: number[] = [];
	for (let f = start + clip; ; f += clip) {
		const end = Math.min(f, until);
		x.push([end, TRACK_X0 + (span * (end - (f - clip))) / clip, "none"]);
		if (f > until) break;
		done.push(f);
		x.push([f + 1, TRACK_X0, "hold"]);
	}
	return { x, done };
}

function lane(
	l: Lane,
	i: number,
	o: { inAt: number; start: number; stopAt: number; end: number },
) {
	const cy = l.y;
	const run = progress(l, o.start, l.hero ? o.end : o.stopAt);
	const colour = l.hero ? ACCENT : FG;
	const fade = keys("opacity", [
		[0, 0],
		[o.inAt, 0],
		[o.inAt + 4, 1, "none"],
		...(l.hero
			? []
			: ([
					[o.stopAt, 1],
					[o.stopAt + 8, 0, EASE_IN],
				] as Key[])),
	]);
	keys(
		"x",
		[
			[0, -160],
			[o.inAt, -160],
			[o.inAt + 12, 0, EASE_OUT],
		],
		fade,
	);
	if (!l.hero)
		keys(
			"y",
			[
				[o.stopAt, 0],
				[o.stopAt + 8, 60, EASE_IN],
			],
			fade,
		);
	// The bar fills behind the head: its width follows the head's x.
	const fill: Key[] = run.x.map(([f, x, e]) => [f, Number(x) - TRACK_X0, e]);
	return Layer.box({
		id: `speed-lane-${i}`,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		children: [
			Layer.text(l.hero ? l.name : l.name.toUpperCase(), {
				id: `speed-lane-${i}-name`,
				position: "absolute",
				x: 120,
				y: cy - 44,
				width: 440,
				fontFamily: MONO,
				fontSize: 24,
				fontWeight: 600,
				letterSpacing: 6,
				fill: l.hero ? ACCENT : MUTED,
			}),
			Layer.text(`${l.fps} FPS`, {
				id: `speed-lane-${i}-fps`,
				position: "absolute",
				x: 120,
				y: cy - 8,
				width: 440,
				fontFamily: DISPLAY,
				fontSize: 44,
				fontWeight: 900,
				fill: colour,
			}),
			Layer.shape("rect", {
				id: `speed-lane-${i}-track`,
				position: "absolute",
				x: TRACK_X0,
				y: cy - 4,
				width: TRACK_X1 - TRACK_X0,
				height: 8,
				borderRadius: 4,
				fillColor: HAIRLINE,
			}),
			Layer.shape("rect", {
				id: `speed-lane-${i}-fill`,
				position: "absolute",
				x: TRACK_X0,
				y: cy - 4,
				width: 0,
				height: 8,
				borderRadius: 4,
				fillColor: colour,
			}).animate(keys("width", fill)),
			Layer.shape("ellipse", {
				id: `speed-lane-${i}-head`,
				position: "absolute",
				x: TRACK_X0 - PUCK / 2,
				y: cy - PUCK / 2,
				width: PUCK,
				height: PUCK,
				fillColor: colour,
			}).animate(
				keys(
					"x",
					run.x.map(([f, x, e]) => [f, Number(x) - PUCK / 2, e]),
				),
			),
			// Clips rendered so far, counted at the end of the track.
			...run.done.map((at, k) =>
				Layer.text(`×${k + 1}`, {
					id: `speed-lane-${i}-done-${k}`,
					position: "absolute",
					x: TRACK_X1 + 50,
					y: cy - 30,
					width: 200,
					fontFamily: DISPLAY,
					fontSize: 48,
					fontWeight: 900,
					fill: colour,
					startFrame: at,
					durationFrames: (run.done[k + 1] ?? o.end + 1) - at,
				}).animate(
					keys("scale", [
						[0, 1.5],
						[8, 1, SNAP],
					]),
				),
			),
		],
	}).animate(fade);
}

/** The figure, counting with the voice: up to 100 on "a hundred", 120 on "twenty". */
function counter(a: number, hundred: number, twenty: number, outAt: number) {
	const steps: [number, string][] = [];
	for (let f = a; f < hundred; f += 2)
		steps.push([f, String(Math.round(((f - a) / (hundred - a)) * 100))]);
	steps.push([hundred, "100"], [twenty, "120"]);
	return steps.map(([at, text], i) => {
		const until = steps[i + 1]?.[0] ?? outAt + 8;
		const last = i === steps.length - 1;
		const anim = LayerAnimation.create();
		if (last)
			anim
				.fromTo("scale", 1.3, 1, { start: 0, end: 10, ease: SNAP })
				.fadeOut(outAt - at, outAt - at + 8, "power2.in")
				.fromTo("y", 70, -40, {
					start: outAt - at,
					end: outAt - at + 8,
					ease: EASE_IN,
				});
		return Layer.text(text, {
			id: `speed-count-${i}`,
			position: "absolute",
			x: 0,
			y: 70,
			width: W,
			height: 330,
			fontFamily: DISPLAY,
			fontWeight: 900,
			fontSize: 300,
			fill: last ? ACCENT : FG,
			align: "center",
			verticalAlign: "middle",
			anchorX: 0.5,
			anchorY: 0.5,
			startFrame: at,
			durationFrames: until - at,
		}).animate(anim);
	});
}

export function speedScene() {
	const from = NOT_TO;
	const to = bar(CH.tools);
	const local = (word: string, after = from) => sung(word, after).at - from;
	const a = local("a");
	const hundred = local("hundred");
	const twenty = local("twenty");
	const frames = sung("frames", from);
	const every = sung("every", frames.at);
	const watch = sung("watch", every.at);
	const runFrom = a + 4;

	return scene("speed", from, to, [
		...LANES.map((l, i) =>
			lane(l, i, {
				inAt: a + i * (BEAT / 4),
				start: runFrom,
				stopAt: watch.at - from,
				end: to - from,
			}),
		),
		...counter(a, hundred, twenty, every.at - from - 4),
		sungLine({
			id: "speed-unit",
			words: [frames, sung("a", frames.at), sung("second", frames.at)],
			from,
			y: 400,
			size: 46,
			font: MONO,
			weight: 600,
			color: FG,
			outAt: every.at - from - 4,
		}),
		// "every pixel rendered true": where the figure stood.
		sungLine({
			id: "speed-true",
			words: lineWords(every.line),
			from,
			y: 200,
			size: 130,
			color: FG,
			colors: [undefined, ACCENT],
			outAt: watch.at - from - 4,
		}),
		sungLine({
			id: "speed-watch",
			words: lineWords(watch.line),
			from,
			y: 200,
			size: 170,
			colors: [undefined, undefined, ACCENT],
		}),
		label({
			id: "speed-caption",
			text: "same clip  ·  frames rendered per second",
			x: CX - 700,
			width: 1400,
			y: 500,
			size: 20,
			inAt: runFrom + BEAT,
			outAt: watch.at - from - 4,
		}),
		// The kick lights the room: one reactive accent.
		plane("speed-pulse", ACCENT, "multiply").animate(
			LayerAnimation.create().signal("opacity", kickPulse(), {
				multiplier: 0.05,
				offset: 0,
			}),
		),
	]);
}
