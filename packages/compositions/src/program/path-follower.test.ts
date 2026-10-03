import { Path3D } from "@gitframes/renderers";
import { describe, expect, it } from "vitest";
import { CameraAnimation, LayerAnimation } from "./animation.js";

describe("Path Follower Kinematics", () => {
	it("generates 2D trajectory with auto-orientation along circle path", () => {
		const circle = Path3D.circle({
			center: [500, 500, 0],
			radius: 200,
		});

		const anim = new LayerAnimation().followPath(circle, {
			start: 0,
			end: 60,
			samples: 12,
			autoOrient: true,
		});

		const spec = anim.toSpec();
		const trackX = spec.tracks.find((t) => t.prop === "x");
		const trackY = spec.tracks.find((t) => t.prop === "y");
		const trackRz = spec.tracks.find((t) => t.prop === "rotateZ");

		expect(trackX).toBeDefined();
		expect(trackY).toBeDefined();
		expect(trackRz).toBeDefined();

		// Check first and last keyframes
		expect(trackX!.keyframes.length).toBe(13);
		expect(trackX!.keyframes[0].value).toBeCloseTo(700, 0); // 500 + 200 * cos(0)
		expect(trackY!.keyframes[0].value).toBeCloseTo(500, 0);
	});

	it("generates 3D trajectory with banking into turns on Catmull-Rom spline", () => {
		const spline = Path3D.catmullRom([
			[0, 100, 0],
			[200, 150, 100],
			[400, 300, 200],
			[600, 200, 50],
		]);

		const anim = new LayerAnimation().followPath(spline, {
			start: 0,
			end: 40,
			samples: 10,
			banking: 1.5,
			autoOrient: true,
		});

		const spec = anim.toSpec();
		const trackZ = spec.tracks.find((t) => t.prop === "z");
		const trackRx = spec.tracks.find((t) => t.prop === "rotateX");
		const trackRz = spec.tracks.find((t) => t.prop === "rotateZ");

		expect(trackZ).toBeDefined();
		expect(trackRx).toBeDefined();
		expect(trackRz).toBeDefined();
		expect(trackZ!.keyframes.length).toBe(11);
	});

	it("generates CameraAnimation path follower in lookAtTarget and leadTarget modes", () => {
		const helix = Path3D.helix({
			center: [960, 540, 0],
			radius: 600,
			pitch: 100,
			turns: 2,
		});

		// Mode: lookAtTarget
		const camAnimLookAt = CameraAnimation.camera().followPath3D(helix, {
			start: 0,
			end: 60,
			mode: "lookAtTarget",
			target: [960, 540, 0],
			samples: 8,
		});

		const specLookAt = camAnimLookAt.toSpec();
		const camX = specLookAt.tracks.find((t) => t.prop === "cameraX");
		const tgtX = specLookAt.tracks.find((t) => t.prop === "targetX");
		expect(camX).toBeDefined();
		expect(tgtX).toBeDefined();
		expect(tgtX!.keyframes[0].value).toBe(960);

		// Mode: leadTarget
		const camAnimLead = CameraAnimation.camera().followPath3D(helix, {
			start: 0,
			end: 60,
			mode: "leadTarget",
			lookAhead: 0.1,
			samples: 8,
		});

		const specLead = camAnimLead.toSpec();
		const leadTgtZ = specLead.tracks.find((t) => t.prop === "targetZ");
		expect(leadTgtZ).toBeDefined();
	});
});
