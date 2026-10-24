import { describe, expect, it } from "vitest";
import {
	analyzeChannels,
	bandEdges,
	resampleBands,
	smoothRelease,
} from "./audio.js";

const SR = 44100;

function tone(seconds: number, hz: number, amp = 0.5): Float32Array {
	return Float32Array.from(
		{ length: Math.round(seconds * SR) },
		(_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR),
	);
}

/** 100 Hz kicks (fast decay) every `every` seconds, starting at `first`. */
function kicks(seconds: number, first: number, every: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * SR));
	for (let t = first; t < seconds; t += every) {
		const s = Math.round(t * SR);
		for (let i = 0; i < SR * 0.12 && s + i < out.length; i++)
			out[s + i] =
				0.8 *
				Math.exp(-i / (SR * 0.03)) *
				Math.sin((2 * Math.PI * 100 * i) / SR);
	}
	return out;
}

describe("analyzeChannels", () => {
	it("puts a tone in the band that holds its frequency", () => {
		const levels = analyzeChannels([tone(2, 440)], SR, { fps: 30, bands: 32 });
		const edges = bandEdges(32, 50, 12000);
		const band = edges.findIndex(
			(e, i) => e <= 440 && (edges[i + 1] ?? 0) > 440,
		);
		expect(levels.frames).toBe(60);
		const mid = levels.bands.map((b) => b[30] ?? 0);
		expect(mid[band]).toBeGreaterThan(0.9);
		// Far bands stay dark.
		expect(mid[0]).toBeLessThan(0.2);
		expect(mid[31]).toBeLessThan(0.2);
		expect(levels.level[30]).toBeGreaterThan(0.9);
	});

	it("finds kick onsets within one frame", () => {
		const levels = analyzeChannels([kicks(4, 0.5, 0.5)], SR, { fps: 30 });
		const expected = [0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((t) => t * 30);
		expect(levels.beats.length).toBe(expected.length);
		levels.beats.forEach((b, i) => {
			expect(Math.abs(b - (expected[i] as number))).toBeLessThanOrEqual(1);
		});
	});

	it("is deterministic and silent where the audio is", () => {
		const a = analyzeChannels([kicks(2, 0.5, 0.5)], SR);
		const b = analyzeChannels([kicks(2, 0.5, 0.5)], SR);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
		const silent = analyzeChannels([new Float32Array(SR)], SR);
		expect(Math.max(...silent.level)).toBe(0);
	});
});

describe("band helpers", () => {
	it("resamples bands by averaging", () => {
		const out = resampleBands([[0], [1], [0.5], [0.5]], 2);
		expect(out).toEqual([[0.5], [0.5]]);
		expect(resampleBands([[0.2], [0.8]], 4).map((b) => b[0])).toEqual([
			0.2, 0.2, 0.8, 0.8,
		]);
	});

	it("releases slowly and attacks at once", () => {
		const out = smoothRelease([0, 1, 0, 0], 1);
		expect(out[1]).toBe(1);
		expect(out[2]).toBe(0.5);
		expect(out[3]).toBe(0.25);
	});
});
