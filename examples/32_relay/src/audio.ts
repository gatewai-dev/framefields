/**
 * The film's generated sound, all from the framefields AI gateway with Seed
 * Audio 1.0: a narrator, a music bed and the mouse click. `pnpm audio` makes
 * the files (media stays out of git) and records what it measured in
 * assets/audio.json, which is committed so the film can be timed without them.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./theme.js";

export const AUDIO_MODEL = "seed-audio/1.0";
export const TRANSCRIBER = "elevenlabs/speech-to-text/scribe-v2";

/** Read most naturally of the presets tried: accurate, about 2.9 words a second. */
export const VOICE = "cedric_en_zh";
export const DIRECTION =
	"Warm, clear and conversational, at an easy natural pace with no long pauses, like a founder showing a friend their product.";
export const voicePrompt = (text: string) =>
	`${DIRECTION} Read the following: '${text}'`;

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

/**
 * Music, laid out on the film's sections. The gateway turns away Seed Audio
 * prompts with nothing to say (every music-only prompt fails its content
 * check), so the music is a scene that ends on one spoken word, `MUSIC_CUE`,
 * and is cut off just before it.
 */
export const MUSIC_SECONDS = 26;
export const MUSIC_CUE = "Relay.";
export const MUSIC_PROMPT = `A bright, quiet design studio in the morning.
Music: a calm, optimistic, minimal product film underscore at 96 BPM in D major. Warm felt piano, a soft plucked synth arpeggio, round sub bass and light brushed percussion.
Total duration: 0:30.
[0:00-0:03] Music only: the piano motif alone.
[0:03-0:14] Music only: a gentle pulse enters with the plucked arpeggio and brushed percussion.
[0:14-0:20] Music only: it lifts as the sub bass and a warm pad join.
[0:20-0:${MUSIC_SECONDS}] Music only: it resolves on one sustained final chord that rings out softly.
[0:27-0:30] A calm male narrator says: "${MUSIC_CUE}"`;

export const CLICK_PROMPT = `Generate sound effects only. No voice, no music.
One single crisp click of a computer mouse button, recorded close and dry in a quiet room, then silence.`;

export interface AudioManifest {
	voice: Record<
		LineId,
		{
			text: string;
			/** What Seed Audio was asked, so a changed direction is read again. */
			prompt: string;
			/** What the transcriber heard, which must match `text` word for word. */
			heard: string;
			/** Trimmed to the speech: 60 ms before the first word, 300 ms after the last. */
			seconds: number;
		}
	>;
	/** Everything before the spoken cue. */
	music: { seconds: number };
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
