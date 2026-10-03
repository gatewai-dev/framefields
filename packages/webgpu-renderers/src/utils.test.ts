import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock React
vi.mock("react", () => {
	return {
		useMemo: vi.fn().mockImplementation((fn) => fn()),
	};
});

import { hasDelayRender, withTempTexture } from "./utils.js";

describe("utils", () => {
	describe("hasDelayRender", () => {
		beforeEach(() => {
			if (typeof globalThis !== "undefined") {
				globalThis.__GATEWAI_DELAYS__ = new Set();
			}
		});

		it("should return an object with delayRender and continueRender", () => {
			const result = hasDelayRender();
			expect(result).not.toBeNull();
			expect(result).toHaveProperty("delayRender");
			expect(result).toHaveProperty("continueRender");
		});

		it("should track delays in globalThis.__GATEWAI_DELAYS__", () => {
			const result = hasDelayRender();
			expect(result).not.toBeNull();
			if (!result) return;

			const handle1 = result.delayRender("First render delay");
			expect(handle1).toBe(0);
			expect(globalThis.__GATEWAI_DELAYS__.has(handle1)).toBe(true);

			const handle2 = result.delayRender("Second render delay");
			expect(handle2).toBe(1);
			expect(globalThis.__GATEWAI_DELAYS__.has(handle2)).toBe(true);

			// Continue first render
			result.continueRender(handle1);
			expect(globalThis.__GATEWAI_DELAYS__.has(handle1)).toBe(false);
			expect(globalThis.__GATEWAI_DELAYS__.has(handle2)).toBe(true);

			// Continue second render
			result.continueRender(handle2);
			expect(globalThis.__GATEWAI_DELAYS__.has(handle2)).toBe(false);
		});
	});

	describe("withTempTexture", () => {
		it("should create, execute callback with texture, and destroy texture", () => {
			const mockTexture = {
				destroy: vi.fn(),
			};
			const mockDevice = {
				createTexture: vi.fn().mockReturnValue(mockTexture),
			};
			const desc: any = { size: [10, 10], format: "rgba8unorm" };

			const callback = vi.fn().mockReturnValue("callback-result");

			const result = withTempTexture(mockDevice as any, desc, callback);

			expect(mockDevice.createTexture).toHaveBeenCalledWith(desc);
			expect(callback).toHaveBeenCalledWith(mockTexture);
			expect(mockTexture.destroy).toHaveBeenCalledTimes(1);
			expect(result).toBe("callback-result");
		});

		it("should destroy texture even if the callback throws an error", () => {
			const mockTexture = {
				destroy: vi.fn(),
			};
			const mockDevice = {
				createTexture: vi.fn().mockReturnValue(mockTexture),
			};
			const desc: any = { size: [10, 10], format: "rgba8unorm" };

			const callback = vi.fn().mockImplementation(() => {
				throw new Error("Callback failed");
			});

			expect(() => {
				withTempTexture(mockDevice as any, desc, callback);
			}).toThrow("Callback failed");

			expect(mockDevice.createTexture).toHaveBeenCalledWith(desc);
			expect(callback).toHaveBeenCalledWith(mockTexture);
			expect(mockTexture.destroy).toHaveBeenCalledTimes(1);
		});
	});
});
