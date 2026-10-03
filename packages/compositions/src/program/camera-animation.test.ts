import { describe, expect, it } from "vitest";
import { CameraAnimation } from "./animation.js";
import { CameraNodeSchema, CompositorProgramSchema } from "./schema.js";

describe("CameraAnimation Builder", () => {
	it("builds dolly tracks", () => {
		const anim = CameraAnimation.camera().dolly({
			fromDistance: -2000,
			toDistance: -1000,
			start: 10,
			end: 40,
			ease: "expo.out",
		});

		const spec = anim.toSpec();
		expect(spec.tracks).toHaveLength(1);
		expect(spec.tracks[0].prop).toBe("cameraZ");
		expect(spec.tracks[0].keyframes.length).toBeGreaterThanOrEqual(2);
		const lastKf =
			spec.tracks[0].keyframes[spec.tracks[0].keyframes.length - 1];
		expect(lastKf.value).toBe(-1000);
		expect(lastKf.frame).toBe(40);
	});

	it("builds multi-axis orbit tracks", () => {
		const anim = CameraAnimation.camera().orbit({
			azimuth: { from: 0, to: 45 },
			elevation: { from: 10, to: 30 },
			radius: { from: 1500, to: 1200 },
			start: 0,
			end: 60,
			ease: "power2.out",
		});

		const spec = anim.toSpec();
		expect(spec.tracks).toHaveLength(3);
		const props = spec.tracks.map((t) => t.prop);
		expect(props).toContain("orbitAzimuth");
		expect(props).toContain("orbitElevation");
		expect(props).toContain("orbitRadius");
	});

	it("builds rack focus and handheld tracks", () => {
		const anim = CameraAnimation.camera()
			.rackFocus({
				fromDistance: 500,
				toDistance: 1200,
				fromFStop: 1.4,
				toFStop: 5.6,
				start: 20,
				end: 50,
			})
			.handheld({
				translationAmplitude: 12,
				rotationAmplitude: 1.5,
				start: 0,
				end: 100,
			});

		const spec = anim.toSpec();
		const props = spec.tracks.map((t) => t.prop);
		expect(props).toContain("focusDistance");
		expect(props).toContain("fStop");
		expect(props).toContain("shakeTranslation");
		expect(props).toContain("shakeRotation");
	});

	it("validates CameraNode with CameraNodeSchema", () => {
		const rawCamera = {
			id: "cinema-camera-1",
			kind: "camera",
			x: 960,
			y: 540,
			z: -1600,
			targetX: 960,
			targetY: 540,
			targetZ: 0,
			lens: {
				focalLength: 35,
				zoom: 1.2,
			},
			dof: {
				enabled: true,
				focusDistance: 800,
				fStop: 2.0,
			},
			shake: {
				translationAmplitude: 5,
				rotationAmplitude: 0.5,
			},
		};

		const parsed = CameraNodeSchema.parse(rawCamera);
		expect(parsed.kind).toBe("camera");
		expect(parsed.lens?.focalLength).toBe(35);
		expect(parsed.dof?.enabled).toBe(true);
	});

	it("validates a complete CompositorProgram containing a CameraNode and 3D layers", () => {
		const doc = {
			width: 1920,
			height: 1080,
			backgroundColor: "#000000",
			layout: [
				{
					id: "main-camera",
					kind: "camera",
					z: -2000,
					dof: { enabled: true, focusDistance: 1000 },
				},
				{
					id: "hero-card",
					kind: "box",
					is3D: true,
					z: 200,
					rotateY: 15,
					width: 400,
					height: 300,
					background: "#222222",
				},
			],
		};

		const parsed = CompositorProgramSchema.parse(doc);
		expect(parsed.layout).toHaveLength(2);
		expect(parsed.layout[0].kind).toBe("camera");
		expect(parsed.layout[1].kind).toBe("box");
		expect((parsed.layout[1] as any).is3D).toBe(true);
	});
});
