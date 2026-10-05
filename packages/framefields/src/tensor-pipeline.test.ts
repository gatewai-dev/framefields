import { describe, expect, it } from "vitest";
import { Composition, Layer, TensorPipeline } from "./index.js";

describe("TensorPipeline Composition DSL Integration", () => {
	it("seamlessly creates composition and chains TensorPipeline in fluent DSL", () => {
		const comp = Composition.create({
			width: 1920,
			height: 1080,
			fps: 60,
			durationFrames: 300,
		});

		expect(comp.width).toBe(1920);
		expect(comp.height).toBe(1080);
		expect(comp.fps).toBe(60);
		expect(comp.durationMs).toBe(5000); // 300 frames at 60 fps = 5000ms

		const actorVideo = Layer.video("assets/actor_dance.mp4");
		const tensors = TensorPipeline.from(actorVideo)
			.canny({ low: 0.1, high: 0.3 })
			.depthNormals({ depthQuality: "high" });

		comp.add(tensors, actorVideo);

		expect(comp.children.length).toBe(2);
		expect(comp.children[0].kind).toBe("tensor");
		expect(comp.children[1].kind).toBe("media");
	});
});
