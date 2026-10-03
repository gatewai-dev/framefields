import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureDOMGlobals } from "./test-helpers.js";
import { TransformStack } from "./transform-stack.js";

describe("TransformStack", () => {
	beforeAll(() => {
		ensureDOMGlobals();
	});

	let stack: TransformStack;

	beforeEach(() => {
		stack = new TransformStack();
	});

	it("should start with an identity matrix", () => {
		const current = stack.getCurrent();
		expect(current.a).toBe(1);
		expect(current.b).toBe(0);
		expect(current.c).toBe(0);
		expect(current.d).toBe(1);
		expect(current.e).toBe(0);
		expect(current.f).toBe(0);
	});

	it("should push a matrix and multiply it with current", () => {
		// Translation matrix
		const translateMat = new DOMMatrix().translate(10, 20);
		stack.push(translateMat);

		let current = stack.getCurrent();
		expect(current.e).toBe(10);
		expect(current.f).toBe(20);

		// Scale matrix
		const scaleMat = new DOMMatrix().scale(2, 3);
		stack.push(scaleMat);

		current = stack.getCurrent();
		// Multiplication result:
		// Translation of (10, 20) followed by Scale of (2, 3)
		expect(current.a).toBe(2);
		expect(current.d).toBe(3);
		expect(current.e).toBe(10);
		expect(current.f).toBe(20);
	});

	it("should pop the top matrix from the stack", () => {
		const mat = new DOMMatrix().translate(10, 20);
		stack.push(mat);
		expect(stack.getCurrent().e).toBe(10);

		stack.pop();
		expect(stack.getCurrent().e).toBe(0);
	});

	it("should not pop the initial identity matrix", () => {
		expect(() => stack.pop()).not.toThrow();
		const current = stack.getCurrent();
		expect(current.a).toBe(1);
	});

	it("should pack current matrix and layout params into float32 array", () => {
		const bufferData = new Float32Array(16);
		const mat = new DOMMatrix().translate(10, 20);
		stack.push(mat);

		stack.packIntoBuffer(bufferData, 0.5, 800, 600, undefined, 42);

		// Check matrix components packed in 4x4 matrix (padded with 0/1/0)
		// Row 0: a, b, 0, 0
		expect(bufferData[0]).toBe(1);
		expect(bufferData[1]).toBe(0);
		expect(bufferData[2]).toBe(0);
		expect(bufferData[3]).toBe(0);

		// Row 1: c, d, 0, 0
		expect(bufferData[4]).toBe(0);
		expect(bufferData[5]).toBe(1);
		expect(bufferData[6]).toBe(0);
		expect(bufferData[7]).toBe(0);

		// Row 2: e, f, 1, 0
		expect(bufferData[8]).toBe(10);
		expect(bufferData[9]).toBe(20);
		expect(bufferData[10]).toBe(1);
		expect(bufferData[11]).toBe(0);

		// Row 3 (params): opacity, surfaceWidth, surfaceHeight, customParam
		expect(bufferData[12]).toBe(0.5);
		expect(bufferData[13]).toBe(800);
		expect(bufferData[14]).toBe(600);
		expect(bufferData[15]).toBe(42);
	});

	it("should apply localOverride when packing matrix into buffer", () => {
		const bufferData = new Float32Array(16);
		const mat = new DOMMatrix().translate(10, 20);
		stack.push(mat);

		const override = new DOMMatrix().translate(5, 5);
		stack.packIntoBuffer(bufferData, 1.0, 100, 100, override);

		// Translation: (10, 20) + (5, 5) = (15, 25)
		expect(bufferData[8]).toBe(15);
		expect(bufferData[9]).toBe(25);
	});

	it("should destroy and reset to initial state", () => {
		const mat = new DOMMatrix().translate(10, 20);
		stack.push(mat);
		stack.destroy();

		const current = stack.getCurrent();
		expect(current.e).toBe(0);
	});
});
