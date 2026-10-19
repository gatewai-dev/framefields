/**
 * 05 — Stylize. Twelve tiles, twelve looks from `Styles.*`, each a short stack of the stylize
 * nodes (Posterize, Ascii, Pixelate, Toon, Halftone, CRT, Painterly, Contour, Kaleidoscope, OpArt,
 * GradientMap, Dither…) on stills and Lotties. On the third bar the dancer clip goes full frame and
 * changes look on every beat.
 */
import { Color, Layer, Signal, Styles } from "framefields";
import { full, hud, keys, type Node, popIn, scene } from "../kit.js";
import { DANCER, lottie, REPO } from "../paths.js";
import { BAR, BEAT, DISPLAY, H, INK, MONO, PAPER, W } from "../theme.js";
import { chapter } from "../timeline.js";

const PORTRAIT = `${REPO}/examples/19_framefields_film/assets/portrait.png`;
const DANCER_STILL = `${REPO}/examples/19_framefields_film/assets/dancer.png`;

type Source = {
	kind: "image" | "lottie";
	src: string;
	fit?: "cover" | "contain";
	bg?: string;
};
const img = (src: string): Source => ({ kind: "image", src });
const lot = (name: string, bg: string): Source => ({
	kind: "lottie",
	src: lottie(name),
	fit: "cover",
	bg,
});

export function stylizeScene(): Node {
	const c = chapter("stylize");
	const spin = Signal.programmatic((ctx) => (ctx.frame - c.start) * 1.5);
	const TILES: Array<{ label: string; look: unknown[]; source: Source }> = [
		{
			label: "pixelArt",
			look: Styles.pixelArt({ pixelSize: 6 }),
			source: img(DANCER_STILL),
		},
		{
			label: "ascii · matrix",
			look: Styles.ascii({ cellSize: 9, matrix: true }),
			source: img(PORTRAIT),
		},
		{
			label: "ledWall",
			look: Styles.ledWall({ size: 12 }),
			source: lot("dogCar", "#4FC3C9"),
		},
		{
			label: "comic",
			look: Styles.comic({ dotFrequency: 70 }),
			source: img(PORTRAIT),
		},
		{
			label: "vhs",
			look: Styles.vhs({ tracking: 0.6 }),
			source: img(DANCER_STILL),
		},
		{
			label: "oilPainting",
			look: Styles.oilPainting({ brush: 6 }),
			source: img(PORTRAIT),
		},
		{
			label: "watercolor",
			look: Styles.watercolor({ brush: 6 }),
			source: img(DANCER_STILL),
		},
		{
			label: "topographic",
			look: Styles.topographic({ levels: 14 }),
			source: img(PORTRAIT),
		},
		{
			label: "kaleidoscope",
			look: Styles.kaleidoscope({ segments: 8, rotation: spin as never }),
			source: lot("gradientShapes", INK),
		},
		{
			label: "opArt",
			look: Styles.opArt({ pattern: "stripes", frequency: 70 }),
			source: img(PORTRAIT),
		},
		{ label: "thermal", look: Styles.thermal(), source: img(DANCER_STILL) },
		{ label: "risograph", look: Styles.risograph(), source: img(PORTRAIT) },
	];

	const COLS = 4;
	const TW = 420;
	const TH = 236;
	const GAP = 22;
	const X0 = (W - (COLS * TW + (COLS - 1) * GAP)) / 2;
	const Y0 = 176;
	const tiles = TILES.map((t, i) => {
		const x = X0 + (i % COLS) * (TW + GAP);
		const y = Y0 + Math.floor(i / COLS) * (TH + GAP);
		const at = 4 + i * 6;
		const media =
			t.source.kind === "image"
				? Layer.image(t.source.src, {
						id: `stylize-src-${i}`,
						position: "absolute",
						x: 0,
						y: 0,
						width: TW,
						height: TH,
						fit: "cover",
					})
				: Layer.lottie(t.source.src, {
						id: `stylize-src-${i}`,
						position: "absolute",
						x: 0,
						y: 0,
						width: TW,
						height: TH,
						fit: "cover",
					});
		return Layer.box({
			id: `stylize-tile-${i}`,
			position: "absolute",
			x,
			y,
			width: TW,
			height: TH,
			borderRadius: 18,
			overflow: "hidden",
			background: t.source.bg ?? INK,
			children: [
				media.withEffects(t.look as never).animate(
					keys("scale", [
						[0, 1.12],
						[BAR * 2, 1, "sine.out"],
					]),
				),
				Layer.box({
					position: "absolute",
					x: 12,
					y: TH - 44,
					height: 32,
					padding: 8,
					borderRadius: 8,
					background: Color.alpha(INK, 0.72),
					children: [
						Layer.text(`Styles.${t.label}`, {
							fontFamily: MONO,
							fontSize: 15,
							fill: PAPER,
						}),
					],
				}),
			],
		}).animate(popIn(at, 16, 0.6));
	});

	// Full frame: the dancer clip, a new look on every beat.
	const LOOKS: Array<[string, unknown[]]> = [
		["GAME BOY", Styles.gameBoy({ pixelSize: 5 })],
		["CARTOON", Styles.cartoon({ levels: 4 })],
		["CRT", Styles.crt({ curvature: 0.18 })],
		[
			"HOLOGRAPHIC",
			Styles.holographic({
				strength: 0.85,
				shift: Signal.programmatic((ctx) => ctx.frame * 6) as never,
			}),
		],
		["1-BIT", Styles.oneBit({ scale: 3 })],
		["TELETEXT", Styles.teletext({ pixelSize: 12 })],
		["GLITCH", Styles.glitch({ amount: 22 })],
		["NOIR", Styles.noir()],
	];
	const fullStart = BAR * 2;
	const looks = LOOKS.map(([name, look], k) => {
		const at = fullStart + k * BEAT;
		return full({
			id: `stylize-full-${k}`,
			startFrame: at,
			durationFrames: k === LOOKS.length - 1 ? c.frames - at + 30 : BEAT,
			children: [
				Layer.video(DANCER, {
					id: `stylize-video-${k}`,
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					fit: "cover",
					muted: true,
					trimStartSec: 0.4 + (k * BEAT) / 30,
				}).withEffects(look as never),
				Layer.text(name, {
					id: `stylize-full-label-${k}`,
					position: "absolute",
					x: 0,
					y: H - 330,
					width: W,
					align: "center",
					fontFamily: DISPLAY,
					fontWeight: 800,
					fontSize: 150,
					letterSpacing: -3,
					fill: PAPER,
					blendMode: "difference",
				}).animate(
					keys("scale", [
						[0, 1.25],
						[8, 1, "expo.out"],
					]),
				),
			],
		});
	});

	return scene("stylize", INK, [
		Layer.text("One source. Every look.", {
			id: "stylize-title",
			position: "absolute",
			x: X0,
			y: 82,
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 70,
			letterSpacing: -2,
			fill: PAPER,
		}).animate(
			keys("opacity", [
				[0, 0],
				[8, 1],
			]),
			keys("x", [
				[0, X0 - 50],
				[22, X0, "expo.out"],
			]),
		),
		...tiles,
		...looks,
		// A white flash on the cut to full frame.
		full({ id: "stylize-flash", background: "#ffffff", opacity: 0 }).animate(
			keys("opacity", [
				[fullStart - 1, 0],
				[fullStart, 0.85],
				[fullStart + 8, 0, "power2.out"],
			]),
		),
		hud("stylize", [
			"layer.withEffects(Styles.*)",
			"Posterize · Ascii · Pixelate · Toon · CRT · Painterly · Contour · OpArt · Iridescence",
		]),
	]);
}
