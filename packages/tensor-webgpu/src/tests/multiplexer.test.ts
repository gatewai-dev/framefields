import { ensureDevice } from "@framefields/webgpu-renderers";
import { describe, expect, it } from "vitest";
import { ControlNetMultiplexer } from "../multiplexer/controlnet-multiplexer.js";
import { TensorPipeline } from "../pipeline/tensor-pipeline.js";

describe("ControlNetMultiplexer & TensorPipeline VRAM Lifecycle", () => {
	it("registers, binds, and exports conditioning textures without CPU roundtrips", async () => {
		let device: GPUDevice;
		try {
			device = await ensureDevice();
		} catch (e) {
			console.warn(
				"WebGPU device unavailable in test environment, skipping:",
				e,
			);
			return;
		}

		const width = 128;
		const height = 128;

		const mockInputTexture = device.createTexture({
			label: "mock_input_video_texture",
			size: [width, height],
			format: "rgba8unorm",
			usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
		});

		// 1. Fluent TensorPipeline chaining
		const pipeline = TensorPipeline.from(mockInputTexture)
			.canny({ low: 0.1, high: 0.3 })
			.depthNormals({ depthQuality: "high", depthScale: 1.0 });

		expect(pipeline.id).toBeDefined();

		// 2. Execute VRAM pipeline
		const outputs = await pipeline.execute(device);
		expect(outputs.canny).toBeDefined();
		expect(outputs.normals).toBeDefined();
		expect(outputs.canny?.width).toBe(width);
		expect(outputs.normals?.width).toBe(width);

		// 3. ControlNet Multiplexer validation
		const mux = pipeline.getMultiplexer();
		expect(mux.has("canny")).toBe(true);
		expect(mux.has("normals")).toBe(true);
		expect(mux.has("poseSkeleton")).toBe(false);

		// 4. Zero-copy bind group entry generation
		const cannyEntry = mux.createBindGroupEntry("canny", 0);
		expect(cannyEntry.binding).toBe(0);
		expect(cannyEntry.resource).toBeDefined();

		const normalsEntry = mux.createBindGroupEntry("normals", 1);
		expect(normalsEntry.binding).toBe(1);
		expect(normalsEntry.resource).toBeDefined();

		// Error on missing texture
		expect(() => mux.createBindGroupEntry("poseSkeleton", 2)).toThrow();

		// 5. Zero-copy TensorView export for WebNN / ONNX-WebGPU models
		const tensorView = mux.exportTensorView("canny");
		expect(tensorView.width).toBe(width);
		expect(tensorView.height).toBe(height);
		expect(tensorView.texture).toBe(outputs.canny);

		// 6. toNode() AST representation
		const node = pipeline.toNode();
		expect(node.kind).toBe("tensor");
		expect(node.config.canny?.low).toBe(0.1);
		expect(node.config.depthNormals?.depthQuality).toBe("high");

		// 7. Standalone ControlNetMultiplexer direct usage
		const standaloneMux = new ControlNetMultiplexer();
		standaloneMux.set("depth", mockInputTexture);
		expect(standaloneMux.has("depth")).toBe(true);
		expect(standaloneMux.get("depth")).toBe(mockInputTexture);
		standaloneMux.destroy();

		// Clean up
		mockInputTexture.destroy();
		pipeline.destroy();
	});
});
