import { describe, expect, it } from "vitest";
import { Blur, Composition, Layer, Modulate, Vision } from "./index.js";

describe("Vision composability (composition / crop / blur / modulate chains)", () => {
	it("Vision effect applies on top of Crop -> Blur -> Modulate on a single layer", () => {
		const videoLayer = Layer.video("test_source.mp4")
			.withCrop({
				leftPercentage: 10,
				topPercentage: 0,
				widthPercentage: 80,
				heightPercentage: 100,
			})
			.apply(new Blur({ strength: 8 }))
			.apply(new Modulate({ saturation: 1.2 }))
			.apply(new Vision({ enableDetection: true }));

		const comp = Composition.create({
			width: 1080,
			height: 1920,
			fps: 24,
			durationFrames: 60,
		}).add(videoLayer);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");
		const layerNode = vm.children[0];
		expect(layerNode.operation.op).toBe("CompositorLayer");

		// pipeline wraps the video: Vision -> Modulate -> Blur -> Crop -> Video
		const visionOp = layerNode.children[0];
		expect(visionOp.operation.op).toBe("Vision");
		expect(
			(visionOp.operation as unknown as { enableDetection: boolean })
				.enableDetection,
		).toBe(true);
		// effect chains nest right-deep — walk the spine to verify order
		const ops: string[] = [];
		let walk: { children?: unknown[]; operation: { op: string } } | undefined =
			visionOp;
		while (walk) {
			ops.push(walk.operation.op);
			walk = walk.children?.[0] as typeof walk | undefined;
		}
		expect(ops).toEqual(["Vision", "Modulate", "Blur", "Crop", "source"]);
	});

	it("withVision() lifts a whole composition (blur + modulate upstream become the inference input)", () => {
		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 48,
		}).add(
			Layer.video("hero.mp4")
				.apply(new Blur({ strength: 4 }))
				.apply(new Modulate({ saturation: 0.9 })),
		);
		comp.withVision({ enablePose: true, enableSegmentation: true });

		// composition-level vision config passes through every serialization path
		// (runtime passthrough — the zod program schema stays engine-agnostic)
		const spec = comp.toSpec() as unknown as {
			vision?: { enablePose?: boolean; enableSegmentation?: boolean };
		};
		expect(spec.vision).toBeDefined();
		expect(spec.vision?.enablePose).toBe(true);
		expect(spec.vision?.enableSegmentation).toBe(true);

		// root-level vision becomes a wrapping op in the render tree, above Compositor
		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Vision");
		expect(vm.children[0]?.operation.op).toBe("Compositor");
	});

	it("Layer.withVision() accepts the engine node and keeps zero-I/O laziness", () => {
		const comp = Composition.create({
			width: 640,
			height: 480,
			fps: 30,
			durationFrames: 30,
		}).add(Layer.video("clip.mp4").withVision({ enableDetection: true }));

		const vm = comp.toVirtualMedia();
		const layerNode = vm.children[0];
		const visionOp = layerNode.children[0];
		expect(visionOp.operation.op).toBe("Vision");
	});

	it("apply() dispatches a Vision effect onto an existing composition", () => {
		const comp = Composition.create({
			width: 1280,
			height: 720,
			fps: 30,
			durationFrames: 90,
		}).add(Layer.video("clip.mp4"));
		comp.apply(new Vision({ enablePose: true, enableMatte: true }));
		const spec = comp.toSpec() as unknown as {
			vision?: { enablePose?: boolean; enableMatte?: boolean };
		};
		expect(spec.vision?.enablePose).toBe(true);
		expect(spec.vision?.enableMatte).toBe(true);
		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Vision");
	});

	it("addSubjectSandwich() creates bottom plate, behind elements, and top matte cutout", () => {
		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 24,
			durationFrames: 48,
		});

		comp.addSubjectSandwich({
			source: "dancer.mp4",
			behind: [
				Layer.text("FUTURE SOUND", {
					fontSize: 120,
					fill: "#ffffff",
					y: 400,
				}),
			],
			feather: 4,
		});

		expect(comp.children).toHaveLength(3);
		// Bottom layer
		expect(comp.children[0].kind).toBe("media");
		// Middle behind layer
		expect(comp.children[1].kind).toBe("text");
		// Top cutout layer with vision mode: matte
		const topNode = comp.children[2] as unknown as {
			vision?: { config?: { mode: string; featherRadius: number } };
		};
		expect(topNode.vision?.config?.mode).toBe("matte");
		expect(topNode.vision?.config?.featherRadius).toBeCloseTo(0.04, 3);
	});

	it("addSmartFraming() wraps video in an auto-reframing box with smoothed camera pan", () => {
		const comp = Composition.create({
			width: 1080,
			height: 1920,
			fps: 24,
			durationFrames: 30,
		});

		const vision = comp.withVision({ enableDetection: true });
		comp.addSmartFraming({
			source: "landscape_16_9.mp4",
			target: vision.objects.primary,
			damping: 0.8,
			leadHeadroom: 0.15,
		});

		expect(comp.children).toHaveLength(1);
		const container = comp.children[0];
		expect(container.kind).toBe("box");
		expect((container as unknown as { overflow: string }).overflow).toBe(
			"hidden",
		);
		expect(
			(container as unknown as { children: unknown[] }).children,
		).toHaveLength(1);
	});

	it("addSubjectOutline() creates an outline layer with blur and silhouette mask", () => {
		const comp = Composition.create({
			width: 1080,
			height: 1920,
			fps: 24,
			durationFrames: 30,
		});

		const vision = comp.withVision({ enableSegmentation: true });
		comp.addSubjectOutline(vision.segmentation.subject, {
			source: "footage.mp4",
			color: "#38bdf8",
			width: 4,
			blur: 12,
		});

		expect(comp.children).toHaveLength(1);
		const outline = comp.children[0];
		expect(outline.kind).toBe("box");
		expect(
			(outline as unknown as { children: unknown[] }).children,
		).toHaveLength(1);
	});
});
