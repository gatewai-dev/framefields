import { describe, expect, it } from "vitest";
import { mixSfxInto, renderSfx, softLimit } from "../src/audio/synth/sfx.js";
import type { SfxTrigger } from "../src/index.js";

const ctx = { sampleRate: 48000, secondsPerBar: 2, seed: 1 };
const TYPES: SfxTrigger["type"][] = [
	"whoosh",
	"riser",
	"impact",
	"downshifter",
	"glitch",
];

const peak = (data: Float32Array) =>
	data.reduce((max, v) => Math.max(max, Math.abs(v)), 0);
const rms = (data: Float32Array, from: number, to: number) => {
	let sum = 0;
	for (let i = from; i < to; i++) sum += data[i]! * data[i]!;
	return Math.sqrt(sum / (to - from));
};

describe("procedural sfx", () => {
	it.each(TYPES)("%s renders finite, audible, bounded stereo audio", (type) => {
		const { channels } = renderSfx({ type, atBar: 0 }, ctx);
		for (const channel of channels) {
			expect(channel.every(Number.isFinite)).toBe(true);
			expect(peak(channel)).toBeGreaterThan(0.05);
			expect(peak(channel)).toBeLessThanOrEqual(1);
		}
	});

	it("is deterministic for the same trigger and seed", () => {
		const a = renderSfx({ type: "whoosh", atBar: 1 }, ctx);
		const b = renderSfx({ type: "whoosh", atBar: 1 }, ctx);
		expect(a.channels[0]).toEqual(b.channels[0]);
	});

	it("places the effect at atBar and honours durationSec", () => {
		const fx = renderSfx({ type: "impact", atBar: 1.5, durationSec: 1 }, ctx);
		expect(fx.startSample).toBe(1.5 * 2 * 48000);
		expect(fx.channels[0].length).toBe(48000);
	});

	it("riser builds in level; downshifter falls away", () => {
		const up = renderSfx({ type: "riser", atBar: 0 }, ctx).channels[0];
		const down = renderSfx({ type: "downshifter", atBar: 0 }, ctx).channels[0];
		const q = Math.floor(up.length / 4);
		expect(rms(up, 3 * q, 4 * q)).toBeGreaterThan(rms(up, 0, q) * 3);
		const d = Math.floor(down.length / 4);
		expect(rms(down, 0, d)).toBeGreaterThan(rms(down, 3 * d, 4 * d) * 3);
	});

	it("mixes into a target buffer and clips at its end", () => {
		const target: [Float32Array, Float32Array] = [
			new Float32Array(1000),
			new Float32Array(1000),
		];
		mixSfxInto(target, [
			renderSfx(
				{ type: "impact", atBar: 0, durationSec: 1 },
				{ ...ctx, secondsPerBar: 0.01 },
			),
		]);
		expect(peak(target[0])).toBeGreaterThan(0);
	});

	it("soft-limits hot sums below full scale without touching quiet material", () => {
		const buf: [Float32Array, Float32Array] = [
			Float32Array.of(0.5, 1.8, -2.4),
			Float32Array.of(0.1, -0.6, 0.85),
		];
		softLimit(buf);
		expect(buf[0][0]).toBe(0.5);
		expect(peak(buf[0])).toBeLessThan(1);
		expect(buf[0][2]).toBeLessThan(-0.95);
		expect(buf[1][1]).toBeCloseTo(-0.6, 6);
		expect(Math.abs(buf[1][2]!)).toBeCloseTo(0.85, 1);
	});
});
