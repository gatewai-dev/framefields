import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type RegisteredShader, shaderStore } from "./shader-store.js";

describe("shaderStore", () => {
	const testNodeId = "test-node-id";
	const dummyShader: RegisteredShader = {
		wgsl: "fn main() {}",
		name: "testShader",
		outputType: "color",
		fnParams: [
			{
				name: "param1",
				type: "float",
				defaultValue: 1.0,
			},
		],
	};

	beforeEach(() => {
		// Ensure clean state before each test
		shaderStore.delete(testNodeId);
	});

	afterEach(() => {
		// Clean up state after each test
		shaderStore.delete(testNodeId);
	});

	it("should register and retrieve a shader", () => {
		shaderStore.register(testNodeId, dummyShader);
		const retrieved = shaderStore.get(testNodeId);

		expect(retrieved).toEqual(dummyShader);
	});

	it("should return undefined for non-existent shaders", () => {
		const retrieved = shaderStore.get("non-existent-id");
		expect(retrieved).toBeUndefined();
	});

	it("should overwrite an existing registration", () => {
		const secondShader: RegisteredShader = {
			...dummyShader,
			name: "secondShader",
			wgsl: "fn another() {}",
		};

		shaderStore.register(testNodeId, dummyShader);
		shaderStore.register(testNodeId, secondShader);

		const retrieved = shaderStore.get(testNodeId);
		expect(retrieved).toEqual(secondShader);
	});

	it("should delete a registered shader", () => {
		shaderStore.register(testNodeId, dummyShader);
		expect(shaderStore.get(testNodeId)).toEqual(dummyShader);

		shaderStore.delete(testNodeId);
		expect(shaderStore.get(testNodeId)).toBeUndefined();
	});
});
