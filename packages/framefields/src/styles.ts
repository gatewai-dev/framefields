/**
 * Ready-made looks: each preset is a short stack of effects, applied with
 * `layer.withEffects(Styles.vhs())`. Presets take a few options for the
 * knobs that matter most; for anything finer, build the stack from the
 * effect classes directly.
 */
import type { Effect } from "@framefields/core";
import {
	Ascii,
	Contour,
	CRT,
	Dither,
	FilmGrain,
	GradientMap,
	HalftoneScreen,
	Iridescence,
	Kaleidoscope,
	OpArt,
	Painterly,
	Pixelate,
	Posterize,
	RGBSplit,
	Toon,
	Vignette,
} from "./effects/index.js";

type Look = Effect<object>[];
const look = (...effects: unknown[]): Look => effects as Look;

export const Styles = {
	/** 8-bit game: PICO-8 palette, chunky pixels, light dithering. */
	pixelArt: (
		o: { pixelSize?: number; palette?: "pico8" | "c64" | "cga" } = {},
	) =>
		look(
			new Posterize({
				palette: o.palette ?? "pico8",
				pixelSize: o.pixelSize ?? 6,
				dither: 0.4,
			}),
		),

	/** Original Game Boy: four greens, dithered, big pixels. */
	gameBoy: (o: { pixelSize?: number } = {}) =>
		look(
			new Posterize({
				palette: "gameboy",
				pixelSize: o.pixelSize ?? 4,
				dither: 0.6,
			}),
		),

	/** Teletext / Ceefax: eight flat colors in big blocks. */
	teletext: (o: { pixelSize?: number } = {}) =>
		look(new Posterize({ palette: "teletext", pixelSize: o.pixelSize ?? 10 })),

	/** LED wall: round lit pixels with gaps. */
	ledWall: (o: { size?: number } = {}) =>
		look(new Pixelate({ size: o.size ?? 14, shape: "circle", gap: 0.18 })),

	/** Text-mode art: the clip drawn in characters. `matrix` makes it green phosphor. */
	ascii: (o: { cellSize?: number; matrix?: boolean } = {}) =>
		look(
			new Ascii({
				cellSize: o.cellSize ?? 10,
				colorMode: o.matrix ? "green" : "source",
				bg: o.matrix ? "#020a04" : "#0b0b0b",
			}),
		),

	/** 1-bit print: ordered dither in two inks. */
	oneBit: (o: { dark?: string; light?: string; scale?: number } = {}) =>
		look(
			new Dither({
				mode: "bayer",
				scale: o.scale ?? 2,
				dark: o.dark ?? "#111111",
				light: o.light ?? "#f2efe6",
			}),
		),

	/** Riso print: two inks on paper, ordered dither, grain. */
	risograph: (o: { inkA?: string; inkB?: string; paper?: string } = {}) => {
		const a = o.inkA ?? "#1d3fbb";
		const b = o.inkB ?? "#ff5fa2";
		const paper = o.paper ?? "#f4efe4";
		return look(
			new GradientMap({
				stops: [
					{ position: 0, color: a },
					{ position: 0.55, color: b },
					{ position: 1, color: paper },
				],
			}),
			new Posterize({
				palette: "custom",
				colors: [a, b, paper],
				dither: 0.8,
				pixelSize: 2,
			}),
			new FilmGrain({ strength: 0.2 }),
		);
	},

	/** Cartoon / cel shading with ink outlines. */
	cartoon: (o: { levels?: number; ink?: string } = {}) =>
		look(
			new Toon({
				levels: o.levels ?? 4,
				edgeColor: o.ink ?? "#111111",
				saturation: 1.3,
			}),
		),

	/** Comic book: cel shading, ink lines and a halftone dot screen. */
	comic: (o: { dotFrequency?: number } = {}) =>
		look(
			new Toon({ levels: 4, edgeWidth: 1.5, saturation: 1.4 }),
			new HalftoneScreen({ frequency: o.dotFrequency ?? 70, opacity: 0.35 }),
		),

	/** Thermal camera: brightness mapped to the ironbow palette. */
	thermal: () =>
		look(
			new GradientMap({
				stops: [
					{ position: 0, color: "#000010" },
					{ position: 0.25, color: "#3b0a7a" },
					{ position: 0.5, color: "#c4205f" },
					{ position: 0.75, color: "#ff9a1f" },
					{ position: 1, color: "#fffbe0" },
				],
			}),
		),

	/** VHS tape: wobble, colour bleed, soft scanlines, grain. */
	vhs: (o: { tracking?: number } = {}) =>
		look(
			new CRT({
				tracking: o.tracking ?? 0.5,
				chroma: 4,
				curvature: 0.04,
				scanlines: 0.25,
				mask: 0.05,
				noise: 0.15,
			}),
			new RGBSplit({ amount: 3 }),
		),

	/** An old CRT monitor: curved glass, scanlines, RGB mask. */
	crt: (o: { curvature?: number } = {}) =>
		look(
			new CRT({ curvature: o.curvature ?? 0.15, scanlines: 0.5, mask: 0.35 }),
		),

	/** Glitch: hard RGB split plus tracking errors. Animate `amount` for hits. */
	glitch: (o: { amount?: number } = {}) =>
		look(
			new RGBSplit({ amount: o.amount ?? 18 }),
			new CRT({
				tracking: 1,
				chroma: 6,
				curvature: 0,
				scanlines: 0.1,
				mask: 0,
				vignette: 0,
			}),
		),

	/** Oil painting. */
	oilPainting: (o: { brush?: number } = {}) =>
		look(new Painterly({ style: "oil", radius: o.brush ?? 5 })),

	/** Watercolour: soft patches, pigment edges, paper. */
	watercolor: (o: { brush?: number } = {}) =>
		look(
			new Painterly({ style: "watercolor", radius: o.brush ?? 6, paper: 0.5 }),
		),

	/** Topographic map lines on paper. */
	topographic: (o: { levels?: number; ink?: string; paper?: string } = {}) =>
		look(
			new Contour({
				levels: o.levels ?? 16,
				fill: "flat",
				lineColor: o.ink ?? "#5a3a1a",
				fillColor: o.paper ?? "#f3ead8",
			}),
		),

	/** Kaleidoscope. Animate `rotation` on the returned effect, or pass a fixed angle. */
	kaleidoscope: (o: { segments?: number; rotation?: number } = {}) =>
		look(
			new Kaleidoscope({
				segments: o.segments ?? 8,
				rotation: o.rotation ?? 0,
			}),
		),

	/** Op art / line portrait: stripes bent by the image. */
	opArt: (
		o: {
			pattern?: "stripes" | "rings" | "checker" | "waves";
			frequency?: number;
		} = {},
	) =>
		look(
			new OpArt({
				pattern: o.pattern ?? "stripes",
				frequency: o.frequency ?? 60,
			}),
		),

	/** Holographic foil sheen. Animate `shift` to make it move. */
	holographic: (o: { strength?: number; shift?: number } = {}) =>
		look(new Iridescence({ strength: o.strength ?? 0.7, shift: o.shift ?? 0 })),

	/** Black-and-white film noir: crushed tones, grain, vignette. */
	noir: () =>
		look(
			new GradientMap({
				stops: [
					{ position: 0, color: "#000000" },
					{ position: 0.55, color: "#8a8a8a" },
					{ position: 1, color: "#ffffff" },
				],
			}),
			new FilmGrain({ strength: 0.35 }),
			new Vignette({ strength: 0.6 }),
		),

	/** Analog film: grain and a soft vignette. */
	film: () =>
		look(new FilmGrain({ strength: 0.25 }), new Vignette({ strength: 0.35 })),
};

export type StyleName = keyof typeof Styles;
