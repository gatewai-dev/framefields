import { describe, expect, it } from "vitest";
import {
	Blur,
	Composition,
	Effect,
	FilmGrain,
	Layer,
	type ObjectTrackSignals,
	Vignette,
	VisionNode,
} from "./index.js";

describe("Unified Composition & Layer Section Architecture Suite", () => {
	function setupVisionWithSyntheticTrack(): {
		video: ReturnType<typeof Layer.video>;
		vision: ReturnType<typeof VisionNode.attach>;
		targetPerson: ObjectTrackSignals;
	} {
		const video = Layer.video("test_source.mp4");
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

		const targetPerson = vision.objects.byCategory("person");
		return { video, vision, targetPerson };
	}

	it("1. comp.section(target, { effects: [...] }) creates a tracked section with multiple effects", () => {
		const { video, vision, targetPerson } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 60,
		});
		comp.add(vision);
		comp.add(video);

		const section = comp.section(targetPerson, {
			padding: 12,
			borderRadius: 16,
			borderColor: "#38bdf8",
			borderWidth: 2,
			effects: [new Blur({ strength: 24 }), new FilmGrain({ strength: 35 })],
		});

		expect(section.kind).toBe("box");
		expect(section.borderRadius).toBe(16);
		expect(section.borderColor).toBe("#38bdf8");
		expect(section.borderWidth).toBe(2);
		expect(section.effects).toHaveLength(2);
		expect(section.effects[0]).toBeInstanceOf(Blur);
		expect(section.effects[1]).toBeInstanceOf(FilmGrain);

		// Container width and height should be bound to screen dimensions + padding*2
		const ctx = { frame: 0, fps: 24 };
		const evalW = (section.width as { get: (ctx: unknown) => number }).get(ctx);
		const evalH = (section.height as { get: (ctx: unknown) => number }).get(
			ctx,
		);
		expect(evalW).toBeCloseTo(200 + 24, 1);
		expect(evalH).toBeCloseTo(500 + 24, 1);

		// Inner media has counter-offset
		expect(section.children).toHaveLength(1);
		const inner = section.innerMedia as unknown as {
			x: { get: (ctx: unknown) => number };
			y: { get: (ctx: unknown) => number };
			effects: unknown[];
		};
		expect(inner.effects).toHaveLength(2);
		expect(inner.x.get(ctx)).toBeCloseTo(-400 + 12, 1);
		expect(inner.y.get(ctx)).toBeCloseTo(-300 + 12, 1);
	});

	it("2. comp.addSection(target, options) creates and adds the section directly to the composition", () => {
		const { video, vision, targetPerson } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 60,
		});
		comp.add(vision);
		comp.add(video);

		const initialChildrenCount = comp.children.length;

		const added = comp.addSection(targetPerson, {
			padding: 8,
			borderRadius: 8,
			effects: [new Blur({ strength: 30 })],
		});

		expect(comp.children).toHaveLength(initialChildrenCount + 1);
		expect(comp.children[comp.children.length - 1]).toBe(added);
		expect(added.effects).toHaveLength(1);
	});

	it("3. comp.section(options) isolates an arbitrary spatial section of the composition", () => {
		const { video } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 30,
		});
		comp.add(video);

		// Define a fixed coordinate section of the composition with vignette + film grain
		const staticSection = comp.section({
			x: 200,
			y: 150,
			width: 600,
			height: 400,
			borderRadius: 20,
			effects: [
				new Vignette({ radius: 0.7, strength: 80 }),
				new FilmGrain({ strength: 40 }),
			],
		});

		expect(staticSection.kind).toBe("box");
		expect(staticSection.x).toBe(200);
		expect(staticSection.y).toBe(150);
		expect(staticSection.width).toBe(600);
		expect(staticSection.height).toBe(400);
		expect(staticSection.borderRadius).toBe(20);

		// Inner media should be counter-offset by (-x, -y)
		const inner = staticSection.innerMedia;
		expect(inner.x).toBe(-200);
		expect(inner.y).toBe(-150);
		expect(inner.width).toBe(1920);
		expect(inner.height).toBe(1080);
		expect(staticSection.effects).toHaveLength(2);
	});

	it("4. video.section(target, options) creates an isolated section directly on a layer", () => {
		const { video, targetPerson } = setupVisionWithSyntheticTrack();

		const section = (
			video as unknown as {
				section: (
					target: ObjectTrackSignals,
					options?: Record<string, unknown>,
				) => typeof video;
			}
		).section(targetPerson, {
			borderRadius: 14,
			effects: [Effect.blur({ strength: 18 })],
		});

		expect(section).toBeDefined();
		expect((section as unknown as { effects: unknown[] }).effects).toHaveLength(
			1,
		);
	});

	it("5. track.section(options) uses track's associated source automatically", () => {
		const { targetPerson } = setupVisionWithSyntheticTrack();

		// Track signals decorated with .section()
		const sectionFromTrack = (
			targetPerson as unknown as {
				section: (options?: Record<string, unknown>) => {
					kind: string;
					effects: unknown[];
				};
			}
		).section({
			padding: 10,
			borderRadius: 12,
			effects: [Effect.blur({ strength: 22 })],
		});

		expect(sectionFromTrack.kind).toBe("box");
		expect(sectionFromTrack.effects).toHaveLength(1);
	});

	it("6. Fluent effect chaining: .addEffect() and .withEffects()", () => {
		const { video, targetPerson } = setupVisionWithSyntheticTrack();

		const section = Layer.section(video, targetPerson, {
			borderRadius: 10,
		});

		expect(section.effects).toHaveLength(0);

		// Chain single effect
		section.addEffect(new Blur({ strength: 15 }));
		expect(section.effects).toHaveLength(1);

		// Chain multiple effects
		section.withEffects([
			new FilmGrain({ strength: 20 }),
			new Vignette({ radius: 0.9 }),
		]);
		expect(section.effects).toHaveLength(3);
		expect(section.innerMedia.effects).toHaveLength(3);
	});

	it("7. Compiles composition with section into valid Compositor VirtualMediaData AST", () => {
		const { video, vision, targetPerson } = setupVisionWithSyntheticTrack();

		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 60,
		});
		comp.add(vision);
		comp.add(video);

		const sec = comp.addSection(targetPerson, {
			effects: [new Blur({ strength: 20 }), new FilmGrain({ strength: 30 })],
		});

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");

		const layers = vm.children || [];
		// Look for the section container layer
		const sectionLayer = layers.find(
			(l) => (l.operation as Record<string, unknown>).id === sec.id,
		);
		expect(sectionLayer).toBeDefined();

		// Inside the section container, innerMedia pipeline has FilmGrain -> Blur -> Video
		const innerLayer = sectionLayer!.children[0];
		expect(innerLayer).toBeDefined();
		const topOp = innerLayer.children[0];
		expect(topOp).toBeDefined();
		// The outer effect is FilmGrain, wrapping Blur
		expect(topOp.operation.op).toBe("FilmGrain");
		expect(topOp.children[0].operation.op).toBe("Blur");
	});

	it("8. Headless WebGPU rendering: renders composition with effected section to PNG", async () => {
		const comp = Composition.create({
			width: 640,
			height: 360,
			fps: 24,
			durationFrames: 30,
			backgroundColor: "#050811",
		});

		// Add base background
		const bg = Layer.box({
			width: 640,
			height: 360,
			background: "#1e293b",
		});
		comp.add(bg);

		// Add a section of the composition with blur + grain
		const sec = comp.addSection({
			x: 120,
			y: 80,
			width: 400,
			height: 200,
			borderRadius: 16,
			borderColor: "#38bdf8",
			borderWidth: 2,
			effects: [new Blur({ strength: 16 })],
		});
		expect(sec).toBeDefined();

		const png = await comp.renderFrame({ frame: 0 });
		expect(Buffer.isBuffer(png)).toBe(true);
		expect(png.length).toBeGreaterThan(100);
		// Validate PNG magic bytes
		expect(png[0]).toBe(0x89);
		expect(png[1]).toBe(0x50);
		expect(png[2]).toBe(0x4e);
		expect(png[3]).toBe(0x47);
	});
});
