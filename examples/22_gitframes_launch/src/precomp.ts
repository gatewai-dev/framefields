/**
 * pnpm precomp → assets/plate.mp4: the 3D chapter rendered on its own, as the
 * footage the chorus grades, grains and glitches. Effects attach to media, so
 * the film's own frames become media first (an After Effects-style precomp),
 * rendered on the film's clock: frame f of the plate is film frame from + f.
 * Re-run after the song or the world scene changes.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Composition, HeadlessMediaRenderer } from "gitframes";
import { bar, FPS } from "./grid.js";
import { asset, OUTPUT } from "./paths.js";
import { worldScene } from "./scenes/world.js";
import { BG, H, registerFonts, W } from "./theme.js";
import { CH } from "./timeline.js";

interface Plate {
	from: number;
	to: number;
	file: string;
	background: string;
	build: (from: number, to: number) => unknown;
}

const PLATES: Record<string, Plate> = {
	world: {
		from: bar(CH.world),
		to: bar(CH.warp),
		file: "plate.mp4",
		background: BG,
		build: () => worldScene({ lyrics: false }),
	},
};

async function render(name: string, p: Plate) {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: p.to,
		backgroundColor: p.background,
	});
	comp.add(p.build(p.from, p.to) as never);
	const dir = path.join(OUTPUT, "precomp", name);
	await fs.rm(dir, { recursive: true, force: true });
	await fs.mkdir(dir, { recursive: true });
	const renderer = new HeadlessMediaRenderer();
	const started = Date.now();
	for (let f = p.from; f < p.to; f++)
		await fs.writeFile(
			path.join(dir, `p${String(f - p.from).padStart(4, "0")}.png`),
			await comp.renderFrame({ frame: f, renderer }),
		);
	execFileSync("ffmpeg", [
		"-y",
		"-v",
		"error",
		"-framerate",
		String(FPS),
		"-i",
		path.join(dir, "p%04d.png"),
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-crf",
		"14",
		"-preset",
		"slow",
		asset(p.file),
	]);
	console.log(
		`${asset(p.file)}  ${p.to - p.from} frames (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}

await registerFonts();
for (const [name, p] of Object.entries(PLATES)) await render(name, p);
process.exit(0);
