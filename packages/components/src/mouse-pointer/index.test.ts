import type { LayoutNode } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { mousePointer } from "./index.js";

const make = () => bind(fakeHost(), mousePointer);

describe("MousePointer", () => {
	it("covers its area from 0, 0 and reports cues on the parent's timeline", () => {
		const p = make()({
			at: 30,
			path: [{ to: [100, 100] }, { to: [600, 400], click: true }],
		});
		expect(p).toMatchObject({
			position: "absolute",
			x: 0,
			y: 0,
			width: 1920,
			height: 1080,
			startFrame: 30,
		});
		const click = p.cues.clicks[0];
		expect(click?.frame).toBeGreaterThan(30);
		expect(click?.point).toEqual([600, 400]);
		expect(p.positionAt(click?.frame ?? 0)).toEqual([600, 400]);
		expect(p.span.duration).toBeGreaterThan((click?.frame ?? 0) - 30);
	});

	it("aims at node centres and text glyphs", () => {
		const button = { id: "btn", x: 200, y: 300, width: 120, height: 40 };
		const title = {
			id: "t",
			kind: "text",
			x: 400,
			y: 100,
			text: "Ship it",
			fontFamily: "Inter",
			fontSize: 20,
		};
		const p = make()({
			path: [
				{ to: { node: button }, click: true },
				{ to: { text: title, match: "it" }, click: true },
			],
		});
		expect(p.cues.clicks[0]).toMatchObject({
			point: [260, 320],
			target: "btn",
		});
		// Text lands at the start of the match, mid-line (fixed 10 px glyphs).
		expect(p.cues.clicks[1]?.point).toEqual([450, 112]);
	});

	it("builds one glyph per style used, a ripple per click, a trail and a label", () => {
		const p = make()({
			path: [
				{ to: [100, 100], click: 2 },
				{ to: [500, 100], cursor: "hand" },
			],
			trail: { length: 3 },
			label: "Ada",
		});
		expect(p.part("glyph-arrow")).toBeDefined();
		expect(p.part("glyph-hand")).toBeDefined();
		expect(p.part("label")).toBeDefined();
		const stage = p.part("stage") as unknown as { children: LayoutNode[] };
		const ids = stage.children.map((c) => c.id);
		expect(ids.filter((id) => id.includes("ripple"))).toHaveLength(2);
		expect(ids.filter((id) => id.includes("trail"))).toHaveLength(3);
		expect(ids.at(-1)).toMatch(/-motion$/);
	});

	it("enters from an edge of its area", () => {
		const p = make()({
			from: "left",
			path: [{ to: [500, 300] }],
			area: { width: 1000, height: 600 },
		});
		expect(p.positionAt(0)[0]).toBeLessThan(0);
		expect(p.positionAt(0)[1]).toBe(300);
	});

	it("rejects unknown waypoint fields", () => {
		expect(() =>
			make()({ path: [{ to: [0, 0], clik: true } as never] }),
		).toThrow(/clik/);
	});
});
