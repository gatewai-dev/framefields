import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontManager } from "framefields";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const FONTS = path.resolve(HERE, "../assets/fonts");
export const OUTPUT = path.resolve(HERE, "../output");
/** The dancer clip from example 19 (generated there by `pnpm assets`). */
export const DANCER = path.resolve(
	HERE,
	"../../19_framefields_film/assets/dancer.mp4",
);

export const W = 1920;
export const H = 1080;
export const FPS = 24;
/** The clip: 6.6 s at 24 fps. */
export const DURATION = 158;
/** The studio floor line in the clip, px. */
export const FLOOR = 1012;

export const INK = "#1E1512";
export const RUST = "#7A2E14";
export const EMBER = "#FF5A1F";
export const CREAM = "#FFF4E0";
export const GOLD = "#F2B33D";
export const VIOLET = "#5B3DF5";
export const HOT = "#FFE7B0";

export const FONT_FILE = path.join(FONTS, "Syne.ttf");

export async function registerFonts(): Promise<void> {
	if (!fs.existsSync(FONT_FILE)) {
		throw new Error(`Missing ${FONT_FILE}. Run \`pnpm fonts\` first.`);
	}
	await FontManager.register({ family: "Syne", source: FONT_FILE });
}
