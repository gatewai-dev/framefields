/**
 * The film's generated sound, all through the framefields AI gateway: Gemini
 * 3.8 Flash TTS reads the narration, Lyria 3.5 writes the music, and Seed
 * Audio 1.0 makes the mouse click. `pnpm audio` makes the files (media stays
 * out of git) and records what it measured in assets/audio.json, which is
 * committed so the film can be timed without them.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./theme.js";

export const VOICE_MODEL = "google/gemini-3.8-flash-tts";
export const MUSIC_MODEL = "google/lyria-3.5";
export const CLICK_MODEL = "seed-audio/1.0";
export const TRANSCRIBER = "elevenlabs/speech-to-text/scribe-v2";

/** Gemini's warm female voice. */
export const VOICE = "Sulafat";
export const STYLE =
	"A warm, confident American woman narrating a calm product film. Natural and conversational, smiling slightly, at an easy pace with no long pauses. Standard American English accent.";

/** The narration, in the order it is heard. */
export const LINES = {
	ask: "A client asks a simple question.",
	inbox: "In Relay, it becomes a task in one click.",
	owner: "An owner.",
	deadline: "A deadline.",
	step: "And a clear next step.",
	board: "Maya sees it on the board, ready to start.",
	close: "Relay. Keep client work moving.",
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
 * Music laid out on the film's sections, instrumental throughout, a little
 * longer than the film so it can be cut and faded on the last frame.
 */
export const MUSIC_SECONDS = 26;
export const MUSIC_PROMPT = `An instrumental underscore for a 30-second software product film. No vocals, no singing, no spoken words.
Calm, optimistic and modern at 100 BPM in D major: warm felt piano, a soft plucked synth arpeggio, round sub bass, airy pads and light brushed percussion with a gentle shaker.
[0:00-0:03] The piano motif alone, intimate.
[0:03-0:08] A soft pulse enters with the plucked arpeggio.
[0:08-0:14] Brushed percussion and shaker join; light, focused momentum.
[0:14-0:20] It lifts: sub bass and a warm pad open up the chorus.
[0:20-0:26] It resolves on one sustained, warm final chord that rings out.
[0:26-0:30] Silence.`;

export const CLICK_PROMPT = `Generate sound effects only. No voice, no music.
One single crisp click of a computer mouse button, recorded close and dry in a quiet room, then silence.`;

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
		}
	>;
	/** The prompt it was made from, and its length once cut to the film. */
	music: { prompt: string; seconds: number };
	click: {
		seconds: number;
		/** Share of the click's energy above 1.5 kHz: a click is bright, a thump is not. */
		brightness: number;
	};
}

/** Where the first word starts in a trimmed line. */
export const VOICE_LEAD = 0.06;

export const MANIFEST = path.join(ASSETS, "audio.json");
export const voicePath = (id: LineId) =>
	path.join(ASSETS, "voice", `${id}.wav`);
export const MUSIC_PATH = path.join(ASSETS, "music.wav");
export const CLICK_PATH = path.join(ASSETS, "sfx", "click.wav");

export function readManifest(): AudioManifest {
	return JSON.parse(readFileSync(MANIFEST, "utf8")) as AudioManifest;
}

/** Generated files not on disk yet. */
export function missingAudio(): string[] {
	return [...LINE_IDS.map(voicePath), MUSIC_PATH, CLICK_PATH]
		.filter((file) => !existsSync(file))
		.map((file) => path.relative(ASSETS, file));
}
