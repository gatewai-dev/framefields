import { describe, expect, it } from "vitest";
import type { AudioLevels } from "../core/audio.js";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { waveform } from "./index.js";

const make = () => bind(fakeHost(), waveform);
type Signal = { kind: "signal"; values: number[]; fps: number };
type Node = {
	id?: string;
	x?: number;
	height?: number;
	rotation?: number;
	children?: Node[];
	animation?: {
		tracks: Array<{ prop: string; source?: { inputHandleId: string } }>;
	};
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

/** Four bands over 10 frames: band b is (b + 1) / 4 on frame 5, 0 elsewhere. */
const audio: AudioLevels = {
	fps: 30,
	frames: 10,
	bands: [0, 1, 2, 3].map((b) =>
		Array.from({ length: 10 }, (_, f) => (f === 5 ? (b + 1) / 4 : 0)),
	),
	level: new Array(10).fill(0),
	beats: [5],
};

/** The signal objects a host built, in order. */
function signalsOf(host: ReturnType<typeof fakeHost>) {
	const out: Signal[] = [];
	const signal = host.signal;
	host.signal = (values, fps) => {
		const s = signal(values, fps) as Signal;
		out.push(s);
		return s;
	};
	return out;
}

describe("Waveform", () => {
	it("needs audio analysed at its own fps", () => {
		expect(() => make()({ audio, fps: 24 })).toThrow(/analysed at 30 fps/);
	});

	it("binds bar heights to their band, offset to the track's start", () => {
		const host = fakeHost();
		const signals = signalsOf(host);
		const w = bind(
			host,
			waveform,
		)({
			id: "w",
			audio,
			kind: "bars",
			floor: 0,
			smoothing: 0,
			height: 100,
			audioStart: 20,
		});
		expect(w.span.duration).toBe(10);
		expect(w.cues.beats.map((c) => c.frame)).toEqual([25]);
		// Band 3's height signal: 20 frames of floor, then the levels.
		const heights = signals.filter((_, i) => i % 2 === 0);
		expect(heights.length).toBe(4);
		const top = heights[3] as Signal;
		expect(top.values.length).toBe(20 + 10 + 1);
		expect(top.values[25]).toBe(100);
		expect(top.values[24]).toBe(0);
		expect(heights[0]?.values[25]).toBe(25);
		const bar = find(w, "w-bar-3");
		expect(bar?.animation?.tracks.map((t) => t.prop)).toEqual(["height", "y"]);
	});

	it("defaults the track's start to the component's", () => {
		const host = fakeHost();
		const signals = signalsOf(host);
		bind(host, waveform)({ audio, at: 12 });
		expect(signals[0]?.values.length).toBe(12 + 10 + 1);
	});

	it("mirrors bands out from the middle", () => {
		const host = fakeHost();
		const signals = signalsOf(host);
		const w = bind(host, waveform)({ id: "w", audio, bars: 6 });
		// 3 bands, each shown twice; lowest in the middle.
		expect(signals.length).toBe(3 * 2);
		const handle = (i: number) =>
			find(w, `w-bar-${i}`)?.animation?.tracks[0]?.source?.inputHandleId;
		expect(handle(2)).toBe(handle(3));
		expect(handle(0)).toBe(handle(5));
		expect(handle(0)).not.toBe(handle(2));
	});

	it("arranges a ring of spokes", () => {
		const w = make()({ id: "w", audio, kind: "radial", bars: 8 });
		expect(find(w, "w-spoke-2")?.rotation).toBe(90);
		expect(find(w, "w-spoke-2")?.children?.[0]?.id).toBe("w-bar-2");
	});
});
