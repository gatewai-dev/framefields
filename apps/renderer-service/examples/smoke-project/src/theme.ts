import { fileURLToPath } from "node:url";
import { Composition, FontManager, Layer } from "framefields";

export const W = 1280;
export const H = 720;
export const FPS = 30;
export const CX = W / 2;
export const CY = H / 2;

export const INK = "#0b0d14";
export const PAPER = "#f4f1ea";
export const EMBER = "#ff5a1f";
export const INDIGO = "#6366f1";
export const MUTED = "#94a3b8";

/** Absolute path of a file in assets/, independent of the working directory. */
export const asset = (name: string) =>
	fileURLToPath(new URL(`../assets/${name}`, import.meta.url));

const FONTS = [
	{ family: "Inter", file: "fonts/Inter.ttf" },
	{ family: "Syne", file: "fonts/Syne.ttf" },
	{ family: "JetBrainsMono", file: "fonts/JetBrainsMono.ttf" },
];

let registered: Promise<void> | undefined;

/** Headless rendering has no system fonts: every family is registered. */
export function registerFonts(): Promise<void> {
	registered ??= Promise.all(
		FONTS.map((f) =>
			FontManager.register({ family: f.family, source: asset(f.file) }),
		),
	).then(() => undefined);
	return registered;
}

/** A composition with the project's size, frame rate and fonts. */
export async function composition(
	durationFrames: number,
	backgroundColor = INK,
): Promise<Composition> {
	await registerFonts();
	return new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames,
		backgroundColor,
		fonts: FONTS.map((f) => asset(f.file)),
	});
}

/** A small label in the corner naming what the scene exercises. */
export function label(text: string) {
	return Layer.text(text, {
		position: "absolute",
		x: 32,
		y: H - 56,
		fontFamily: "JetBrainsMono",
		fontSize: 18,
		fill: MUTED,
	});
}
