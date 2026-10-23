import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	formatDuration,
	type RenderProgress,
	RenderReporter,
} from "../render-reporter.js";

function setup(totalFrames: number) {
	const lines: string[] = [];
	const events: RenderProgress[] = [];
	const push = (_obj: object, msg: string) => {
		lines.push(msg.replace("[HeadlessWebGPURenderer] ", ""));
	};
	const reporter = new RenderReporter({
		renderId: "vid-test",
		totalFrames,
		onProgress: (p) => events.push(p),
		log: { info: push, debug: () => {}, warn: push, error: push },
		now: () => Date.now(),
	});
	return { reporter, lines, events };
}

describe("RenderReporter", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it("logs a bounded number of frame lines whatever the length", () => {
		for (const totalFrames of [300, 30_000]) {
			const { reporter, lines, events } = setup(totalFrames);
			reporter.stage("render", "Rendering");
			for (let f = 1; f <= totalFrames; f++) {
				vi.advanceTimersByTime(100);
				reporter.frameDone(f);
			}
			reporter.dispose();
			const frameLines = lines.filter((l) => l.startsWith("Rendered "));
			expect(frameLines).toHaveLength(10);
			expect(frameLines[0]).toMatch(
				new RegExp(
					`^Rendered 10% \\(${totalFrames / 10}/${totalFrames} frames\\) · 10\\.0 fps · eta `,
				),
			);
			expect(frameLines.at(-1)).toMatch(/^Rendered 100% .* in /);
			// onProgress still sees every frame.
			expect(events.filter((e) => e.phase === "render")).toHaveLength(
				totalFrames + 1,
			);
		}
	});

	it("skips milestones reached within a second, but always logs 100%", () => {
		const { reporter, lines } = setup(30);
		reporter.stage("render", "Rendering");
		for (let f = 1; f <= 30; f++) {
			vi.advanceTimersByTime(10);
			reporter.frameDone(f);
		}
		reporter.dispose();
		expect(lines).toEqual([
			"Rendering",
			expect.stringMatching(/^Rendered 100% \(30\/30 frames\)/),
		]);
	});

	it("logs 'still …' lines with backoff, without emitting progress", () => {
		const { reporter, lines, events } = setup(100);
		reporter.stage("mux", "Muxing mp4");
		const before = events.length;
		vi.advanceTimersByTime(20 * 60_000);
		reporter.dispose();
		const still = lines.filter((l) => l.startsWith("Still "));
		// 10 s, 30 s, 70 s, 150 s, 310 s, then every 5 min: 610 s, 910 s.
		expect(still).toHaveLength(7);
		expect(still[0]).toBe("Still muxing, 10.0s in this phase");
		expect(still[1]).toBe("Still muxing, 30.0s in this phase");
		expect(events.length).toBe(before);
	});

	it("restarts the backoff on a new phase and shows the phase's detail", () => {
		const { reporter, lines } = setup(100);
		reporter.stage("mux", "Muxing mp4");
		vi.advanceTimersByTime(40_000);
		reporter.stage("audio", "Mixing audio");
		reporter.update("3/7 clips: music.mp3", 3 / 7);
		vi.advanceTimersByTime(10_000);
		reporter.dispose();
		expect(lines.at(-1)).toBe(
			"Still mixing audio (42%, 3/7 clips: music.mp3), 10.0s in this phase",
		);
	});

	it("summarizes phase durations and reports done", () => {
		const { reporter, lines, events } = setup(60);
		reporter.stage("prepare", "Preparing");
		vi.advanceTimersByTime(1_000);
		reporter.stage("render", "Rendering");
		vi.advanceTimersByTime(4_000);
		reporter.frameDone(60);
		reporter.stage("audio", "Mixing audio");
		vi.advanceTimersByTime(500);
		reporter.stage("mux", "Muxing mp4");
		vi.advanceTimersByTime(250);
		reporter.finish({ bytes: 3 * 1024 * 1024 });
		vi.advanceTimersByTime(60_000);
		expect(lines.at(-1)).toBe(
			"Done in 5.8s (3.0 MB): prepare 1.0s · render 4.0s · audio 0.5s · mux 0.3s",
		);
		expect(events.at(-1)).toMatchObject({
			phase: "done",
			frame: 60,
			totalFrames: 60,
			elapsedMs: 5750,
		});
		expect(events.map((e) => e.phase)).toEqual([
			"prepare",
			"render",
			"render",
			"audio",
			"mux",
			"done",
		]);
	});

	it("names the phase a render failed or was aborted in", () => {
		const { reporter, lines } = setup(10);
		reporter.stage("audio", "Mixing audio");
		reporter.fail(new Error("boom"), false);
		reporter.fail(new Error("stop"), true);
		expect(lines.slice(-2)).toEqual([
			"Failed while mixing audio after 0.0s",
			"Aborted while mixing audio after 0.0s",
		]);
	});
});

describe("formatDuration", () => {
	it("formats seconds, minutes and hours", () => {
		expect(formatDuration(4_240)).toBe("4.2s");
		expect(formatDuration(125_000)).toBe("2m 05s");
		expect(formatDuration(3_720_000)).toBe("1h 02m");
	});
});
