import { describe, expect, it } from "vitest";
import {
	evaluateAnimationAtFrame,
	evaluateSignal,
	evaluateSpringOvershoot,
	evaluateTrackAtFrame,
	evaluateWiggle,
} from "./evaluator.js";
import type { AnimationTrack, CompositorProgramConfig } from "./schema.js";
import { computeStaggerDelay } from "./stagger.js";
import { compositorToProgram } from "./to-virtual-media.js";

describe("Evaluator — Wiggle", () => {
	it("is deterministic with the same seed, frequency, and time", () => {
		const val1 = evaluateWiggle(
			{ frequency: 2.0, amplitude: 50, seed: 1234 },
			1.5,
			100,
		);
		const val2 = evaluateWiggle(
			{ frequency: 2.0, amplitude: 50, seed: 1234 },
			1.5,
			100,
		);
		expect(val1).toBe(val2);
	});

	it("stays within the configured amplitude envelope around base value", () => {
		const base = 200;
		const amp = 30;
		for (let frame = 0; frame <= 120; frame++) {
			const val = evaluateWiggle(
				{ frequency: 4.0, amplitude: amp, octaves: 3, seed: 999 },
				frame / 24,
				base,
			);
			expect(val).toBeGreaterThanOrEqual(base - amp * 1.5);
			expect(val).toBeLessThanOrEqual(base + amp * 1.5);
		}
	});
});

describe("Evaluator — Spring Overshoot", () => {
	it("starts at v0 when t=0 and converges to v1 as t increases", () => {
		const source = { damping: 10, stiffness: 180, mass: 1 };
		const v0 = 0;
		const v1 = 100;

		const start = evaluateSpringOvershoot(source, 0, v0, v1);
		expect(start).toBe(0);

		// End after 2 seconds should be settled at ~100
		const end = evaluateSpringOvershoot(source, 2.0, v0, v1);
		expect(Math.abs(end - 100)).toBeLessThan(0.1);
	});

	it("overshoots target value during underdamped oscillation", () => {
		const source = { damping: 6, stiffness: 180, mass: 1 }; // Low damping = high bounce
		const v0 = 0;
		const v1 = 100;

		let maxVal = 0;
		for (let step = 0; step <= 50; step++) {
			const val = evaluateSpringOvershoot(source, step * 0.02, v0, v1);
			if (val > maxVal) maxVal = val;
		}

		// Must overshoot 100
		expect(maxVal).toBeGreaterThan(100);
	});
});

describe("Evaluator — Signal Binding", () => {
	it("evaluates signal with multiplier, offset, and smoothing", () => {
		const samples = [0, 0.2, 0.8, 1.0, 0.4, 0.1];
		const signals = {
			audio_bass: samples,
		};

		// Without smoothing: frame 3 is 1.0 * 2.0 + 10 = 12.0
		const rawVal = evaluateSignal(
			{
				inputHandleId: "audio_bass",
				multiplier: 2.0,
				offset: 10.0,
				smoothingWindowFrames: 0,
			},
			3,
			24,
			signals,
		);
		expect(rawVal).toBe(12.0);

		// With smoothing window of 2: frame 3 averages samples[2] (0.8) and samples[3] (1.0) = 0.9
		// 0.9 * 2.0 + 10 = 11.8
		const smoothedVal = evaluateSignal(
			{
				inputHandleId: "audio_bass",
				multiplier: 2.0,
				offset: 10.0,
				smoothingWindowFrames: 2,
			},
			3,
			24,
			signals,
		);
		expect(Math.abs(smoothedVal - 11.8)).toBeLessThan(0.001);
	});

	it("evaluates mathematical generator signal from node-signal", () => {
		const signals = {
			sine_osc: {
				type: "generator",
				amplitude: 2.0,
				frequency: 1.0,
				phase: 0.0,
				offset: 0.0,
			},
		};

		// At t = 0.25 sec (frame 6 at 24fps), sin(2*pi*0.25) = 1.0 * 2.0 = 2.0
		const val = evaluateSignal(
			{ inputHandleId: "sine_osc", multiplier: 1.0, offset: 0.0 },
			6,
			24,
			signals,
		);
		expect(Math.abs(val - 2.0)).toBeLessThan(0.01);

		// Driving scale: sin(t) * 1.0 + 1.0 oscillates between 0.0 and 2.0
		const scaleVal = evaluateTrackAtFrame(
			{
				id: "scale-track",
				prop: "scale",
				source: {
					type: "signal",
					inputHandleId: "sine_osc",
					multiplier: 1.0,
					offset: 1.0,
				},
				keyframes: [],
			},
			6,
			24,
			{ signals },
		);
		expect(Math.abs((scaleVal as number) - 3.0)).toBeLessThan(0.01);
	});

	it("evaluates Float32Array typed array signal samples", () => {
		const buffer = new Float32Array([0.1, 0.5, 0.9, 0.4]);
		const signals = {
			audio_stream: {
				type: "audio_signal_stream",
				samples: buffer,
			},
		};

		const val = evaluateSignal(
			{ inputHandleId: "audio_stream", multiplier: 2.0, offset: 0.5 },
			2,
			24,
			signals,
		);
		expect(Math.abs(val - (0.9 * 2.0 + 0.5))).toBeLessThan(0.001);
	});

	it("evaluates signal_math descriptors with recursive inputs", () => {
		const signals = {
			inverted_pulse: {
				type: "signal_math",
				operation: "invert",
				signalA: [0.2, 0.4, 0.6, 0.8],
			},
			scaled_sum: {
				type: "signal_math",
				operation: "add",
				signalA: 10,
				signalB: 5,
			},
		};

		// Invert: 1.0 - 0.6 = 0.4
		const valInvert = evaluateSignal(
			{ inputHandleId: "inverted_pulse", multiplier: 1.0, offset: 0.0 },
			2,
			24,
			signals,
		);
		expect(Math.abs(valInvert - 0.4)).toBeLessThan(0.001);

		// Add: 10 + 5 = 15
		const valSum = evaluateSignal(
			{ inputHandleId: "scaled_sum", multiplier: 2.0, offset: 1.0 },
			0,
			24,
			signals,
		);
		expect(valSum).toBe(31.0); // (10 + 5) * 2 + 1
	});

	it("evaluates audio_extractor signals with samples buffer", () => {
		const signals = {
			audio_beat: {
				type: "audio_extractor",
				extractionMode: "transient_beat",
				samples: new Float32Array([0.1, 0.85, 0.3, 0.05]),
			},
		};

		const val0 = evaluateSignal(
			{ inputHandleId: "audio_beat", multiplier: 1.0, offset: 0.0 },
			0,
			24,
			signals,
		);
		expect(Math.abs(val0 - 0.1)).toBeLessThan(0.001);

		const val1 = evaluateSignal(
			{ inputHandleId: "audio_beat", multiplier: 2.0, offset: 1.0 },
			1,
			24,
			signals,
		);
		expect(Math.abs(val1 - (0.85 * 2.0 + 1.0))).toBeLessThan(0.001);
	});

	it("falls back to available connected signal if source.inputHandleId is stale", () => {
		const signals = {
			new_dynamic_handle_id: {
				type: "audio_extractor",
				samples: new Float32Array([0.42, 0.77]),
			},
		};

		// Track references old handle id that was replaced
		const val = evaluateSignal(
			{
				inputHandleId: "old_disconnected_handle_id",
				multiplier: 1.0,
				offset: 0.0,
			},
			0,
			24,
			signals,
		);
		expect(Math.abs(val - 0.42)).toBeLessThan(0.001);
	});

	it("accumulates sound pulses on rising edges with threshold and debounce (keystroke sound triggers)", () => {
		// Simulated typing sound signal: bursts at frame 2, frame 5, frame 6 (debounced), frame 9
		const keystrokeAudioSignal = {
			type: "audio_extractor",
			extractionMode: "transient_beat",
			samples: new Float32Array([
				0.0, // f0: silence
				0.05, // f1: noise floor
				0.6, // f2: CLICK 1 (trigger 1)
				0.05, // f3: decay
				0.02, // f4: silence
				0.8, // f5: CLICK 2 (trigger 2)
				0.75, // f6: bounce within debounce window (< 2 frames, should NOT double trigger)
				0.1, // f7: decay
				0.0, // f8: silence
				0.9, // f9: CLICK 3 (trigger 3)
				0.05, // f10: decay
			]),
		};

		const signals = { typing_sound: keystrokeAudioSignal };

		// At frame 0: 0 triggers
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				0,
				24,
				signals,
			),
		).toBe(0);

		// At frame 2: 1 trigger
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				2,
				24,
				signals,
			),
		).toBe(1);

		// At frame 4: still 1 trigger (held)
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				4,
				24,
				signals,
			),
		).toBe(1);

		// At frame 5: 2 triggers
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				5,
				24,
				signals,
			),
		).toBe(2);

		// At frame 6: debounce prevented second trigger on frame 6, count stays 2
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				6,
				24,
				signals,
			),
		).toBe(2);

		// At frame 9: 3 triggers
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				9,
				24,
				signals,
			),
		).toBe(3);

		// At frame 10: stays 3 triggers
		expect(
			evaluateSignal(
				{
					inputHandleId: "typing_sound",
					signalMode: "accumulate",
					threshold: 0.2,
					debounceFrames: 2,
				},
				10,
				24,
				signals,
			),
		).toBe(3);
	});
});

describe("Evaluator — Master evaluateTrackAtFrame & evaluateAnimationAtFrame", () => {
	it("evaluates a layer animation combining keyframe, wiggle, and signal tracks", () => {
		const animation = {
			tracks: [
				{
					id: "t1",
					prop: "opacity" as const,
					keyframes: [
						{ id: "k1", frame: 0, value: 0 },
						{ id: "k2", frame: 20, value: 1 },
					],
				},
				{
					id: "t2",
					prop: "scale" as const,
					source: {
						type: "signal" as const,
						inputHandleId: "beat_pulse",
						multiplier: 0.5,
						offset: 1.0,
					},
				},
			],
		};

		const signals = { beat_pulse: 0.8 };
		const result = evaluateAnimationAtFrame(animation, 10, 24, {
			signals,
			startFrame: 0,
		});

		expect(result.opacity).toBe(0.5); // halfway between 0 and 1
		expect(result.scale).toBe(1.4); // 0.8 * 0.5 + 1.0 = 1.4
	});
});

describe("Container Staggering", () => {
	it("computes stagger delays accurately for forward, reverse, and center-out", () => {
		const count = 5;
		const stagger = 4;

		// Forward: 0, 4, 8, 12, 16
		expect(computeStaggerDelay(0, count, stagger, "forward")).toBe(0);
		expect(computeStaggerDelay(2, count, stagger, "forward")).toBe(8);
		expect(computeStaggerDelay(4, count, stagger, "forward")).toBe(16);

		// Reverse: 16, 12, 8, 4, 0
		expect(computeStaggerDelay(0, count, stagger, "reverse")).toBe(16);
		expect(computeStaggerDelay(2, count, stagger, "reverse")).toBe(8);
		expect(computeStaggerDelay(4, count, stagger, "reverse")).toBe(0);

		// Center-out: center is 2. Distances: |0-2|=2 -> 8, |1-2|=1 -> 4, |2-2|=0 -> 0, |3-2|=1 -> 4, |4-2|=2 -> 8
		expect(computeStaggerDelay(0, count, stagger, "center-out")).toBe(8);
		expect(computeStaggerDelay(1, count, stagger, "center-out")).toBe(4);
		expect(computeStaggerDelay(2, count, stagger, "center-out")).toBe(0);
		expect(computeStaggerDelay(3, count, stagger, "center-out")).toBe(4);
		expect(computeStaggerDelay(4, count, stagger, "center-out")).toBe(8);
	});

	it("staggers startFrames of container children when compiling to VirtualMediaData", () => {
		const doc: CompositorProgramConfig = {
			width: 1920,
			height: 1080,
			volume: 1,
			fps: 24,
			mode: "Video",
			layout: [
				{
					id: "flex-container",
					kind: "flex",
					dir: "row",
					staggerFrames: 5,
					staggerDirection: "forward",
					children: [
						{
							id: "child-0",
							kind: "shape",
							width: 100,
							height: 100,
							startFrame: 0,
							durationFrames: 30,
						},
						{
							id: "child-1",
							kind: "shape",
							width: 100,
							height: 100,
							startFrame: 0,
							durationFrames: 30,
						},
						{
							id: "child-2",
							kind: "shape",
							width: 100,
							height: 100,
							startFrame: 0,
							durationFrames: 30,
						},
					],
				},
			],
		};

		const vm = compositorToProgram(doc, { isVideoMode: true, fps: 24 });
		const containerVM = vm.children![0];
		expect(containerVM.children).toHaveLength(3);

		const c0 = containerVM.children![0].operation as any;
		const c1 = containerVM.children![1].operation as any;
		const c2 = containerVM.children![2].operation as any;

		expect(c0.startFrame).toBe(0);
		expect(c1.startFrame).toBe(5);
		expect(c2.startFrame).toBe(10);

		// Container envelops all children: min start = 0, max end = 10 + 30 = 40
		const contOp = containerVM.operation as any;
		expect(contOp.startFrame).toBe(0);
		expect(contOp.durationFrames).toBe(40);
	});
});

describe("Evaluator — Signal to Color Modulation", () => {
	it("interpolates colors based on signal amplitude", () => {
		const track: AnimationTrack = {
			id: "sig-color-1",
			prop: "fill",
			source: {
				type: "signal",
				inputHandleId: "sig1",
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
				colorMode: "interpolate",
				colorA: "#000000",
				colorB: "#ffffff",
			},
			keyframes: [],
		};

		// Signal = 0 -> colorA
		const c0 = evaluateTrackAtFrame(track, 0, 24, {
			signals: { sig1: 0.0 },
		});
		expect(c0).toBe("#000000");

		// Signal = 1 -> colorB
		const c1 = evaluateTrackAtFrame(track, 0, 24, {
			signals: { sig1: 1.0 },
		});
		expect(c1).toBe("#ffffff");

		// Signal = 0.5 -> intermediate gray
		const cMid = evaluateTrackAtFrame(track, 0, 24, {
			signals: { sig1: 0.5 },
		});
		expect(cMid).toBe("#808080");
	});

	it("switches color abruptly with threshold mode", () => {
		const track: AnimationTrack = {
			id: "sig-color-thresh",
			prop: "fillColor",
			source: {
				type: "signal",
				inputHandleId: "beatSig",
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
				colorMode: "threshold",
				colorA: "#111111",
				colorB: "#ffffff",
				colorThreshold: 0.7,
			},
			keyframes: [],
		};

		expect(
			evaluateTrackAtFrame(track, 0, 24, {
				signals: { beatSig: 0.5 },
			}),
		).toBe("#111111");

		expect(
			evaluateTrackAtFrame(track, 0, 24, {
				signals: { beatSig: 0.8 },
			}),
		).toBe("#ffffff");
	});

	it("rotates hue based on signal amplitude", () => {
		const track: AnimationTrack = {
			id: "sig-color-hue",
			prop: "strokeColor",
			source: {
				type: "signal",
				inputHandleId: "sineSig",
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
				colorMode: "hueRotate",
				colorA: "#ff0000", // Red (0 deg)
			},
			keyframes: [],
		};

		// Rotate 1/3 (120 deg) -> Green
		const greenRes = evaluateTrackAtFrame(track, 0, 24, {
			signals: { sineSig: 1 / 3 },
		});
		expect(greenRes).toBe("#00ff00");

		// Rotate 2/3 (240 deg) -> Blue
		const blueRes = evaluateTrackAtFrame(track, 0, 24, {
			signals: { sineSig: 2 / 3 },
		});
		expect(blueRes).toBe("#0000ff");
	});

	it("evaluates signal_math normalize operation correctly", () => {
		const track: AnimationTrack = {
			id: "sig-norm",
			prop: "scaleX",
			source: {
				type: "signal",
				inputHandleId: "normSig",
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
			},
			keyframes: [],
		};

		const signals = {
			normSig: {
				type: "signal_math",
				operation: "normalize",
				signalA: 50,
				aMin: 0,
				aMax: 100,
			},
		};

		const val = evaluateTrackAtFrame(track, 0, 24, { signals });
		expect(val).toBeCloseTo(0.5, 3);
	});

	it("evaluates generator waveforms including pulse, bounce, and staircase", () => {
		const makeTrack = (id: string): AnimationTrack => ({
			id,
			prop: "opacity",
			source: {
				type: "signal",
				inputHandleId: id,
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
			},
			keyframes: [],
		});

		const signals = {
			pulseSig: {
				type: "generator",
				baseType: "pulse",
				frequency: 1.0,
				amplitude: 1.0,
				phase: 0.5, // 50% duty cycle
				offset: 0.0,
			},
			bounceSig: {
				type: "generator",
				baseType: "bounce",
				frequency: 1.0,
				amplitude: 1.0,
				phase: 0.0,
				offset: 0.0,
			},
			stairSig: {
				type: "generator",
				baseType: "staircase",
				frequency: 1.0,
				amplitude: 1.0,
				phase: 0.0,
				offset: 0.0,
			},
			fmSig: {
				type: "generator",
				baseType: "sine",
				frequency: 1.0,
				fmEnabled: true,
				fmAmplitude: 0.5,
				fmFrequency: 2.0,
			},
		};

		// Pulse at t=0.1 (fract < 0.5) -> 1.0
		const pulseVal1 = evaluateTrackAtFrame(makeTrack("pulseSig"), 2.4, 24, {
			signals,
		});
		expect(pulseVal1).toBe(1.0);

		// Pulse at t=0.7 (fract > 0.5) -> -1.0
		const pulseVal2 = evaluateTrackAtFrame(makeTrack("pulseSig"), 16.8, 24, {
			signals,
		});
		expect(pulseVal2).toBe(-1.0);

		// Bounce is always non-negative
		for (let f = 0; f < 24; f++) {
			const bVal = evaluateTrackAtFrame(makeTrack("bounceSig"), f, 24, {
				signals,
			});
			expect(bVal).toBeGreaterThanOrEqual(0.0);
		}

		// Staircase produces discrete steps
		const stairVal = evaluateTrackAtFrame(makeTrack("stairSig"), 6, 24, {
			signals,
		});
		expect(typeof stairVal).toBe("number");

		// FM modulation produces valid numbers
		const fmVal = evaluateTrackAtFrame(makeTrack("fmSig"), 12, 24, { signals });
		expect(typeof fmVal).toBe("number");
		expect(Number.isNaN(fmVal)).toBe(false);
	});

	it("resamples audio extractor samples accurately across different composition fps", () => {
		// 1 second of audio at 24 fps = 24 samples: [0, 1, 2, ..., 23]
		const samples = Array.from({ length: 24 }, (_, i) => i);
		const track: AnimationTrack = {
			id: "sig-resample",
			prop: "scaleX",
			source: {
				type: "signal",
				inputHandleId: "audioSig",
				multiplier: 1.0,
				offset: 0.0,
				smoothingWindowFrames: 0,
			},
			keyframes: [],
		};
		const signals = {
			audioSig: {
				type: "audio_extractor",
				samples,
				fps: 24,
			},
		};

		// At 24 fps: frame 12 is t=0.5s -> sample index 12 -> value 12
		const val24 = evaluateTrackAtFrame(track, 12, 24, { signals });
		expect(val24).toBe(12);

		// At 48 fps: frame 24 is t=0.5s -> sample index 12 -> value 12
		const val48 = evaluateTrackAtFrame(track, 24, 48, { signals });
		expect(val48).toBe(12);

		// At 60 fps: frame 30 is t=0.5s -> sample index 12 -> value 12
		const val60 = evaluateTrackAtFrame(track, 30, 60, { signals });
		expect(val60).toBe(12);
	});

	it("evaluates generator with tempo sync (syncToBpm)", () => {
		const signals = {
			bpmGen: {
				type: "generator",
				baseType: "square",
				syncToBpm: true,
				bpm: 120, // 120 BPM = 2 Hz (period 0.5s = 12 frames at 24fps)
				amplitude: 1.0,
				offset: 0.0,
			},
		};

		// At t=0 (frame 0): square wave starts at +1
		const val0 = evaluateSignal({ inputHandleId: "bpmGen" }, 0, 24, signals);
		expect(val0).toBe(1);

		// At t=0.3s (frame 7 of 12, past half-period): square wave drops to -1
		const val7 = evaluateSignal({ inputHandleId: "bpmGen" }, 7, 24, signals);
		expect(val7).toBe(-1);
	});

	it("evaluates gate, trigger, toggle, and invert signals", () => {
		// Constant 0.8 is above threshold 0.5 -> gate returns 1.0, invert returns 0.0
		const gateHighSignals = {
			gateHigh: {
				type: "gate",
				mode: "gate",
				threshold: 0.5,
				invert: false,
				sourceSignal: {
					type: "generator",
					baseType: "constant",
					amplitude: 0.8,
					offset: 0,
				},
			},
			gateInvert: {
				type: "gate",
				mode: "gate",
				threshold: 0.5,
				invert: true,
				sourceSignal: {
					type: "generator",
					baseType: "constant",
					amplitude: 0.8,
					offset: 0,
				},
			},
		};

		expect(
			evaluateSignal({ inputHandleId: "gateHigh" }, 0, 24, gateHighSignals),
		).toBe(1.0);
		expect(
			evaluateSignal({ inputHandleId: "gateInvert" }, 0, 24, gateHighSignals),
		).toBe(0.0);

		// Discrete sample array crossing threshold at index 2
		const samples = [0.1, 0.2, 0.9, 0.8, 0.2, 0.1];
		const triggerSignals = {
			trig: {
				type: "gate",
				mode: "trigger",
				threshold: 0.5,
				holdFrames: 2,
				debounceMs: 0,
				sourceSignal: samples,
			},
			tog: {
				type: "gate",
				mode: "toggle",
				threshold: 0.5,
				debounceMs: 0,
				sourceSignal: samples,
			},
		};

		// Frame 1: 0.2 < 0.5 -> trigger 0
		expect(
			evaluateSignal({ inputHandleId: "trig" }, 1, 24, triggerSignals),
		).toBe(0.0);
		// Frame 2: 0.9 >= 0.5 (rising edge) -> trigger 1.0
		expect(
			evaluateSignal({ inputHandleId: "trig" }, 2, 24, triggerSignals),
		).toBe(1.0);
		// Frame 3: held for 2 frames (frames 2 and 3) -> trigger 1.0
		expect(
			evaluateSignal({ inputHandleId: "trig" }, 3, 24, triggerSignals),
		).toBe(1.0);
		// Frame 4: hold expired -> trigger 0.0
		expect(
			evaluateSignal({ inputHandleId: "trig" }, 4, 24, triggerSignals),
		).toBe(0.0);

		// Toggle: before rising edge = 0.0, after rising edge = 1.0
		expect(
			evaluateSignal({ inputHandleId: "tog" }, 1, 24, triggerSignals),
		).toBe(0.0);
		expect(
			evaluateSignal({ inputHandleId: "tog" }, 2, 24, triggerSignals),
		).toBe(1.0);
		expect(
			evaluateSignal({ inputHandleId: "tog" }, 4, 24, triggerSignals),
		).toBe(1.0);
	});
});
