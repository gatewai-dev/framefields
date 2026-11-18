/**
 * pnpm assets → downloads pinned Google Fonts (verified by SHA-256) and
 * synthesizes the 20-second stereo 48 kHz soundtrack `assets/generated/score.wav`.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { encodeStereoWav } from "framefields";
import { FONT_ASSETS, fontPath, fontUrl } from "./fonts.js";
import { SCORE_RATE, synthesizeScore } from "./score.js";
import { SCORE_PATH } from "./theme.js";

const sha256 = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

async function fetchFont(family: string): Promise<void> {
	const spec = FONT_ASSETS[family];
	if (!spec) throw new Error(`Unknown font: ${family}`);
	const target = fontPath(family);
	const existing = await fs.readFile(target).catch(() => null);
	if (existing && sha256(existing) === spec.sha256) {
		console.log(`font ok: ${path.basename(target)}`);
		return;
	}
	const url = fontUrl(family);
	const res = await fetch(url);
	if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const digest = sha256(bytes);
	if (digest !== spec.sha256) {
		throw new Error(
			`${url}: SHA-256 mismatch (${digest} !== ${spec.sha256}). Aborted.`,
		);
	}
	await fs.mkdir(path.dirname(target), { recursive: true });
	await fs.writeFile(target, bytes);
	console.log(`font fetched: ${path.basename(target)}`);
}

async function main(): Promise<void> {
	const t0 = Date.now();
	await Promise.all(Object.keys(FONT_ASSETS).map(fetchFont));
	await fs.mkdir(path.dirname(SCORE_PATH), { recursive: true });
	const score = synthesizeScore();
	await fs.writeFile(
		SCORE_PATH,
		encodeStereoWav(score, { sampleRate: SCORE_RATE }),
	);
	console.log(
		`score written: ${SCORE_PATH} (${((Date.now() - t0) / 1000).toFixed(1)}s)`,
	);
}

await main();
process.exit(0);
