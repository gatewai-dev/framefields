/**
 * pnpm fonts → assets/fonts/. Arabic and Hebrew faces from google/fonts (all SIL OFL).
 * Font files are gitignored; this script is the record of where they came from.
 * Idempotent: an existing file is kept.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { FONTS } from "./theme.js";

const BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl";

const FONT_FILES: Record<string, string> = {
	// Arabic + Latin, variable weight: the face from the original bug report.
	"Cairo.ttf": "cairo/Cairo%5Bslnt,wght%5D.ttf",
	// Arabic with full vowel marks (harakat) placed through GPOS anchors.
	"NotoNaskhArabic.ttf": "notonaskharabic/NotoNaskhArabic%5Bwght%5D.ttf",
	// Hebrew + Latin, variable weight.
	"Rubik.ttf": "rubik/Rubik%5Bwght%5D.ttf",
	// Latin labels.
	"Inter.ttf": "inter/Inter%5Bopsz,wght%5D.ttf",
};

await fs.mkdir(FONTS, { recursive: true });
for (const [file, src] of Object.entries(FONT_FILES)) {
	const target = path.join(FONTS, file);
	if (await fs.stat(target).catch(() => null)) continue;
	const res = await fetch(`${BASE}/${src}`);
	if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
	await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
	console.log(target);
}
process.exit(0);
