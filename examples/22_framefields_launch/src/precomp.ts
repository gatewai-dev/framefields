/**
 * pnpm precomp → assets/plate.mp4: the compositing chapter's finished
 * composite (backdrop, keyed camera, light leak in screen, paper in multiply)
 * rendered on its own, as the footage the chorus grades, grains and glitches.
 * Effects attach to media, so the composite becomes media first (an After
 * Effects-style precomp). Re-run after the images or the composite change.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { Composition, HeadlessMediaRenderer } from "framefields";
import { FPS } from "./grid.js";
import { asset, OUTPUT } from "./paths.js";
import { compPlate, PLATE_FRAMES } from "./scenes/comp.js";
import { BG, H, registerFonts, W } from "./theme.js";

interface Plate {
	from: number;
	to: number;
	file: string;
	background: string;
	build: (from: number, to: number) => unknown;
}

const PLATES: Record<string, Plate> = {
	comp: {
		from: 0,
		to: PLATE_FRAMES,
		file: "plate.mp4",
		background: BG,
		build: () => compPlate(),
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
		// A short GOP keeps the plate cheap to *seek*: the VFX chapter instances
		// it dozens of times at different in-points, and x264's default 250-frame
		// keyframe interval makes each of those seeks re-decode up to 4s before
		// the frame it wants. A keyframe every 15 frames bounds that.
		"-g",
		"15",
		"-keyint_min",
		"15",
		asset(p.file),
	]);
	console.log(
		`${asset(p.file)}  ${p.to - p.from} frames (${((Date.now() - started) / 1000).toFixed(1)} s)`,
	);
}

await registerFonts();
for (const [name, p] of Object.entries(PLATES)) await render(name, p);
process.exit(0);
