import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { evaluateGlyphExpression, type GlyphAnimator } from "../core/glyphs.js";
import { fakeHost } from "../test/fake-host.js";
import { captions } from "./index.js";

const make = () => bind(fakeHost(), captions);
type Node = {
	id?: string;
	children?: Node[];
	animators?: GlyphAnimator[];
	startFrame?: number;
	x?: number;
	width?: number;
	styles?: unknown[];
};
const find = (n: unknown, id: string): Node | undefined => {
	const node = n as Node;
	if (node.id === id) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};
const words = "Ship it faster than ever before today"
	.split(" ")
	.map((text, i) => ({
		text,
		start: 0.5 + i * 0.4,
		end: 0.8 + i * 0.4,
	}));

describe("Captions", () => {
	it("cues every word on round(start × fps), in the parent's timeline", () => {
		const c = make()({ id: "c", words, at: 10 });
		expect(c.cues.words.map((w) => w.frame)).toEqual(
			words.map((w) => 10 + Math.round(w.start * 30)),
		);
		expect(c.cues.phrases[0]?.frame).toBe(10 + 15);
	});

	it("karaoke turns each word to ink exactly on its frame", () => {
		const c = make()({ id: "c", words, style: "karaoke" });
		const spoken = find(c, "c-phrase-0")?.animators?.find(
			(a) => a.name === "spoken",
		);
		const expr = spoken?.selectors[0]?.expression ?? "";
		const phraseStart = c.cues.phrases[0]?.frame ?? 0;
		const local = (c.cues.words[2]?.frame ?? 0) - phraseStart;
		expect(
			evaluateGlyphExpression(expr, { frame: local - 1, wordIndex: 2 }),
		).toBe(1);
		expect(evaluateGlyphExpression(expr, { frame: local, wordIndex: 2 })).toBe(
			0,
		);
	});

	it("keeps every line inside the safe area at the auto-fitted size", () => {
		const long =
			"a fairly long caption sentence that keeps going on and on for several lines of text"
				.split(" ")
				.map((text, i) => ({ text, start: i * 0.2, end: i * 0.2 + 0.18 }));
		const c = make()({ id: "c", words: long, width: 1080, height: 1920 });
		const safe = 1080 * 0.84;
		// Fake measure: 0.5 em glyphs, so the longest line × size / 2 must fit.
		const size = (find(c, "c-phrase-0") as { fontSize?: number }).fontSize ?? 0;
		const longest = Math.max(...phraseLines(c));
		expect(longest * size * 0.5).toBeLessThanOrEqual(safe + 1e-6);
	});

	it("emphasises matching words and supports transcripts", () => {
		const srt = "1\n00:00:00,000 --> 00:00:01,000\nmake it faster\n";
		const c = make()({ id: "c", transcript: srt, emphasis: ["faster"] });
		expect(c.cues.words.map((w) => w.emphasised)).toEqual([false, false, true]);
		expect(() => make()({})).toThrow(/give `words` or a `transcript`/);
	});

	it("puts a cut-out of the speaker over the captions", () => {
		const c = make()({ id: "c", words, behind: { video: "talk.mp4" } });
		const kids = ((c as unknown as Node).children?.[0]?.children ??
			[]) as Node[];
		expect(kids[kids.length - 1]?.id).toBe("c-behind");
	});

	it("outlines with a layer-style stroke, never over the glyphs", () => {
		const c = make()({ id: "c", words, style: "outline" });
		expect(find(c, "c-phrase-0")?.styles?.[0]).toMatchObject({
			stroke: { position: "outside" },
		});
	});
});

/** Every laid-out line's length, across all phrases. */
function phraseLines(c: unknown): number[] {
	const out: number[] = [];
	for (let p = 0; ; p++) {
		const node = find(c, `c-phrase-${p}`) as { text?: string } | undefined;
		if (!node) return out;
		out.push(...(node.text ?? "").split("\n").map((l) => l.length));
	}
}
