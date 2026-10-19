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

// The framefields brand (framefields-social/packages/brand), light theme: ice and white
// grounds, navy type, the mark's signal blue and cobalt for emphasis, sky for glow. Night is
// kept for "screens": panels that need a dark ground for their effect.
export const NIGHT = "#081638";
export const NAVY = "#0B1E4D";
export const ROYAL = "#123A9C";
export const COBALT = "#1D4ED8";
export const SIGNAL = "#3B82F6";
export const SKY = "#7DD3FC";
export const ICE = "#F5F8FF";
export const FROST = "#E6EEFC";
export const LINE = "#D3DEF5";
export const WHITE = "#FFFFFF";
export const SLATE = "#5B6B91";

/** Page ground, body type, secondary type. */
export const BG = ICE;
export const FG = NAVY;
export const MUTED = SLATE;

// Accent names the scenes use, mapped onto the brand's blues.
export const EMBER = COBALT;
export const GOLD = "#60A5FA";
export const LIME = "#38BDF8";
export const CYAN = SKY;
export const VIOLET = ROYAL;
export const PINK = SIGNAL;
export const SPECTRUM = [COBALT, SIGNAL, GOLD, LIME, SKY, ROYAL];

/** Ink on light grounds, and white for type on night panels and footage. */
export const INK = NAVY;
export const PAPER = WHITE;

// Inter speaks, JetBrains Mono writes code.
export const DISPLAY = "Inter";
export const SANS = "Inter";
export const MONO = "JetBrainsMono";
export const ARABIC = "NotoSansArabic";
export const HEBREW = "NotoSansHebrew";

const FACES: Array<[string, string]> = [
	[SANS, "Inter.ttf"],
	[MONO, "JetBrainsMono.ttf"],
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
