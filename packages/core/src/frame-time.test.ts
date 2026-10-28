import { describe, expect, it } from "vitest";
import { frameCount, resolveFrameRequest } from "./frame-time.js";

describe("frame time contracts", () => {
	it("resolves fractional timestamps once and preserves timestamp precedence", () => {
		expect(resolveFrameRequest({ atMs: 16.6 }, 30)).toEqual({
			frame: 0,
			timeMs: 0,
		});
		expect(resolveFrameRequest({ frame: 0, atMs: 1000 }, 30)).toEqual({
			frame: 30,
			timeMs: 1000,
		});
		expect(resolveFrameRequest({ frame: 7 }, 29.97)).toEqual(
			resolveFrameRequest({ atMs: 7000 / 29.97 }, 29.97),
		);
	});
	it("rejects invalid time inputs", () => {
		for (const frame of [-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1])
			expect(() => resolveFrameRequest({ frame }, 30)).toThrow(/frame/);
		for (const atMs of [-1, Infinity, NaN])
			expect(() => resolveFrameRequest({ atMs }, 30)).toThrow(/atMs/);
		for (const fps of [0, -1, Infinity, NaN])
			expect(() => resolveFrameRequest({}, fps)).toThrow(/fps/);
	});
	it("counts half-open export windows using rounded duration", () => {
		expect(frameCount(1000, 30)).toBe(30);
		expect(frameCount(50, 30)).toBe(2);
		expect(frameCount(1, 30)).toBe(1);
	});
});
