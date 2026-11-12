/**
 * pnpm assets: downloads the two sample models (pinned, verified by size and
 * SHA-256) and generates the sun sky.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import {
	ASSETS,
	CESIUM_MAN,
	type Download,
	SKY,
	WATER_BOTTLE,
} from "./paths.js";
import { encodeRgbe, sunSky } from "./sky.js";

async function verified(d: Download, bytes: Uint8Array): Promise<boolean> {
	const sha = createHash("sha256").update(bytes).digest("hex");
	return bytes.byteLength === d.bytes && sha === d.sha256;
}

async function fetchPinned(d: Download): Promise<void> {
	const existing = await fs.readFile(d.file).catch(() => null);
	if (existing && (await verified(d, existing))) return;
	const res = await fetch(d.url);
	if (!res.ok) throw new Error(`${d.url}: HTTP ${res.status}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (!(await verified(d, bytes))) {
		throw new Error(`${d.url}: size or SHA-256 differs from the pinned file`);
	}
	await fs.writeFile(d.file, bytes);
	console.log(`${d.file} (${d.credit})`);
}

await fs.mkdir(ASSETS, { recursive: true });
await fetchPinned(CESIUM_MAN);
await fetchPinned(WATER_BOTTLE);
const s = sunSky();
await fs.writeFile(SKY, encodeRgbe(s.width, s.height, s.data));
console.log(SKY);
process.exit(0);
