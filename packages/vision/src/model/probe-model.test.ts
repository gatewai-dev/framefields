import * as ort from "onnxruntime-node";
import { describe, expect, it } from "vitest";
import { probeModel } from "./probe-model.js";

describe("probeModel", () => {
	it("is a valid ONNX model that onnxruntime runs", async () => {
		const session = await ort.InferenceSession.create(probeModel());
		const { y } = await session.run({
			x: new ort.Tensor("float32", new Float32Array([3]), [1]),
		});
		expect(Array.from(y?.data as Float32Array)).toEqual([3]);
		await session.release();
	});
});
