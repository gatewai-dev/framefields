/**
 * "Frame by frame, shader by shader, grade it, grain it, glitch it, make it
 * louder, frame by frame, faster and faster!" The composite the last chapter
 * built (backdrop, keyed camera, light leak, paper), precomposed (precomp.ts),
 * is the footage; each verb is the effect it names, cut on the syllable.
 * "faster and faster" ends it on three strips of it accelerating to a blur.
 */
import {
	Blur,
	ColorBalance,
	Curves,
	FilmGrain,
	GradientMap,
	HalftoneScreen,
	Layer,
	LayerAnimation,
	Signal,
	TileOffset,
} from "gitframes";
import { BEAT, bar, FPS } from "../grid.js";
import { bare, lineWords, type SungWord, sung } from "../lyrics.js";
import { asset } from "../paths.js";
import {
	ACCENT,
	ACCENT_DEEP,
	BG,
	DISPLAY,
	EASE_OUT,
	FG,
	H,
	keys,
	MONO,
	SNAP,
	scene,
	sungLine,
	W,
	word,
} from "../theme.js";
import { CH } from "../timeline.js";
import { PLATE_FRAMES } from "./comp.js";

type Clip = ReturnType<typeof Layer.video>;
interface Frame {
	x: number;
	y: number;
	w: number;
	h: number;
}

const FULL: Frame = { x: 0, y: 0, w: W, h: H };

/** The plate is the composite (precomp.ts); a shot's in-point is a fraction of it. */
const PLATE_SEC = PLATE_FRAMES / FPS;
const into = (fraction: number) =>
	Number((fraction * (PLATE_SEC - 1.4)).toFixed(3));

function plate(id: string, trimSec: number, f: Frame = FULL): Clip {
	return Layer.video(asset("plate.mp4"), {
		id,
		position: "absolute",
		x: f.x,
		y: f.y,
		width: f.w,
		height: f.h,
		fit: "cover",
		muted: true,
		trimStartSec: trimSec,
	});
}

/** A shot owns [from, to) of the scene. */
function shot(id: string, from: number, to: number, children: unknown[]) {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: BG,
		startFrame: from,
		durationFrames: to - from,
		children: children as never,
	});
}

/** The effect's name, bottom left: the machine voice naming the pass. */
function chip(id: string, text: string, len: number) {
	return Layer.text(text.toUpperCase(), {
		id,
		position: "absolute",
		x: 96,
		y: H - 120,
		width: 900,
		fontFamily: MONO,
		fontSize: 22,
		fontWeight: 600,
		letterSpacing: 6,
		fill: FG,
		background: BG,
		padding: 14,
		borderRadius: 8,
	}).animate(
		LayerAnimation.create()
			.fadeIn(0, 4)
			.letterSpacing(14, 6, 0, 14, EASE_OUT)
			.fadeOut(len - 4, len, "power2.in"),
	);
}

/** A word over the footage, set on a paper band so it reads over any frame. */
function shout(
	id: string,
	text: string,
	at: number,
	until: number,
	color = FG,
) {
	return word({ id, text, at, outAt: until - 4, size: 170, color });
}

// ── The passes ───────────────────────────────────────────────────────────────

/** Cobalt grade: a hard S-curve and everything pushed toward blue. */
const grade = (c: Clip) =>
	c
		.apply(
			new Curves({
				master: [
					{ x: 0, y: 0 },
					{ x: 0.3, y: 0.12 },
					{ x: 0.72, y: 0.9 },
					{ x: 1, y: 1 },
				],
			}),
		)
		.apply(
			new ColorBalance({
				shadows: { cyanRed: -40, yellowBlue: 70 },
				midtones: { cyanRed: -30, yellowBlue: 55 },
				highlights: { yellowBlue: 20 },
				preserveLuminosity: false,
			}),
		)
		// A paper-white world barely shifts under color balance: tint it cobalt too.
		.apply(
			new GradientMap({
				stops: [
					{ position: 0, color: FG },
					{ position: 0.6, color: ACCENT_DEEP },
					{ position: 1, color: "#DCE2FF" },
				],
				opacity: 0.55,
			}),
		);

const grain = (c: Clip) =>
	c.apply(
		new FilmGrain({
			strength: 90,
			size: 2.6,
			monochrome: true,
			animated: true,
			highlights: 1,
			midtones: 1,
		}),
	);

/** A per-frame random step: the same value for `hold` frames, then a new one. */
const stepNoise = (hold: number, seed: number) => (frame: number) => {
	const n = Math.sin((Math.floor(frame / hold) + seed) * 12.9898) * 43758.5453;
	return n - Math.floor(n);
};

/** Glitch: the frame tears sideways and flashes inverted, in stepped bursts. */
function glitch(c: Clip) {
	const tearNoise = stepNoise(2, 3);
	const flashNoise = stepNoise(3, 11);
	const tear = Signal.builder({
		type: "custom",
		fn: (ctx) => {
			const r = tearNoise(ctx.frame);
			return r < 0.45 ? (r - 0.225) * 1800 : 0;
		},
	});
	const invert = Signal.builder({
		type: "custom",
		fn: (ctx) => (flashNoise(ctx.frame) < 0.22 ? 1 : 0),
	});
	return c
		.apply(
			new TileOffset({ offsetX: tear as never, offsetY: 0, edgeMode: "wrap" }),
		)
		.apply(
			new GradientMap({
				stops: [
					{ position: 0, color: BG },
					{ position: 0.6, color: ACCENT },
					{ position: 1, color: FG },
				],
				opacity: invert as never,
			}),
		);
}

/** Louder: a zoom blur that slams in and decays over the line (clocked in source frames). */
function louder(c: Clip, trimSec: number, frames: number) {
	const t0 = Math.round(trimSec * FPS);
	const strength = Signal.builder({
		type: "custom",
		fn: (ctx) =>
			90 * (1 - Math.min(1, Math.max(0, (ctx.frame - t0) / frames))) ** 2,
	});
	return c.apply(
		new Blur({
			blurType: "Zoom",
			centerX: 0.5,
			centerY: 0.5,
			strength: strength as never,
		}),
	);
}

const halftone = (c: Clip) =>
	c.apply(
		new HalftoneScreen({
			dotShape: "Circle",
			frequency: 22,
			angle: 30,
			dotColor: ACCENT,
			paperColor: BG,
			contrast: 1.8,
			invert: true,
		}),
	);
/** Paper maps to cobalt, ink stays ink: the footage recoloured end to end. */
const cobaltMap = (c: Clip) =>
	c.apply(
		new GradientMap({
			stops: [
				{ position: 0, color: FG },
				{ position: 0.55, color: ACCENT_DEEP },
				{ position: 0.93, color: ACCENT },
				{ position: 1, color: BG },
			],
		}),
	);

// ── The shots ────────────────────────────────────────────────────────────────

/** FRAME BY FRAME: the footage as a filmstrip racing past, one word per syllable. */
function filmstrip(words: SungWord[], from: number, to: number) {
	const tile = { w: 560, h: 315 };
	const gap = 36;
	const count = 7;
	const y = (H - tile.h) / 2;
	const len = to - from;
	const tiles = Array.from({ length: count }, (_, i) =>
		Layer.box({
			id: `vfx-strip-${i}`,
			position: "absolute",
			x: i * (tile.w + gap),
			y,
			width: tile.w,
			height: tile.h,
			borderRadius: 12,
			overflow: "hidden",
			children: [
				plate(`vfx-strip-plate-${i}`, into(i / 6), {
					x: 0,
					y: 0,
					w: tile.w,
					h: tile.h,
				}),
			],
		}),
	);
	const strip = Layer.box({
		id: "vfx-strip",
		position: "absolute",
		x: 0,
		y: 0,
		width: count * (tile.w + gap),
		height: H,
		children: tiles,
	}).animate(
		keys("x", [
			[0, 200],
			[len, -(count * (tile.w + gap) - W) - 200, "sine.inOut"],
		]),
	);
	return shot("vfx-a", 0, len, [
		strip,
		...words.map((w, i) =>
			shout(
				`vfx-a-word-${i}`,
				bare(w).toUpperCase(),
				w.at - from,
				i < words.length - 1 ? words[i + 1].at - from : len,
				i === 2 ? ACCENT : FG,
			),
		),
	]);
}

/** SHADER BY SHADER: one clip, two passes, split down a moving seam. */
function split(words: SungWord[], from: number, to: number, at: number) {
	const len = to - from;
	const half = { x: 0, y: 0, w: W / 2, h: H };
	return shot("vfx-b", at, at + len, [
		Layer.box({
			id: "vfx-b-left",
			position: "absolute",
			x: 0,
			y: 0,
			width: W / 2,
			height: H,
			overflow: "hidden",
			children: [
				halftone(plate("vfx-b-plate-l", into(0.15), { ...half, w: W })),
			],
		}),
		Layer.box({
			id: "vfx-b-right",
			position: "absolute",
			x: W / 2,
			y: 0,
			width: W / 2,
			height: H,
			overflow: "hidden",
			children: [
				cobaltMap(
					plate("vfx-b-plate-r", into(0.15), { x: -W / 2, y: 0, w: W, h: H }),
				),
			],
		}),
		Layer.shape("rect", {
			id: "vfx-b-seam",
			position: "absolute",
			x: W / 2 - 3,
			y: 0,
			width: 6,
			height: H,
			fillColor: BG,
		}).animate(
			keys("height", [
				[0, 0],
				[10, H, EASE_OUT],
			]),
		),
		chip("vfx-b-chip", "Halftone screen  ·  Gradient map", len),
		...words.map((w, i) =>
			shout(
				`vfx-b-word-${i}`,
				bare(w).toUpperCase(),
				w.at - to + len,
				i < words.length - 1 ? words[i + 1].at - to + len : len,
			),
		),
	]);
}

interface Pass {
	id: string;
	verb: SungWord;
	until: number;
	/** The sung words this pass shows, each from its own syllable. */
	words: SungWord[];
	chip: string;
	trim: number;
	fx: (c: Clip, trim: number, frames: number) => Clip;
}

function passShot(p: Pass, sceneFrom: number) {
	const at = p.verb.at - sceneFrom;
	const len = p.until - p.verb.at;
	// Never run past the plate's last frame.
	const trim = Math.max(0, Math.min(p.trim, PLATE_SEC - len / FPS - 0.05));
	return shot(p.id, at, at + len, [
		p.fx(plate(`${p.id}-plate`, trim), trim, len).animate(
			keys("scale", [
				[0, 1.14],
				[12, 1, EASE_OUT],
			]),
		),
		chip(`${p.id}-chip`, p.chip, len),
		sungLine({
			id: `${p.id}-words`,
			words: p.words,
			from: p.verb.at,
			until: len,
			y: (H - 210) / 2,
			size: 170,
			color: p.id === "vfx-loud" ? ACCENT : FG,
		}),
	]);
}

/** FRAME BY FRAME!: every pass at once, nine cells dropping in on sixteenths. */
function wall(words: SungWord[], sceneFrom: number, at: number, len: number) {
	const passes = [
		grade,
		grain,
		(c: Clip) => glitch(c),
		halftone,
		cobaltMap,
		grade,
		halftone,
		grain,
		cobaltMap,
	];
	const gap = 10;
	const cw = (W - gap * 4) / 3;
	const ch = (H - gap * 4) / 3;
	return shot("vfx-wall", at, at + len, [
		...passes.map((fx, i) => {
			const x = gap + (i % 3) * (cw + gap);
			const y = gap + Math.floor(i / 3) * (ch + gap);
			const drop = i * (BEAT / 4);
			return Layer.box({
				id: `vfx-wall-${i}`,
				position: "absolute",
				x,
				y,
				width: cw,
				height: ch,
				borderRadius: 10,
				overflow: "hidden",
				startFrame: drop,
				children: [
					fx(
						plate(`vfx-wall-plate-${i}`, into(i / 8), {
							x: 0,
							y: 0,
							w: cw,
							h: ch,
						}),
					),
				],
			}).animate(
				keys("scale", [
					[0, 1.3],
					[10, 1, SNAP],
				]),
			);
		}),
		...words.map((w, i) =>
			word({
				id: `vfx-wall-word-${i}`,
				text: bare(w).toUpperCase(),
				at: w.at - sceneFrom - at,
				size: 200,
				color: i === 2 ? ACCENT : FG,
				font: DISPLAY,
			}),
		),
	]);
}

/**
 * "faster and faster": two strips of graded footage running against each
 * other, accelerating to a blur, the words on the paper between them.
 */
function fasterShot(
	words: SungWord[],
	sceneFrom: number,
	at: number,
	len: number,
) {
	const tile = { w: 440, h: 248 };
	const gap = 24;
	const count = 7;
	const rowW = count * (tile.w + gap);
	const margin = 70;
	const passes = [grade, halftone];
	const rows = passes.map((fx, r) => {
		const dir = r % 2 ? 1 : -1;
		const start = dir < 0 ? 0 : W - rowW;
		return Layer.box({
			id: `vfx-faster-row-${r}`,
			position: "absolute",
			x: 0,
			y: r === 0 ? margin : H - margin - tile.h,
			width: rowW,
			height: tile.h,
			children: Array.from({ length: count }, (_, i) =>
				Layer.box({
					id: `vfx-faster-${r}-${i}`,
					position: "absolute",
					x: i * (tile.w + gap),
					y: 0,
					width: tile.w,
					height: tile.h,
					borderRadius: 10,
					overflow: "hidden",
					children: [
						fx(
							plate(`vfx-faster-plate-${r}-${i}`, into(((i * 3 + r) % 8) / 8), {
								x: 0,
								y: 0,
								w: tile.w,
								h: tile.h,
							}),
						),
					],
				}),
			),
		}).animate(
			keys("x", [
				[0, start],
				[len, start + dir * (rowW - W), "expo.in"],
			]),
		);
	});
	return shot("vfx-faster", at, at + len, [
		...rows,
		...words.map((w, i) =>
			shout(
				`vfx-faster-word-${i}`,
				bare(w).toUpperCase(),
				w.at - sceneFrom - at,
				i < words.length - 1 ? words[i + 1].at - sceneFrom - at : len + 4,
				i === 2 ? ACCENT : FG,
			),
		),
	]);
}

export function vfxScene() {
	const from = bar(CH.vfx);
	const to = bar(CH.outro);
	const frame1 = sung("frame", from - BEAT);
	const by1 = sung("by", frame1.at);
	const frame2 = sung("frame", by1.at);
	const shader = sung("shader", frame2.at);
	const shaderWords = [
		shader,
		sung("by", shader.at),
		sung("shader", shader.at + 1),
	];
	const gradeW = sung("grade", shader.at);
	const grainW = sung("grain", gradeW.at);
	const glitchW = sung("glitch", grainW.at);
	const make = sung("make", glitchW.at);
	const last = sung("frame", make.at);
	const lastWords = [last, sung("by", last.at), sung("frame", last.at + 1)];
	const faster = sung("faster", last.at);
	const fasterWords = lineWords(faster.line);

	const passes: Pass[] = [
		{
			id: "vfx-grade",
			verb: gradeW,
			until: grainW.at,
			words: [gradeW, sung("it", gradeW.at)],
			chip: "Curves  ·  Color balance",
			trim: into(0.55),
			fx: (c) => grade(c),
		},
		{
			id: "vfx-grain",
			verb: grainW,
			until: glitchW.at,
			words: [grainW, sung("it", grainW.at)],
			chip: "Film grain",
			trim: into(0.7),
			fx: (c) => grain(c),
		},
		{
			id: "vfx-glitch",
			verb: glitchW,
			until: make.at,
			words: [glitchW, sung("it", glitchW.at)],
			chip: "Tile offset  ·  Gradient map",
			trim: into(0.3),
			fx: (c) => glitch(c),
		},
		{
			id: "vfx-loud",
			verb: make,
			until: last.at,
			words: [make, sung("it", make.at), sung("louder", make.at)],
			chip: "Zoom blur",
			trim: into(0.9),
			fx: (c, t, n) => louder(c, t, n),
		},
	];
	return scene("vfx", from, to, [
		filmstrip([frame1, by1, frame2], from, shader.at),
		split(shaderWords, shader.at, gradeW.at, shader.at - from),
		...passes.map((p) => passShot(p, from)),
		wall(lastWords, from, last.at - from, faster.at - last.at),
		fasterShot(fasterWords, from, faster.at - from, to - faster.at),
	]);
}
