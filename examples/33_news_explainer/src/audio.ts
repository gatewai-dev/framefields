/**
 * The film's generated sound, all through the framefields AI gateway: Gemini
 * 3.8 Flash TTS reads the narration and Lyria 3.5 plays a soft bed under it.
 * `pnpm audio` makes the files (media stays out of git) and records what it
 * measured in assets/audio.json, which is committed so the film can be timed
 * without them.
 *
 * The narration reports what officials and early coverage said on November
 * 1–2, 2026 (FAA, NTSB, AP, Reuters, CBS News, FOX Weather); no cause had been
 * determined, and the script says so.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./theme.js";

export const VOICE_MODEL = "google/gemini-3.8-flash-tts";
export const MUSIC_MODEL = "google/lyria-3.5";
export const TRANSCRIBER = "elevenlabs/speech-to-text/scribe-v2";

/** Gemini's informative male voice. */
export const VOICE = "Charon";
export const STYLE =
	"A thoughtful American journalist narrating a calm news explainer video about a fatal plane crash. Clear, measured and quietly serious, curious rather than dramatic, never sensational. A steady conversational pace with no long pauses. Standard American English accent.";

/** The narration, in the order it is heard. */
export const LINES = {
	fell: "On Sunday afternoon, a business jet fell out of the sky over South Florida.",
	nine: "All nine people on board were killed.",
	know: "So what do we actually know about what happened?",
	route:
		"The plane, a Learjet 60 built in 2004, had taken off from Austin, Texas, that morning, bound for the Bahamas.",
	cruise:
		"By early afternoon, it was cruising east over Florida at thirty-five thousand feet.",
	storm:
		"But a thunderstorm was building over Palm Beach County, with tops near forty-four thousand feet.",
	warned:
		"Forecasters had already warned of severe turbulence, icing, and hail.",
	climb:
		"The crew reported ice and turbulence, and asked to climb two thousand feet.",
	fall: "Then the jet started to fall.",
	minute:
		"According to the FAA, it dropped from about thirty-five thousand feet to under nine thousand in just over a minute.",
	rate: "At its fastest, it was descending thirty thousand feet per minute.",
	speed:
		"That's a vertical speed of about three hundred and forty miles an hour.",
	mayday:
		"The crew declared an emergency. About thirty-five seconds later, the radio went quiet.",
	road: "It came down beside a busy road in Palm Beach County, near a mobile home park.",
	crater:
		"It left a crater by the road, and about six hundred nearby residents were evacuated.",
	ground: "No one on the ground was killed.",
	ntsb: "The National Transportation Safety Board is leading the investigation, and says the weather is a major focus.",
	breakup:
		"Investigators have also found signs that the plane may have begun to break apart in the air.",
	report:
		"A preliminary report is expected within weeks. A final cause could take a year or more.",
	question:
		"For now, the question is how a jet cruising at thirty-five thousand feet could fall so far, so fast.",
} as const;

export type LineId = keyof typeof LINES;
export const LINE_IDS = Object.keys(LINES) as LineId[];

/** What the voice model is asked for one line: its text and the shared delivery. */
export const voiceInput = (id: LineId) => ({
	prompt: LINES[id],
	voice: VOICE,
	style_instructions: STYLE,
});

/**
 * A soft bed, instrumental throughout, longer than the film so it can be cut
 * and faded on the last frame.
 */
export const MUSIC_SECONDS = 125;
export const MUSIC_PROMPT = `A soft instrumental underscore for a two-minute news explainer video about a tragic plane crash. No vocals, no singing, no spoken words, no drums.
Reflective, respectful and quietly curious at 72 BPM in D minor: felt piano playing a sparse repeating motif, warm string pad, a soft low cello drone and a faint, slow plucked pulse. Gentle and understated throughout, always staying in the background under a narrator.
[0:00-0:20] Felt piano motif alone over a soft pad, intimate.
[0:20-0:45] The plucked pulse enters, light and steady, like a clock.
[0:45-1:10] The low cello drone joins and the harmony darkens slightly, tense but restrained.
[1:10-1:40] It opens up a little: warm strings carry the motif, hopeful but sober.
[1:40-2:05] It thins back to the piano motif and settles on one long, quiet final chord.
[2:05-2:10] Silence.`;

export interface SpokenWord {
	text: string;
	start: number;
	end: number;
}

export interface AudioManifest {
	voice: Record<
		LineId,
		{
			text: string;
			/** What the voice model was asked, so a changed line or delivery is read again. */
			input: ReturnType<typeof voiceInput>;
			/** What the transcriber heard, which must match `text` word for word. */
			heard: string;
			/** Trimmed to the speech: 60 ms before the first word, 300 ms after the last. */
			seconds: number;
			/** Each word heard, in seconds into the trimmed file, so a picture can land on a word. */
			words: SpokenWord[];
		}
	>;
	/** The prompt it was made from, and its length once cut. */
	music: { prompt: string; seconds: number };
}

/** Where the first word starts in a trimmed line. */
export const VOICE_LEAD = 0.06;

export const MANIFEST = path.join(ASSETS, "audio.json");
export const voicePath = (id: LineId) =>
	path.join(ASSETS, "voice", `${id}.wav`);
export const MUSIC_PATH = path.join(ASSETS, "music.wav");

export function readManifest(): AudioManifest {
	return JSON.parse(readFileSync(MANIFEST, "utf8")) as AudioManifest;
}

/** Generated files not on disk yet. */
export function missingAudio(): string[] {
	return [...LINE_IDS.map(voicePath), MUSIC_PATH]
		.filter((file) => !existsSync(file))
		.map((file) => path.relative(ASSETS, file));
}
