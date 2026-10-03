import { describe, expect, it } from "vitest";
import { compileTimeline } from "./compiler.js";

describe("Kinetic Typography Engine Integration (Section 5)", () => {
	it("compiles keyframe tracks for offset, rangeStart, and rangeEnd", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "text-kinetic-1",
						kind: "text",
						text: "KINETIC MOTION GRAPHICS",
						fontSize: 64,
						startFrame: 0,
						durationFrames: 60,
						animators: [
							{
								id: "wave-rise",
								unit: "character" as const,
								rangeStart: 0,
								rangeEnd: 1,
								offset: -1,
								easing: "power2.out",
								transform: {
									y: 40,
									scale: 0.8,
									rotation: 10,
									rotationX: 90,
									opacity: 0,
									blur: 12,
								},
							},
						],
						animation: {
							tracks: [
								{
									id: "track-offset",
									prop: "offset" as const,
									keyframes: [
										{ id: "kf-0", frame: 0, value: -1 },
										{
											id: "kf-1",
											frame: 48,
											value: 1,
											ease: { name: "power2" as const, dir: "out" as const },
										},
									],
								},
							],
						},
					},
				},
			],
		};

		const { tl, targetsById } = compileTimeline("test-kinetic", virtualMedia, {
			fps: 24,
			durationSec: 3,
		});

		const stub = targetsById["text-kinetic-1"];
		expect(stub).toBeDefined();

		// Seek to frame 0
		tl.seek(0);
		expect(stub.offset).toBeCloseTo(-1);

		// Seek to frame 48 (2.0s at 24fps)
		tl.seek(2.0);
		expect(stub.offset).toBeCloseTo(1);

		// Seek to midpoint frame 24 (1.0s at 24fps)
		tl.seek(1.0);
		expect(stub.offset).toBeGreaterThan(-1);
		expect(stub.offset).toBeLessThan(1);
	});

	it("supports word and line units on kinetic text animators", () => {
		const virtualMedia = {
			operation: {
				op: "Compositor",
				width: 1920,
				height: 1080,
			},
			children: [
				{
					operation: {
						op: "CompositorLayer",
						id: "text-words",
						kind: "text",
						text: "HELLO WORLD FROM GATEWAI",
						fontSize: 48,
						startFrame: 0,
						durationFrames: 30,
						animators: [
							{
								id: "word-pop",
								unit: "word" as const,
								rangeStart: 0.2,
								rangeEnd: 0.8,
								offset: 0,
								transform: {
									scale: 1.3,
									y: -15,
								},
							},
							{
								id: "line-slide",
								unit: "line" as const,
								rangeStart: 0,
								rangeEnd: 1,
								offset: 0,
								transform: {
									x: 20,
								},
							},
						],
					},
				},
			],
		};

		const { targetsById } = compileTimeline("test-words", virtualMedia, {
			fps: 24,
			durationSec: 2,
		});

		const stub = targetsById["text-words"];
		expect(stub).toBeDefined();
		expect(stub.scale).toBe(1);
	});
});
