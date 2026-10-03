import { reportRenderDiagnostic, takeRenderDiagnostics } from "@gitframes/core";
import { describe, expect, it } from "vitest";
import {
	analyzeAudio,
	buildQaReport,
	FrameInspector,
	formatQaReport,
	integratedLoudness,
} from "../video-qa.js";

const RATE = 48_000;

function sine(amplitude: number, seconds: number, hz = 997): Float32Array {
	const out = new Float32Array(Math.round(seconds * RATE));
	for (let i = 0; i < out.length; i++) {
		out[i] = amplitude * Math.sin((2 * Math.PI * hz * i) / RATE);
	}
	return out;
}

function frame(width: number, height: number, rgb: number): Uint8Array {
	const px = new Uint8Array(width * height * 4);
	for (let i = 0; i < px.length; i += 4) {
		px[i] = rgb;
		px[i + 1] = rgb;
		px[i + 2] = rgb;
		px[i + 3] = 255;
	}
	return px;
}

describe("integratedLoudness (ITU-R BS.1770)", () => {
	it("reads a -20 dBFS 997 Hz stereo sine as -20 LUFS", () => {
		const ch = sine(0.1, 5);
		expect(integratedLoudness([ch, ch], RATE)).toBeCloseTo(-20, 1);
	});

	it("reads the same sine on one channel 3 LU quieter", () => {
		const ch = sine(0.1, 5);
		const lufs = integratedLoudness([ch, new Float32Array(ch.length)], RATE)!;
		expect(lufs).toBeCloseTo(-23.01, 1);
	});

	it("gates out silence instead of averaging it in", () => {
		const loud = sine(0.1, 3);
		const ch = new Float32Array(loud.length * 3);
		ch.set(loud); // 3 s of tone, 6 s of silence
		expect(integratedLoudness([ch, ch], RATE)).toBeCloseTo(-20, 0);
	});
});

describe("analyzeAudio", () => {
	it("measures peak, clipping and silent stretches", () => {
		const ch = new Float32Array(RATE * 6);
		ch.set(sine(1.2, 2)); // 2 s overdriven, then 4 s silence
		const stats = analyzeAudio([ch, ch], RATE);
		expect(stats.peakDbfs).toBeCloseTo(20 * Math.log10(1.2), 1);
		expect(stats.clippedSamples).toBeGreaterThan(0);
		expect(stats.silentSegments).toHaveLength(1);
		expect(stats.silentSegments[0]!.startSec).toBeCloseTo(2, 1);
		expect(stats.silentSegments[0]!.endSec).toBeCloseTo(6, 1);
	});

	it("reports a silent track with no loudness", () => {
		const stats = analyzeAudio([new Float32Array(RATE * 3)], RATE);
		expect(stats.integratedLufs).toBeNull();
	});
});

describe("FrameInspector", () => {
	it("finds black and frozen stretches", () => {
		const fps = 10;
		const inspector = new FrameInspector();
		// 1 s of moving gray, 1 s of black, 3 s holding one gray
		for (let i = 0; i < 10; i++) inspector.inspect(frame(64, 36, 100 + i * 10), 64, 36);
		for (let i = 0; i < 10; i++) inspector.inspect(frame(64, 36, 0), 64, 36);
		for (let i = 0; i < 30; i++) inspector.inspect(frame(64, 36, 128), 64, 36);

		const stats = inspector.stats(50, 50, fps, 64, 36);
		expect(stats.blackSegments).toEqual([{ startSec: 1, endSec: 2 }]);
		// The black second also holds still, but is shorter than the 2 s minimum.
		expect(stats.frozenSegments).toEqual([{ startSec: 2, endSec: 5 }]);
	});
});

describe("buildQaReport", () => {
	it("fails on warnings and errors, passes with only info", () => {
		const inspector = new FrameInspector();
		for (let i = 0; i < 4; i++) inspector.inspect(frame(8, 8, 200), 8, 8);
		const video = inspector.stats(5, 4, 30, 8, 8);
		const ch = sine(0.1, 2);
		const audio = analyzeAudio([ch, ch], RATE);

		const failing = buildQaReport({
			video,
			audio,
			diagnostics: [
				{
					severity: "warning",
					code: "animation_truncated",
					message: "tail never plays",
					layerId: "title",
				},
			],
			options: { targetLufs: -14 },
		});
		expect(failing.passed).toBe(false);
		expect(failing.issues.map((i) => i.code)).toEqual([
			"frames_missing",
			"loudness_off_target",
			"animation_truncated",
		]);
		expect(formatQaReport(failing)).toContain("QA FAILED");

		const passing = buildQaReport({
			video: inspector.stats(4, 4, 30, 8, 8),
			audio,
		});
		expect(passing.passed).toBe(true);
	});
});

describe("render diagnostics", () => {
	it("collects a render's own and its nested compositions' reports once", () => {
		const d = {
			severity: "warning" as const,
			code: "animation_truncated",
			message: "tail never plays",
			layerId: "a",
		};
		reportRenderDiagnostic("vid-1", d);
		reportRenderDiagnostic("vid-1", d); // repeat: kept once
		reportRenderDiagnostic("vid-1-c3-Compositor", { ...d, layerId: "b" });
		reportRenderDiagnostic("vid-10", { ...d, layerId: "other render" });

		expect(takeRenderDiagnostics("vid-1").map((x) => x.layerId)).toEqual(["a", "b"]);
		expect(takeRenderDiagnostics("vid-1")).toEqual([]);
		expect(takeRenderDiagnostics("vid-10")).toHaveLength(1);
	});
});
