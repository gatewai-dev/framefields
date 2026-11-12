/**
 * pnpm render character → output/character/: 30 traced frames of the walk,
 *   each frame's render time (a BVH that refits badly shows up as slow
 *   frames), a contact sheet and a raster-vs-traced comparison
 * pnpm render sun       → output/sun/: draft vs reference under the sun
 *   HDRI, with the error and firefly count of draft against reference
 * pnpm render motion    → output/motion.mp4 (2 s, draft, motion blur and
 *   bloom), and flicker measured on a static-camera take: how much still
 *   background changes from frame to frame, draft vs standard
 * pnpm render all       → all three
 */
import fs from "node:fs/promises";
import path from "node:path";
import { type Composition, HeadlessMediaRenderer } from "framefields";
import sharp from "sharp";
import { OUTPUT } from "./paths.js";
import {
	characterScene,
	FPS,
	H,
	motionScene,
	type PathTraceQuality,
	sunScene,
	W,
} from "./scenes.js";

const renderer = new HeadlessMediaRenderer();

async function rgba(comp: Composition, frame: number): Promise<Uint8Array> {
	return new Uint8Array(
		await comp.renderFrame({ frame, format: "rgba", renderer }),
	);
}

async function png(pixels: Uint8Array, file: string): Promise<void> {
	await sharp(pixels, { raw: { width: W, height: H, channels: 4 } })
		.png()
		.toFile(file);
}

/** Images stacked top to bottom into one file. */
async function stack(files: string[], file: string): Promise<void> {
	await sharp({
		create: {
			width: W,
			height: H * files.length,
			channels: 3,
			background: "#000",
		},
	})
		.composite(files.map((input, i) => ({ input, top: i * H, left: 0 })))
		.png()
		.toFile(file);
}

const luma = (p: Uint8Array, i: number) =>
	0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];

async function character(): Promise<void> {
	const dir = path.join(OUTPUT, "character");
	await fs.mkdir(dir, { recursive: true });
	const comp = characterScene({ frames: FPS });
	const times: number[] = [];
	for (let f = 0; f < FPS; f++) {
		const t = performance.now();
		const px = await rgba(comp, f);
		times.push(performance.now() - t);
		if (f % 10 === 0)
			await png(px, path.join(dir, `f${String(f).padStart(2, "0")}.png`));
	}
	const steady = times.slice(1).sort((a, b) => a - b);
	const median = steady[Math.floor(steady.length / 2)] ?? 0;
	console.log(
		`character: frame 0 ${times[0]?.toFixed(0)} ms (builds trees), then median ${median.toFixed(0)} ms, slowest ${Math.max(...steady).toFixed(0)} ms`,
	);
	const slow = times
		.map((t, f) => [f, t])
		.filter(([f, t]) => f > 0 && t > median * 1.5);
	console.log(
		slow.length
			? `  slow frames: ${slow.map(([f, t]) => `${f} (${t.toFixed(0)} ms)`).join(", ")}`
			: "  no slow frames",
	);
	await fs.writeFile(
		path.join(dir, "times.json"),
		JSON.stringify(times.map(Math.round)),
	);
	const raster = path.join(dir, "raster-f15.png");
	const traced = path.join(dir, "traced-f15.png");
	await png(
		await rgba(characterScene({ raster: true, frames: FPS }), 15),
		raster,
	);
	await png(await rgba(comp, 15), traced);
	await stack([raster, traced], path.join(dir, "raster-vs-traced.png"));
	console.log(`  ${dir}`);
}

/**
 * Isolated bright pixels: brighter than every one of their eight neighbours
 * by more than 40 (a path that found the sun by chance, caustics included).
 */
function fireflies(img: Uint8Array): number {
	let count = 0;
	for (let y = 1; y < H - 1; y++) {
		for (let x = 1; x < W - 1; x++) {
			const c = luma(img, (y * W + x) * 4);
			let brightest = 0;
			for (let dy = -1; dy <= 1; dy++)
				for (let dx = -1; dx <= 1; dx++)
					if (dx || dy)
						brightest = Math.max(
							brightest,
							luma(img, ((y + dy) * W + x + dx) * 4),
						);
			if (c > brightest + 40) count++;
		}
	}
	return count;
}

async function sun(): Promise<void> {
	const dir = path.join(OUTPUT, "sun");
	await fs.mkdir(dir, { recursive: true });
	const shots: Record<string, Uint8Array> = {};
	for (const quality of [
		"draft",
		"standard",
		"reference",
	] as PathTraceQuality[]) {
		const t = performance.now();
		shots[quality] = await rgba(sunScene({ quality }), 0);
		console.log(
			`sun ${quality}: ${((performance.now() - t) / 1000).toFixed(1)} s`,
		);
		await png(shots[quality], path.join(dir, `${quality}.png`));
	}
	const ref = shots.reference as Uint8Array;
	for (const quality of ["draft", "standard", "reference"]) {
		const img = shots[quality] as Uint8Array;
		let sq = 0;
		for (let i = 0; i < img.length; i += 4) {
			const d = luma(img, i) - luma(ref, i);
			sq += d * d;
		}
		const error =
			quality === "reference"
				? ""
				: `RMSE vs reference ${Math.sqrt(sq / (W * H)).toFixed(2)} (0-255), `;
		console.log(`  ${quality}: ${error}${fireflies(img)} fireflies`);
	}
	await stack(
		["draft", "standard", "reference"].map((q) => path.join(dir, `${q}.png`)),
		path.join(dir, "draft-standard-reference.png"),
	);
	console.log(`  ${dir}`);
}

/**
 * Mean frame-to-frame change of a still, lit picture, 0-255: the sun scene
 * right of the walking man, where nothing moves, so every change is noise
 * the per-frame denoiser left (each frame has its own sample seed).
 */
async function flicker(quality: PathTraceQuality): Promise<number> {
	const comp = sunScene({ quality, frames: 12 });
	let prev: Uint8Array | null = null;
	let sum = 0;
	let n = 0;
	for (let f = 0; f < 12; f++) {
		const px = await rgba(comp, f);
		if (prev) {
			for (let y = 150; y < H; y += 2) {
				for (let x = 440; x < W; x += 2) {
					const i = (y * W + x) * 4;
					sum += Math.abs(luma(px, i) - luma(prev, i));
					n++;
				}
			}
		}
		prev = px;
	}
	return sum / n;
}

async function motion(): Promise<void> {
	await fs.mkdir(OUTPUT, { recursive: true });
	const t = performance.now();
	const result = await motionScene().renderVideo({
		outputPath: path.join(OUTPUT, "motion.mp4"),
		quality: "high",
	});
	await result.cleanup?.().catch(() => {});
	console.log(
		`motion: ${result.filePath} (${((performance.now() - t) / 1000).toFixed(1)} s)`,
	);
	for (const quality of ["draft", "standard"] as PathTraceQuality[]) {
		console.log(
			`  flicker of a still sunlit picture, ${quality}: ${(await flicker(quality)).toFixed(2)} (0-255)`,
		);
	}
}

const mode = process.argv[2] ?? "all";
if (mode === "character" || mode === "all") await character();
if (mode === "sun" || mode === "all") await sun();
if (mode === "motion" || mode === "all") await motion();
process.exit(0);
