import fs from "node:fs";
import path from "node:path";
import { FontManager } from "framefields";
import { FONTS } from "./paths.js";

export const W = 1920;
export const H = 1080;
export const FPS = 30;
/** 120 BPM at 30 fps: a beat is exactly 15 frames, a bar 60 (2 s). */
export const BPM = 120;
export const BEAT = 15;
export const BAR = BEAT * 4;
export const beats = (n: number) => Math.round(n * BEAT);
export const bars = (n: number) => Math.round(n * BAR);

// Palette: a near-black ink stage with an electric spectrum of accents.
export const INK = "#07060B";
export const NIGHT = "#0E0C18";
export const PLUM = "#1A1230";
export const PAPER = "#F4EFE6";
export const MUTED = "#9C96B0";
export const EMBER = "#FF5A1F";
export const GOLD = "#FFC93C";
export const LIME = "#B8FF3C";
export const CYAN = "#2EE6FF";
export const VIOLET = "#7A4DFF";
export const PINK = "#FF3D9A";
export const SPECTRUM = [EMBER, GOLD, LIME, CYAN, VIOLET, PINK];

export const DISPLAY = "Syne";
export const SANS = "Inter";
export const MONO = "JetBrainsMono";
export const SERIF = "InstrumentSerif";
export const ARABIC = "NotoSansArabic";
export const HEBREW = "NotoSansHebrew";

const FACES: Array<[string, string]> = [
	[DISPLAY, "Syne.ttf"],
	[SANS, "Inter.ttf"],
	[MONO, "JetBrainsMono.ttf"],
	[SERIF, "InstrumentSerif-Italic.ttf"],
	[ARABIC, "NotoSansArabic.ttf"],
	[HEBREW, "NotoSansHebrew.ttf"],
];

export const FONT_FILES = FACES.map(([, file]) => path.join(FONTS, file));
export const EMOJI_FONT = path.join(FONTS, "NotoColorEmoji.ttf");

export async function registerFonts(): Promise<void> {
	for (const [family, file] of FACES) {
		const source = path.join(FONTS, file);
		if (!fs.existsSync(source)) {
			throw new Error(`Missing ${source}. Run \`pnpm assets\` first.`);
		}
		await FontManager.register({ family, source });
	}
	await FontManager.registerEmojiFont(EMOJI_FONT);
}
