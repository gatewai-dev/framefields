/**
 * Local render through the same exports the worker uses:
 *   npm run render              # all → output/{film,threeD,vision}.mp4
 *   npm run render -- title     # one export
 *   npm run render -- film --grid   # frame grid PNG instead of a video
 */
import fs from "node:fs/promises";
import type { Composition } from "framefields";
import * as entry from "../src/film.js";

const [name = "all", ...flags] = process.argv.slice(2);
const exported = (entry as Record<string, unknown>)[name];
if (typeof exported !== "function") {
	console.error(
		`No export "${name}". Exports: ${Object.keys(entry).join(", ")}`,
	);
	process.exit(1);
}

const result = (await exported()) as Composition | Record<string, Composition>;
const outputs =
	"renderVideo" in result ? { [name]: result as Composition } : result;

await fs.mkdir("output", { recursive: true });
for (const [key, comp] of Object.entries(outputs)) {
	const started = Date.now();
	if (flags.includes("--grid")) {
		const png = await comp.renderFrameGrid({ stepFrames: 15 });
		await fs.writeFile(`output/${key}-grid.png`, png);
		console.log(`output/${key}-grid.png (${Date.now() - started} ms)`);
	} else {
		const { filePath } = await comp.renderVideo({
			outputPath: `output/${key}.mp4`,
			quality: "high",
		});
		console.log(`${filePath} (${Date.now() - started} ms)`);
	}
}
process.exit(0);
