import { describe, expect, it } from "vitest";
import { ensureDevice } from "../device.js";
import {
	decodePitchTrack,
	PITCH_CANDIDATES,
	trackAudioPitch,
} from "./audio-pitch-compute.js";

const SR = 44100;
const FPS = 50;

/** Candidates for one frame as [lag, yinValue] pairs, padded with empty slots. */
function frame(...pairs: [number, number][]): number[] {
	const out: number[] = [];
	for (let k = 0; k < PITCH_CANDIDATES; k++) {
		const [lag, val] = pairs[k] ?? [0, 2];
		out.push(lag, val);
	}
	return out;
}

/** Pitch of the synthetic engine at time t: two upshift ramps, then a held note. */
function engineHz(t: number): number {
	if (t < 1) return 85 + 15 * t;
	if (t < 2) return 88 + 12 * (t - 1);
	return 100;
}

/** Harmonic-rich tone with a weak fundamental and seeded noise; silent after 3 s. */
function syntheticEngine(seconds: number): Float32Array {
	const out = new Float32Array(Math.round(seconds * SR));
	let phase = 0;
	let seed = 1;
	const noise = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 32 - 0.5;
	};
	for (let i = 0; i < out.length; i++) {
		const t = i / SR;
		phase += engineHz(t) / SR;
		if (t >= 3) continue;
		let v = 0;
		for (let h = 1; h <= 12; h++) {
			const amp = h % 3 === 0 ? 1 : 0.25 / h;
			v += amp * Math.sin(2 * Math.PI * h * phase);
		}
		out[i] = 0.1 * v + 0.05 * noise();
	}
	return out;
}

describe("decodePitchTrack", () => {
	it("rejects a one-frame octave error and fills unvoiced gaps", () => {
		const lag100 = SR / 100;
		const data = new Float32Array([
			...frame([lag100, 0.2], [lag100 * 2, 0.25]),
			// The deepest dip is an octave up; continuity should keep 100 Hz.
			...frame([lag100 / 2, 0.15], [lag100, 0.2]),
			...frame([lag100, 0.2]),
			...frame(),
			...frame([SR / 110, 0.1]),
			...frame([SR / 110, 0.1]),
		]);
		const track = decodePitchTrack({ data, numFrames: 6, sampleRate: SR }, {});
		expect(Array.from(track.voiced)).toEqual([1, 1, 1, 0, 1, 1]);
		expect(track.hz[1]).toBeCloseTo(100, 3);
		expect(track.hz[3]).toBeCloseTo(105, 3);
		expect(track.confidence[3]).toBe(0);
		expect(track.confidence[0]).toBeCloseTo(0.8, 5);
	});

	it("prefers the period over a slightly deeper double-period echo", () => {
		// Real engine audio at top speed: 101 Hz dips to 0.41, its 2x echo to 0.38.
		const lag = SR / 101;
		const echo = Array.from({ length: 10 }, () =>
			frame([lag * 2, 0.38], [lag, 0.41], [SR / 138, 0.8]),
		);
		const track = decodePitchTrack(
			{ data: new Float32Array(echo.flat()), numFrames: 10, sampleRate: SR },
			{},
		);
		for (const hz of track.hz) expect(hz).toBeCloseTo(101, 3);
	});
});

describe("trackAudioPitch", () => {
	it("tracks a harmonic sweep through a shift and goes unvoiced in silence", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch {
			console.warn("Skipping due to no WebGPU device");
			return;
		}

		const track = await trackAudioPitch(device, [syntheticEngine(4)], SR, FPS, {
			minHz: 50,
			maxHz: 1000,
		});
		expect(track.numFrames).toBe(4 * FPS);

		let worst = 0;
		for (let f = 2; f < 3 * FPS - 2; f++) {
			const t = f / FPS;
			// Skip the frames whose window straddles the shift discontinuity.
			if (Math.abs(t - 1) < 0.06) continue;
			expect(track.voiced[f]).toBe(1);
			worst = Math.max(worst, Math.abs(track.hz[f] / engineHz(t) - 1));
		}
		expect(worst).toBeLessThan(0.01);

		for (let f = 3.2 * FPS; f < 4 * FPS; f++) {
			expect(track.voiced[f]).toBe(0);
			expect(track.hz[f]).toBeCloseTo(track.hz[3 * FPS - 3], 0);
		}
	});

	it("refuses a minHz whose period exceeds the lag limit", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch {
			return;
		}
		await expect(
			trackAudioPitch(device, [new Float32Array(SR)], SR, FPS, {
				minHz: 10,
			}),
		).rejects.toThrow(/minHz >= 22/);
	});
});
