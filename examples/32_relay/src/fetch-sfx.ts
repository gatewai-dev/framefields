/**
 * pnpm assets → assets/sfx/{panel,complete}.mp3
 *
 * Downloads the pinned UI SFX sounds listed in sfx.ts and checks each one's
 * SHA-256. Idempotent: a file already on disk with the right hash is kept.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { SFX, type SfxName, sfxPath, sfxUrl } from "./sfx.js";

const sha256 = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

async function fetchSound(name: SfxName): Promise<void> {
	const file = sfxPath(name);
	const { sha256: expected } = SFX[name];
	const existing = await fs.readFile(file).catch(() => null);
	if (existing && sha256(existing) === expected) {
		console.log(`kept ${path.basename(file)}`);
		return;
	}
	const url = sfxUrl(name);
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
	console.log(`wrote ${path.basename(file)} (${SFX[name].source})`);
}

await Promise.all((Object.keys(SFX) as SfxName[]).map(fetchSound));
process.exit(0);
