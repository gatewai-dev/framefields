/**
 * pnpm song        → the whole soundtrack pipeline (idempotent; delete a file to redo its step)
 * pnpm song cost   → print the estimate, no calls
 * pnpm song measure → re-run the free steps (grid, structure, lyrics, envelopes)
 *
 *   1. song       ElevenLabs Music v2.5, one chunk per section of song.ts      → assets/song.mp3
 *   2. stems      fal-ai/demucs: vocals, drums                                   → assets/stems/
 *   3. words      ElevenLabs Scribe v2 on the vocal stem, word timestamps        → assets/words.json
 *   4. grid       the drum stem's tempo (beat-grid.ts), checked against 180 BPM
 *   5. lyrics     written words aligned to heard words                           → assets/lyrics.json
 *   6. chapters   lyric line starts and the final hit (chapters.ts)              → assets/structure.json
 *   7. envelopes  kick / snare from the drum stem, vocal level                   → assets/envelopes.json
 *
 * The soundtrack is song.mp3 itself, untouched: the film's clock is the take's
 * clock, so nothing here stretches, shifts or re-masters the audio.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { download, exists, FalClient, PRICING } from "./fal.js";
import { BAR_SEC, BPM, PLAN_SEC, SAMPLE_RATE } from "./grid.js";
import { alignLyrics, type HeardWord } from "./music/align.js";
import { analyzeBeatGrid } from "./music/beat-grid.js";
import { chaptersOf } from "./music/chapters.js";
import { type Stereo, stereo } from "./music/dsp.js";
import { envelopes } from "./music/envelopes.js";
import { findFinalHit } from "./music/structure.js";
import { ASSETS, asset, ROOT } from "./paths.js";
import {
	GLOBAL_AVOID,
	GLOBAL_STYLES,
	SECTIONS,
	sectionDurationsMs,
} from "./song.js";

const SONG = asset("song.mp3");
const SONG_META = asset("song.json");
const WORDS = asset("words.json");
const STEMS = asset("stems.json");
const stem = (name: string) => asset(`stems/${name}.wav`);

const step = process.argv[2] ?? "all";

function client(): FalClient {
	process.loadEnvFile(path.join(ROOT, ".env"));
	const key = process.env.FAL_API_KEY ?? process.env.FAL_KEY;
	if (!key) throw new Error("FAL_API_KEY missing from the repo root .env");
	return new FalClient(key);
}

/** Generous upper bound on the music model's compute time, for the estimate. */
const SONG_COMPUTE_SEC = 120;

async function song(fal: FalClient, seed: number): Promise<void> {
	if (await exists(SONG)) return;
	const durations = sectionDurationsMs();
	// v2.5 has no global styles: the first chunk's styles set the whole song's
	// tone, so it carries the global ones; every chunk avoids the global faults.
	const plan = {
		chunks: SECTIONS.map((s, i) => ({
			duration_ms: durations[i],
			text: [`[${s.name}]`, ...s.lines].join("\n"),
			positive_styles: i === 0 ? [...GLOBAL_STYLES, ...s.styles] : s.styles,
			negative_styles: [...GLOBAL_AVOID, ...s.avoid],
			context_adherence: "high",
		})),
	};
	const t0 = Date.now();
	const out = await fal.run<{ audio: { url: string } }>(
		"fal-ai/elevenlabs/music/v2.5",
		{ composition_plan: plan, seed, output_format: "mp3_48000_192" },
		SONG_COMPUTE_SEC,
	);
	await download(out.audio.url, SONG);
	await fs.writeFile(
		SONG_META,
		JSON.stringify({ url: out.audio.url, seed, plan }, null, 2),
	);
	console.log(
		`song   ${SONG} seed ${seed} (${((Date.now() - t0) / 1000).toFixed(0)} s)`,
	);
}

/** The vocal stem is transcribed; the drum stem gives the grid and the hits. */
type StemName = "vocals" | "drums";
const STEM_NAMES: StemName[] = ["vocals", "drums"];

async function stems(fal: FalClient): Promise<void> {
	if (await exists(STEMS)) return;
	const { url } = JSON.parse(await fs.readFile(SONG_META, "utf8")) as {
		url: string;
	};
	const out = await fal.run<Record<StemName, { url: string } | null>>(
		"fal-ai/demucs",
		{
			audio_url: url,
			model: "htdemucs_ft",
			stems: STEM_NAMES,
			output_format: "wav",
		},
		PLAN_SEC,
	);
	const urls: Partial<Record<StemName, string>> = {};
	for (const name of STEM_NAMES) {
		const file = out[name];
		if (!file) throw new Error(`demucs returned no ${name} stem`);
		await download(file.url, stem(name));
		urls[name] = file.url;
	}
	await fs.writeFile(STEMS, JSON.stringify(urls, null, 2));
	console.log(`stems  ${STEM_NAMES.join(", ")}`);
}

interface ScribeWord {
	text: string;
	start: number;
	end: number;
	type: "word" | "spacing" | "audio_event";
}

/** Names the transcriber would otherwise spell as ordinary words. */
const KEYTERMS = [
	"Gitframes",
	"Chromium",
	"GPU",
	"glTF",
	"After Effects",
	"Photoshop",
	"Premiere",
	"Cinema 4D",
	"Blender",
	"Illustrator",
];

async function words(fal: FalClient): Promise<void> {
	if (await exists(WORDS)) return;
	const { vocals: url } = JSON.parse(
		await fs.readFile(STEMS, "utf8"),
	) as Record<StemName, string>;
	const out = await fal.run<{ words: ScribeWord[] }>(
		"fal-ai/elevenlabs/speech-to-text/scribe-v2",
		{
			audio_url: url,
			language_code: "eng",
			keyterms: KEYTERMS,
			tag_audio_events: false,
		},
		PLAN_SEC / 60,
	);
	const heard: HeardWord[] = out.words
		.filter((w) => w.type === "word")
		.map(({ text, start, end }) => ({ text: text.trim(), start, end }));
	await fs.writeFile(WORDS, JSON.stringify(heard, null, 1));
	console.log(
		`words  ${heard.length} heard: ${heard.map((h) => h.text).join(" ")}`,
	);
}

/** Decodes through ffmpeg to interleaved float32 at the film's sample rate. */
function decode(
	file: string,
	filters: string[],
	channels: 1 | 2,
): Float32Array {
	const args = ["-v", "error", "-i", file];
	if (filters.length) args.push("-af", filters.join(","));
	args.push(
		"-ac",
		String(channels),
		"-ar",
		String(SAMPLE_RATE),
		"-f",
		"f32le",
		"pipe:1",
	);
	const raw = execFileSync("ffmpeg", args, { maxBuffer: 1 << 30 });
	return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4);
}

/** How far the take may stray from 180 BPM before the grid drifts audibly off it (0.2 % ≈ 0.1 s a minute). */
const MAX_TEMPO_ERROR = 0.002;

interface Grid {
	measuredBpm: number;
	/** Where the take's downbeat phase sits relative to the film's bar lines (ms, for the record). */
	phaseMs: number;
	/** Film length in bars: from the start of the take to its last sounding bar. */
	bars: number;
}

/** Bars quieter than this are the ring-out past the end. */
const SILENCE_DB = -60;

function barLevels(mix: Stereo): number[] {
	const per = Math.round(BAR_SEC * SAMPLE_RATE);
	const out: number[] = [];
	for (let at = 0; at + per <= mix[0].length; at += per) {
		let e = 0;
		for (let i = at; i < at + per; i++)
			e += (mix[0][i] ** 2 + mix[1][i] ** 2) / 2;
		out.push(10 * Math.log10(e / per + 1e-12));
	}
	return out;
}

/** A file decoded on the film's clock (which is the take's clock), padded or cut to `bars`. */
function onClock(file: string, bars: number): Stereo {
	const seconds = bars * BAR_SEC;
	const pcm = decode(file, ["apad", `atrim=end=${seconds.toFixed(4)}`], 2);
	const out = stereo(Math.round(seconds * SAMPLE_RATE));
	for (let i = 0; i < out[0].length && 2 * i + 1 < pcm.length; i++) {
		out[0][i] = pcm[2 * i];
		out[1][i] = pcm[2 * i + 1];
	}
	return out;
}

/**
 * The take is used as it is, so its tempo must already be the film's: measure
 * it on the drum stem and refuse a take that would drift off the bar grid.
 */
function measureGrid(): Grid {
	const mono = decode(stem("drums"), [], 1);
	const grid = analyzeBeatGrid(mono, SAMPLE_RATE, {
		bpmHint: BPM,
		minBpm: 150,
		maxBpm: 210,
	});
	const error = Math.abs(grid.bpm - BPM) / BPM;
	if (error > MAX_TEMPO_ERROR)
		throw new Error(
			`take runs at ${grid.bpm.toFixed(2)} BPM, ${(error * 100).toFixed(2)} % off ${BPM}: regenerate it`,
		);
	const phase =
		Math.round(grid.downbeatSec / BAR_SEC) * BAR_SEC - grid.downbeatSec;
	const levels = barLevels(onClock(SONG, Math.ceil(PLAN_SEC / BAR_SEC) + 2));
	const bars =
		levels.length - [...levels].reverse().findIndex((db) => db > SILENCE_DB);
	console.log(
		`grid   ${grid.bpm.toFixed(2)} BPM, downbeats ${(phase * 1000).toFixed(0)} ms off the bar lines, ${bars} bars (${(bars * BAR_SEC).toFixed(2)} s)`,
	);
	return { measuredBpm: grid.bpm, phaseMs: Math.round(phase * 1000), bars };
}

async function measure(): Promise<void> {
	const grid = measureGrid();
	const song = onClock(SONG, grid.bars);

	const heard = JSON.parse(await fs.readFile(WORDS, "utf8")) as HeardWord[];
	const words = alignLyrics(SECTIONS, heard);
	console.log(
		`lyrics ${words.filter((w) => w.heard).length}/${words.length} words timed from the transcript`,
	);

	const chapters = chaptersOf(findFinalHit(song), words, grid.bars);
	console.log(
		`chapters ${Object.entries(chapters)
			.map(([k, v]) => `${k} ${v}`)
			.join(", ")}`,
	);
	await fs.writeFile(
		asset("structure.json"),
		JSON.stringify({ grid, chapters }, null, 1),
	);
	await fs.writeFile(asset("lyrics.json"), JSON.stringify(words, null, 1));
	await fs.writeFile(
		asset("envelopes.json"),
		JSON.stringify(
			envelopes(
				onClock(stem("drums"), grid.bars),
				onClock(stem("vocals"), grid.bars),
			),
		),
	);
}

/**
 * The film puts every written line on screen when it is sung, so a take that
 * skips a line (the model sometimes repeats one instead) cannot be cut to:
 * the lines most of whose words the transcript never heard.
 */
async function skippedLines(): Promise<string[]> {
	const heard = JSON.parse(await fs.readFile(WORDS, "utf8")) as HeardWord[];
	const words = alignLyrics(SECTIONS, heard);
	const lines = [...new Set(words.map((w) => w.line))];
	return lines
		.map((n) => words.filter((w) => w.line === n))
		.filter((ws) => ws.filter((w) => w.heard).length < ws.length / 2)
		.map((ws) => ws.map((w) => w.text).join(" "));
}

const MAX_TAKES = 4;

/** Generates takes until one sings every line, setting rejected ones aside. */
async function generate(fal: FalClient): Promise<void> {
	for (let take = 1; ; take++) {
		await song(fal, take);
		await stems(fal);
		await words(fal);
		const skipped = await skippedLines();
		if (!skipped.length) return;
		const rejected = path.resolve(
			ASSETS,
			"../scratch/rejected-takes",
			`take-${take}`,
		);
		await fs.mkdir(rejected, { recursive: true });
		for (const file of [SONG, SONG_META, STEMS, WORDS, asset("stems")])
			if (await exists(file))
				await fs.rename(file, path.join(rejected, path.basename(file)));
		console.log(`take ${take} skipped: ${skipped.join(" / ")}`);
		if (take === MAX_TAKES)
			throw new Error(`no take sang every line in ${MAX_TAKES} tries`);
	}
}

if (step === "cost") {
	const usd =
		PRICING["fal-ai/elevenlabs/music/v2.5"].usd * SONG_COMPUTE_SEC +
		PRICING["fal-ai/demucs"].usd * PLAN_SEC +
		PRICING["fal-ai/elevenlabs/speech-to-text/scribe-v2"].usd * (PLAN_SEC / 60);
	console.log(
		`estimate $${usd.toFixed(2)} (song ${PLAN_SEC.toFixed(0)} s, stems, transcription)`,
	);
} else {
	if (step === "all") {
		const fal = client();
		await generate(fal);
		console.log(`fal    $${fal.totalUsd.toFixed(3)}`);
	}
	await measure();
}
process.exit(0);
