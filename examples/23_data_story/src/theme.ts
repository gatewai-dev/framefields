import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontManager } from "gitframes";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../../../assets/fonts");
export const OUTPUT = path.resolve(HERE, "../output");

export const W = 1920;
export const H = 1080;
export const FPS = 30;

/** The tempo the accents breathe to: one beat every 18 frames at 30 fps. */
export const BPM = 100;
export const BEAT = Math.round((FPS * 60) / BPM);

/** Light theme: a paper-white page, ink text, saturated data colours. */
export const BG = "#f7f8fb";
export const TEXT = "#0f172a";
export const MUTED = "#64748b";
/** Axis labels, legends. */
export const CHART_TEXT = "#475569";
export const GRID = "rgba(15, 23, 42, 0.08)";

export const ACCENT = "#6366f1";
/** Data colours for bars, slices and lines. */
export const CYAN = "#22d3ee";
export const AMBER = "#f59e0b";
export const PINK = "#ec4899";
export const GREEN = "#22c55e";
export const RED = "#ef4444";
/** The same hues, dark enough for text on the light page. */
export const CYAN_TEXT = "#0891b2";
export const GREEN_TEXT = "#15803d";

export const SANS = "Inter";
export const DISPLAY = "Syne";
export const MONO = "JetBrains Mono";

/** Every scene lays out on the same frame: header top-left, chart below. */
export const MARGIN = 120;
export const HEADER_Y = 92;
export const CHART_Y = 300;
export const CHART_H = H - CHART_Y - 90;

export const EASE_IN = "expo.out";
export const EASE_OUT = "power3.in";

export async function registerFonts(): Promise<void> {
	await FontManager.register({
		family: SANS,
		source: path.join(FONTS, "Inter.ttf"),
	});
	await FontManager.register({
		family: DISPLAY,
		source: path.join(FONTS, "Syne.ttf"),
	});
	await FontManager.register({
		family: MONO,
		source: path.join(FONTS, "JetBrainsMono.ttf"),
	});
}
