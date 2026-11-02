/**
 * The four faces, from google/fonts pinned to one commit and checked by
 * SHA-256 (Anton, Libre Franklin and JetBrains Mono are SIL OFL 1.1,
 * Permanent Marker is Apache 2.0). Font files stay out of git; `pnpm assets`
 * fetches them into assets/fonts/.
 */
import { existsSync } from "node:fs";
import { FontManager } from "framefields";
import { DISPLAY, FONTS, HAND, MONO, SANS } from "./theme.js";

export const GOOGLE_FONTS_COMMIT = "2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc";

export const FONT_FILES = {
	[DISPLAY]: {
		file: "Anton.ttf",
		source: "ofl/anton/Anton-Regular.ttf",
		sha256: "a4ba3a92350ebb031da0cb47630ac49eb265082ca1bc0450442f4a83ab947cab",
	},
	[SANS]: {
		file: "LibreFranklin.ttf",
		source: "ofl/librefranklin/LibreFranklin%5Bwght%5D.ttf",
		sha256: "2329f394b10ed1c71107df20fddc11e2bb1b68c1ecbb385f975b36fd64a971f8",
	},
	[MONO]: {
		file: "JetBrainsMono.ttf",
		source: "ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
		sha256: "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
	},
	[HAND]: {
		file: "PermanentMarker.ttf",
		source: "apache/permanentmarker/PermanentMarker-Regular.ttf",
		sha256: "28f82c8a7943cb8e9d599f8554da1d4fc75dbcf69b9885ad6c0611d20c6946c5",
	},
} as const;

export const fontPath = (family: keyof typeof FONT_FILES) =>
	`${FONTS}${FONT_FILES[family].file}`;

export const fontUrl = (family: keyof typeof FONT_FILES) =>
	`https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/${FONT_FILES[family].source}`;

const FAMILIES = Object.keys(FONT_FILES) as Array<keyof typeof FONT_FILES>;

/** Fonts not on disk yet. */
export const missingFonts = () =>
	FAMILIES.filter((family) => !existsSync(fontPath(family)));

/** Registers every face; returns their files for `Composition.fonts`. */
export async function registerFonts(): Promise<string[]> {
	const missing = missingFonts();
	if (missing.length > 0)
		throw new Error(
			`Missing fonts (${missing.join(", ")}). Run \`pnpm assets\` first.`,
		);
	for (const family of FAMILIES)
		await FontManager.register({ family, source: fontPath(family) });
	return FAMILIES.map(fontPath);
}
