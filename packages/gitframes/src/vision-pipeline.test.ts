import { describe, expect, it } from "vitest";
import { Blur, Composition, Layer, Vignette } from "./index.js";

describe("WebGPU vision pipeable architecture", () => {
	it("chains Crop -> Blur -> Vision on a single video layer in one go", () => {
		const videoLayer = Layer.video("test_source.mp4")
			.withCrop({
				leftPercentage: 27.8,
				topPercentage: 0,
				widthPercentage: 44.4,
				heightPercentage: 100,
			})
			.apply(new Blur({ strength: 10 }))
			.withVision({ mode: "skeleton", enablePose: true });

		const comp = Composition.create({
			width: 1080,
			height: 1920,
			fps: 24,
			durationFrames: 60,
		}).add(videoLayer);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Compositor");
		expect(vm.children).toHaveLength(1);

		const layerNode = vm.children[0];
		expect(layerNode.operation.op).toBe("CompositorLayer");

		// Layer pipeline: Vision -> Blur -> Crop -> Video
		const visionOp = layerNode.children[0];
		expect(visionOp.operation.op).toBe("Vision");
		expect((visionOp.operation as Record<string, unknown>).mode).toBe(
			"skeleton",
		);

		const blurOp = visionOp.children[0];
		expect(blurOp.operation.op).toBe("Blur");

		const cropOp = blurOp.children[0];
		expect(cropOp.operation.op).toBe("Crop");

		const baseVideo = cropOp.children[0];
		expect(baseVideo.operation.op).toBe("source");
		expect((baseVideo.operation as Record<string, unknown>).url).toBe(
			"test_source.mp4",
		);
	});

	it("pins nodes to pose landmarks from a composition-wide vision bundle", () => {
		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 30,
			durationFrames: 90,
		});
		const vision = comp.withVision({
			enablePose: true,
			enableSegmentation: true,
		});

		const floatingCard = Layer.box({
			width: 200,
			height: 100,
			is3D: true,
		}).pinToLandmark(vision.poseLandmarks.rightWrist, { offsetZ: -10 });
		comp.add(Layer.video("background.mp4"), floatingCard);

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Vision");
		expect(vm.children[0]?.operation.op).toBe("Compositor");
		expect(floatingCard.x).toBeDefined();
		expect(vision.poseLandmarksTensor).toBeDefined();
		expect(vision.segmentation.subject).toBeDefined();
		expect(vision.segmentation.matte.coverage).toBeDefined();
	});

	it("supports whole-composition post-processing effect chaining", () => {
		const comp = Composition.create({ width: 1920, height: 1080 })
			.add(Layer.video("main.mp4"))
			.apply(new Vignette({ strength: 40 }))
			.apply(new Blur({ strength: 5 }));

		const vm = comp.toVirtualMedia();
		expect(vm.operation.op).toBe("Blur");
		const vignetteNode = vm.children[0];
		expect(vignetteNode.operation.op).toBe("Vignette");
		expect(vignetteNode.children[0].operation.op).toBe("Compositor");
	});
});
