import type { LayoutNode } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { appFrame } from "./index.js";

const make = () => bind(fakeHost(), appFrame);
const kids = (n: unknown) =>
	((n as { children?: LayoutNode[] }).children ?? []) as LayoutNode[];

describe("AppFrame", () => {
	it("maps content pixels into the parent's coordinates", () => {
		const f = make()({
			kind: "browser",
			x: 100,
			y: 50,
			width: 1200,
			height: 800,
		});
		expect(f.contentRect).toEqual({ x: 100, y: 106, width: 1200, height: 744 });
		expect(f.at(10, 20)).toEqual([110, 126]);
		const window = make()({ kind: "window", x: 0, y: 0 });
		expect(window.contentRect.y).toBe(46);
		const bare = make()({ kind: "minimal", x: 0, y: 0 });
		expect(bare.contentRect.y).toBe(0);
	});

	it("is open-ended unless given a duration", () => {
		const f = make()({});
		expect(f.durationFrames).toBeUndefined();
		expect(f.span.end).toBe(Number.POSITIVE_INFINITY);
		expect(() => make()({ exit: "fade" })).toThrow(/exit needs a known end/);
		expect(make()({ duration: 90, exit: "fade" }).durationFrames).toBe(90);
	});

	it("accepts content late with fill()", () => {
		const f = make()({ x: 0, y: 0 });
		f.fill({ kind: "box", id: "late" } as LayoutNode);
		expect(kids(f.part("content")).map((c) => c.id)).toEqual(["late"]);
	});

	it("types the URL, then loads", () => {
		const f = make()({
			kind: "browser",
			url: { text: "acme.dev", typeAt: 10, cps: 30 },
		});
		expect(f.cues.urlTyped).toEqual([{ frame: 18 }]);
		expect(f.cues.loaded[0]?.frame).toBeGreaterThan(18);
		expect(f.part("caret")).toBeDefined();
	});

	it("puts the shadow on its own plate under the clipping chrome", () => {
		const f = make()({ elevation: 3 });
		const stage = kids(f.part("stage"));
		expect(stage.map((c) => c.id.split("-").at(-1))).toEqual([
			"shadow",
			"chrome",
		]);
		expect(
			(f.part("shadow") as unknown as { styles: unknown[] }).styles,
		).toHaveLength(1);
		expect(make()({ elevation: 0 }).part("shadow")).toBeUndefined();
	});

	it("wraps media paths", () => {
		const f = make()({ content: "rec.mp4" });
		expect(kids(f.part("content"))[0]).toMatchObject({
			kind: "media",
			source: "rec.mp4",
		});
	});
});
