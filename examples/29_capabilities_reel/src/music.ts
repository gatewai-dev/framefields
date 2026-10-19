/**
 * The score as data: one arrangement read by both the synthesizer (score.ts writes the stems)
 * and the picture (every beat-reactive signal is built from the same note list, so nothing is
 * detected and nothing drifts).
 */
import { Signal } from "framefields";
import { BAR, BEAT, FPS } from "./theme.js";
import { CHAPTERS, TOTAL_BARS, TOTAL_FRAMES } from "./timeline.js";

export const SAMPLE_RATE = 48000;
export const SECONDS_PER_BEAT = BEAT / FPS;

/** A minor: Am – F – C – G, one chord a bar. MIDI roots. */
export const PROGRESSION = [
	{ root: 45, tones: [57, 60, 64, 69] },
	{ root: 41, tones: [53, 57, 60, 65] },
	{ root: 48, tones: [55, 60, 64, 67] },
	{ root: 43, tones: [55, 59, 62, 67] },
];

export type Section =
	| "intro"
	| "groove"
	| "lift"
	| "breakdown"
	| "drop"
	| "outro";

/** What plays in each bar, read off the chapters. */
export function sectionAt(bar: number): Section {
	const chapter = CHAPTERS.find((c) => bar >= c.bar && bar < c.bar + c.bars);
	if (!chapter) return "outro";
	if (chapter.id === "open") return "intro";
	if (chapter.id === "fluid") return "breakdown";
	if (
		chapter.id === "vision" ||
		chapter.id === "nodes" ||
		chapter.id === "finale"
	) {
		return bar === TOTAL_BARS - 1 ? "outro" : "drop";
	}
	if (chapter.id === "stylize" || chapter.id === "space") return "lift";
	return "groove";
}

export interface Hit {
	beat: number; // absolute beat index (quarter notes)
	step?: number; // 16th offset inside the beat, 0–3
}

const beatsOf = (bar: number) => bar * 4;

/** Kick: four on the floor everywhere but the intro, the breakdown and the outro tail. */
export const KICKS: number[] = [];
/** Clap on 2 and 4. */
export const CLAPS: number[] = [];
/** Closed hats on the off-beat 8ths; in lifts and drops, 16ths. */
export const HATS: Array<{ beat: number; step: number; open: boolean }> = [];
/** Downbeats that open a chapter: an impact plays there. */
export const IMPACTS: number[] = [];
/** Bars that end with a riser into the next chapter. */
export const RISERS: number[] = [];

for (let bar = 0; bar < TOTAL_BARS; bar++) {
	const section = sectionAt(bar);
	const b0 = beatsOf(bar);
	const drums =
		section !== "intro" && section !== "breakdown" && section !== "outro";
	if (drums) {
		for (let i = 0; i < 4; i++) KICKS.push(b0 + i);
		CLAPS.push(b0 + 1, b0 + 3);
	}
	if (section === "intro" && bar === 2) {
		// The last intro bar: kicks on every beat building into the drop.
		for (let i = 0; i < 4; i++) KICKS.push(b0 + i);
	}
	if (section === "outro") KICKS.push(b0);
	if (drums || (section === "intro" && bar >= 1)) {
		const dense = section === "lift" || section === "drop";
		for (let i = 0; i < 4; i++) {
			for (let step = 0; step < 4; step++) {
				const offbeat = step === 2;
				if (offbeat || (dense && step % 2 === 1)) {
					HATS.push({
						beat: b0 + i,
						step,
						open: offbeat && dense && i % 2 === 1,
					});
				}
			}
		}
	}
}
for (const c of CHAPTERS) {
	if (c.bar > 0) {
		IMPACTS.push(beatsOf(c.bar));
		RISERS.push(c.bar - 1);
	}
}
IMPACTS.push(beatsOf(TOTAL_BARS - 1));

export const beatToFrame = (beat: number, step = 0) =>
	Math.round((beat + step / 4) * BEAT);

/** A per-frame envelope: 1 on each hit frame, decaying with `decay` (frames to ~37 %). */
export function envelope(
	frames: number[],
	decay: number,
	length = TOTAL_FRAMES,
): Float32Array {
	const out = new Float32Array(length);
	const sorted = [...frames].sort((a, b) => a - b);
	let k = 0;
	let last = -1e9;
	for (let f = 0; f < length; f++) {
		while (k < sorted.length && sorted[k] <= f) last = sorted[k++];
		out[f] = Math.exp(-(f - last) / decay);
	}
	return out;
}

export const KICK_FRAMES = KICKS.map((b) => beatToFrame(b));
export const CLAP_FRAMES = CLAPS.map((b) => beatToFrame(b));
export const HAT_FRAMES = HATS.map((h) => beatToFrame(h.beat, h.step));
export const IMPACT_FRAMES = IMPACTS.map((b) => beatToFrame(b));

/** Per-frame envelopes, for drivers that take `(frame) => value`. */
export const KICK_ENV = envelope(KICK_FRAMES, 4);
export const kickAt = (frame: number) =>
	KICK_ENV[Math.max(0, Math.min(KICK_ENV.length - 1, Math.round(frame)))] ?? 0;

/** Beat-reactive signals on the composition clock. */
export const kick = Signal.fromArray(KICK_ENV, FPS);
export const clap = Signal.fromArray(envelope(CLAP_FRAMES, 5), FPS);
export const hat = Signal.fromArray(envelope(HAT_FRAMES, 1.5), FPS);
export const impact = Signal.fromArray(envelope(IMPACT_FRAMES, 10), FPS);

/** The breakdown's low-pass sweep (Hz), shared by the audio EQ and the picture. */
export function lowpassAt(frame: number): number {
	const fluid = CHAPTERS.find((c) => c.id === "fluid");
	if (!fluid) return 20000;
	const start = fluid.bar * BAR;
	const end = start + fluid.bars * BAR;
	if (frame < start || frame >= end) return 20000;
	const t = (frame - start) / (end - start);
	// Closes to a muffled 380 Hz over the first half, opens back up into the drop.
	const shape = t < 0.5 ? 1 - t / 0.5 : (t - 0.5) / 0.5;
	return 380 * (20000 / 380) ** (shape ** 2);
}
