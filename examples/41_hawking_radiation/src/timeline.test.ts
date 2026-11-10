import { describe, expect, it } from "vitest";
import { LINE_IDS, readVoice } from "./audio.js";
import { planTimeline, SCENES } from "./timeline.js";

describe("timeline", () => {
	it("reads every line exactly once, in script order", () => {
		expect(SCENES.flatMap((scene) => scene.lines)).toEqual(LINE_IDS);
	});

	it("never lets two lines overlap, and runs two to three minutes", () => {
		const timeline = planTimeline(readVoice());
		timeline.lines.forEach((line, i) => {
			const before = timeline.lines[i - 1];
			if (before) expect(line.start).toBeGreaterThanOrEqual(before.end);
		});
		expect(timeline.total / 30).toBeGreaterThan(120);
		expect(timeline.total / 30).toBeLessThan(180);
	});
});
