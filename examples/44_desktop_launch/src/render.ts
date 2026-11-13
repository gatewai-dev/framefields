/**
 * pnpm render                 → output/first-light.mp4
 * pnpm render frames 30 600   → output/frames/f0030.png …
 * pnpm render grid [a b …]    → output/grid.png, a contact sheet
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "framefields";
import { buildFilm, DURATION } from "./film.js";
import { OUTPUT } from "./theme.js";

const [mode = "video", ...args] = process.argv.slice(2);
await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });
const film = await buildFilm();

if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	for (const frame of args.map(Number)) {
		const started = Date.now();
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await film.renderFrame({ frame, renderer }));
		console.log(file, `${((Date.now() - started) / 1000).toFixed(1)} s`);
	}
} else if (mode === "grid") {
	const frames = args.length
		? args.map(Number)
		: Array.from({ length: 16 }, (_, i) =>
				Math.round((i * (DURATION - 1)) / 15),
			);
	const file = path.join(OUTPUT, "grid.png");
	await fs.writeFile(
		file,
		await film.renderFrameGrid({
			frames,
			columns: 4,
			cellWidth: 480,
			showLabels: true,
		}),
	);
	console.log(file);
} else {
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUTPUT, "first-light.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
