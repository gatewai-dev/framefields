import { describe, expect, it } from "vitest";
import { compileTimeline } from "./compiler.js";
import type { CompositorNodeConfig } from "./config.js";
import { processCompositor } from "./processor.js";

describe("Audio-Reactive Motion Graphics Engine Pipeline", () => {
	it("connects signal streams to Compositor and drives beat-synchronized motion", () => {
		// Mock dynamic signal streams (beat spikes at frame 12 and 24, continuous bass ramp)
		const beatSamples = new Array(48).fill(0.0);
		beatSamples[12] = 1.0; // Beat hit 1
		beatSamples[24] = 1.0; // Beat hit 2

		const bassSamples = new Array(48).fill(0.0).map((_, i) => i / 48);

		const signalsByHandle = new Map<string, number[]>([
			["audio_beat_handle", beatSamples],
			["audio_bass_handle", bassSamples],
		]);

		const compositorConfig: CompositorNodeConfig = {
			width: 1920,
			height: 1080,
			volume: 1,
			fps: 24,
			mode: "Video",
			layout: [
				{
					id: "bouncing-logo-star",
					kind: "shape",
					shapeType: "star",
					starPoints: 5,
					starInnerRadiusRatio: 0.5,
					width: 300,
					height: 300,
					x: 810,
					y: 390,
					position: "absolute",
					strokeWidth: 4,
					strokeColor: "#38bdf8",
					animation: {
						tracks: [
							{
								id: "t-beat-scale",
								prop: "scale",
								source: {
									type: "signal",
									inputHandleId: "audio_beat_handle",
									multiplier: 0.6,
									offset: 1.0,
									smoothingWindowFrames: 0,
								},
								keyframes: [],
							},
							{
								id: "t-bass-trim",
								prop: "trimEnd",
								source: {
									type: "signal",
									inputHandleId: "audio_bass_handle",
									multiplier: 0.8,
									offset: 0.2,
									smoothingWindowFrames: 0,
								},
								keyframes: [],
							},
							{
								id: "t-procedural-wiggle",
								prop: "rotation",
								source: {
									type: "wiggle",
									frequency: 2.0,
									amplitude: 15.0,
									octaves: 2,
									seed: 777,
								},
								keyframes: [],
							},
						],
					},
				},
				{
					id: "staggered-bars-row",
					kind: "flex",
					dir: "row",
					gap: 20,
					staggerFrames: 4,
					staggerDirection: "forward",
					children: [
						{
							id: "bar-1",
							kind: "shape",
							width: 40,
							height: 200,
							startFrame: 0,
							durationFrames: 24,
							animation: {
								tracks: [
									{
										id: "t-bar1-fade",
										prop: "opacity",
										keyframes: [
											{ id: "k1", frame: 0, value: 0 },
											{ id: "k2", frame: 12, value: 1 },
										],
									},
								],
							},
						},
						{
							id: "bar-2",
							kind: "shape",
							width: 40,
							height: 200,
							startFrame: 0,
							durationFrames: 24,
							animation: {
								tracks: [
									{
										id: "t-bar2-fade",
										prop: "opacity",
										keyframes: [
											{ id: "k3", frame: 0, value: 0 },
											{ id: "k4", frame: 12, value: 1 },
										],
									},
								],
							},
						},
						{
							id: "bar-3",
							kind: "shape",
							width: 40,
							height: 200,
							startFrame: 0,
							durationFrames: 24,
							animation: {
								tracks: [
									{
										id: "t-bar3-fade",
										prop: "opacity",
										keyframes: [
											{ id: "k5", frame: 0, value: 0 },
											{ id: "k6", frame: 12, value: 1 },
										],
									},
								],
							},
						},
					],
				},
			],
		};

		// 1. Process compositor into VirtualMediaData tree
		const vm = processCompositor(
			compositorConfig,
			new Map(),
			true,
			signalsByHandle,
		);

		// Verify signals attached to operation
		const operation = vm.operation as Record<string, unknown>;
		expect(operation.signals).toBeDefined();
		const signals = operation.signals as Record<string, unknown>;
		expect(signals.audio_beat_handle).toBe(beatSamples);

		// 2. Compile into timeline
		const { tl, targetsById } = compileTimeline("audio-reactive-session", vm, {
			fps: 24,
			durationSec: 2,
		});

		const logoStub = targetsById["bouncing-logo-star"];
		expect(logoStub).toBeDefined();

		// Check baseline at frame 0 (t = 0 sec):
		// Beat signal = 0.0 -> scale = 0.0 * 0.6 + 1.0 = 1.0
		tl.seek(0);
		expect(logoStub.scale).toBeCloseTo(1.0, 3);
		// Bass signal = 0.0 -> trimEnd = 0.0 * 0.8 + 0.2 = 0.2
		expect(logoStub.trimEnd).toBeCloseTo(0.2, 3);
		// Rotation wiggles within amplitude [-15, 15]
		expect(Math.abs(logoStub.rotation as number)).toBeLessThanOrEqual(15);

		// Check beat hit at frame 12 (t = 12/24 = 0.5 sec):
		// Beat signal = 1.0 -> scale = 1.0 * 0.6 + 1.0 = 1.6!
		tl.seek(12 / 24);
		expect(logoStub.scale).toBeCloseTo(1.6, 3);

		// Check post-beat settling at frame 14:
		// Beat signal = 0.0 -> scale back to 1.0
		tl.seek(14 / 24);
		expect(logoStub.scale).toBeCloseTo(1.0, 3);

		// Check second beat hit at frame 24 (t = 1.0 sec):
		tl.seek(24 / 24);
		expect(logoStub.scale).toBeCloseTo(1.6, 3);

		// Check container staggering:
		// bar-1: startFrame = 0
		// bar-2: startFrame = 4 (stagger offset 1 * 4)
		// bar-3: startFrame = 8 (stagger offset 2 * 4)
		const bar1 = targetsById["bar-1"];
		const bar2 = targetsById["bar-2"];
		const bar3 = targetsById["bar-3"];

		// At frame 0:
		tl.seek(0);
		expect(bar1.opacity).toBe(0);

		// At frame 4 (bar-1 is halfway faded 0.33, bar-2 is just starting):
		tl.seek(4 / 24);
		expect(bar1.opacity).toBeGreaterThan(0);
		expect(bar2.opacity).toBe(0);
		expect(bar3.opacity).toBe(0);

		// At frame 8 (bar-3 is just starting):
		tl.seek(8 / 24);
		expect(bar2.opacity).toBeGreaterThan(0);
		expect(bar3.opacity).toBe(0);
	});
});
