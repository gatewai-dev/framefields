import { describe, expect, it } from "vitest";
import type { PreviewNote } from "../protocol.js";
import { draftAt } from "./app.js";
import {
	frameFromHash,
	hashForFrame,
	markLanes,
	openNotesText,
	rulerTicks,
	timecode,
	whereText,
} from "./format.js";

const note = (id: number, frame: number, extra: Partial<PreviewNote> = {}) =>
	({
		id,
		frame,
		time: frame / 10,
		x: 0.25,
		y: 0.5,
		text: `note ${id}`,
		done: false,
		created: "",
		...extra,
	}) satisfies PreviewNote;

describe("the address fragment", () => {
	it("names a moment in seconds or a frame, clamped to the film", () => {
		expect(frameFromHash("#t=1.25", 24, 100)).toBe(30);
		expect(frameFromHash("#frame=12", 24, 100)).toBe(12);
		expect(frameFromHash("#x=1&t=2", 10, 100)).toBe(20);
		expect(frameFromHash("#t=99", 24, 100)).toBe(99);
		expect(frameFromHash("#frame=500", 24, 100)).toBe(99);
		expect(frameFromHash("", 24, 100)).toBeNull();
		expect(frameFromHash("#notes", 24, 100)).toBeNull();
	});

	it("keeps a position as seconds, and nothing at the start", () => {
		expect(hashForFrame(30, 24)).toBe("#t=1.25");
		expect(hashForFrame(1, 3)).toBe("#t=0.333");
		expect(hashForFrame(0, 24)).toBe("");
		// What it writes reads back as the same frame.
		expect(frameFromHash(hashForFrame(77, 30), 30, 1000)).toBe(77);
	});
});

describe("time", () => {
	it("shows m:ss.ss", () => {
		expect(timecode(0, 30)).toBe("0:00.00");
		expect(timecode(95, 10)).toBe("0:09.50");
		expect(timecode(3725, 50)).toBe("1:14.50");
	});

	it("labels the ruler's majors at least 80 px apart", () => {
		const ticks = rulerTicks(10, 800);
		const majors = ticks.filter((t) => t.major);
		expect(majors.map((t) => t.label)).toEqual([
			"0:00",
			"0:01",
			"0:02",
			"0:03",
			"0:04",
			"0:05",
			"0:06",
			"0:07",
			"0:08",
			"0:09",
			// Too close to the right edge for a label.
			undefined,
		]);
		expect(ticks).toHaveLength(51);
		expect(rulerTicks(0, 800)).toEqual([]);
	});
});

describe("notes", () => {
	it("stack on the timeline when close together, three lanes at most", () => {
		const lanes = markLanes(
			[note(4, 3), note(1, 0), note(2, 1), note(3, 2), note(5, 90)],
			100,
			300,
		);
		expect(lanes.map((m) => [m.note.id, m.lane])).toEqual([
			[1, 0],
			[2, 1],
			[3, 2],
			[4, 2],
			[5, 0],
		]);
		expect(lanes[4].left).toBeCloseTo((90 / 99) * 100);
	});

	it("are pinned to a spot, or an area when dragged far enough", () => {
		expect(draftAt(7, { x: 0.1, y: 0.2 }, null)).toEqual({
			frame: 7,
			x: 0.1,
			y: 0.2,
			text: "",
		});
		expect(
			draftAt(7, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }),
		).toEqual({ frame: 7, x: 0.1, y: 0.2, w: 0.3, h: 0.4, text: "" });
		// A twitch is a click.
		expect(
			draftAt(7, { x: 0.1, y: 0.2 }, { x: 0.1, y: 0.2, w: 0.3, h: 0.005 }),
		).toEqual({ frame: 7, x: 0.1, y: 0.2, text: "" });
	});

	it("read as text for a chat: open ones, by time, with where and the picture", () => {
		expect(whereText({ x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toBe(
			"area 10%,20% to 40%,60%",
		);
		const text = openNotesText(
			"Film",
			[
				note(2, 20, { image: "/n/note-2.jpg" }),
				note(1, 10, { done: true }),
				note(3, 5),
			],
			10,
		);
		expect(text).toBe(
			[
				'Notes on the preview of "Film":',
				"- Note 3 at 0:00.50 (frame 5), spot 25%,50%: note 3",
				"- Note 2 at 0:02.00 (frame 20), spot 25%,50%: note 2 [picture: /n/note-2.jpg]",
			].join("\n"),
		);
	});
});
