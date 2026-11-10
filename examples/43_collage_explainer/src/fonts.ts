/**
 * Every face the seed looks name, from google/fonts pinned to one commit and
 * checked by SHA-256 (all SIL OFL 1.1). Font files stay out of git;
 * `pnpm assets` fetches them into assets/fonts/.
 */
import { existsSync } from "node:fs";
import { FontManager } from "framefields";

const GOOGLE_FONTS_COMMIT = "2fe1e8c6b137fb13041a7cfca6fdcd8a910ea4dc";
export const FONTS_DIR = new URL("../assets/fonts/", import.meta.url).pathname;

export const FONT_FILES: Record<
	string,
	{ file: string; source: string; sha256: string }
> = {
	Archivo: {
		file: "Archivo.ttf",
		source: "ofl/archivo/Archivo%5Bwdth,wght%5D.ttf",
		sha256: "0e094a7d3c7c4c25cf1310c4b30014f1dae9332220b1c2c88f4fa996f0b05053",
	},
	Inter: {
		file: "Inter.ttf",
		source: "ofl/inter/Inter%5Bopsz,wght%5D.ttf",
		sha256: "29160a80ff49ddcab2c97711247e08b1fab27a484a329ce8b813d820dc559031",
	},
	"Libre Franklin": {
		file: "LibreFranklin.ttf",
		source: "ofl/librefranklin/LibreFranklin%5Bwght%5D.ttf",
		sha256: "2329f394b10ed1c71107df20fddc11e2bb1b68c1ecbb385f975b36fd64a971f8",
	},
	"JetBrains Mono": {
		file: "JetBrainsMono.ttf",
		source: "ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
		sha256: "48715a42ec242c21e9f02692891e147d022299a52e48d5e413e1a942193ffeda",
	},
};

export const fontPath = (family: string) =>
	`${FONTS_DIR}${FONT_FILES[family].file}`;
export const fontUrl = (family: string) =>
	`https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/${FONT_FILES[family].source}`;

/** Registers the given families; returns their files for `Composition.fonts`. */
export async function registerFonts(families: string[]): Promise<string[]> {
	const unknown = families.filter((f) => !(f in FONT_FILES));
	if (unknown.length > 0)
		throw new Error(`No pinned file for ${unknown.join(", ")}.`);
	const missing = families.filter((f) => !existsSync(fontPath(f)));
	if (missing.length > 0)
		throw new Error(
			`Missing fonts (${missing.join(", ")}). Run \`pnpm assets\` first.`,
		);
	for (const family of families)
		await FontManager.register({ family, source: fontPath(family) });
	return families.map(fontPath);
}
