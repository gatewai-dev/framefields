import { describe, expect, it } from "vitest";
import { Blur, Composition, Layer, Modulate, Yolo } from "./index.js";

describe("YOLO composability (composition / crop / blur / modulate chains)", () => {
	it("yolo effect applies on top of Crop -> Blur -> Modulate on a single layer", () => {
		const videoLayer = Layer.video("test_source.mp4")
			.withCrop({
				leftPercentage: 10,
				topPercentage: 0,
				widthPercentage: 80,
				heightPercentage: 100,
			})
			.apply(new Blur({ strength: 8 }))
			.apply(new Modulate({ saturation: 1.2 }))
			.apply(new Yolo({ enableDetection: true }));

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

		// pipeline wraps the video: Yolo -> Modulate -> Blur -> Crop -> Video
		const yoloOp = layerNode.children[0];
		expect(yoloOp.operation.op).toBe("Yolo");
		expect(
			(yoloOp.operation as unknown as { enableDetection: boolean })
				.enableDetection,
		).toBe(true);
		// effect chains nest right-deep — walk the spine to verify order
		const ops: string[] = [];
		let walk: { children?: unknown[]; operation: { op: string } } | undefined =
			yoloOp;
		while (walk) {
			ops.push(walk.operation.op);
			walk = walk.children?.[0] as typeof walk | undefined;
		}
		expect(ops).toEqual(["Yolo", "Modulate", "Blur", "Crop", "source"]);
	});

	it("withYolo() lifts a whole composition (blur + modulate upstream become the inference input)", () => {
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
		comp.withYolo({ enablePose: true, enableSegmentation: true });

		// composition-level yolo config passes through every serialization path
		// (runtime passthrough, same convention as mediapipe — the zod program
		// schema intentionally stays engine-agnostic)
		const spec = comp.toSpec() as unknown as {
			yolo?: { enablePose?: boolean; enableSegmentation?: boolean };
		};
		expect(spec.yolo).toBeDefined();
		expect(spec.yolo?.enablePose).toBe(true);
		expect(spec.yolo?.enableSegmentation).toBe(true);

		// root-level yolo becomes a wrapping op in the render tree, above Compositor
		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Yolo");
		expect(vm.children[0]?.operation.op).toBe("Compositor");
	});

	it("Layer.withYolo() accepts the engine node and keeps zero-I/O laziness", () => {
		const comp = Composition.create({
			width: 640,
			height: 480,
			fps: 30,
			durationFrames: 30,
		}).add(Layer.video("clip.mp4").withYolo({ enableDetection: true }));

		const vm = comp.toVirtualMedia();
		const layerNode = vm.children[0];
		const yoloOp = layerNode.children[0];
		expect(yoloOp.operation.op).toBe("Yolo");
	});

	it("apply() dispatches a Yolo effect onto an existing composition", () => {
		const comp = Composition.create({
			width: 1280,
			height: 720,
			fps: 30,
			durationFrames: 90,
		}).add(Layer.video("clip.mp4"));
		comp.apply(new Yolo({ enableClassification: true }));
		const spec = comp.toSpec() as unknown as {
			yolo?: { enableClassification?: boolean };
		};
		expect(spec.yolo?.enableClassification).toBe(true);
		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Yolo");
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
		// Top cutout layer with yolo mode: matte
		const topNode = comp.children[2] as unknown as {
			yolo?: { config?: { mode: string; featherRadius: number } };
		};
		expect(topNode.yolo?.config?.mode).toBe("matte");
		expect(topNode.yolo?.config?.featherRadius).toBeCloseTo(0.04, 3);
	});

	it("addSmartFraming() wraps video in an auto-reframing box with smoothed camera pan", () => {
		const comp = Composition.create({
			width: 1080,
			height: 1920,
			fps: 24,
			durationFrames: 30,
		});

		const vision = comp.withYolo({ enableDetection: true });
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

		const vision = comp.withYolo({ enableSegmentation: true });
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
