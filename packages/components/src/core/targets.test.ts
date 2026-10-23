import { describe, expect, it } from "vitest";
import { fakeMeasure } from "../test/fake-host.js";
import {
	anchorPoint,
	boundsOf,
	resolveTarget,
	targetPoint,
} from "./targets.js";
import { findRange, rangeRects, wordRanges } from "./text.js";

const ctx = { measure: fakeMeasure };

describe("text geometry", () => {
	it("finds words and ranges", () => {
		expect(
			wordRanges("  ship it  fast").map((w) => [w.text, w.start, w.end]),
		).toEqual([
			["ship", 2, 6],
			["it", 7, 9],
			["fast", 11, 15],
		]);
		expect(findRange("a b a b", "b", 1)).toEqual([6, 7]);
		expect(findRange("price 120%", /\d+%/)).toEqual([6, 10]);
		expect(findRange("abc", "z")).toBeNull();
	});

	it("returns one rect per line a range spans", () => {
		// 20px font → 10px glyphs, 24px lines; width 100 fits 10 glyphs,
		// so "brave" wraps to line 2.
		const text = "hello brave new world";
		const options = { fontFamily: "Inter", fontSize: 20, width: 100 };
		const m = fakeMeasure(text, options);
		const rects = rangeRects(m, 0, 11, options); // "hello brave"
		expect(rects).toEqual([
			{ x: 0, y: 0, width: 50, height: 24 },
			{ x: 0, y: 24, width: 50, height: 24 },
		]);
	});

	it("shifts centred lines", () => {
		const options = {
			fontFamily: "Inter",
			fontSize: 20,
			width: 200,
			align: "center" as const,
		};
		const m = fakeMeasure("abcd", options);
		expect(rangeRects(m, 0, 4, options)[0]).toMatchObject({ x: 80, width: 40 });
	});
});

describe("targets", () => {
	it("resolves points and rects", () => {
		expect(resolveTarget([10, 20])).toEqual({
			kind: "static",
			anchor: "center",
			rects: [{ x: 10, y: 20, width: 0, height: 0 }],
		});
		const r = { x: 0, y: 0, width: 10, height: 10 };
		expect(targetPoint(resolveTarget(r))).toEqual([5, 5]);
	});

	it("resolves absolute nodes and refuses flowed ones", () => {
		const node = { id: "btn", x: 100, y: 50, width: 80, height: 40 };
		expect(targetPoint(resolveTarget({ node, anchor: "top-left" }))).toEqual([
			100, 50,
		]);
		expect(() => resolveTarget({ node: { id: "flow" } })).toThrow(
			/absolute geometry/,
		);
	});

	it("resolves text matches to glyph boxes in composition space", () => {
		const text = {
			id: "t",
			x: 200,
			y: 300,
			text: "Ship faster today",
			fontFamily: "Inter",
			fontSize: 20,
		};
		const resolved = resolveTarget({ text, match: "faster" }, ctx);
		expect(resolved.kind).toBe("static");
		if (resolved.kind !== "static") return;
		expect(resolved.rects).toEqual([{ x: 250, y: 300, width: 60, height: 24 }]);
		expect(targetPoint(resolved, 0, true)).toEqual([250, 312]);
		expect(() => resolveTarget({ text, match: "slower" }, ctx)).toThrow(
			/not found/,
		);
	});

	it("samples tracked objects per frame", () => {
		const sig = (f: (frame: number) => number) => ({
			get: (c?: { frame: number }) => f(c?.frame ?? 0),
		});
		const track = {
			x: sig((f) => f * 2),
			y: sig(() => 10),
			width: sig(() => 20),
			height: sig(() => 20),
		};
		const resolved = resolveTarget({ track });
		expect(resolved.kind).toBe("dynamic");
		expect(targetPoint(resolved, 5)).toEqual([20, 20]);
		expect(
			targetPoint(
				resolveTarget((f) => [f, f]),
				7,
			),
		).toEqual([7, 7]);
	});

	it("computes bounds and anchors", () => {
		expect(
			boundsOf([
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 20, y: 5, width: 5, height: 10 },
			]),
		).toEqual({ x: 0, y: 0, width: 25, height: 15 });
		expect(
			anchorPoint({ x: 0, y: 0, width: 10, height: 20 }, "bottom-right"),
		).toEqual([10, 20]);
	});
});
