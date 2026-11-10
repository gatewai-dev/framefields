/**
 * pnpm render                    → output/style-frames/<look>/<crop>.png for every look
 * pnpm render motion collage     → only those looks
 * pnpm render grid motion        → output/style-frames/<look>/grid.png, the clip at 16:9
 *
 * Each look's hero frame is rendered at every crop, each crop laid out by
 * the look's own reference (not cut from one frame). frames.json lists what
 * was written, for the publish script in the API repo.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "framefields";
import { CROP_IDS, cropFormat, referenceComposition } from "./frame.js";
import { REFERENCES } from "./looks/index.js";

const OUT = new URL("../output/style-frames/", import.meta.url).pathname;
const args = process.argv.slice(2);
const grid = args[0] === "grid";
const wanted = grid ? args.slice(1) : args;
const refs =
	wanted.length > 0
		? REFERENCES.filter((r) => wanted.includes(r.look))
		: REFERENCES;
const unknown = wanted.filter((id) => !REFERENCES.some((r) => r.look === id));
if (unknown.length > 0)
	throw new Error(`No reference for ${unknown.join(", ")}.`);

const renderer = new HeadlessMediaRenderer();
const sha256 = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

for (const ref of refs) {
	const dir = path.join(OUT, ref.look);
	await fs.mkdir(dir, { recursive: true });
	if (grid) {
		const comp = await referenceComposition(ref, "16:9");
		const frames = Array.from({ length: 12 }, (_, i) =>
			Math.round((i * (ref.frames - 1)) / 11),
		);
		const file = path.join(dir, "grid.png");
		await fs.writeFile(
			file,
			await comp.renderFrameGrid({
				frames,
				columns: 4,
				cellWidth: 480,
				showLabels: true,
			}),
		);
		console.log(file);
		continue;
	}
	const crops: Record<
		string,
		{ file: string; width: number; height: number; sha256: string }
	> = {};
	for (const id of CROP_IDS) {
		const comp = await referenceComposition(ref, id);
		const png = await comp.renderFrame({ frame: ref.hero, renderer });
		const file = `${id.replace(":", "x")}.png`;
		await fs.writeFile(path.join(dir, file), png);
		const { width, height } = cropFormat(id);
		crops[id] = { file, width, height, sha256: sha256(png) };
		console.log(path.join(dir, file));
	}
	await fs.writeFile(
		path.join(dir, "frames.json"),
		`${JSON.stringify({ look: ref.look, hero: ref.hero, fps: 30, crops }, null, "\t")}\n`,
	);
}
process.exit(0);
