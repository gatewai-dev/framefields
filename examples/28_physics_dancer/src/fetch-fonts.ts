/**
 * pnpm fonts → assets/fonts/Syne.ttf from google/fonts (SIL OFL).
 * Font files are gitignored; this script is the record of where they came from.
 * Idempotent: an existing file is kept.
 */
import fs from "node:fs/promises";
import { FONT_FILE, FONTS } from "./theme.js";

const SRC =
	"https://raw.githubusercontent.com/google/fonts/main/ofl/syne/Syne%5Bwght%5D.ttf";

await fs.mkdir(FONTS, { recursive: true });
if (!(await fs.stat(FONT_FILE).catch(() => null))) {
	const res = await fetch(SRC);
	if (!res.ok) throw new Error(`${SRC}: HTTP ${res.status}`);
	await fs.writeFile(FONT_FILE, Buffer.from(await res.arrayBuffer()));
	console.log(FONT_FILE);
}
process.exit(0);
