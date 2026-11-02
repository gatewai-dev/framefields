/**
 * A windowed mix (what the preview plays around its playhead) is the same
 * samples as that stretch of a full mix. Effects that carry state match once
 * the window is mixed from far enough before it (the lead-in).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { mixAudioTracks } from "@framefields/compositions";
import { ensureDevice } from "@framefields/webgpu-renderers";
import { beforeAll, describe, expect, it } from "vitest";
import { AudioDelay, AudioFade, AudioReverb } from "./effects/index.js";
import { Composition, encodeStereoWav, Layer } from "./index.js";
import { HeadlessMediaRenderer } from "./renderer/index.js";

const SR = 48000;
const FPS = 30;

function noise(seconds: number, seed: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * SR));
	let s = seed;
	for (let i = 0; i < out.length; i++) {
		s = (s * 1103515245 + 12345) >>> 0;
		out[i] = ((s / 2 ** 32) * 2 - 1) * 0.3;
	}
	return out;
}

let source = "";
beforeAll(async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "audio-mix-window-"));
	source = path.join(dir, "source.wav");
	await fs.writeFile(
		source,
		encodeStereoWav([noise(12, 1), noise(12, 2)], { sampleRate: SR }),
	);
});

function film(effects: "none" | "fade" | "reverb" = "none") {
	const comp = new Composition({
		width: 64,
		height: 64,
		fps: FPS,
		durationMs: 4000,
	});
	const first = Layer.audio(source, {
		trimStartSec: 2.25,
		startFrame: 7,
		durationFrames: 70,
	});
	if (effects === "fade")
		first.apply(new AudioFade({ fadeInDuration: 0.8, fadeOutDuration: 0.6 }));
	if (effects === "reverb") first.apply(new AudioReverb({}));
	comp.addAudio(first);
	comp.addAudio(
		Layer.audio(source, {
			trimStartSec: 6,
			startFrame: 40,
			durationFrames: 60,
			volume: 0.5,
		}),
	);
	comp.addAudio(
		Layer.audio(source, {
			startFrame: 85,
			durationFrames: 30,
			timeRemap: { kind: "rate", sourceStartSec: 9, rate: -0.75 },
		}),
	);
	return comp;
}

const renderer = new HeadlessMediaRenderer();
const mix = (
	comp: Composition,
	window?: { startSec: number; endSec: number },
) =>
	renderer.renderAudio(comp.toVirtualMedia(), {
		fps: FPS,
		sampleRate: SR,
		window,
		master: false,
	});

/** The largest difference between a window and the same stretch of `full`. */
function maxDiff(full: Float32Array[], part: Float32Array[], startSec: number) {
	const offset = Math.round(startSec * SR);
	let max = 0;
	for (let c = 0; c < 2; c++)
		for (let i = 0; i < part[c].length; i++)
			max = Math.max(max, Math.abs(part[c][i] - full[c][offset + i]));
	return max;
}

describe("windowed audio mix", () => {
	it("is the same samples as that stretch of the full mix", async () => {
		const comp = film();
		const full = await mix(comp);
		for (const [startSec, endSec] of [
			[0, 4],
			[0.37, 1.13],
			[1.2, 1.4],
			[2.9, 3.8],
			[3.5, 4],
		]) {
			const part = await mix(comp, { startSec, endSec });
			expect(part.channels[0].length).toBe(
				Math.round(endSec * SR) - Math.round(startSec * SR),
			);
			expect(maxDiff(full.channels, part.channels, startSec)).toBeLessThan(
				1e-6,
			);
		}
	}, 60_000);

	it("keeps time-based effects on the clip's own clock", async () => {
		const comp = film("fade");
		const full = await mix(comp);
		const part = await mix(comp, { startSec: 0.5, endSec: 2.5 });
		expect(maxDiff(full.channels, part.channels, 0.5)).toBeLessThan(1e-6);
	}, 60_000);

	it("matches effects with state after a lead-in", async () => {
		const comp = film("reverb");
		const full = await mix(comp);
		const lead = 2;
		const [startSec, endSec] = [2.5, 3.5];
		const part = await mix(comp, { startSec: startSec - lead, endSec });
		const tail = part.channels.map((ch) => ch.subarray(Math.round(lead * SR)));
		expect(maxDiff(full.channels, tail, startSec)).toBeLessThan(1e-6);
		// Without it the reverb starts cold at the window's edge.
		const cold = await mix(comp, { startSec, endSec });
		expect(maxDiff(full.channels, cold.channels, startSec)).toBeGreaterThan(
			1e-3,
		);
	}, 60_000);

	it("starts every mix with fresh effect state, whatever its render id", async () => {
		// A ping-pong delay keeps its echoes on the GPU between calls. The
		// preview mixes block after block under one render id: each mix must
		// still start from silence, as an export does.
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationMs: 2000,
		});
		comp.addAudio(
			Layer.audio(source, { durationFrames: 60 }).apply(
				new AudioDelay({ delayTime: 0.25, feedback: 0.6, pingPong: true }),
			),
		);
		const vm = comp.toVirtualMedia();
		await mix(comp); // registers the audio processors
		const device = await ensureDevice();
		const once = () =>
			mixAudioTracks(vm, FPS, SR, device, "preview-audio", { master: false });
		const first = await once();
		const second = await once();
		expect(maxDiff(first.channels, second.channels, 0)).toBe(0);
		// And the same as an export, which gets a fresh render id.
		const exported = await mix(comp);
		expect(maxDiff(exported.channels, first.channels, 0)).toBe(0);
	}, 60_000);

	it("continues effect state across back-to-back windows, exactly", async () => {
		// A long, strong delay: its echoes outlast any lead-in. Windows that
		// continue the last one's state reproduce the full mix sample for sample.
		const comp = new Composition({
			width: 64,
			height: 64,
			fps: FPS,
			durationMs: 4000,
		});
		comp.addAudio(
			Layer.audio(source, { trimStartSec: 1, durationFrames: 120 }).apply(
				new AudioDelay({ delayTime: 0.3, feedback: 0.9, pingPong: true }),
			),
		);
		const vm = comp.toVirtualMedia();
		await mix(comp);
		const device = await ensureDevice();
		const full = await mixAudioTracks(vm, FPS, SR, device, "chain", {
			master: false,
		});
		const edges = [0, 0.7, 2, 2.05, 3.3, 4];
		const parts: Float32Array[][] = [];
		for (let k = 0; k + 1 < edges.length; k++) {
			const part = await mixAudioTracks(vm, FPS, SR, device, "chain", {
				window: { startSec: edges[k], endSec: edges[k + 1] },
				master: false,
				continue: k > 0,
			});
			parts.push(part.channels);
		}
		const joined = [0, 1].map((c) => {
			const out = new Float32Array(full.channels[c].length);
			let at = 0;
			for (const p of parts) {
				out.set(p[c], at);
				at += p[c].length;
			}
			return out;
		});
		expect(maxDiff(full.channels, joined, 0)).toBe(0);
	}, 60_000);
});
