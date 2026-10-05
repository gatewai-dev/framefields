/**
 * Asset pipeline for the Framefields film.
 *
 *   pnpm assets            → fonts, plates (gpt-image-2), shots (h3-max / h3-max-turbo), score (ElevenLabs)
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
import { SCORE, SHOTS } from "./shots.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const ASSETS = path.resolve(HERE, "../assets");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const FAL_KEY = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
if (!FAL_KEY) throw new Error("FAL_API_KEY missing from .env");

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

/** Submits to the fal queue and polls until the result is ready. */
async function fal<T>(model: string, input: Record<string, unknown>): Promise<T> {
	const headers = {
		Authorization: `Key ${FAL_KEY}`,
		"Content-Type": "application/json",
	};
	const submit = await request(`https://queue.fal.run/${model}`, {
		method: "POST",
		headers,
		body: JSON.stringify(input),
	});
	if (!submit.ok) throw new Error(`${model} submit → ${submit.status} ${await submit.text()}`);
	const { status_url, response_url } = (await submit.json()) as {
		status_url: string;
		response_url: string;
	};

	for (;;) {
		await sleep(4000);
		const res = await request(status_url, { headers });
		const { status } = (await res.json()) as { status: string };
		if (status === "COMPLETED") break;
		if (status !== "IN_QUEUE" && status !== "IN_PROGRESS") {
			throw new Error(`${model} → ${status}`);
		}
	}
	const result = await request(response_url, { headers });
	if (!result.ok) throw new Error(`${model} result → ${result.status} ${await result.text()}`);
	return (await result.json()) as T;
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
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.png`);
			if (await exists(dest)) return;
			const t0 = Date.now();
			const out = await fal<{ images: { url: string }[] }>("openai/gpt-image-2", {
				prompt: shot.image,
				image_size: { width: 2048, height: 1152 },
				quality: "high",
				output_format: "png",
			});
			await download(out.images[0].url, dest);
			console.log(`image  ${shot.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
		}),
	);
}

/** fal accepts data URIs for image inputs, so the local plate is sent as-is. */
async function videos() {
	await Promise.all(
		SHOTS.map(async (shot) => {
			const dest = path.join(ASSETS, `${shot.id}.mp4`);
			if (await exists(dest)) return;
			const plate = await fs.readFile(path.join(ASSETS, `${shot.id}.png`));
			const t0 = Date.now();
			const out = await fal<{ video: { url: string } }>(
				shot.model ?? "minimax/h3-max-turbo/image-to-video",
				{
					prompt: shot.motion,
					image_url: `data:image/png;base64,${plate.toString("base64")}`,
					duration: shot.seconds,
					resolution: "1080P",
					prompt_expansion_mode: "disabled",
				},
			);
			await download(out.video.url, dest);
			console.log(`video  ${shot.id} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
		}),
	);
}

async function music() {
	const dest = path.join(ASSETS, "score.mp3");
	if (await exists(dest)) return;
	const t0 = Date.now();
	const out = await fal<{ audio: { url: string } }>("fal-ai/elevenlabs/music", {
		composition_plan: SCORE,
		respect_sections_durations: true,
	});
	await download(out.audio.url, dest);
	console.log(`music  score (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const step = process.argv[2];
await fs.mkdir(ASSETS, { recursive: true });
if (!step || step === "fonts") await fonts();
if (!step || step === "images") await images();
if (!step || step === "videos") await videos();
if (!step || step === "music") await music();
