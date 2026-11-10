/**
 * pnpm assets → assets/fonts/*.ttf
 *
 * Downloads the pinned faces listed in fonts.ts and checks each one's
 * SHA-256. Idempotent: a file already on disk with the right hash is kept.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { FONT_FILES, fontPath, fontUrl } from "./fonts.js";

type Family = keyof typeof FONT_FILES;

const sha256 = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

async function fetchFont(family: Family): Promise<void> {
	const file = fontPath(family);
	const { sha256: expected } = FONT_FILES[family];
	const existing = await fs.readFile(file).catch(() => null);
	if (existing && sha256(existing) === expected) {
		console.log(`kept ${path.basename(file)}`);
		return;
	}
	const url = fontUrl(family);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
	const data = new Uint8Array(await res.arrayBuffer());
	const actual = sha256(data);
	if (actual !== expected)
		throw new Error(
			`${url}: SHA-256 ${actual}, expected ${expected}. Not written.`,
		);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, data);
	console.log(`wrote ${path.basename(file)} (${family})`);
}

await Promise.all((Object.keys(FONT_FILES) as Family[]).map(fetchFont));
process.exit(0);
