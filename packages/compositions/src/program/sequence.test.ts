import { describe, expect, it } from "vitest";
import {
	calculateSequenceTimeline,
	computeCarrierContinuity,
	Scene,
	Sequence,
} from "./sequence.js";

describe("Cinematic Sequencing & Carrier Match Cuts", () => {
	it("calculates sequential timeline offsets without overlap", () => {
		const scenes = [
			{ id: "act-1", durationFrames: 60 },
			{ id: "act-2", durationFrames: 90 },
			{ id: "act-3", durationFrames: 45 },
		];

		const result = calculateSequenceTimeline(scenes, 60);

		expect(result.totalFrames).toBe(195);
		expect(result.totalDurationMs).toBe(3250);
		expect(result.sceneOffsets).toEqual([
			{ sceneId: "act-1", startFrame: 0, durationFrames: 60 },
			{ sceneId: "act-2", startFrame: 60, durationFrames: 90 },
			{ sceneId: "act-3", startFrame: 150, durationFrames: 45 },
		]);
	});

	it("calculates timeline with transition overlap", () => {
		const scenes = [
			{ id: "act-1", durationFrames: 60, transitionOverlap: 10 },
			{ id: "act-2", durationFrames: 60, transitionOverlap: 15 },
			{ id: "act-3", durationFrames: 60 },
		];

		const result = calculateSequenceTimeline(scenes, 60);

		// act-1: 0..60 (advance by 50)
		// act-2: 50..110 (advance by 45)
		// act-3: 95..155
		expect(result.sceneOffsets[0]?.startFrame).toBe(0);
		expect(result.sceneOffsets[1]?.startFrame).toBe(50);
		expect(result.sceneOffsets[2]?.startFrame).toBe(95);
		expect(result.totalFrames).toBe(155);
	});

	it("computes carrier state continuity across cuts", () => {
		const outgoingState = {
			x: 960,
			y: 540,
			scale: 1.2,
			vx: 15.5,
			vy: -4.2,
		};

		const incomingContinuousState = computeCarrierContinuity(outgoingState, {
			scale: 1.0,
		});

		expect(incomingContinuousState.x).toBe(960);
		expect(incomingContinuousState.y).toBe(540);
		expect(incomingContinuousState.vx).toBe(15.5);
		expect(incomingContinuousState.vy).toBe(-4.2);
		expect(incomingContinuousState.scale).toBe(1.0);
	});

	it("compiles sequenced scenes into a unified compositor program", () => {
		const seq = Sequence.create({
			fps: 60,
			width: 1920,
			height: 1080,
			backgroundColor: "#fdfbf7",
		});

		const scene1 = Scene.create({
			id: "hook",
			chapter: "hook",
			durationFrames: 60,
			layout: [
				{
					id: "card-1",
					kind: "box",
					background: "#ffffff",
					width: 400,
					height: 300,
					startFrame: 0,
					durationFrames: 60,
				},
			],
		});

		const scene2 = Scene.create({
			id: "solution",
			chapter: "solution",
			durationFrames: 90,
			layout: [
				{
					id: "card-2",
					kind: "box",
					background: "#f0f4ff",
					width: 500,
					height: 400,
					startFrame: 5,
				},
			],
		});

		seq.addScene(scene1);
		seq.addScene(scene2);

		const program = seq.toProgram();

		expect(program.fps).toBe(60);
		expect(program.width).toBe(1920);
		expect(program.height).toBe(1080);
		expect(program.backgroundColor).toBe("#fdfbf7");
		expect(program.layout.length).toBe(2);

		// scene 1 node
		expect(program.layout[0]?.id).toBe("card-1");
		expect(program.layout[0]?.startFrame).toBe(0);

		// scene 2 node should be offset by 60 frames
		expect(program.layout[1]?.id).toBe("card-2");
		expect(program.layout[1]?.startFrame).toBe(65);
		expect(program.layout[1]?.durationFrames).toBe(90);
	});
});
