/**
 * Pinned SIL OFL fonts for the Gemini 4 Neon film (Archivo variable width,
 * Inter variable weight, JetBrains Mono variable weight).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { FontManager } from "framefields";
import { FONT_DISPLAY, FONT_MONO, FONT_SANS, FONTS_DIR } from "./theme.js";

const GOOGLE_FONTS_COMMIT = "2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc";

export interface FontAsset {
	readonly file: string;
	readonly source: string;
	readonly sha256: string;
}

export const FONT_ASSETS: Record<string, FontAsset> = {
	[FONT_DISPLAY]: {
		file: "Archivo.ttf",
		source: "ofl/archivo/Archivo%5Bwdth,wght%5D.ttf",
		sha256: "0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053",
	},
	[FONT_SANS]: {
		file: "Inter.ttf",
		source: "ofl/inter/Inter%5Bopsz,wght%5D.ttf",
		sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
	},
	[FONT_MONO]: {
		file: "JetBrainsMono.ttf",
		source: "ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
		sha256: "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
	},
};

export const fontPath = (family: string): string => {
	const spec = FONT_ASSETS[family];
	if (!spec) throw new Error(`Unknown font family: ${family}`);
	return path.join(FONTS_DIR, spec.file);
};

export const fontUrl = (family: string): string => {
	const spec = FONT_ASSETS[family];
	if (!spec) throw new Error(`Unknown font family: ${family}`);
	return `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/${spec.source}`;
};

export async function registerFonts(): Promise<string[]> {
	const families = Object.keys(FONT_ASSETS);
	const missing = families.filter((f) => !existsSync(fontPath(f)));
	if (missing.length > 0) {
		throw new Error(
			`Missing fonts (${missing.join(", ")}). Run \`pnpm assets\` first.`,
		);
	}
	for (const family of families) {
		await FontManager.register({ family, source: fontPath(family) });
	}
	return families.map(fontPath);
}
