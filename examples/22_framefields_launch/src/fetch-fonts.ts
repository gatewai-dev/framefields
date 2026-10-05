/**
 * pnpm fonts → assets/fonts/. Display faces from google/fonts (all SIL OFL).
 * Font files are gitignored; this script is the record of where they came from.
 * Idempotent: an existing file is kept.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { ASSETS } from "./paths.js";

const BASE = "https://raw.githubusercontent.com/google/fonts/main/ofl";

export const FONT_FILES: Record<string, string> = {
	"JetBrainsMono.ttf": "jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
	"Unbounded.ttf": "unbounded/Unbounded%5Bwght%5D.ttf",
	"DelaGothicOne.ttf": "delagothicone/DelaGothicOne-Regular.ttf",
	"Anton.ttf": "anton/Anton-Regular.ttf",
	"Monoton.ttf": "monoton/Monoton-Regular.ttf",
	"MajorMonoDisplay.ttf": "majormonodisplay/MajorMonoDisplay-Regular.ttf",
	"Silkscreen.ttf": "silkscreen/Silkscreen-Regular.ttf",
	"Bungee.ttf": "bungee/Bungee-Regular.ttf",
	"BungeeShade.ttf": "bungeeshade/BungeeShade-Regular.ttf",
	"Michroma.ttf": "michroma/Michroma-Regular.ttf",
	"RubikMonoOne.ttf": "rubikmonoone/RubikMonoOne-Regular.ttf",
	"SpaceMono-Bold.ttf": "spacemono/SpaceMono-Bold.ttf",
	"FrauncesItalic.ttf": "fraunces/Fraunces-Italic%5BSOFT,WONK,opsz,wght%5D.ttf",
	"BowlbyOne.ttf": "bowlbyone/BowlbyOne-Regular.ttf",
};

const dir = path.join(ASSETS, "fonts");
await fs.mkdir(dir, { recursive: true });
for (const [file, src] of Object.entries(FONT_FILES)) {
	const target = path.join(dir, file);
	if (await fs.stat(target).catch(() => null)) continue;
	const res = await fetch(`${BASE}/${src}`);
	if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
	await fs.writeFile(target, Buffer.from(await res.arrayBuffer()));
	console.log(target);
}
process.exit(0);
