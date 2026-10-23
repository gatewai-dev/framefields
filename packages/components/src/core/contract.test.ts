import { describe, expect, it } from "vitest";
import { fakeHost } from "../test/fake-host.js";
import { probe } from "../test/probe.js";
import { bind, pulseKeys } from "./contract.js";

const make = () => bind(fakeHost(), probe);

describe("component contract", () => {
	it("builds root → stage → content with the natural window", () => {
		const Probe = make();
		const node = Probe({ at: 30, x: 100, y: 50 });
		expect(node).toMatchObject({
			kind: "box",
			id: "probe-auto-1",
			position: "absolute",
			x: 100,
			y: 50,
			width: 100,
			height: 100,
			startFrame: 30,
			durationFrames: 15, // natural 10 + hold 5, no exit
		});
		const stage = node.part("stage")!;
		expect(stage).toMatchObject({
			id: "probe-auto-1-stage",
			position: "absolute",
			x: 0,
			y: 0,
		});
		expect(
			(stage as { children: Array<{ id: string }> }).children.map((c) => c.id),
		).toEqual(["probe-auto-1-plate", "probe-auto-1-label"]);
		expect(node.span).toEqual({ start: 30, end: 45, duration: 15 });
	});

	it("puts cues on the parent's timeline", () => {
		const node = make()({ at: 30, ticks: [2, 7] });
		expect(node.cues.landed).toEqual([{ frame: 40 }]);
		expect(node.cues.ticks.map((c) => c.frame)).toEqual([32, 37]);
	});

	it("keeps extras off the JSON", () => {
		const node = make()({ id: "p" });
		const json = JSON.parse(JSON.stringify(node));
		expect(json).not.toHaveProperty("cues");
		expect(json).not.toHaveProperty("span");
		expect(json).not.toHaveProperty("part");
		expect(json.children[0].id).toBe("p-stage");
	});

	it("applies enter by default and exit when asked, extending the window", () => {
		const node = make()({ exit: { preset: "fade", duration: 6 } });
		expect(node.durationFrames).toBe(21);
		const tracks =
			(
				node.part("stage") as {
					animation?: { tracks: Array<{ prop: string }> };
				}
			).animation?.tracks ?? [];
		expect(tracks.map((t) => t.prop).sort()).toEqual([
			"opacity",
			"opacity",
			"y",
		]);
		const none = make()({ enter: false });
		expect(
			(none.part("stage") as { animation?: unknown }).animation,
		).toBeUndefined();
	});

	it("respects explicit duration, size, flow placement and theme", () => {
		const node = make()({
			duration: 90,
			width: 300,
			position: "relative",
			theme: { color: { accent: "#123456" } },
		});
		expect(node.durationFrames).toBe(90);
		expect(node.width).toBe(300);
		expect(node.position).toBe("relative");
		expect(node.x).toBeUndefined();
		expect(node.part("plate")).toMatchObject({ background: "#123456" });
	});

	it("is deterministic per seed", () => {
		const a = make()({ ticks: [1, 2], seed: 3 }).cues.ticks;
		const b = make()({ ticks: [1, 2], seed: 3 }).cues.ticks;
		const c = make()({ ticks: [1, 2], seed: 4 }).cues.ticks;
		expect(a).toEqual(b);
		expect(a).not.toEqual(c);
	});

	it("hands every part to customize", () => {
		const seen: string[] = [];
		make()({
			customize: (parts) => {
				seen.push(...Object.keys(parts));
				(parts.plate as { background?: string }).background = "#fff";
			},
		});
		expect(seen.sort()).toEqual(["label", "plate", "root", "stage"]);
	});

	it("rejects bad and unknown props with a readable message", () => {
		const Probe = make();
		expect(() => Probe({ at: -1 })).toThrow(/Probe: invalid props\n {2}- at:/);
		expect(() => Probe({ lable: "x" } as never)).toThrow(/lable/);
		expect(() => Probe({ enter: "spin" as never })).toThrow(/enter/);
		expect(() => Probe({ at: 1.5 })).toThrow(/at/);
	});
});

describe("pulseKeys", () => {
	it("pulses at each cue", () => {
		expect(
			pulseKeys([{ frame: 10 }, 30], {
				rest: 1,
				peak: 1.2,
				attack: 2,
				release: 6,
			}),
		).toEqual([
			[8, 1],
			[10, 1.2],
			[16, 1, "power2.out"],
			[28, 1],
			[30, 1.2],
			[36, 1, "power2.out"],
		]);
	});
});
