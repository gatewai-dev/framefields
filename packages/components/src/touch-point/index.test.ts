import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { touchPoint } from "./index.js";

const make = () => bind(fakeHost(), touchPoint);
type Key = { frame: number; value: number };
type Node = {
	id?: string;
	children?: Node[];
	animation?: { tracks: Array<{ prop: string; keyframes: Key[] }> };
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
const track = (n: Node | undefined, prop: string) =>
	n?.animation?.tracks.find((t) => t.prop === prop)?.keyframes ?? [];
const valueAt = (keys: Key[], f: number) =>
	[...keys].reverse().find((k) => k.frame <= f)?.value ?? keys[0]?.value;

describe("TouchPoint", () => {
	it("cues taps, presses and swipes in order", () => {
		const t = make()({
			touches: [
				{ to: [100, 100], tap: 2 },
				{ to: [200, 200], press: 30 },
				{ to: [300, 600], swipe: [300, 200] },
			],
		});
		expect(t.cues.taps.length).toBe(2);
		expect(t.cues.presses.length).toBe(1);
		expect(t.cues.swipes.length).toBe(1);
		expect(t.cues.touches.length).toBe(4);
		const frames = t.cues.touches.map((c) => c.frame);
		expect([...frames].sort((a, b) => a - b)).toEqual(frames);
		const press = t.cues.presses[0] as { frame: number; end: number };
		expect(press.end - press.frame).toBe(30);
	});

	it("a swipe's disc is at `from` on the cue frame and `to` at its end", () => {
		const t = make()({
			id: "t",
			size: 40,
			touches: [{ to: [300, 600], swipe: [300, 200] }],
		});
		const sw = t.cues.swipes[0] as { frame: number; end: number };
		const disc = find(t, "t-touch-0");
		expect(valueAt(track(disc, "y"), sw.frame)).toBe(600 - 20);
		expect(valueAt(track(disc, "y"), sw.end)).toBe(200 - 20);
		expect(find(t, "t-touch-0-trail-0")).toBeDefined();
	});

	it("is invisible before the lead-in and after the lift", () => {
		const t = make()({ id: "t", touches: [{ to: [100, 100], at: 30 }] });
		const o = track(find(t, "t-touch-0"), "opacity");
		expect(valueAt(o, 20)).toBe(0);
		expect(valueAt(o, 30)).toBeGreaterThan(0);
		expect(o.at(-1)?.value).toBe(0);
		expect(t.cues.taps[0]?.frame).toBe(30);
	});

	it("waits after each touch when `at` is omitted", () => {
		const t = make()({ touches: [{ to: [0, 0] }, { to: [10, 10] }] });
		const [a, b] = t.cues.taps.map((c) => c.frame);
		expect((b as number) - (a as number)).toBeGreaterThan(20);
	});
});
