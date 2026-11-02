/**
 * pnpm audio       → assets/voice/<line>.wav, assets/music.wav, and what was
 *                    measured in assets/audio.json
 * pnpm audio cost  → print the estimate, no calls
 *
 * Gemini 3.8 Flash TTS reads each line of the narration and Lyria 3.5 plays
 * the bed. Scribe v2 checks that every line was read as written and finds its
 * first and last word, so each line is trimmed to its speech and the film can
 * start it exactly where it belongs; it also checks the music has no voice in
 * it. Idempotent: delete a file to make it again. Raw takes are kept in
 * assets/takes/.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ai } from "framefields";
import {
	type AudioManifest,
	LINE_IDS,
	LINES,
	type LineId,
	MANIFEST,
	MUSIC_MODEL,
	MUSIC_PATH,
	MUSIC_PROMPT,
	MUSIC_SECONDS,
	type SpokenWord,
	TRANSCRIBER,
	VOICE_LEAD,
	VOICE_MODEL,
	voiceInput,
	voicePath,
} from "./audio.js";
import { spokenWords } from "./spoken.js";
import { ASSETS } from "./theme.js";

/**
 * The gateway's rates (November 2026: fal's price plus 25 %): per minute
 * transcribed, per 1000 characters read, and per music track.
 */
const PER_MINUTE = 0.0125;
const PER_1000_CHARACTERS = 0.05625;
const PER_TRACK = 0.125;
const SAMPLE_RATE = 48000;
const MAX_TAKES = 4;
const TAKES = path.join(ASSETS, "takes");
/** Kept after a line's last word, faded over its second half. */
const VOICE_TAIL = 0.3;
/** Longest silence allowed between two words of a sentence; punctuation may hold longer (`HOLD`). */
const MAX_PAUSE = 0.5;
const KEYTERMS = [
	"Learjet",
	"Eleuthera",
	"Palm Beach",
	"FAA",
	"Military Trail",
];

/** A take's file, named by what was asked for, so a changed prompt is made afresh. */
const takePath = (
	kind: string,
	input: Record<string, unknown>,
	take: number,
	ext = "wav",
) =>
	path.join(
		TAKES,
		`${kind}-${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 8)}-${take}.${ext}`,
	);

let spent = 0;

/** Runs `model` and saves the audio it returns to `dest`. */
async function generate(
	model: string,
	input: Record<string, unknown>,
	dest: string,
): Promise<void> {
	const { data } = await ai.subscribe<{ audio: { url: string } }>(model, {
		input,
	});
	const res = await fetch(data.audio.url);
	if (!res.ok) throw new Error(`GET ${data.audio.url} → ${res.status}`);
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
}

interface Word {
	text: string;
	start: number;
	end: number;
}

async function transcribe(file: string): Promise<Word[]> {
	const type = file.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
	const audio = new Blob([await fs.readFile(file)], { type });
	const { data } = await ai.subscribe<{
		words: Array<Word & { type: string }>;
	}>(TRANSCRIBER, {
		input: {
			audio_url: audio,
			language_code: "eng",
			keyterms: KEYTERMS,
			tag_audio_events: false,
		},
	});
	spent += (PER_MINUTE * duration(file)) / 60;
	return data.words
		.filter((w) => w.type === "word")
		.map(({ text, start, end }) => ({ text: text.trim(), start, end }));
}

function duration(file: string): number {
	const out = execFileSync("ffprobe", [
		"-v",
		"error",
		"-show_entries",
		"format=duration",
		"-of",
		"csv=p=0",
		file,
	]);
	return Number(out.toString().trim());
}

/** Cuts `from`–`to` seconds of `src` through `filters` into a 48 kHz WAV. */
function cut(
	src: string,
	dest: string,
	from: number,
	to: number,
	filters: string[],
	channels: 1 | 2,
) {
	mkdirSync(path.dirname(dest), { recursive: true });
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-ss",
		from.toFixed(3),
		"-to",
		to.toFixed(3),
		"-i",
		src,
		"-af",
		filters.join(","),
		"-ar",
		`${SAMPLE_RATE}`,
		"-ac",
		`${channels}`,
		dest,
	]);
}

/** Word times moved by `by` seconds, rounded to the millisecond. */
const shift = (heard: Word[], by: number): SpokenWord[] =>
	heard.map(({ text, start, end }) => ({
		text,
		start: Number((start + by).toFixed(3)),
		end: Number((end + by).toFixed(3)),
	}));

/** How much longer than a gap between words a punctuation mark may hold. */
const HOLD = (word: string) =>
	/[.:;]$/.test(word) ? 2 : /,$/.test(word) ? 1.4 : 1;

/** The longest gap between words, each measured against what its punctuation allows. */
function longestPause(heard: Word[]): number {
	let longest = 0;
	for (let i = 1; i < heard.length; i++) {
		const before = heard[i - 1];
		const word = heard[i];
		if (!before || !word) continue;
		longest = Math.max(longest, (word.start - before.end) / HOLD(before.text));
	}
	return longest;
}

async function voiceLine(id: LineId): Promise<AudioManifest["voice"][LineId]> {
	const text = LINES[id];
	for (let take = 1; take <= MAX_TAKES; take++) {
		const input = voiceInput(id);
		const raw = takePath(`voice-${id}`, input, take);
		if (!existsSync(raw)) {
			await generate(VOICE_MODEL, input, raw);
			spent += (PER_1000_CHARACTERS * text.length) / 1000;
		}
		const heard = await transcribe(raw);
		const said = heard.map((w) => w.text).join(" ");
		const first = heard[0];
		const last = heard.at(-1);
		// Same words, no question where the script states something, no long pauses.
		const asks = said.includes("?") && !text.includes("?");
		const pause = longestPause(heard);
		if (
			!first ||
			!last ||
			spokenWords(said) !== spokenWords(text) ||
			asks ||
			pause > MAX_PAUSE
		) {
			console.log(
				`voice  ${id} take ${take} heard "${said}" (longest pause ${pause.toFixed(2)} s), retrying`,
			);
			continue;
		}
		const from = Math.max(0, first.start - VOICE_LEAD);
		const to = Math.min(duration(raw), last.end + VOICE_TAIL);
		const length = to - from;
		cut(
			raw,
			voicePath(id),
			from,
			to,
			[
				"afade=t=in:d=0.01",
				`afade=t=out:st=${(length - VOICE_TAIL / 2).toFixed(3)}:d=${(VOICE_TAIL / 2).toFixed(3)}`,
				"loudnorm=I=-16:TP=-1.5:LRA=11",
			],
			1,
		);
		const seconds = duration(voicePath(id));
		console.log(`voice  ${id} ${seconds.toFixed(2)} s "${said}"`);
		return { text, input, heard: said, seconds, words: shift(heard, -from) };
	}
	throw new Error(
		`No take of "${text}" was read as written in ${MAX_TAKES} tries.`,
	);
}

async function music(): Promise<AudioManifest["music"]> {
	const input = { prompt: MUSIC_PROMPT };
	for (let take = 1; take <= MAX_TAKES; take++) {
		const raw = takePath("music", input, take, "mp3");
		if (!existsSync(raw)) {
			await generate(MUSIC_MODEL, input, raw);
			spent += PER_TRACK;
		}
		const length = duration(raw);
		const heard = await transcribe(raw);
		if (heard.length > 0 || length < MUSIC_SECONDS) {
			console.log(
				`music  take ${take}: ${length.toFixed(1)} s, heard "${heard.map((w) => w.text).join(" ")}", retrying`,
			);
			continue;
		}
		cut(
			raw,
			MUSIC_PATH,
			0,
			MUSIC_SECONDS,
			[
				`afade=t=out:st=${(MUSIC_SECONDS - 3).toFixed(3)}:d=3`,
				"loudnorm=I=-20:TP=-2:LRA=11",
			],
			2,
		);
		const seconds = duration(MUSIC_PATH);
		console.log(`music  ${seconds.toFixed(1)} s of ${length.toFixed(1)} s`);
		return { prompt: MUSIC_PROMPT, seconds };
	}
	throw new Error(
		`No instrumental music take of ${MUSIC_SECONDS} s or more in ${MAX_TAKES} tries.`,
	);
}

async function readPartial(): Promise<Partial<AudioManifest>> {
	if (!existsSync(MANIFEST)) return {};
	return JSON.parse(
		await fs.readFile(MANIFEST, "utf8"),
	) as Partial<AudioManifest>;
}

async function save(manifest: Partial<AudioManifest>): Promise<void> {
	await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, "\t")}\n`);
}

async function main(): Promise<void> {
	process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
	if (!process.env.FRAMEFIELDS_API_KEY)
		throw new Error("FRAMEFIELDS_API_KEY missing from the repo root .env");
	const manifest = await readPartial();
	const voice: Partial<AudioManifest["voice"]> = {};
	for (const id of LINE_IDS) {
		const kept = manifest.voice?.[id];
		const same = JSON.stringify(kept?.input) === JSON.stringify(voiceInput(id));
		if (kept && same && existsSync(voicePath(id))) {
			// Lines made before word timings were kept: read them off the trimmed file.
			voice[id] = kept.words
				? kept
				: { ...kept, words: shift(await transcribe(voicePath(id)), 0) };
			continue;
		}
		voice[id] = await voiceLine(id);
		await save({ ...manifest, voice: voice as AudioManifest["voice"] });
	}
	manifest.voice = voice as AudioManifest["voice"];
	if (manifest.music?.prompt !== MUSIC_PROMPT || !existsSync(MUSIC_PATH)) {
		manifest.music = await music();
		await save(manifest);
	}
	console.log(`spent  ~$${spent.toFixed(3)}`);
}

if (process.argv[2] === "cost") {
	const characters = Object.values(LINES).join("").length;
	const speech = Object.values(LINES).join(" ").split(" ").length / 2.6;
	const usd =
		(PER_1000_CHARACTERS * characters) / 1000 +
		PER_TRACK +
		(PER_MINUTE * (speech + MUSIC_SECONDS)) / 60;
	console.log(
		`estimate $${usd.toFixed(2)} per pass (${characters} characters of narration, a ${MUSIC_SECONDS} s music track), up to ${MAX_TAKES}× with retries`,
	);
} else {
	await main();
}
process.exit(0);
