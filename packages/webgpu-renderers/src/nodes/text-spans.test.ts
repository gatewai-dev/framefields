import { signal } from "@framefields/core";
import { describe, expect, it } from "vitest";
import { fitSpansToText, resolveTextSpans, spansText } from "./text-spans.js";

const spans = [
	{ text: "ab " },
	{ text: "cd", fill: "#d00" },
	{ text: " ef", fontSize: 10 },
];

describe("resolveTextSpans", () => {
	it("reads signal fields as plain values", () => {
		const out = resolveTextSpans([
			{
				text: signal("hi"),
				fill: signal("#d00"),
				fontSize: signal(12),
				opacity: signal(0.5),
				mark: { background: signal("#ff0"), paddingX: 2 },
			},
		]);
		expect(out).toEqual([
			{
				text: "hi",
				fill: "#d00",
				fontSize: 12,
				opacity: 0.5,
				mark: { background: "#ff0", paddingX: 2 },
			},
		]);
	});
});

describe("fitSpansToText", () => {
	it("keeps a revealed prefix in each span's style and drops the rest", () => {
		expect(fitSpansToText(spans, "ab c")).toEqual([
			{ text: "ab " },
			{ text: "c", fill: "#d00" },
		]);
		expect(fitSpansToText(spans, "")).toEqual([]);
	});

	it("is the identity on the spans' own text", () => {
		expect(fitSpansToText(spans, spansText(spans))).toEqual(spans);
	});

	it("restyles a same-length rewrite in place", () => {
		expect(fitSpansToText(spans, "xy zw")).toEqual([
			{ text: "xy " },
			{ text: "zw", fill: "#d00" },
		]);
	});

	it("gives text past the spans' end the last span's style", () => {
		expect(fitSpansToText(spans, "ab cd efgh").at(-1)).toEqual({
			text: " efgh",
			fontSize: 10,
		});
	});
});
