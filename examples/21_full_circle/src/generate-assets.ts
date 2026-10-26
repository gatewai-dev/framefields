/**
 * Asset pipeline for Full Circle. Every model is the cheapest one that holds
 * up on screen; the whole film costs about $6.50 to generate.
 *
 *   pnpm assets          → fonts, stills, shots, score, beat grid
 *   pnpm assets images   → stills only    (Seedream 5.0 Pro, $0.072 each)
 *   pnpm assets videos   → shots only     (Seedance 2.0 Mini at 720p, $0.121/s)
 *   pnpm assets music    → score only     (Seed Audio, $0.003125/s)
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
import { ai } from "framefields";
import { analyzeBeatGrid } from "./beat-grid.js";
import {
	type Circle,
	type CircleTrack,
	cleanTrack,
	measureCircle,
} from "./circles.js";
import { download, estimate, exists } from "./gateway.js";
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
	"JetBrainsMono.ttf":
		"https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
};

/** Seedance keeps the first frame's 16:9 framing at 720p. */
const STILL = { width: 1920, height: 1080 };
const VIDEO_MODEL = "seedance/2.0-mini";

const elapsed = (t0: number) => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

let spent = 0;

function checkApiKey(): void {
	const key = process.env.FRAMEFIELDS_API_KEY;
	if (!key) throw new Error("FRAMEFIELDS_API_KEY missing from .env");
}

async function fonts() {
	for (const [file, url] of Object.entries(FONTS)) {
		const dest = path.join(ROOT, "assets/fonts", file);
		if (await exists(dest)) continue;
		await download(url, dest);
		console.log(`font   ${file}`);
	}
}

async function images() {
	checkApiKey();
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.png`);
			if (await exists(dest)) return;
			const t0 = Date.now();
			const { data: out } = await ai.subscribe<{ images: { url: string }[] }>(
				"seedream/5.0-pro",
				{
					input: {
						prompt: shot.image,
						size: `${STILL.width}x${STILL.height}`,
						output_format: "png",
					},
				},
			);
			await download(out.images[0].url, dest);
			spent += estimate("seedream/5.0-pro", 1);
			console.log(`image  ${shot.id} (${elapsed(t0)})`);
		}),
	);
}

/** Seedance accepts a data URI first frame, so the local still is sent as-is. */
async function videos(target?: string) {
	checkApiKey();
	const shotList = target ? SHOTS.filter((s) => s.id === target) : SHOTS;
	await Promise.all(
		shotList.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.mp4`);
			if (await exists(dest)) return;
			const still = await fs.readFile(path.join(ASSETS, `${shot.id}.png`));
			const t0 = Date.now();
			const { data: out } = await ai.subscribe<{ video: { url: string } }>(
				VIDEO_MODEL,
				{
					input: {
						prompt: shot.motion,
						content: [
							{
								type: "image_url",
								image_url: {
									url: `data:image/png;base64,${still.toString("base64")}`,
								},
								role: "first_frame",
							},
						],
						resolution: "720p",
						ratio: "16:9",
						duration: shot.seconds,
						generate_audio: false,
					},
				},
			);
			await download(out.video.url, dest);
			spent += estimate(VIDEO_MODEL, shot.seconds);
			console.log(`video  ${shot.id} (${elapsed(t0)})`);
		}),
	);
}

async function music() {
	checkApiKey();
	const dest = path.join(ASSETS, "score.wav");
	if (await exists(dest)) return;
	const t0 = Date.now();
	const { data: out } = await ai.subscribe<{
		audio: { url: string; duration: number };
	}>("seed-audio/1.0", {
		input: {
			text_prompt: SCORE.prompt,
			audio_config: { format: "wav", sample_rate: 48000 },
		},
	});
	await download(out.audio.url, dest);
	spent += estimate("seed-audio/1.0", out.audio.duration);
	console.log(
		`music  score ${out.audio.duration.toFixed(1)}s (${elapsed(t0)})`,
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
async function circles(target?: string) {
	let tracks: Record<string, CircleTrack> = {};
	const jsonPath = path.join(ASSETS, "circles.json");
	if (target && (await exists(jsonPath))) {
		tracks = JSON.parse(await fs.readFile(jsonPath, "utf8"));
	}
	const shotList = target ? SHOTS.filter((s) => s.id === target) : SHOTS;
	const size = FRAME.w * FRAME.h;
	for (const shot of shotList) {
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
			if (c) seed = "seed" in spec && spec.seed ? spec.seed : [c.cx, c.cy];
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
	const stills = SHOTS.length * estimate("seedream/5.0-pro", 1);
	const shots = SHOTS.reduce(
		(sum, s) => sum + estimate(VIDEO_MODEL, s.seconds),
		0,
	);
	const score = estimate("seed-audio/1.0", SCORE_SECONDS);
	console.log(
		`stills $${stills.toFixed(3)}  shots $${shots.toFixed(3)}  score $${score.toFixed(3)}  total $${(stills + shots + score).toFixed(2)}`,
	);
}

const step = process.argv[2];
const target = process.argv[3];
const runs = (...names: string[]) => !step || names.includes(step);
await fs.mkdir(ASSETS, { recursive: true });
if (step === "cost") {
	cost();
} else {
	if (runs("fonts")) await fonts();
	if (runs("images")) await images();
	// Music and motion are independent; run them side by side.
	await Promise.all([
		runs("videos") ? videos(target) : undefined,
		runs("music") ? music() : undefined,
	]);
	if (runs("music", "grid")) await grid();
	if (runs("videos", "circles")) await circles(target);
	if (spent > 0) console.log(`spent  ~$${spent.toFixed(3)}`);
}
process.exit(0);
