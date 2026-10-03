import { beforeEach, describe, expect, it } from "vitest";
import { ClipStack } from "./clip-stack.js";
import { createMockRenderPassEncoder } from "./test-helpers.js";

describe("ClipStack", () => {
	let stack: ClipStack;
	let mockPass: any;

	beforeEach(() => {
		stack = new ClipStack();
		mockPass = createMockRenderPassEncoder();
	});

	it("should return undefined for empty stack", () => {
		expect(stack.getCurrentScissor()).toBeUndefined();
		expect(stack.getCurrentStencil()).toBeUndefined();
	});

	it("should push and pop scissor rects", () => {
		const rect1 = { x: 10, y: 20, width: 30, height: 40 };
		const rect2 = { x: 50, y: 60, width: 70, height: 80 };

		stack.pushScissor(rect1);
		expect(stack.getCurrentScissor()).toBe(rect1);

		stack.pushScissor(rect2);
		expect(stack.getCurrentScissor()).toBe(rect2);

		stack.popScissor();
		expect(stack.getCurrentScissor()).toBe(rect1);

		stack.popScissor();
		expect(stack.getCurrentScissor()).toBeUndefined();

		// Safe popping from empty stack
		expect(() => stack.popScissor()).not.toThrow();
	});

	it("should push and pop stencil clip paths", () => {
		const path1 = { path: "M 0 0 L 10 10 Z" };
		const path2 = { path: "M 10 10 L 20 20 Z" };

		stack.pushStencilClip(path1);
		expect(stack.getCurrentStencil()).toBe(path1);

		stack.pushStencilClip(path2);
		expect(stack.getCurrentStencil()).toBe(path2);

		stack.popStencilClip();
		expect(stack.getCurrentStencil()).toBe(path1);

		stack.popStencilClip();
		expect(stack.getCurrentStencil()).toBeUndefined();

		// Safe popping from empty stack
		expect(() => stack.popStencilClip()).not.toThrow();
	});

	it("should apply full surface scissor when stack is empty", () => {
		stack.applyScissorToPass(mockPass, 800, 600);
		expect(mockPass.setScissorRect).toHaveBeenCalledWith(0, 0, 800, 600);
	});

	it("should clamp and apply scissor rect when stack has a rect", () => {
		stack.pushScissor({ x: 10.5, y: 20.3, width: 30.8, height: 40.2 });

		// x: max(0, floor(10.5)) = 10
		// y: max(0, floor(20.3)) = 20
		// right: min(800, ceil(10.5 + 30.8)) = min(800, 42) = 42
		// bottom: min(600, ceil(20.3 + 40.2)) = min(600, 61) = 61
		// width: right - x = 42 - 10 = 32
		// height: bottom - y = 61 - 20 = 41
		stack.applyScissorToPass(mockPass, 800, 600);
		expect(mockPass.setScissorRect).toHaveBeenCalledWith(10, 20, 32, 41);
	});

	it("should clamp to 1x1 rect if width or height is 0", () => {
		stack.pushScissor({ x: 10, y: 20, width: 0, height: 40 });
		stack.applyScissorToPass(mockPass, 800, 600);
		expect(mockPass.setScissorRect).toHaveBeenCalledWith(0, 0, 1, 1);
	});

	it("should clamp if scissor rect is outside the surface bounds", () => {
		stack.pushScissor({ x: 750, y: 550, width: 100, height: 100 });
		// x = 750, y = 550
		// right = min(800, 850) = 800
		// bottom = min(600, 650) = 600
		// width = 800 - 750 = 50
		// height = 600 - 550 = 50
		stack.applyScissorToPass(mockPass, 800, 600);
		expect(mockPass.setScissorRect).toHaveBeenCalledWith(750, 550, 50, 50);
	});

	it("should fallback to 1x1 if clamped dimensions are 0", () => {
		// Scissor is completely to the right of surface
		stack.pushScissor({ x: 900, y: 700, width: 50, height: 50 });
		stack.applyScissorToPass(mockPass, 800, 600);
		expect(mockPass.setScissorRect).toHaveBeenCalledWith(0, 0, 1, 1);
	});

	it("should clear stacks on destroy", () => {
		stack.pushScissor({ x: 0, y: 0, width: 10, height: 10 });
		stack.pushStencilClip({ path: "M 0 0 Z" });

		stack.destroy();

		expect(stack.getCurrentScissor()).toBeUndefined();
		expect(stack.getCurrentStencil()).toBeUndefined();
	});
});
