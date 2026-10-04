import { describe, expect, it, vi } from "vitest";
import { withTempTexture } from "./utils.js";

describe("utils", () => {
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
