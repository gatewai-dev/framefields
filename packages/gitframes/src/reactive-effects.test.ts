import { describe, expect, it } from "vitest";
import {
	AudioSignal,
	Blur,
	computed,
	Media,
	Signal,
	signal,
	updateClockSignals,
	Vignette,
} from "./index.js";

describe("Reactive Signals & First-Class Effects", () => {
	it("1. State signals and computed reactivity", () => {
		const baseRadius = signal(0.85);
		const pulse = signal(0.0);
		const dynamicRadius = computed(() => baseRadius.value + pulse.value);

		expect(dynamicRadius.value).toBeCloseTo(0.85);

		pulse.value = 0.15;
		expect(dynamicRadius.value).toBeCloseTo(1.0);

		baseRadius.value = 0.5;
		expect(dynamicRadius.value).toBeCloseTo(0.65);
	});

	it("2. Procedural Signal.builder", () => {
		const lfo = Signal.builder({
			type: "sine",
			frequency: 2.0,
			amplitude: 15.0,
			offset: 50.0,
		});

		updateClockSignals(0, 24, 1000);
		expect(lfo.value).toBeCloseTo(50.0);

		// At t = 0.125s (frame 3 @ 24fps): sin(2*pi*2*0.125) = sin(pi/2) = 1.0 => 50 + 15 = 65
		updateClockSignals(3, 24, 1000);
		expect(lfo.value).toBeCloseTo(65.0);

		// At t = 0.375s (frame 9 @ 24fps): sin(3*pi/2) = -1.0 => 50 - 15 = 35
		updateClockSignals(9, 24, 1000);
		expect(lfo.value).toBeCloseTo(35.0);
	});

	it("3. Effect class instantiation and proxy property mutation", () => {
		const vignette = new Vignette({
			strength: 55,
			radius: 0.85,
			softness: 0.55,
		});

		expect(vignette.strength).toBe(55);
		expect(vignette.radius).toBe(0.85);
		expect(vignette.softness).toBe(0.55);

		// Direct proxy mutation
		vignette.strength -= 5;
		expect(vignette.strength).toBe(50);
		expect(vignette.signals.strength!.value).toBe(50);

		vignette.radius = 1.2;
		expect(vignette.radius).toBe(1.2);
		expect(vignette.signals.radius!.value).toBe(1.2);
	});

	it("4. Effect binding with computed signals", () => {
		const energy = signal(0.5);
		const vignette = new Vignette({
			strength: computed(() => 30 + energy.value * 40),
			radius: 0.9,
		});

		expect(vignette.strength).toBe(50);

		energy.value = 1.0;
		expect(vignette.strength).toBe(70);

		energy.value = 0.0;
		expect(vignette.strength).toBe(30);
	});

	it("5. Game-engine onRequestFrame per-frame hooks", () => {
		const vignette = new Vignette({
			strength: 60,
			radius: 1.0,
		});

		vignette.onRequestFrame(({ frame }) => {
			vignette.strength -= frame * 0.1;
		});

		vignette.notifyFrame({
			frame: 10,
			fps: 24,
			time: 10 / 24,
			duration: 1,
			durationMs: 1000,
			progress: 0.1,
			deltaTime: 1 / 24,
		});

		expect(vignette.strength).toBe(59);

		vignette.notifyFrame({
			frame: 50,
			fps: 24,
			time: 50 / 24,
			duration: 1,
			durationMs: 1000,
			progress: 0.5,
			deltaTime: 1 / 24,
		});

		expect(vignette.strength).toBe(54);
	});

	it("6. Media.apply with Effect instances", () => {
		const vignette = new Vignette({ strength: 45, radius: 0.8 });
		const blur = new Blur({ blurType: "Gaussian", strength: 3 });

		const media = Media.video("test.mp4").apply(vignette).apply(blur);

		const vm = media.toVirtualMedia();
		expect(vm.operation.op).toBe("Blur");
		expect((vm.operation as Record<string, unknown>).blurType).toBe("Gaussian");
		expect((vm.children?.[0]?.operation as Record<string, unknown>).op).toBe(
			"Vignette",
		);
		expect(
			(
				(vm.children?.[0]?.operation as Record<string, unknown>).strength as {
					value: number;
				}
			).value,
		).toBe(45);
	});

	it("7. AudioSignal extractor interface existence", () => {
		expect(AudioSignal).toBeDefined();
		expect(typeof AudioSignal.extract).toBe("function");
	});

	it("8. Primitive coercion (valueOf and Symbol.toPrimitive) on all signals", () => {
		const stateSig = signal(15);
		const compSig = computed(() => stateSig.value * 2);
		const progSig = Signal.programmatic(50);
		const builderSig = Signal.builder({
			type: "sine",
			amplitude: 5,
			offset: 25,
		});

		// Number() coercion
		expect(Number(stateSig)).toBe(15);
		expect(Number(compSig)).toBe(30);
		expect(Number.isFinite(Number(builderSig))).toBe(true);
		expect(Number(builderSig)).toBeCloseTo(28.535, 1);

		// Arithmetic expressions without NaN
		expect(Number(stateSig) + 5).toBe(20);
		expect(Number(compSig) - 10).toBe(20);
		expect(Number(progSig) / 2).toBe(25);
	});

	it("9. ProgrammaticSignal reactivity with computed and cross-FPS resampling", () => {
		const samples = new Float32Array(25);
		samples[0] = 10;
		samples[12] = 20;
		samples[24] = 30;

		const sig24 = Signal.programmatic(samples, { fps: 24 });
		const comp = computed(() => Number(sig24.value) * 2);

		updateClockSignals(0, 24);
		expect(comp.value).toBe(20);

		// Seek frame updates computed
		sig24.seekFrame(12);
		expect(comp.value).toBe(40);

		// Resampling at 48 FPS
		const halfSecVal = sig24.get({
			frame: 24,
			fps: 48,
			time: 0.5,
			duration: 2,
			durationMs: 2000,
			progress: 0.25,
			deltaTime: 1 / 48,
		});
		expect(halfSecVal).toBe(20);
	});

	it("10. Composition onRequestFrame per-frame lifecycle hook", async () => {
		const { Composition, Layer } = await import("./index.js");
		const comp = Composition.create({ width: 1920, height: 1080, fps: 30 });
		const card = Layer.box({ width: 200, height: 200, x: 100, y: 100 });
		comp.add(card);

		let recordedFrame = -1;
		let hookExecuted = false;

		comp.onRequestFrame((ctx) => {
			hookExecuted = true;
			recordedFrame = ctx.frame;
			card.x = 100 + ctx.frame * 2;
		});

		// Verify hook fires via notifyFrame
		comp.notifyFrame({
			frame: 15,
			fps: 30,
			time: 0.5,
			duration: 1,
			durationMs: 1000,
			progress: 0.5,
			deltaTime: 1 / 30,
		});

		expect(hookExecuted).toBe(true);
		expect(recordedFrame).toBe(15);
		expect(card.x).toBe(130);

		// Verify onRequestFrame is attached in compiled virtual media operation
		const vm = comp.toVirtualMedia();
		expect(
			typeof (vm.operation as Record<string, unknown>).onRequestFrame,
		).toBe("function");
	});
});
