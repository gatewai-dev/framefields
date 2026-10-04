/**
 * 19.8–23.4 s — The drop. The preview that just rendered is now the frame,
 * ember smoke blooms out of it, then a 2×2 wall of four passes over one clip
 * lands an eighth note at a time. Six beats, then Vision takes the rest of the bar.
 */
import {
	ColorBalance,
	Curves,
	FilmGrain,
	GradientMap,
	HalftoneScreen,
	Layer,
	LayerAnimation,
	Vignette,
} from "gitframes";
import { CODE_FROM, CODE_TO, DANCER_TRIM_SEC, EMBER_STOPS, HALFTONE, PREVIEW_CLIP_START } from "./code.js";
import { EASE_OUT, EMBER, FPS, H, INK, PAPER, SANS, W, asset, beats, headline, scene } from "../theme.js";

export const EFFECTS_FROM = CODE_TO;
export const EFFECTS_TO = EFFECTS_FROM + beats(6);

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

export function effectsScene() {
	// Continue the code preview exactly where it was when it hit full frame.
	const dancerIn = DANCER_TRIM_SEC + (CODE_TO - CODE_FROM - PREVIEW_CLIP_START) / FPS;

	// One beat per idea: halftone (0..45), pure smoke (36..72), the wall (63..108).
	const A = shot("fx-a", 0, 45, [
		clip("fx-a-clip", "dancer.mp4", dancerIn).apply(new HalftoneScreen(HALFTONE)).apply(new GradientMap({ stops: EMBER_STOPS })),
		headline({ id: "fx-title", text: "Transform it.", x: 96, y: 96, width: 1200, size: 124, color: INK, inAt: 4, outAt: 28 }),
	]).animate(LayerAnimation.create().fadeOut(36, 44, "power2.inOut"));

	// Smoke blooms out of the fading dancer, stands alone for the gradient map,
	// then burns off as the wall drops in underneath it.
	const SMOKE_START = 36;
	const SMOKE_END = 72;
	const smokeDur = SMOKE_END - SMOKE_START;

	const smokeAnim = LayerAnimation.create()
		.fromTo("opacity", 0, 1, { start: 0, end: 8, ease: "power2.inOut" })
		.fromTo("opacity", 1, 0, { start: 27, end: smokeDur, ease: "sine.out" })
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
		63,
		108,
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

	return scene({
		id: "effects",
		from: EFFECTS_FROM,
		to: EFFECTS_TO,
		background: INK,
		children: [
			A,
			E,
			B,
			chip("fx-chip-a", "Halftone", 6, 40),
			chip("fx-chip-b", "Gradient map", 44, 66),
		],
	});
}
