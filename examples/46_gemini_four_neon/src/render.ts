/**
 * Render & verification entry point:
 *   pnpm check                 → schema + lint preflight
 *   pnpm frames 30 75 180 ...  → high-res PNG frames into output/frames/
 *   pnpm grid [a b ...]        → 4x5 contact sheet into output/grid.png
 *   pnpm render                → 1080p very_high MP4 with automated video/audio QA
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
	CompositorProgramSchema,
	formatQaReport,
	HeadlessMediaRenderer,
} from "framefields";
import { buildFilm, DURATION } from "./film.js";
import { OUTPUT } from "./theme.js";

const [mode = "video", ...args] = process.argv.slice(2);
await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });

const film = await buildFilm();

if (mode === "check") {
	const spec = film.toSpec();
	const parsed = CompositorProgramSchema.safeParse(spec);
	if (!parsed.success) {
		console.error("Schema validation failed:");
		console.error(JSON.stringify(parsed.error.format(), null, 2));
		process.exit(1);
	}
	const diagnostics = film.lint();
	console.log(
		`Schema OK · ${DURATION} frames (${(DURATION / 30).toFixed(2)}s)`,
	);
	if (diagnostics.length === 0) {
		console.log("Lint OK · 0 diagnostics");
	} else {
		for (const d of diagnostics) {
			console.log(`${d.severity} ${d.code}: ${d.message}`);
		}
		if (
			diagnostics.some(
				(d) => d.severity === "error" || d.severity === "warning",
			)
		) {
			process.exit(1);
		}
	}
} else if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	const targets = args.length
		? args.map(Number)
		: [30, 72, 165, 195, 280, 315, 385, 415, 498, 540];
	for (const frame of targets) {
		const t0 = Date.now();
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(frame).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await film.renderFrame({ frame, renderer }));
		console.log(`${file} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
	}
} else if (mode === "grid") {
	const frames = args.length
		? args.map(Number)
		: Array.from({ length: 20 }, (_, i) =>
				Math.round((i * (DURATION - 1)) / 19),
			);
	const file = path.join(OUTPUT, "grid.png");
	const t0 = Date.now();
	await fs.writeFile(
		file,
		await film.renderFrameGrid({
			frames,
			columns: 4,
			cellWidth: 480,
			showLabels: true,
		}),
	);
	console.log(`${file} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
} else {
	const t0 = Date.now();
	const outputPath = path.join(OUTPUT, "gemini-4-neon.mp4");
	const result = await film.renderVideo({
		outputPath,
		quality: "very_high",
		codec: "h264",
		qa: { targetLufs: -14 },
	});
	await result.cleanup?.().catch(() => {});
	console.log(`${result.filePath} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
	if (result.qa) {
		console.log(formatQaReport(result.qa));
		if (!result.qa.passed) {
			process.exitCode = 1;
		}
	}
}

process.exit(process.exitCode ?? 0);
