/**
 * pnpm images → assets/generated/<name>.<n>.jpg, the candidates for each
 * image in images.ts, from Seedream 5.0 Pro on the framefields AI gateway.
 * Reads FRAMEFIELDS_API_KEY from the repo root .env. Idempotent: an image
 * whose candidates are all on disk is skipped.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { ai } from "framefields";
import {
	candidatePath,
	GENERATED_DIR,
	IMAGES,
	type ImageName,
	promptFor,
} from "./images.js";

const MODEL = "seedream/5.0-pro";
/** USD per image, from estimate_generation_cost (November 2026). */
const USD_PER_IMAGE = 0.05625;

process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
const apiKey = process.env.FRAMEFIELDS_API_KEY;
if (!apiKey)
	throw new Error("FRAMEFIELDS_API_KEY missing from the repo root .env");
ai.config({ apiKey });
await fs.mkdir(GENERATED_DIR, { recursive: true });

let made = 0;
for (const name of Object.keys(IMAGES) as ImageName[]) {
	const image = IMAGES[name];
	const paths = Array.from({ length: image.candidates }, (_, i) =>
		candidatePath(name, i + 1),
	);
	if (paths.every((p) => existsSync(p))) continue;
	console.log(`${name}: ${promptFor(name)}`);
	const { data } = await ai.subscribe<{ images: { url: string }[] }>(MODEL, {
		input: {
			prompt: promptFor(name),
			aspect_ratio: image.aspectRatio,
			resolution: "2K",
			num_images: image.candidates,
			output_format: "jpeg",
		},
	});
	for (const [i, out] of data.images.entries()) {
		const res = await fetch(out.url);
		if (!res.ok) throw new Error(`GET ${out.url} → ${res.status}`);
		await fs.writeFile(paths[i], Buffer.from(await res.arrayBuffer()));
		console.log(`wrote ${paths[i]}`);
	}
	made += data.images.length;
}
console.log(
	made > 0
		? `spent ~$${(made * USD_PER_IMAGE).toFixed(2)}`
		: "nothing to generate",
);
process.exit(0);
