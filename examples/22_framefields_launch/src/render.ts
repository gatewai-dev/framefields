/**
 * pnpm render                    → output/framefields-launch.mp4 (with the score) + QA report; exits 1 if QA fails
 * pnpm render preview            → live player on localhost; add --open for the system browser
 * pnpm render frames 0 80 320    → output/frames/f0000.png … for visual checks
 * pnpm render sheet 0 320 20     → every 20th frame from 0 to 320, plus a contact sheet
 * pnpm render:src …               → any of the above, run on the engine's source (no package builds)
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
	formatQaReport,
	HeadlessMediaRenderer,
	startPreview,
} from "framefields";
import { buildFilm } from "./film.js";
import { OUTPUT } from "./paths.js";

const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
	// The page runs film.ts itself and renders with WebGPU in the browser.
	const session = await startPreview(
		{ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
		{ title: "framefields launch", open: args.includes("--open") },
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
	for (let f = from; f < to; f += step || 20) out.push(f);
	return out;
}

if (mode === "frames" || mode === "sheet") {
	const renderer = new HeadlessMediaRenderer();
	const files: string[] = [];
	for (const frame of framesToRender()) {
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await film.renderFrame({ frame, renderer }));
		files.push(file);
	}
	console.log(files.join("\n"));
} else {
	const started = Date.now();
	const result = await film.renderVideo({
		outputPath: path.join(OUTPUT, "framefields-launch.mp4"),
		quality: "high",
		qa: true,
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`${path.join(OUTPUT, "framefields-launch.mp4")} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
	if (result.qa) {
		console.log(formatQaReport(result.qa));
		if (!result.qa.passed) process.exitCode = 1;
	}
}
process.exit(process.exitCode ?? 0);
