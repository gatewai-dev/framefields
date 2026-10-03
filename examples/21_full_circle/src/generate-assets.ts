/**
 * Asset pipeline for Full Circle. Every model is the cheapest one that holds
 * up on screen; the whole film costs about one dollar to generate.
 *
 *   pnpm assets          → fonts, stills, shots, score, beat grid
 *   pnpm assets images   → stills only    (z-image turbo, ~$0.01 each)
 *   pnpm assets videos   → shots only     (h3-max-turbo $0.015/s, h3-max $0.03/s)
 *   pnpm assets music    → score only     (MiniMax Music 3, $0.002/s)
 *   pnpm assets grid     → re-analyze the score into assets/score.json (free)
 *   pnpm assets circles  → measure each shot's circle into assets/circles.json (free, needs ffmpeg)
 *   pnpm assets cost     → print the estimate without calling anything
 *
 * Every step is idempotent: existing files are kept, delete one to regenerate it.
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import dotenv from "dotenv";
import { analyzeBeatGrid } from "./beat-grid.js";
import {
	type Circle,
	type CircleTrack,
	cleanTrack,
	measureCircle,
} from "./circles.js";
import { download, estimate, exists, FalClient } from "./fal.js";
import { ASSETS, ROOT } from "./paths.js";
import { SCORE, SCORE_SECONDS, SHOTS } from "./shots.js";
import { readWav } from "./wav.js";

dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const FONTS: Record<string, string> = {
	"Syne.ttf":
		"https://github.com/google/fonts/raw/main/ofl/syne/Syne%5Bwght%5D.ttf",
	"Inter.ttf":
		"https://github.com/google/fonts/raw/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf",
	"InstrumentSerif-Italic.ttf":
		"https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf",
};

/** z-image wants multiples of 16; h3 keeps the still's aspect. */
const STILL = { width: 1920, height: 1088 };
const STILL_MP = (STILL.width * STILL.height) / 1e6;

const elapsed = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

function client(): FalClient {
	const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
	if (!key) throw new Error("FAL_API_KEY missing from .env");
	return new FalClient(key);
}

async function fonts() {
	for (const [file, url] of Object.entries(FONTS)) {
		const dest = path.join(ROOT, "assets/fonts", file);
		if (await exists(dest)) continue;
		await download(url, dest);
		console.log(`font   ${file}`);
	}
}

async function images(fal: FalClient) {
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.png`);
			if (await exists(dest)) return;
			const t0 = Date.now();
			const out = await fal.run<{ images: { url: string }[] }>(
				"fal-ai/z-image/turbo",
				{
					prompt: shot.image,
					image_size: STILL,
					num_inference_steps: 8,
					output_format: "png",
				},
				STILL_MP,
			);
			await download(out.images[0].url, dest);
			console.log(`image  ${shot.id} (${elapsed(t0)})`);
		}),
	);
}

/** fal accepts data URIs for image inputs, so the local still is sent as-is. */
async function videos(fal: FalClient) {
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.mp4`);
			if (await exists(dest)) return;
			const still = await fs.readFile(path.join(ASSETS, `${shot.id}.png`));
			const t0 = Date.now();
			const out = await fal.run<{ video: { url: string } }>(
				shot.model,
				{
					prompt: shot.motion,
					image_url: `data:image/png;base64,${still.toString("base64")}`,
					duration: shot.seconds,
					resolution: "1080P",
					prompt_expansion_mode: "disabled",
				},
				shot.seconds,
			);
			await download(out.video.url, dest);
			console.log(`video  ${shot.id} via ${shot.model} (${elapsed(t0)})`);
		}),
	);
}

async function music(fal: FalClient) {
	const dest = path.join(ASSETS, "score.wav");
	if (await exists(dest)) return;
	const t0 = Date.now();
	const out = await fal.run<{
		audio: { url: string };
		duration: number;
		seed: number;
	}>(
		"minimax/music-3",
		{ prompt: SCORE.prompt, lyrics: SCORE.lyrics, duration: SCORE_SECONDS },
		SCORE_SECONDS,
	);
	await download(out.audio.url, dest);
	console.log(
		`music  score ${out.duration.toFixed(1)}s seed ${out.seed} (${elapsed(t0)})`,
	);
}

/** Measures tempo, downbeat phase and the drop so the cut list can be written in bars. */
async function grid() {
	const { samples, sampleRate } = await readWav(path.join(ASSETS, "score.wav"));
	const result = analyzeBeatGrid(samples, sampleRate, {
		bpmHint: SCORE.bpmHint,
	});
	await fs.writeFile(
		path.join(ASSETS, "score.json"),
		`${JSON.stringify(result, null, "\t")}\n`,
	);
	console.log(
		`grid   ${result.bpm.toFixed(2)} BPM, downbeat ${result.downbeatSec.toFixed(3)}s, drop at bar ${result.dropBar}, ${result.durationSec.toFixed(1)}s`,
	);
}

const TRACK_FPS = 6;
const FRAME = { w: 1920, h: 1080 };

/** Decodes a shot to grey frames exactly as the compositor frames it (cover-fit, centred). */
function grayFrames(file: string): Promise<Buffer> {
	const { w, h } = FRAME;
	const vf = `fps=${TRACK_FPS},scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},format=gray`;
	return new Promise((resolve, reject) =>
		execFile(
			"ffmpeg",
			["-v", "error", "-i", file, "-vf", vf, "-f", "rawvideo", "-"],
			{ encoding: "buffer", maxBuffer: 1 << 30 },
			(err, out) => (err ? reject(err) : resolve(out)),
		),
	);
}

/** Tracks every shot's circle frame to frame: each sample seeds the next. */
async function circles() {
	const tracks: Record<string, CircleTrack> = {};
	const size = FRAME.w * FRAME.h;
	for (const shot of SHOTS) {
		const spec = shot.circle;
		const raw = await grayFrames(path.join(ASSETS, `${shot.id}.mp4`));
		const found: (Circle | null)[] = [];
		let seed: [number, number] =
			"fixed" in spec ? [0, 0] : (spec.seed ?? [FRAME.w / 2, FRAME.h / 2]);
		for (let at = 0; at + size <= raw.length; at += size) {
			const c =
				"fixed" in spec
					? spec.fixed
					: measureCircle(
							raw.subarray(at, at + size),
							FRAME.w,
							FRAME.h,
							spec,
							seed,
						);
			found.push(c);
			if (c) seed = [c.cx, c.cy];
		}
		const samples = cleanTrack(found).map((c) => ({
			cx: Math.round(c.cx),
			cy: Math.round(c.cy),
			r: Math.round(c.r),
		}));
		tracks[shot.id] = { fps: TRACK_FPS, samples };
		const misses = found.filter((c) => !c).length;
		const [a, b] = [samples[0], samples[samples.length - 1]];
		console.log(
			`circle ${shot.id.padEnd(9)} (${a.cx},${a.cy}) r${a.r} → (${b.cx},${b.cy}) r${b.r}${misses ? `  ${misses} misses` : ""}`,
		);
	}
	await fs.writeFile(
		path.join(ASSETS, "circles.json"),
		`${JSON.stringify(tracks)}\n`,
	);
}

function cost() {
	const stills = SHOTS.length * estimate("fal-ai/z-image/turbo", STILL_MP);
	const shots = SHOTS.reduce((sum, s) => sum + estimate(s.model, s.seconds), 0);
	const score = estimate("minimax/music-3", SCORE_SECONDS);
	console.log(
		`stills $${stills.toFixed(3)}  shots $${shots.toFixed(3)}  score $${score.toFixed(3)}  total $${(stills + shots + score).toFixed(2)}`,
	);
}

const step = process.argv[2];
const runs = (...names: string[]) => !step || names.includes(step);
await fs.mkdir(ASSETS, { recursive: true });
if (step === "cost") {
	cost();
} else {
	// The analysis steps are local; only generation needs a fal key.
	const fal = runs("fonts", "images", "videos", "music") ? client() : null;
	if (runs("fonts")) await fonts();
	if (fal && runs("images")) await images(fal);
	// Music and motion are independent; run them side by side.
	await Promise.all([
		fal && runs("videos") ? videos(fal) : undefined,
		fal && runs("music") ? music(fal) : undefined,
	]);
	if (runs("music", "grid")) await grid();
	if (runs("videos", "circles")) await circles();
	if (fal && fal.totalUsd > 0)
		console.log(`spent  ~$${fal.totalUsd.toFixed(3)}`);
}
process.exit(0);
