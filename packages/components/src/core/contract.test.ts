import { LayerAnimation } from "@framefields/compositions/program";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fakeHost } from "../test/fake-host.js";
import { probe } from "../test/probe.js";
import {
	bind,
	defineComponent,
	after as endPlus,
	pulseKeys,
	withDefaults,
} from "./contract.js";
import { themes } from "./theme.js";

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

describe("component lifetimes", () => {
	const settles = (o: { openEnded?: boolean; afterHold?: number }) =>
		defineComponent({
			name: "Settles",
			props: () => ({ tag: z.string().optional() }),
			defaults: { hold: 10 },
			build: (ctx) => ({
				children: [ctx.host.box({ id: ctx.partId("x") })],
				width: 100,
				height: 50,
				duration: 20,
				cues: {},
				...o,
			}),
		});

	it("keeps open-ended components up until an exit is asked for", () => {
		const host = fakeHost();
		const up = bind(host, settles({ openEnded: true }))({});
		expect(up.span.end).toBe(Number.POSITIVE_INFINITY);
		const out = bind(
			host,
			settles({ openEnded: true }),
		)({ exit: { preset: "fade", duration: 6 } });
		expect(out.span.duration).toBe(20 + 10 + 6);
		expect(
			bind(host, settles({ openEnded: true }))({ duration: 50 }).span.duration,
		).toBe(50);
	});

	it("adds the component's own after-hold exit to the window", () => {
		const c = bind(fakeHost(), settles({ afterHold: 12 }))({});
		expect(c.span.duration).toBe(20 + 10 + 12);
	});

	it("slides mask presets the full size through a clipping root", () => {
		const c = bind(
			fakeHost(),
			settles({}),
		)({ enter: "mask-up" }) as unknown as {
			overflow?: string;
			children: Array<{
				animation: {
					tracks: Array<{ prop: string; keyframes: Array<{ value: number }> }>;
				};
			}>;
		};
		expect(c.overflow).toBe("hidden");
		const tracks = c.children[0]?.animation.tracks ?? [];
		expect(tracks.map((t) => t.prop)).toEqual(["y"]);
		expect(tracks[0]?.keyframes[0]?.value).toBe(50);
	});
});

describe("first keys", () => {
	it("hold from frame 0 in every track of the tree (the renderer shows base values before them)", () => {
		const late = defineComponent({
			name: "Late",
			props: () => ({ tag: z.string().optional() }),
			build: (ctx) => {
				const child = ctx.host.box({ id: ctx.partId("child") });
				child.animate(
					LayerAnimation.keys("opacity", [
						[40, 0],
						[44, 1],
					]),
				);
				return {
					children: [child],
					width: 10,
					height: 10,
					duration: 50,
					cues: {},
				};
			},
		});
		const node = bind(fakeHost(), late)({ id: "l" }) as unknown as {
			children: Array<{
				children: Array<{
					animation: {
						tracks: Array<{
							keyframes: Array<{ frame: number; value: number }>;
						}>;
					};
				}>;
			}>;
		};
		const keys =
			node.children[0]?.children[0]?.animation.tracks[0]?.keyframes ?? [];
		expect(keys.map((k) => [k.frame, k.value])).toEqual([
			[0, 0],
			[40, 0],
			[44, 1],
		]);
	});

	it("suggests the prop a typo meant, and names the instance", () => {
		const Probe = make();
		expect(() => Probe({ lable: "x" } as never)).toThrow(
			/did you mean "lable" → "label"\?/,
		);
		expect(() => Probe({ id: "intro", at: -1 })).toThrow(
			/^Probe#intro: invalid props/,
		);
	});

	it("hands the canvas to the build, defaulting to 1920 × 1080 × scale", () => {
		let seen: unknown;
		const Spy = bind(
			fakeHost(),
			defineComponent({
				name: "Spy",
				props: () => ({ n: z.number().optional() }),
				build(ctx) {
					seen = ctx.canvas;
					return { children: [], width: 1, height: 1, duration: 1, cues: {} };
				},
			}),
		);
		Spy({});
		expect(seen).toEqual({ width: 1920, height: 1080 });
		Spy({ theme: { scale: 2 } });
		expect(seen).toEqual({ width: 3840, height: 2160 });
		Spy({ canvas: { width: 1080, height: 1920 } });
		expect(seen).toEqual({ width: 1080, height: 1920 });
	});

	it("withDefaults sets project props once; calls still win", () => {
		const ui = withDefaults({ fps: 60, theme: themes.paper, seed: 7 });
		const Probe = ui(make());
		const node = Probe({ id: "d" });
		const plate = node.part("plate") as unknown as { background: string };
		expect(plate.background).toBe(themes.paper.color.accent);
		// A partial theme merges over the default theme, not over graphite.
		const tinted = Probe({ id: "e", theme: { color: { accent: "#123456" } } });
		expect(tinted.part("plate")).toMatchObject({
			background: "#123456",
			borderRadius: themes.paper.radius.md,
		});
		expect(() => Probe({ fps: 24 })).not.toThrow();
	});

	it("after() chains from a component's end", () => {
		const node = make()({ at: 30 });
		expect(endPlus(node, 6)).toBe(51);
		expect(() => endPlus({ span: { end: Number.POSITIVE_INFINITY } })).toThrow(
			/open-ended/,
		);
	});

	it("puts the stage's motion blur on when its enter or exit asks", () => {
		const blurred = make()({ enter: "slide-left" });
		expect(blurred.part("stage")).toMatchObject({ motionBlurShutter: 90 });
		const plain = make()({ enter: "rise" });
		expect(plain.part("stage")).not.toHaveProperty("motionBlurShutter");
	});
});
