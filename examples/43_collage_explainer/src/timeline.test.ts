import { describe, expect, it } from "vitest";
import type { AudioManifest } from "./assets.js";
import { DIRECTION, FPS } from "./direction.js";
import { BEATS, LINE_IDS, LINES } from "./script.js";
import { cue, planTimeline } from "./timeline.js";

/** Every line read at three words a second: enough to plan a cut without the voice files. */
const audio: AudioManifest = {
	lines: Object.fromEntries(
		LINE_IDS.map((id) => {
			const words = LINES[id]
				.split(" ")
				.map((text, i) => ({ text, start: i / 3, end: i / 3 + 0.3 }));
			return [id, { duration: words.length / 3, words }];
		}),
	) as AudioManifest["lines"],
};

describe("the film follows its direction", () => {
	it("tells the Explainer's beats, in order, with every line", () => {
		expect(Object.keys(BEATS)).toEqual(DIRECTION.genre.beats);
		expect(Object.values(BEATS).flat()).toEqual(LINE_IDS);
	});

	it("cuts scenes back to back, long enough for the format", () => {
		const { scenes, total } = planTimeline(audio);
		scenes.forEach((s, i) => {
			expect(s.start).toBe(
				i === 0
					? 0
					: (scenes[i - 1]?.start ?? 0) + (scenes[i - 1]?.duration ?? 0),
			);
			expect(s.voiceAt).toBeGreaterThan(s.start);
		});
		expect(total / FPS).toBeGreaterThanOrEqual(
			DIRECTION.format.durationSec.min,
		);
	});

	it("cues pictures on spoken words, and refuses a word that isn't spoken", () => {
		const recap = planTimeline(audio).scenes.at(-1);
		if (!recap) throw new Error("no scenes");
		expect(cue(recap, "moved")).toBeGreaterThan(cue(recap, "city"));
		expect(() => cue(recap, "submarine")).toThrow(/not spoken/);
	});
});
