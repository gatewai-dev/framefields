/**
 * pnpm generate → assets/generated/<still>.<n>.jpg, assets/voice/<line>.mp3,
 * assets/music.mp3 and assets/audio.json, all through the framefields AI
 * gateway (FRAMEFIELDS_API_KEY from the repo root .env). Images only, never
 * video: the film moves the stills itself. Idempotent: whatever is on disk
 * is kept; delete a file to make it again.
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import { ai } from "framefields";
import {
	AUDIO_MANIFEST,
	type AudioManifest,
	candidatePath,
	GENERATED,
	IMAGE_MODEL,
	MUSIC,
	MUSIC_MODEL,
	MUSIC_PROMPT,
	MUSIC_SECONDS,
	STILLS,
	type StillId,
	stillPrompt,
	VOICE_DIR,
	VOICE_ID,
	VOICE_MODEL,
	voicePath,
	type Word,
} from "./assets.js";
import { LINE_IDS, LINES, type LineId } from "./script.js";

/** USD rates from estimate_generation_cost (November 2026). */
const RATES = { image: 0.05625, per1kCharacters: 0.1, musicMinute: 0.1875 };

process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
const apiKey = process.env.FRAMEFIELDS_API_KEY;
if (!apiKey)
	throw new Error("FRAMEFIELDS_API_KEY missing from the repo root .env");
ai.config({ apiKey });

let spent = 0;

async function save(url: string, dest: string): Promise<void> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
	await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
	console.log(`wrote ${dest}`);
}

async function stills(): Promise<void> {
	await fs.mkdir(GENERATED, { recursive: true });
	for (const id of Object.keys(STILLS) as StillId[]) {
		const n = STILLS[id].candidates;
		const paths = Array.from({ length: n }, (_, i) => candidatePath(id, i + 1));
		if (paths.every((p) => existsSync(p))) continue;
		const { data } = await ai.subscribe<{ images: { url: string }[] }>(
			IMAGE_MODEL,
			{
				input: {
					prompt: stillPrompt(id),
					aspect_ratio: "4:3",
					resolution: "2K",
					num_images: n,
					output_format: "jpeg",
				},
			},
		);
		for (const [i, image] of data.images.entries())
			await save(image.url, paths[i]);
		spent += data.images.length * RATES.image;
	}
}

interface Alignment {
	characters: string[];
	character_start_times_seconds: number[];
	character_end_times_seconds: number[];
}

/** Characters with times → words with times (punctuation stays on its word). */
function words(a: Alignment): Word[] {
	const out: Word[] = [];
	let current: Word | null = null;
	a.characters.forEach((ch, i) => {
		if (/\s/.test(ch)) {
			current = null;
			return;
		}
		const start = a.character_start_times_seconds[i] ?? 0;
		const end = a.character_end_times_seconds[i] ?? start;
		if (!current) {
			current = { text: "", start, end };
			out.push(current);
		}
		current.text += ch;
		current.end = end;
	});
	return out;
}

async function voice(manifest: AudioManifest): Promise<void> {
	await fs.mkdir(VOICE_DIR, { recursive: true });
	for (const [i, id] of LINE_IDS.entries()) {
		if (existsSync(voicePath(id)) && manifest.lines[id]) continue;
		const { data } = await ai.subscribe<{
			audio: { url: string; duration?: number };
			alignment: Alignment;
		}>(VOICE_MODEL, {
			input: {
				text: LINES[id],
				voice_id: VOICE_ID,
				previous_text: i > 0 ? LINES[LINE_IDS[i - 1] as LineId] : undefined,
				next_text: LINE_IDS[i + 1]
					? LINES[LINE_IDS[i + 1] as LineId]
					: undefined,
				voice_settings: { stability: 0.55, style: 0.2, speed: 0.95 },
				seed: 43,
			},
		});
		await save(data.audio.url, voicePath(id));
		const spoken = words(data.alignment);
		const duration = data.audio.duration ?? spoken.at(-1)?.end ?? 0;
		manifest.lines[id] = { duration, words: spoken };
		spent += (LINES[id].length / 1000) * RATES.per1kCharacters;
	}
}

async function music(): Promise<void> {
	if (existsSync(MUSIC)) return;
	const { data } = await ai.subscribe<{ audio: { url: string } }>(MUSIC_MODEL, {
		input: {
			prompt: MUSIC_PROMPT,
			music_length_ms: MUSIC_SECONDS * 1000,
			force_instrumental: true,
		},
	});
	await save(data.audio.url, MUSIC);
	spent += (MUSIC_SECONDS / 60) * RATES.musicMinute;
}

const manifest: AudioManifest = existsSync(AUDIO_MANIFEST)
	? JSON.parse(await fs.readFile(AUDIO_MANIFEST, "utf8"))
	: { lines: {} as AudioManifest["lines"] };
await stills();
await voice(manifest);
await fs.writeFile(AUDIO_MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
await music();
console.log(spent > 0 ? `spent ~$${spent.toFixed(2)}` : "nothing to generate");
process.exit(0);
