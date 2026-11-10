/**
 * The film's sound. ElevenLabs v4 reads the narration through the framefields
 * AI gateway, and the music bed is synthesized in bed.ts.
 * `pnpm audio` makes the files (media stays out of git) and records what it
 * measured in assets/audio.json, which is committed so the film can be timed
 * without them.
 *
 * The script keeps to what the physics says: the particle pairs are "one way
 * to picture it" (Hawking's own heuristic), a solar-mass black hole sits near
 * 6e-8 K and would need about 1e67 years to evaporate, and the radiation has
 * never been observed.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ASSETS } from "./theme.js";

export const VOICE_MODEL = "elevenlabs/v4";
export const TRANSCRIBER = "elevenlabs/speech-to-text/scribe-v2";

/** A warm narrator with a light English accent. */
export const VOICE = "George";
/** George's ElevenLabs voice id. */
export const VOICE_IDS: Record<string, string> = {
	George: "JBFqnCBsd6RMkjVDRZzb",
};

/** The narration, in the order it is heard. */
export const LINES = {
	hole: "This is a black hole. Its gravity is so strong that nothing crossing its edge, the event horizon, can ever come back. Not even light.",
	grow: "For a long time, physicists were sure that black holes could only grow.",
	hawking:
		"Then, half a century ago, Stephen Hawking showed something astonishing. Black holes glow. And slowly, they evaporate.",
	zoom: "To see why, we have to zoom in, far beyond anything our eyes can see.",
	atom: "Past a single atom, and the cloud of electrons around it. Past its tiny nucleus of protons and neutrons.",
	empty: "Down to the emptiest thing there is: empty space itself.",
	never: "But empty space is never truly empty.",
	pairs:
		"Quantum fields are always flickering. One way to picture it is as pairs of particles that pop into existence, and vanish again an instant later. It happens everywhere, all the time.",
	edge: "At the very edge of a black hole, though, something different can happen.",
	split:
		"A pair appears, and before the two can meet again, one partner falls in. The other escapes.",
	glow: "From far away, those escaping particles look like a faint glow coming from the black hole itself. This is Hawking radiation.",
	negative:
		"But that energy is not free. The partner that falls in carries negative energy, which makes the black hole a tiny bit lighter.",
	mass: "So with every particle that escapes, the black hole loses a little mass.",
	hotter:
		"And here is the strange part: the smaller a black hole is, the hotter it glows.",
	sun: "One as heavy as our Sun is barely warmer than absolute zero, and would take far longer than the age of the universe to disappear.",
	shrink: "But as it shrinks, it heats up, and shrinks even faster.",
	flash: "Until, in its final moment, it vanishes in a burst of radiation.",
	unseen:
		"Hawking radiation has never been seen directly. It is far too faint.",
	forever:
		"But it tells us something profound. Even black holes do not last forever.",
} as const;

export type LineId = keyof typeof LINES;
export const LINE_IDS = Object.keys(LINES) as LineId[];

/** Names the transcriber should spell as the script does. */
export const KEYTERMS = ["Hawking", "Stephen Hawking", "event horizon"];

/** What the voice model is asked for one line. */
export const voiceInput = (id: LineId) => ({
	text: LINES[id],
	voice: VOICE,
	stability: 0.5,
});

/**
 * The bed is made longer than any cut of the film and trimmed to it; its
 * bells play while the film looks at the vacuum and the particle pairs.
 */
export const MUSIC_SECONDS = 180;
export const MUSIC_BELLS = { from: 52, to: 128 };
/** Bump to have `pnpm audio` synthesize the bed again. */
export const MUSIC_VERSION = "bed-1";

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
	/** Which version of the synthesized bed is on disk, and its length. */
	music: { version: string; seconds: number };
}

/** Where the first word starts in a trimmed line. */
export const VOICE_LEAD = 0.06;

export const MANIFEST = path.join(ASSETS, "audio.json");
export const voicePath = (id: LineId) =>
	path.join(ASSETS, "voice", `${id}.wav`);
export const MUSIC_PATH = path.join(ASSETS, "music.wav");

type Voice = AudioManifest["voice"];

/** Words a second the narrator reads at, for lines not recorded yet. */
const DRAFT_PACE = 2.5;

/**
 * A stand-in for a line that has no take yet: its length at the narrator's
 * usual pace, each word given time by its letters. Lets the picture be cut
 * and reviewed before the voice exists.
 */
function draftLine(id: LineId): Voice[LineId] {
	const text = LINES[id];
	const said = text.split(/\s+/);
	const seconds = said.length / DRAFT_PACE + 0.3;
	const letters = said.reduce((sum, word) => sum + word.length + 1, 0);
	let at = VOICE_LEAD;
	const words = said.map((word) => {
		const length = ((word.length + 1) / letters) * (seconds - 0.36);
		const spoken = { text: word, start: at, end: at + length * 0.85 };
		at += length;
		return spoken;
	});
	return { text, input: voiceInput(id), heard: text, seconds, words };
}

/** Every line's timing: measured where a take exists, estimated where not. */
export function readVoice(): Voice {
	const recorded: Partial<Voice> = existsSync(MANIFEST)
		? ((JSON.parse(readFileSync(MANIFEST, "utf8")) as Partial<AudioManifest>)
				.voice ?? {})
		: {};
	return Object.fromEntries(
		LINE_IDS.map((id) => [
			id,
			recorded[id]?.text === LINES[id] ? recorded[id] : draftLine(id),
		]),
	) as Voice;
}

/** Generated files not on disk yet. */
export function missingAudio(): string[] {
	return [...LINE_IDS.map(voicePath), MUSIC_PATH]
		.filter((file) => !existsSync(file))
		.map((file) => path.relative(ASSETS, file));
}
