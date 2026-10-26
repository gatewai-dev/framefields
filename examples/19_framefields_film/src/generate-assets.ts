/**
 * Asset pipeline for the Framefields film.
 *
 *   pnpm assets            → fonts, plates (Seedream 5.0 Pro), shots (Seedance 2.0 Mini, 720p), score (Seed Audio)
 *   pnpm assets images     → only the stills
 *   pnpm assets videos     → only the image-to-video shots
 *   pnpm assets music      → only the score
 *
 * Every step is idempotent: existing files are kept, delete one to regenerate it.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { ai } from "framefields";
import { SHOTS, scorePrompt } from "./shots.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ASSETS = path.resolve(HERE, "../assets");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

function checkApiKey() {
	const key = process.env.FRAMEFIELDS_API_KEY;
	if (!key) throw new Error("FRAMEFIELDS_API_KEY missing from .env");
}

const FONTS: Record<string, string> = {
	"InstrumentSerif-Regular.ttf":
		"https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Regular.ttf",
	"InstrumentSerif-Italic.ttf":
		"https://github.com/google/fonts/raw/main/ofl/instrumentserif/InstrumentSerif-Italic.ttf",
	"JetBrainsMono.ttf":
		"https://github.com/google/fonts/raw/main/ofl/jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf",
};

const exists = (p: string) =>
	fs.access(p).then(
		() => true,
		() => false,
	);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** fetch that rides out transient network failures (long polls drop connections). */
async function request(url: string, init?: RequestInit): Promise<Response> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fetch(url, init);
		} catch (err) {
			if (attempt === 5) throw err;
			await sleep(2000 * attempt);
		}
	}
}

async function download(url: string, dest: string): Promise<void> {
	const res = await request(url);
	if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

async function fonts() {
	const dir = path.join(ROOT, "assets/fonts");
	for (const [file, url] of Object.entries(FONTS)) {
		const dest = path.join(dir, file);
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
						size: "2048x1152",
						output_format: "png",
					},
				},
			);
			await download(out.images[0].url, dest);
			console.log(
				`image  ${shot.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
			);
		}),
	);
}

/** Seedance accepts a data URI first frame, so the local plate is sent as-is. */
async function videos() {
	checkApiKey();
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.mp4`);
			if (await exists(dest)) return;
			const plate = await fs.readFile(path.join(ASSETS, `${shot.id}.png`));
			const t0 = Date.now();
			const { data: out } = await ai.subscribe<{ video: { url: string } }>(
				"seedance/2.0-mini",
				{
					input: {
						prompt: shot.motion,
						content: [
							{
								type: "image_url",
								image_url: {
									url: `data:image/png;base64,${plate.toString("base64")}`,
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
			console.log(
				`video  ${shot.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`,
			);
		}),
	);
}

async function music() {
	checkApiKey();
	const dest = path.join(ASSETS, "score.mp3");
	if (await exists(dest)) return;
	const t0 = Date.now();
	const { data: out } = await ai.subscribe<{ audio: { url: string } }>(
		"seed-audio/1.0",
		{
			input: {
				text_prompt: scorePrompt(),
				audio_config: { format: "mp3" },
			},
		},
	);
	await download(out.audio.url, dest);
	console.log(`music  score (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const step = process.argv[2];
await fs.mkdir(ASSETS, { recursive: true });
if (!step || step === "fonts") await fonts();
if (!step || step === "images") await images();
if (!step || step === "videos") await videos();
if (!step || step === "music") await music();
