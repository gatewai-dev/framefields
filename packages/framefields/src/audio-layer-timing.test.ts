/**
 * An audio layer's in-point and volume keyframes reach the mix: `trimStartSec`
 * picks where the source starts (as it does for a video layer's picture), and
 * a volume ramp is followed across the whole layer, not frozen at its start.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { encodeStereoWav } from "./audio/index.js";
import { Composition, Layer, LayerAnimation } from "./index.js";
import { HeadlessMediaRenderer } from "./renderer/index.js";

const SR = 48000;
let source = "";

/** Two seconds: silence, then a full-scale 440 Hz tone from 1.0 s. */
beforeAll(async () => {
	const n = 2 * SR;
	const ch = new Float32Array(n);
	for (let i = SR; i < n; i++) ch[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
	source = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "audio-layer-")), "step.wav");
	await fs.writeFile(source, encodeStereoWav([ch, ch], { sampleRate: SR }));
});

/** RMS of the mix's left channel over [fromSec, toSec). */
function rms(ch: Float32Array, fromSec: number, toSec: number): number {
	let s = 0;
	const [a, b] = [Math.round(fromSec * SR), Math.round(toSec * SR)];
	for (let i = a; i < b; i++) s += ch[i] * ch[i];
	return Math.sqrt(s / (b - a));
}

async function mix(layer: ReturnType<typeof Layer.audio>) {
	const comp = new Composition({ width: 64, height: 64, fps: 30, durationMs: 1000 });
	comp.add(layer);
	// renderAudio is the mix renderVideo muxes (layer processors included).
	const { channels } = await new HeadlessMediaRenderer().renderAudio(
		comp.toVirtualMedia(),
		{ fps: 30, sampleRate: SR },
	);
	return channels[0];
}

describe("audio layer timing", () => {
	it("starts the source at the layer's trimStartSec", async () => {
		const trimmed = await mix(Layer.audio(source, { trimStartSec: 1, durationFrames: 30 }));
		const untrimmed = await mix(Layer.audio(source, { durationFrames: 30 }));
		// The tone begins at source 1.0 s: trimmed, it fills the layer from its
		// first frame; untrimmed, the layer only hears the silence before it.
		expect(rms(trimmed, 0, 0.2)).toBeGreaterThan(0.4);
		expect(rms(untrimmed, 0, 0.9)).toBeLessThan(0.01);
	});

	it("follows a volume ramp across the layer", async () => {
		const ch = await mix(
			Layer.audio(source, { trimStartSec: 1, durationFrames: 30 }).animate(
				LayerAnimation.keys("volume", [[0, 0], [15, 1]]),
			),
		);
		const full = rms(ch, 0.6, 0.9);
		// Past the ramp (frame 15 = 0.5 s) the tone plays at full level…
		expect(full).toBeGreaterThan(0.4);
		// …having risen from silence through the middle of the ramp.
		expect(rms(ch, 0, 0.03)).toBeLessThan(full * 0.1);
		expect(rms(ch, 0.24, 0.26)).toBeGreaterThan(full * 0.35);
		expect(rms(ch, 0.24, 0.26)).toBeLessThan(full * 0.65);
	});
});
