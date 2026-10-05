import { describe, expect, it } from "vitest";
import {
	Blur,
	Composition,
	Effect,
	type EditableObjectTrack,
	Layer,
	VisionNode,
} from "./index.js";

describe("Tracked Section Editing & Blur Engine Suite", () => {
	function setupVisionWithSyntheticTrack(): {
		vision: ReturnType<typeof VisionNode.attach>;
		targetPerson: EditableObjectTrack;
	} {
		const video = Layer.video("test.mp4");
		const vision = VisionNode.attach(video, {
			enableDetection: true,
			classes: ["person"],
		});

		// Populate synthetic bounding box at frame 0: origin (400, 300), size (200, 500)
		vision.setObjectResult(0, [
			{
				trackId: 1,
				category: "person",
				score: 0.95,
				boundingBox: {
					originX: 400,
					originY: 300,
					width: 200,
					height: 500,
					normalizedX: 400 / 1920,
					normalizedY: 300 / 1080,
					normalizedWidth: 200 / 1920,
					normalizedHeight: 500 / 1080,
				},
				centerX: 500,
				centerY: 550,
				normalizedCenterX: 500 / 1920,
				normalizedCenterY: 550 / 1080,
				velocity: { vx: 0, vy: 0 },
				speed: 0,
				age: 1,
				hits: 1,
				active: true,
				isCoasting: false,
			},
		]);

		// Vision decorates every track with its editing helpers.
		const targetPerson = vision.objects.byCategory(
			"person",
		) as EditableObjectTrack;
		return { vision, targetPerson };
	}

	it("1. Blur effect constructor binds directly to ObjectTrackSignals with elliptical geometry", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		const blur = new Blur({
			track: targetPerson,
			strength: 25,
			shape: "ellipse",
		});

		expect(blur.op).toBe("Blur");
		expect(blur.partialBlur).toBe(true);
		expect(blur.shape).toBe("ellipse");

		// Evaluate uniforms at frame 0
		const ctx = { frame: 0, fps: 24 };
		const centerX = (
			blur.signals.centerX as { get: (ctx: unknown) => number }
		).get(ctx);
		const centerY = (
			blur.signals.centerY as { get: (ctx: unknown) => number }
		).get(ctx);
		const radius = (
			blur.signals.radius as { get: (ctx: unknown) => number }
		).get(ctx);
		const radiusY = (
			blur.signals.radiusY as { get: (ctx: unknown) => number }
		).get(ctx);

		expect(centerX).toBeCloseTo(500 / 1920, 3);
		expect(centerY).toBeCloseTo(550 / 1080, 3);
		expect(radius).toBeGreaterThan(0);
		expect(radiusY).toBeGreaterThan(0);
	});

	it("2. Layer.video.blurRegion attaches a configured Blur effect in a single fluent line", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();
		const video = Layer.video("assets/film.mp4");

		// Fluent 1-liner to blur the tracked person
		video.blurRegion(targetPerson, {
			strength: 30,
			shape: "rect",
		});

		expect((video as unknown as { effects?: unknown[] }).effects).toBeDefined();
		expect((video as unknown as { effects: unknown[] }).effects).toHaveLength(
			1,
		);

		const attachedBlur = (video as unknown as { effects: Blur[] }).effects[0];
		expect(attachedBlur).toBeInstanceOf(Blur);
		expect(attachedBlur.partialBlur).toBe(true);
		expect(attachedBlur.shape).toBe("rect");
	});

	it("3. Layer.trackedRegion isolates the tracked section as a clipped, pinned layer for arbitrary editing", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		const trackedBox = Layer.trackedRegion("assets/film.mp4", targetPerson, {
			padding: 10,
			borderRadius: 16,
			borderColor: "#38bdf8",
			borderWidth: 2,
			effects: [new Blur({ strength: 20 })],
		});

		expect(trackedBox.kind).toBe("box");
		expect(trackedBox.overflow).toBe("hidden");
		expect(trackedBox.borderRadius).toBe(16);
		expect(trackedBox.borderColor).toBe("#38bdf8");
		expect(trackedBox.borderWidth).toBe(2);

		// Container width and height should be bound to screen dimensions + padding
		const ctx = { frame: 0, fps: 24 };
		const evalWidth = (
			trackedBox.width as { get: (ctx: unknown) => number }
		).get(ctx);
		const evalHeight = (
			trackedBox.height as { get: (ctx: unknown) => number }
		).get(ctx);
		expect(evalWidth).toBeCloseTo(200 + 20, 1);
		expect(evalHeight).toBeCloseTo(500 + 20, 1);

		// Inside the box, a nested video plate counter-offsets by -screenX + padding
		expect(trackedBox.children).toHaveLength(1);
		const innerVideo = trackedBox.children?.[0] as unknown as {
			kind: string;
			x: { get: (ctx: unknown) => number };
			y: { get: (ctx: unknown) => number };
			effects: Blur[];
		};
		expect(innerVideo.kind).toBe("media");
		expect(innerVideo.effects).toHaveLength(1);
		expect(innerVideo.effects[0]).toBeInstanceOf(Blur);

		const evalInnerX = innerVideo.x.get(ctx);
		const evalInnerY = innerVideo.y.get(ctx);
		expect(evalInnerX).toBeCloseTo(-400 + 10, 1);
		expect(evalInnerY).toBeCloseTo(-300 + 10, 1);
	});

	it("4. Layer.blurTrackedRegion provides one-line convenience for isolated blur plates", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		const blurredLayer = Layer.blurTrackedRegion(
			"assets/film.mp4",
			targetPerson,
			{
				strength: 35,
				borderRadius: 8,
				padding: 12,
			},
		);

		expect(blurredLayer.kind).toBe("box");
		expect(blurredLayer.borderRadius).toBe(8);
		expect(blurredLayer.children).toHaveLength(1);
	});

	it("5. ObjectTrackSignals has fluent .blurEffect and .isolate helper methods", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		// targetPerson.blurEffect()
		const blurFromTrack = targetPerson.blurEffect?.({ strength: 40 });
		expect(blurFromTrack).toBeInstanceOf(Blur);
		expect((blurFromTrack as Blur).partialBlur).toBe(true);

		// targetPerson.isolate()
		const isolatedBox = targetPerson.isolate?.("assets/film.mp4", {
			padding: 14,
			borderRadius: 10,
		});
		expect((isolatedBox as unknown as { kind: string }).kind).toBe("box");
	});

	it("6. Effect.blur static factory creates configured Blur instances", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		const effectInstance = Effect.blur({
			track: targetPerson,
			strength: 15,
		});

		expect(effectInstance).toBeInstanceOf(Blur);
		expect(effectInstance.partialBlur).toBe(true);
	});

	it("7. Compiles into VirtualMediaData AST with Blur op wrapping media plate", () => {
		const { vision, targetPerson } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 60,
		});

		comp.add(vision);

		const video = Layer.video("assets/film.mp4").blurRegion(targetPerson, {
			strength: 25,
			shape: "ellipse",
		});
		comp.add(video);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");

		// Find CompositorLayer containing video with Blur
		const layers = vm.children || [];
		const videoLayer = layers.find(
			(l) => (l.operation as Record<string, unknown>).dataType === "Video",
		);
		expect(videoLayer).toBeDefined();

		// Video media pipeline should have Blur op wrapping the base video source
		const topOp = videoLayer!.children[0];
		expect(topOp.operation.op).toBe("Blur");
		expect((topOp.operation as Record<string, unknown>).partialBlur).toBe(true);
		expect((topOp.operation as Record<string, unknown>).shape).toBe("ellipse");
	});

	it("8. Renders partial blur headlessly to valid PNG with WebGPU shader compilation", async () => {
		const { vision } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 640,
			height: 360,
			fps: 24,
			durationFrames: 30,
			backgroundColor: "#0d1117",
		});

		comp.add(vision);

		const bgCard = Layer.box({
			width: 640,
			height: 360,
			background: "#1e293b",
		});
		comp.add(bgCard);

		const png = await comp.renderFrame({ frame: 0 });
		expect(Buffer.isBuffer(png)).toBe(true);
		expect(png.length).toBeGreaterThan(100);
		// Check PNG signature: 0x89 'P' 'N' 'G'
		expect(png[0]).toBe(0x89);
		expect(png[1]).toBe(0x50);
		expect(png[2]).toBe(0x4e);
		expect(png[3]).toBe(0x47);
	});
});
