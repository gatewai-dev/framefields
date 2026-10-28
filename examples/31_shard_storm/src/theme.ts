import path from "node:path";
import { fileURLToPath } from "node:url";
import { FontManager } from "framefields";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FONTS = path.resolve(HERE, "../../../assets/fonts");
export const OUTPUT = path.resolve(HERE, "../output");

export const W = 1920;
export const H = 1080;
export const FPS = 30;
export const DURATION = 210; // 7.0 seconds

/** Scene origin and floor geometry */
export const CX = W / 2;
export const CY = H / 2;
export const FLOOR_Y = 220;

/** Sci-fi dark void palette */
export const BG = "#07060b";
export const FLOOR_COLOR = "#07060b";
export const SHARD_BASE = "#383c4e";
export const SHARD_DARK = "#232634";

/** Kinetic heat ramp (deep magenta -> neon pink -> white-hot) */
export const HEAT_COLD = "#3b0022";
export const HEAT_WARM = "#ff0055";
export const HEAT_HOT = "#ff1177";
export const HEAT_INCANDESCENT = "#ffffff";

/** Interface & typography palette */
export const TEXT_MAIN = "#f2eff7";
export const TEXT_MUTED = "#888396";
export const ACCENT = "#ff2266";

export const FONT_DISPLAY = "Syne";
export const FONT_MONO = "JetBrains Mono";

export async function registerFonts(): Promise<void> {
	await FontManager.register({
		family: FONT_DISPLAY,
		source: path.join(FONTS, "Syne.ttf"),
	});
	await FontManager.register({
		family: FONT_MONO,
		source: path.join(FONTS, "JetBrainsMono.ttf"),
	});
}
