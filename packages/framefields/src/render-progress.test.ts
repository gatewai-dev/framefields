import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	Composition,
	encodeStereoWav,
	Layer,
	type RenderProgress,
} from "./index.js";

async function tone(dir: string): Promise<string> {
	const sampleRate = 48_000;
	const samples = new Float32Array(sampleRate);
	for (let i = 0; i < samples.length; i++) {
		samples[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / sampleRate);
	}
	const file = path.join(dir, "tone.wav");
	await fs.writeFile(file, encodeStereoWav([samples, samples], { sampleRate }));
	return file;
}

function film(audio: string): Composition {
	const comp = new Composition({
		width: 64,
		height: 64,
		fps: 30,
		durationFrames: 30,
		backgroundColor: "#202020",
	});
	comp.add(Layer.audio(audio, { id: "tone", durationFrames: 30 }));
	return comp;
}

/** Phases in the order they were first reported. */
function phases(events: RenderProgress[]): string[] {
	return events
		.map((e) => e.phase)
		.filter((phase, i, all) => all.indexOf(phase) === i);
}

describe("renderVideo progress", () => {
	it("reports each phase in order, with the audio clips mixed", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-progress-"));
		const events: RenderProgress[] = [];
		const result = await film(await tone(dir)).renderVideo({
			outputPath: path.join(dir, "out.mp4"),
			onProgress: (p) => events.push({ ...p }),
		});
		await result.cleanup();

		expect(phases(events)).toEqual([
			"prepare",
			"render",
			"audio",
			"audio-encode",
			"mux",
			"done",
		]);
		const frames = events.filter((e) => e.phase === "render");
		expect(frames.at(-1)).toMatchObject({ frame: 30, totalFrames: 30 });
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].frame).toBeGreaterThanOrEqual(frames[i - 1].frame);
		}
		expect(events.filter((e) => e.phase === "audio").at(-1)).toMatchObject({
			detail: "1/1 clips: tone.wav",
			phaseProgress: 1,
		});
		expect(
			events.filter((e) => e.phase === "audio-encode").at(-1)?.phaseProgress,
		).toBe(1);
		const elapsed = events.map((e) => e.elapsedMs);
		expect(elapsed).toEqual([...elapsed].sort((a, b) => a - b));
	}, 60_000);

	it("skips the frame phase for audio-only output", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-progress-"));
		const events: RenderProgress[] = [];
		const result = await film(await tone(dir)).renderVideo({
			outputPath: path.join(dir, "out.m4a"),
			codec: "aac",
			onProgress: (p) => events.push({ ...p }),
		});
		await result.cleanup();

		expect(phases(events)).toEqual([
			"prepare",
			"audio",
			"audio-encode",
			"mux",
			"done",
		]);
	}, 60_000);
});
