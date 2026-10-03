import { describe, expect, it } from "vitest";
import {
	computed,
	frameArraySignal,
	frameSignal,
	isSignal,
	Signal,
	signal,
	updateClockSignals,
} from "./index.js";

describe("Signals Reactive Core", () => {
	it("should get and set state signals", () => {
		const count = signal(10);
		expect(count.value).toBe(10);
		expect(count.get()).toBe(10);
		expect(isSignal(count)).toBe(true);

		count.value = 20;
		expect(count.value).toBe(20);

		count.update((n) => n + 5);
		expect(count.value).toBe(25);
	});

	it("should track computed dependencies automatically", () => {
		const a = signal(2);
		const b = signal(3);
		let computeCount = 0;

		const sum = computed(() => {
			computeCount++;
			return a.value + b.value;
		});

		expect(computeCount).toBe(0); // lazy
		expect(sum.value).toBe(5);
		expect(computeCount).toBe(1);

		// Multiple reads without changing source do not recompute
		expect(sum.value).toBe(5);
		expect(computeCount).toBe(1);

		// Mutating a dependency invalidates lazily
		a.value = 10;
		expect(computeCount).toBe(1); // not computed yet
		expect(sum.value).toBe(13);
		expect(computeCount).toBe(2);
	});

	it("should handle chained and diamond dependencies cleanly", () => {
		const x = signal(1);
		const double = computed(() => x.value * 2);
		const triple = computed(() => x.value * 3);
		const combined = computed(() => double.value + triple.value);

		expect(combined.value).toBe(5); // (1*2) + (1*3)

		x.value = 2;
		expect(combined.value).toBe(10); // (2*2) + (2*3)
	});

	it("should bind to engine clock signals seamlessly", () => {
		const strength = computed(() => 55 - frameSignal.value * 0.1);

		updateClockSignals(0, 24, 1000);
		expect(strength.value).toBe(55);

		updateClockSignals(10, 24, 1000);
		expect(strength.value).toBe(54);

		updateClockSignals(50, 24, 1000);
		expect(strength.value).toBe(50);
	});

	it("should sample frameArraySignal based on frame clock", () => {
		const samples = new Float32Array([0.1, 0.5, 0.9, 0.3]);
		const audioBeat = frameArraySignal(samples, 24);

		updateClockSignals(0, 24);
		expect(audioBeat.value).toBeCloseTo(0.1);

		updateClockSignals(1, 24);
		expect(audioBeat.value).toBeCloseTo(0.5);

		updateClockSignals(2, 24);
		expect(audioBeat.value).toBeCloseTo(0.9);

		const modulated = computed(() => 1.0 + audioBeat.value * 2.0);
		expect(modulated.value).toBeCloseTo(2.8);
	});
	it("should evaluate procedural signals via Signal.builder", () => {
		const lfo = Signal.builder({
			type: "sine",
			frequency: 1.0,
			amplitude: 10.0,
			offset: 50.0,
		});

		updateClockSignals(0, 24);
		expect(lfo.value).toBeCloseTo(50.0);

		// At t = 0.25s (6 frames @ 24fps): sin(2*pi*1*0.25) = sin(pi/2) = 1.0 => 50 + 10 = 60
		updateClockSignals(6, 24);
		expect(lfo.value).toBeCloseTo(60.0);

		// At t = 0.75s (18 frames @ 24fps): sin(3*pi/2) = -1.0 => 50 - 10 = 40
		updateClockSignals(18, 24);
		expect(lfo.value).toBeCloseTo(40.0);
	});

	it("should support primitive valueOf and arithmetic coercion without NaN", () => {
		const stateSig = signal(15);
		const compSig = computed(() => stateSig.value * 2);
		const arraySig = frameArraySignal([10, 20, 30], 24);
		const builderSig = Signal.builder({
			type: "sine",
			amplitude: 5,
			offset: 25,
		});
		const progSig = Signal.programmatic(50);

		// Number() coercion
		expect(Number(stateSig)).toBe(15);
		expect(Number(compSig)).toBe(30);
		expect(Number(arraySig)).toBe(10);
		expect(Number(builderSig)).toBe(25);
		expect(Number(progSig)).toBe(50);

		// Arithmetic operator coercion (+, -, *)
		expect(Number(stateSig) + 5).toBe(20);
		expect(Number(compSig) - 10).toBe(20);
		expect(Number(arraySig) * 2).toBe(20);
		expect(Number(progSig) / 2).toBe(25);
	});

	it("should reactively update computed signals when programmaticSignal or frameArraySignal updates", () => {
		const progSig = Signal.programmatic(new Float32Array([10, 20, 30, 40]), {
			fps: 24,
		});
		const comp = computed(() => Number(progSig.value) * 3);

		updateClockSignals(0, 24);
		expect(comp.value).toBe(30);

		updateClockSignals(1, 24);
		expect(comp.value).toBe(60);

		// seekFrame notification
		progSig.seekFrame(2);
		expect(comp.value).toBe(90);
	});

	it("should resample array signals across differing composition frame rates", () => {
		// Signal sampled at 24 FPS: frame 0 -> 10, frame 12 -> 20, frame 24 -> 30
		const samples = new Float32Array(25);
		samples[0] = 10;
		samples[12] = 20;
		samples[24] = 30;

		const sig24 = Signal.programmatic(samples, { fps: 24 });

		// Sample at 48 FPS composition rate (frame 24 @ 48fps should correspond to frame 12 @ 24fps)
		const valAtHalfSec = sig24.get({
			frame: 24,
			fps: 48,
			time: 0.5,
			duration: 2,
			durationMs: 2000,
			progress: 0.25,
			deltaTime: 1 / 48,
		});
		expect(valAtHalfSec).toBe(20);
	});
});
