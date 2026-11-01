/**
 * pnpm render                → output/relay.mp4
 * pnpm render frames 60 180  → output/frames/f0060.png …
 * pnpm render grid           → output/grid.png, a contact sheet of the film
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer } from "framefields";
import { missingAudio } from "./audio.js";
import { buildFilm } from "./film.js";
import { missingSfx } from "./sfx.js";
import { FPS, OUTPUT } from "./theme.js";

const [mode = "video", ...args] = process.argv.slice(2);
const film = await buildFilm();
const total = Math.round(((film.durationMs ?? 0) / 1000) * FPS);
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
	const frames =
		args.length > 0
			? args.map(Number)
			: Array.from({ length: 20 }, (_, i) =>
					Math.round((i * (total - 1)) / 19),
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
	const missing = [...missingSfx(), ...missingAudio()];
	if (missing.length > 0) {
		console.error(
			`Missing sounds (${missing.join(", ")}). Run \`pnpm assets\` and \`pnpm audio\` first.`,
		);
		process.exit(1);
	}
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUTPUT, "relay.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
