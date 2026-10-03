/**
 * 19.8–26.4 s — The drop. The preview that just rendered is now the frame;
 * then a cut every half-bar, each one a different GPU effect, a 2×2 wall of
 * four passes over one clip, and two flash cuts into the title.
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
	Vignette,
} from "gitframes";
import { CODE_FROM, CODE_TO, DANCER_TRIM_SEC, EMBER_STOPS, HALFTONE, PREVIEW_CLIP_START } from "./code.js";
import { EASE_OUT, EMBER, FPS, H, INK, PAPER, SANS, W, asset, headline, keys, scene } from "../theme.js";

export const EFFECTS_FROM = CODE_TO;
export const EFFECTS_TO = 792;

type Clip = ReturnType<typeof Layer.video>;

/** The house grade from the Color chapter, as a reusable chain. */
const warm = (c: Clip): Clip =>
	c
		.apply(
			new Curves({
				master: [{ x: 0, y: 0.02 }, { x: 0.25, y: 0.18 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.82 }, { x: 1, y: 0.98 }],
				blue: [{ x: 0, y: 0 }, { x: 0.5, y: 0.47 }, { x: 1, y: 0.93 }],
			}),
		)
		.apply(new ColorBalance({ midtones: { cyanRed: 8, yellowBlue: -12 } }));
const FIRE_STOPS = [
	{ position: 0, color: INK },
	{ position: 0.45, color: "#7A2308" },
	{ position: 0.7, color: EMBER },
	{ position: 1, color: PAPER },
];

function clip(id: string, file: string, trimStartSec: number, frame: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: W, h: H }): Clip {
	return Layer.video(asset(file), {
		id,
		position: "absolute",
		x: frame.x,
		y: frame.y,
		width: frame.w,
		height: frame.h,
		fit: "cover",
		muted: true,
		trimStartSec,
	});
}

/** A shot owns [from, to) of the scene; the clip inside restarts at the shot's first frame. */
function shot(id: string, from: number, to: number, children: unknown[]) {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: INK,
		startFrame: from,
		durationFrames: to - from,
		children: children as never,
	});
}

/** Effect name chip (bottom-left by default): solid enough to read over any plate. */
function chip(id: string, name: string, from: number, to: number, at = { x: 96, y: H - 96 - 56 }) {
	const len = to - from;
	const anim = LayerAnimation.create()
		.fadeIn(0, 6, "power2.out")
		.fromTo("y", at.y + 14, at.y, { start: 0, end: 12, ease: EASE_OUT });
	if (len > 12) anim.fadeOut(len - 6, len, "power2.in");

	return Layer.flex({
		id,
		position: "absolute",
		x: at.x,
		y: at.y,
		height: 56,
		width: "fit",
		dir: "row",
		align: "center",
		gap: 16,
		padding: 24,
		background: "rgba(14,13,12,0.86)",
		borderColor: "rgba(238,233,224,0.22)",
		borderWidth: 1,
		borderRadius: 28,
		startFrame: from,
		durationFrames: len,
		children: [
			Layer.box({ id: `${id}-dot`, width: 8, height: 8, borderRadius: 4, background: EMBER }),
			Layer.text(name.toUpperCase(), { id: `${id}-t`, fontFamily: SANS, fontSize: 20, fontWeight: 500, letterSpacing: 4, fill: PAPER }),
		],
	}).animate(anim);
}

/** Scene-local ramp for effect params (effects are clocked in source frames). */
function decay(from: number, to: number, trimSec: number, frames: number) {
	const t0 = Math.round(trimSec * FPS);
	return Signal.builder({
		type: "custom",
		fn: (ctx) => {
			const p = Math.min(1, Math.max(0, (ctx.frame - t0) / frames));
			return to + (from - to) * (1 - p) ** 2;
		},
	});
}

export function effectsScene() {
	// Continue the code preview exactly where it was when it hit full frame.
	const dancerIn = DANCER_TRIM_SEC + (CODE_TO - CODE_FROM - PREVIEW_CLIP_START) / FPS;

	const A = shot("fx-a", 0, 56, [
		clip("fx-a-clip", "dancer.mp4", dancerIn).apply(new HalftoneScreen(HALFTONE)).apply(new GradientMap({ stops: EMBER_STOPS })),
		headline({ id: "fx-title", text: "Transform it.", x: 96, y: 96, width: 1200, size: 124, color: INK, inAt: 4, outAt: 38 }),
	]).animate(LayerAnimation.create().fadeOut(46, 54, "power2.inOut"));

	// Continuous smoke layer: blooms over the spinning dancer (46..54),
	// stands pure and voluminous for the gradient map showcase (54..81),
	// and floats as glowing atmospheric tendrils over the salt flat desert (81..97).
	const SMOKE_START = 46;
	const SMOKE_END = 97;
	const smokeDur = SMOKE_END - SMOKE_START;
	const smokeFadeIn = 8;
	const smokeFadeOutStart = 81 - SMOKE_START;

	const smokeAnim = LayerAnimation.create()
		.fromTo("opacity", 0, 1, { start: 0, end: smokeFadeIn, ease: "power2.inOut" })
		.fromTo("opacity", 1, 0, { start: smokeFadeOutStart, end: smokeDur, ease: "sine.out" })
		.fromTo("scale", 1.14, 0.98, { start: 0, end: smokeDur, ease: "sine.out" });

	const B = Layer.box({
		id: "fx-b",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "transparent",
		startFrame: SMOKE_START,
		durationFrames: smokeDur,
		blendMode: "screen",
		children: [
			clip("fx-b-clip", "ink.mp4", 3.1)
				.apply(new GradientMap({ stops: FIRE_STOPS })),
		],
	}).animate(smokeAnim);

	const C = shot("fx-c", 81, 108, [
		warm(
			clip("fx-c-clip", "frame.mp4", 1.2).apply(
				new Blur({ blurType: "Zoom", centerX: 0.5, centerY: 0.46, strength: decay(100, 0, 1.2, 26) as never }),
			),
		).animate(keys("scale", [[0, 1.18], [27, 1.0, EASE_OUT]])),
	]);

	// Engraved line screen: ink rules on paper, no process colours.
	const D = shot("fx-d", 108, 135, [
		clip("fx-d-clip", "portrait.mp4", 0.6).apply(
			new HalftoneScreen({ dotShape: "Line", frequency: 96, angle: 30, dotColor: INK, paperColor: PAPER, contrast: 1.25 }),
		),
	]);

	// Four passes over one clip, tiled; each cell drops in on an eighth note.
	const GAP = 12;
	const cw = (W - GAP * 3) / 2;
	const ch = (H - GAP * 3) / 2;
	const cells: { name: string; title: string; fx: (c: Clip) => Clip }[] = [
		{ name: "grade", title: "Graded", fx: (c) => warm(c).apply(new Vignette({ strength: 0.4 })) },
		{ name: "halftone", title: "Halftone", fx: (c) => c.apply(new HalftoneScreen(HALFTONE)) },
		{ name: "map", title: "Gradient map", fx: (c) => c.apply(new GradientMap({ stops: FIRE_STOPS })) },
		{
			name: "bleach",
			title: "Bleach bypass",
			fx: (c) =>
				c
					.apply(new GradientMap({ stops: [{ position: 0, color: INK }, { position: 1, color: PAPER }], opacity: 0.6 }))
					.apply(new Curves({ master: [{ x: 0, y: 0 }, { x: 0.3, y: 0.16 }, { x: 0.7, y: 0.86 }, { x: 1, y: 1 }] }))
					.apply(new FilmGrain({ strength: 45, size: 1.6 })),
		},
	];
	const E = shot(
		"fx-e",
		135,
		180,
		cells.map(({ name, title, fx }, i) => {
			const x = GAP + (i % 2) * (cw + GAP);
			const y = GAP + Math.floor(i / 2) * (ch + GAP);
			return Layer.box({
				id: `fx-e-cell-${name}`,
				position: "absolute",
				x,
				y,
				width: cw,
				height: ch,
				borderRadius: 10,
				children: [
					fx(clip(`fx-e-${name}`, "dancer.mp4", 1.0, { x: 0, y: 0, w: cw, h: ch })),
					chip(`fx-e-tag-${name}`, title, i * 4 + 6, 45, { x: 20, y: 20 }),
				],
			}).animate(
				LayerAnimation.create()
					.fadeIn(i * 4, i * 4 + 3)
					.fromTo("scale", 1.12, 1, { start: i * 4, end: i * 4 + 16, ease: EASE_OUT }),
			);
		}),
	);

	const F1 = shot("fx-f1", 180, 189, [warm(clip("fx-f1-clip", "ink.mp4", 5.2))]);
	const F2 = shot("fx-f2", 189, 198, [warm(clip("fx-f2-clip", "portrait.mp4", 4.5))]);

	return scene({
		id: "effects",
		from: EFFECTS_FROM,
		to: EFFECTS_TO,
		background: INK,
		children: [
			A,
			C,
			D,
			E,
			F1,
			F2,
			B,
			chip("fx-chip-a", "Halftone", 6, 52),
			chip("fx-chip-b", "Gradient map", 56, 81),
			chip("fx-chip-c", "Zoom blur  ·  Curves", 83, 108),
			chip("fx-chip-d", "Line screen", 110, 135),
		],
	});
}
