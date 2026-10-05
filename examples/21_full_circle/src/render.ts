/**
 * pnpm render                  → output/full-circle.mp4 (with score)
 * pnpm render preview          → live player on localhost; add --open for the system browser
 * pnpm render frames 0 140 637 → output/frames/f0000.png … for visual checks
 * pnpm render sheet 0 1080 24  → output/frames/ every 24th frame from 0 to 1080
 */
import fs from "node:fs/promises";
import path from "node:path";
import { HeadlessMediaRenderer, startPreview } from "gitframes";
import { buildFilm } from "./film.js";
import { OUTPUT } from "./paths.js";

const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
	// The page runs film.ts itself and renders with WebGPU in the browser.
	const session = await startPreview(
		{ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
		{ title: "Full circle", open: args.includes("--open") },
	);
	console.log(`Preview at ${session.url}`);
	// Serves until its tab closes, or the next `pnpm render preview` takes over.
	await session.closed;
	process.exit(0);
}

const film = await buildFilm();
await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });

function framesToRender(): number[] {
	if (mode !== "sheet") return args.map(Number);
	const [from, to, step] = args.map(Number);
	const out: number[] = [];
	for (let f = from; f < to; f += step || 24) out.push(f);
	return out;
}

if (mode === "frames" || mode === "sheet") {
	const renderer = new HeadlessMediaRenderer();
	for (const frame of framesToRender()) {
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await film.renderFrame({ frame, renderer }));
		console.log(file);
	}
} else {
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUTPUT, "full-circle.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
