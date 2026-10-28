import { describe, expect, it } from "vitest";
import {
	sampledMediaSourceRange,
	sampledMediaSourceTime,
	sampleFrameMediaSignal,
	sampleMediaSignal,
} from "./media-time-signal.js";
import { Signal } from "./signals/index.js";
import { ProgrammaticSignal } from "./signals/programmatic.js";

describe("sampled media signals", () => {
	it("samples programmatic and engine signals on the composition clock", () => {
		const frames: number[] = [];
		const programmatic = new ProgrammaticSignal((ctx) => {
			frames.push(ctx.frame);
			expect(ctx.time).toBe(ctx.frame / 24);
			expect(ctx.duration).toBe(4);
			expect(ctx.progress).toBe(ctx.frame / 96);
			return ctx.frame / 24;
		});
		const options = {
			mode: "source-time" as const,
			fps: 24,
			startFrame: 24,
			durationFrames: 2,
			compositionDurationFrames: 96,
		};
		const map = sampleFrameMediaSignal({ ...options, signal: programmatic });
		expect(frames).toEqual([24, 25, 26]);
		expect(sampledMediaSourceTime(map, 1)).toBeCloseTo(25 / 24);
		const engine = Signal.builder({
			type: "custom",
			fn: (ctx) => ctx.frame / 24,
		});
		const engineMap = sampleFrameMediaSignal({ ...options, signal: engine });
		expect(sampledMediaSourceTime(engineMap, 1)).toBeCloseTo(25 / 24);
	});
	it("does not reuse a programmatic value across different frame contexts", () => {
		const signal = new ProgrammaticSignal((ctx) => ctx.time + ctx.progress);
		const context = {
			frame: 24,
			fps: 24,
			time: 1,
			duration: 4,
			durationMs: 4000,
			progress: 0.25,
			deltaTime: 1 / 24,
		};
		expect(signal.get(context)).toBe(1.25);
		expect(
			signal.get({ ...context, fps: 48, time: 0.5, progress: 0.125 }),
		).toBe(0.625);
	});
	it("resamples an array signal when the same frame is read at a different fps", () => {
		const signal = Signal.fromArray(
			Array.from({ length: 30 }, (_, i) => i),
			24,
		);
		const context = {
			frame: 24,
			fps: 24,
			time: 1,
			duration: 4,
			durationMs: 4000,
			progress: 0.25,
			deltaTime: 1 / 24,
		};
		expect(signal.get(context)).toBe(24);
		expect(signal.get({ ...context, fps: 48, time: 0.5 })).toBe(12);
	});
	it("integrates linearly varying speed at fractional frames and supports random access", () => {
		const map = sampleMediaSignal({
			mode: "speed",
			fps: 2,
			startFrame: 4,
			durationFrames: 2,
			sourceStartSec: 1,
			sample: (frame) => frame - 4,
		});
		expect(sampledMediaSourceTime(map, 0)).toBe(1);
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.0625);
		expect(sampledMediaSourceTime(map, 1)).toBe(1.25);
		expect(sampledMediaSourceTime(map, 2)).toBe(2);
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.0625);
	});
	it("finds source-time extrema between frame boundaries", () => {
		const map = sampleMediaSignal({
			mode: "speed",
			fps: 1,
			startFrame: 0,
			durationFrames: 1,
			sourceStartSec: 1,
			sample: (f) => 1 - 2 * f,
		});
		expect(sampledMediaSourceRange(map, 0, 1)).toEqual({
			min: 1,
			max: 1.25,
			maxIncluded: true,
		});
	});
	it("interpolates source times and rejects non-finite samples", () => {
		const map = sampleMediaSignal({
			mode: "source-time",
			fps: 24,
			startFrame: 10,
			durationFrames: 2,
			sample: (frame) => 12 - frame,
		});
		expect(sampledMediaSourceTime(map, 0.5)).toBe(1.5);
		expect(sampledMediaSourceRange(map, 0, 2)).toEqual({
			min: 0,
			max: 2,
			maxIncluded: true,
		});
		expect(() =>
			sampleMediaSignal({
				mode: "source-time",
				fps: 24,
				startFrame: 0,
				durationFrames: 2,
				sample: () => NaN,
			}),
		).toThrow(/Non-finite/);
	});
	it("rejects an overflow while integrating finite signal values", () => {
		expect(() =>
			sampleMediaSignal({
				mode: "speed",
				fps: 0.1,
				startFrame: 0,
				durationFrames: 1,
				sample: () => Number.MAX_VALUE,
			}),
		).toThrow(/overflow/);
	});
	it("distinguishes an exclusive upper boundary from a sampled upper bound", () => {
		const ascending = sampleMediaSignal({
			mode: "source-time",
			fps: 24,
			startFrame: 0,
			durationFrames: 1,
			sample: (frame) => frame,
		});
		expect(sampledMediaSourceRange(ascending, 0, 1)).toEqual({
			min: 0,
			max: 1,
			maxIncluded: false,
		});
		const held = sampleMediaSignal({
			mode: "speed",
			fps: 24,
			startFrame: 0,
			durationFrames: 1,
			sourceStartSec: 1,
			sample: () => 0,
		});
		expect(sampledMediaSourceRange(held, 0, 1)).toEqual({
			min: 1,
			max: 1,
			maxIncluded: true,
		});
	});
	it("evaluates large finite signals without overflowing intermediate differences", () => {
		const map = sampleMediaSignal({
			mode: "speed",
			fps: 1,
			startFrame: 0,
			durationFrames: 1,
			sample: (f) => (f === 0 ? 1e308 : -1e308),
		});
		expect(sampledMediaSourceTime(map, 1)).toBe(0);
		expect(sampledMediaSourceTime(map, 0.5)).toBeCloseTo(2.5e307);
		expect(sampledMediaSourceRange(map, 0, 1).max).toBeCloseTo(2.5e307);
	});
});
