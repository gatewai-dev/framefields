/**
 * pnpm audio       → assets/voice/<line>.wav, assets/music.wav, and what was
 *                    measured in assets/audio.json
 * pnpm audio cost  → print the estimate, no calls
 *
 * ElevenLabs v3 reads each line of the narration. Scribe v2 checks that
 * every line was read as written and finds its first and last word, so each
 * line is trimmed to its speech and the film can start it exactly where it
 * belongs. The bed is synthesized (bed.ts). Idempotent: delete a file to make
 * it again. Raw takes are kept in assets/takes/.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ai } from "framefields";
import {
	type AudioManifest,
	KEYTERMS,
	LINE_IDS,
	LINES,
	type LineId,
	MANIFEST,
	MUSIC_BELLS,
	MUSIC_PATH,
	MUSIC_SECONDS,
	MUSIC_VERSION,
	type SpokenWord,
	TRANSCRIBER,
	VOICE_LEAD,
	VOICE_MODEL,
	voiceInput,
	voicePath,
} from "./audio.js";
import { BED_RATE, synthesizeBed } from "./bed.js";
import { spokenWords } from "./spoken.js";
import { ASSETS } from "./theme.js";

/** Rates (November 2026): per minute transcribed, and per 1000 characters read. */
const PER_MINUTE = 0.0125;
const PER_1000_CHARACTERS = 0.1;
const SAMPLE_RATE = 48000;
const MAX_TAKES = 6;
const TAKES = path.join(ASSETS, "takes");
/** Kept after a line's last word, faded over its second half. */
const VOICE_TAIL = 0.3;

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

/** Runs `model` on fal and saves the audio it returns to `dest`. */
async function generate(
	model: string,
	input: Record<string, unknown>,
	dest: string,
): Promise<void> {
	const run = await fetch(`https://fal.run/${model}`, {
		method: "POST",
		headers: {
			Authorization: `Key ${process.env.FAL_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(input),
	});
	if (!run.ok) throw new Error(`${model} → ${run.status} ${await run.text()}`);
	const data = (await run.json()) as { audio: { url: string } };
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

/** Word times rounded to the millisecond. */
const rounded = (heard: Word[]): SpokenWord[] =>
	heard.map(({ text, start, end }) => ({
		text,
		start: Number(start.toFixed(3)),
		end: Number(end.toFixed(3)),
	}));

/** The longest silence kept after a word: a breath at a full stop, less at a comma. */
const hold = (word: string) =>
	/[.:;!?]$/.test(word) ? 0.5 : /,$/.test(word) ? 0.32 : 0.26;

interface Edit {
	/** Stretches of the take to keep, in seconds. */
	keep: Array<[number, number]>;
	/** The words, timed in the edited line. */
	words: Word[];
}

/**
 * The take from just before its first word to just after its last, with
 * every silence longer than its punctuation allows cut down to that length
 * (the model likes to stop and think).
 */
function tighten(heard: Word[], end: number): Edit {
	const first = heard[0];
	const last = heard.at(-1);
	if (!first || !last) return { keep: [], words: [] };
	const keep: Array<[number, number]> = [];
	const words: Word[] = [];
	let from = Math.max(0, first.start - VOICE_LEAD);
	// Seconds of the take before `from` that are not in the edited line.
	let removed = from;
	heard.forEach((word, i) => {
		const before = heard[i - 1];
		const allowed = before ? hold(before.text) : 0;
		if (before && word.start - before.end > allowed) {
			const half = allowed / 2;
			keep.push([from, before.end + half]);
			removed += word.start - half - (before.end + half);
			from = word.start - half;
		}
		words.push({
			text: word.text,
			start: word.start - removed,
			end: word.end - removed,
		});
	});
	keep.push([from, Math.min(end, last.end + VOICE_TAIL)]);
	return { keep, words };
}

/** Joins the kept stretches of `src` into a leveled 48 kHz mono WAV. */
function assemble(src: string, dest: string, keep: Array<[number, number]>) {
	mkdirSync(path.dirname(dest), { recursive: true });
	const seam = 0.008;
	const parts = keep.map(([from, to], i) => {
		const length = to - from;
		return `[0:a]atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS,afade=t=in:d=${seam},afade=t=out:st=${(length - seam).toFixed(3)}:d=${seam}[p${i}]`;
	});
	const total = keep.reduce((sum, [from, to]) => sum + to - from, 0);
	const joined = `${keep.map((_, i) => `[p${i}]`).join("")}concat=n=${keep.length}:v=0:a=1,afade=t=out:st=${(total - VOICE_TAIL / 2).toFixed(3)}:d=${(VOICE_TAIL / 2).toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-i",
		src,
		"-filter_complex",
		[...parts, joined].join(";"),
		"-map",
		"[out]",
		"-ar",
		`${SAMPLE_RATE}`,
		"-ac",
		"1",
		dest,
	]);
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
		// Same words, and no question where the script states something.
		const asks = said.includes("?") && !text.includes("?");
		if (heard.length === 0 || spokenWords(said) !== spokenWords(text) || asks) {
			console.log(`voice  ${id} take ${take} heard "${said}", retrying`);
			continue;
		}
		const { keep, words } = tighten(heard, duration(raw));
		assemble(raw, voicePath(id), keep);
		const seconds = duration(voicePath(id));
		console.log(
			`voice  ${id} ${seconds.toFixed(2)} s (${keep.length - 1} pauses shortened) "${said}"`,
		);
		return { text, input, heard: said, seconds, words: rounded(words) };
	}
	throw new Error(
		`No take of "${text}" was read as written in ${MAX_TAKES} tries.`,
	);
}

/** Synthesizes the bed and levels it to sit under a narrator. */
function music(): AudioManifest["music"] {
	const samples = synthesizeBed(MUSIC_SECONDS, MUSIC_BELLS);
	mkdirSync(path.dirname(MUSIC_PATH), { recursive: true });
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			"-f",
			"f32le",
			"-ar",
			`${BED_RATE}`,
			"-ac",
			"2",
			"-i",
			"pipe:0",
			"-af",
			"loudnorm=I=-20:TP=-2:LRA=11",
			"-ar",
			`${SAMPLE_RATE}`,
			MUSIC_PATH,
		],
		{ input: Buffer.from(samples.buffer) },
	);
	const seconds = duration(MUSIC_PATH);
	console.log(`music  ${seconds.toFixed(1)} s`);
	return { version: MUSIC_VERSION, seconds };
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
	if (!process.env.FRAMEFIELDS_API_KEY || !process.env.FAL_API_KEY)
		throw new Error(
			"FRAMEFIELDS_API_KEY and FAL_API_KEY are needed in the repo root .env",
		);
	const manifest = await readPartial();
	const voice: Partial<AudioManifest["voice"]> = {};
	for (const id of LINE_IDS) {
		const kept = manifest.voice?.[id];
		const same = JSON.stringify(kept?.input) === JSON.stringify(voiceInput(id));
		if (kept && same && existsSync(voicePath(id))) {
			voice[id] = kept;
			continue;
		}
		voice[id] = await voiceLine(id);
		await save({ ...manifest, voice: voice as AudioManifest["voice"] });
	}
	manifest.voice = voice as AudioManifest["voice"];
	if (manifest.music?.version !== MUSIC_VERSION || !existsSync(MUSIC_PATH)) {
		manifest.music = music();
		await save(manifest);
	}
	console.log(`spent  ~$${spent.toFixed(3)}`);
}

if (process.argv[2] === "cost") {
	const characters = Object.values(LINES).join("").length;
	const speech = Object.values(LINES).join(" ").split(" ").length / 2.6;
	const usd =
		(PER_1000_CHARACTERS * characters) / 1000 + (PER_MINUTE * speech) / 60;
	console.log(
		`estimate $${usd.toFixed(2)} per pass (${characters} characters, about ${speech.toFixed(0)} s of narration), up to ${MAX_TAKES}× with retries`,
	);
} else {
	await main();
}
process.exit(0);
