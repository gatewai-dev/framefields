/**
 * pnpm render                    → output/capabilities-reel.mp4 (with QA)
 * pnpm render frames 0 90 400    → output/frames/f0000.png …
 * pnpm render grid lottie [12]   → output/grid-lottie.png: a contact sheet across one chapter
 * pnpm render seq vision 40 6    → consecutive frames (vision needs frames in order), every 6th kept
 * pnpm render lint               → schema + document lint
 * pnpm render preview            → live player on localhost
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
	CompositorProgramSchema,
	formatQaReport,
	HeadlessMediaRenderer,
	startPreview,
} from "framefields";
import { buildFilm } from "./film.js";
import { OUTPUT, REPO } from "./paths.js";
import { chapter } from "./timeline.js";

const [mode = "video", ...args] = process.argv.slice(2);

if (mode === "preview") {
	const session = await startPreview(
		{ entry: new URL("./film.ts", import.meta.url), export: "buildFilm" },
		{
			title: "framefields — capabilities reel",
			open: args.includes("--open"),
			root: [REPO],
		},
	);
	console.log(`Preview at ${session.url}`);
	await session.closed;
	process.exit(0);
}

const started = Date.now();
const comp = await buildFilm();
console.log(`built in ${((Date.now() - started) / 1000).toFixed(1)} s`);
await fs.mkdir(OUTPUT, { recursive: true });

if (mode === "lint") {
	const parsed = CompositorProgramSchema.safeParse(comp.toSpec());
	if (!parsed.success) {
		const { z } = await import("zod");
		console.error(
			z.prettifyError(parsed.error).split("\n").slice(0, 40).join("\n"),
		);
	}
	for (const d of comp.lint())
		console.log(
			`${d.severity} ${d.code}: ${d.message}${d.layerId ? ` (${d.layerId})` : ""}`,
		);
	console.log(parsed.success ? "schema ok" : "schema FAILED");
} else if (mode === "frames") {
	const renderer = new HeadlessMediaRenderer();
	await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });
	for (const f of args.map(Number)) {
		const file = path.join(
			OUTPUT,
			"frames",
			`f${String(f).padStart(4, "0")}.png`,
		);
		await fs.writeFile(file, await comp.renderFrame({ frame: f, renderer }));
		console.log(file);
	}
} else if (mode === "grid") {
	const c = chapter(args[0]);
	const count = Number(args[1] ?? 12);
	const frames = Array.from(
		{ length: count },
		(_, i) => c.start + Math.round((i * (c.frames - 1)) / (count - 1)),
	);
	const png = await comp.renderFrameGrid({
		frames,
		columns: 4,
		cellWidth: 480,
		showLabels: true,
	});
	const file = path.join(OUTPUT, `grid-${c.id}.png`);
	await fs.writeFile(file, png);
	console.log(file, frames.join(" "));
} else if (mode === "seq") {
	// Frames rendered in order with one renderer, keeping every `step`th (vision reads the previous frame).
	const c = chapter(args[0]);
	const from = c.start + Number(args[1] ?? 0);
	const step = Number(args[2] ?? 10);
	const to = Math.min(c.start + c.frames, from + step * 8);
	const renderer = new HeadlessMediaRenderer();
	await fs.mkdir(path.join(OUTPUT, "frames"), { recursive: true });
	for (let f = from; f < to; f++) {
		const png = await comp.renderFrame({ frame: f, renderer });
		if ((f - from) % step === step - 1) {
			const file = path.join(
				OUTPUT,
				"frames",
				`f${String(f).padStart(4, "0")}.png`,
			);
			await fs.writeFile(file, png);
			console.log(file);
		}
	}
} else {
	const result = await comp.renderVideo({
		outputPath: path.join(OUTPUT, "capabilities-reel.mp4"),
		quality: "high",
		qa: { targetLufs: -14 },
	});
	await result.cleanup?.().catch(() => {});
	if (result.qa) console.log(formatQaReport(result.qa));
	console.log(
		`${result.filePath} (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}
process.exit(0);
