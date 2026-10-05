/**
 * pnpm render                → output/data-story.mp4
 * pnpm render frames 60 180  → output/frames/f0060.png …
 * pnpm render grid           → output/grid.png, a contact sheet of the whole film
 * pnpm render preview        → live player on localhost; add --open for the system browser
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer, startPreview } from "gitframes";
import { buildFilm } from "./film.js";
import { OUTPUT } from "./theme.js";
import { DURATION } from "./timeline.js";

const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
	// The page runs film.ts itself and renders with WebGPU in the browser.
	const session = await startPreview(
		{ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
		{ title: "Data story", open: args.includes("--open") },
	);
	console.log(`Preview at ${session.url}`);
	// Serves until its tab closes, or the next `pnpm render preview` takes over.
	await session.closed;
	process.exit(0);
}
const film = await buildFilm();
await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });

if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	for (const frame of args.map(Number)) {
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await film.renderFrame({ frame, renderer }));
		console.log(file);
	}
} else if (mode === "grid") {
	const frames = Array.from({ length: 16 }, (_, i) =>
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
		outputPath: path.join(OUTPUT, "data-story.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
