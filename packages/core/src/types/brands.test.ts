import { describe, expect, it } from "vitest";
import {
	degrees,
	fps,
	frame,
	handleId,
	handleLabel,
	isFrameIndex,
	isNormalized,
	ms,
	nodeId,
	normalized,
	pixels,
	radians,
	seconds,
} from "./brands.js";

describe("Nominal Branded Types", () => {
	it("validates and constructs FrameIndex correctly", () => {
		expect(frame(0)).toBe(0);
		expect(frame(120)).toBe(120);
		expect(() => frame(-1)).toThrow(RangeError);
		expect(() => frame(1.5)).toThrow(RangeError);
		expect(() => frame(Number.NaN)).toThrow(RangeError);
		expect(isFrameIndex(24)).toBe(true);
		expect(isFrameIndex(24.5)).toBe(false);
		expect(isFrameIndex(-5)).toBe(false);
		expect(isFrameIndex("24")).toBe(false);
	});

	it("validates and constructs time units", () => {
		expect(seconds(2.5)).toBe(2.5);
		expect(ms(1500)).toBe(1500);
		expect(fps(60)).toBe(60);
		expect(() => seconds(Number.NaN)).toThrow(TypeError);
		expect(() => ms(Number.POSITIVE_INFINITY)).toThrow(TypeError);
		expect(() => fps(0)).toThrow(RangeError);
		expect(() => fps(-30)).toThrow(RangeError);
	});

	it("validates and constructs normalized range", () => {
		expect(normalized(0.5)).toBe(0.5);
		expect(normalized(-0.2)).toBe(0);
		expect(normalized(1.5)).toBe(1);
		expect(isNormalized(0.75)).toBe(true);
		expect(isNormalized(-0.1)).toBe(false);
		expect(isNormalized(1.1)).toBe(false);
		expect(() => normalized(Number.NaN)).toThrow(TypeError);
	});

	it("validates angles and pixel dimensions", () => {
		expect(degrees(180)).toBe(180);
		expect(radians(Math.PI)).toBe(Math.PI);
		expect(pixels(1920)).toBe(1920);
		expect(() => degrees(Number.NaN)).toThrow(TypeError);
		expect(() => radians(Number.NaN)).toThrow(TypeError);
		expect(() => pixels(Number.NaN)).toThrow(TypeError);
	});

	it("validates identity and graph handle strings", () => {
		expect(handleId("input-video-1")).toBe("input-video-1");
		expect(handleLabel("Main Video")).toBe("Main Video");
		expect(nodeId("box-hero")).toBe("box-hero");
		expect(() => handleId("")).toThrow(TypeError);
		expect(() => handleLabel("")).toThrow(TypeError);
		expect(() => nodeId("")).toThrow(TypeError);
	});
});
