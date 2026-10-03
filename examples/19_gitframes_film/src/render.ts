/**
 * pnpm render                 → output/gitframes-film.mp4 (30 s, 1080p30, with score)
 * pnpm render frames 0 45 90  → output/frames/f0000.png … for quick visual checks
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "gitframes";
import { buildFilm } from "./film.js";
import { HERE } from "./theme.js";

const OUT = path.resolve(HERE, "../output");
const [mode = "video", ...args] = process.argv.slice(2);

const film = await buildFilm();
await fs.mkdir(OUT, { recursive: true });

if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	await fs.mkdir(path.join(OUT, "frames"), { recursive: true });
	for (const frame of args.map(Number)) {
		const png = await film.renderFrame({ frame, renderer });
		const file = path.join(
			OUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, png);
		console.log(file);
	}
} else {
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUT, "gitframes-film.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
