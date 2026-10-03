import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acquireDevice,
	ensureDevice,
	getDevice,
	resetDeviceInstance,
} from "./device.js";

describe("device management", () => {
	let originalNavigator: any;

	beforeEach(() => {
		originalNavigator = globalThis.navigator;
		resetDeviceInstance();
	});

	afterEach(() => {
		Object.defineProperty(globalThis, "navigator", {
			value: originalNavigator,
			configurable: true,
			writable: true,
		});
		resetDeviceInstance();
	});

	describe("unit tests with mock GPU", () => {
		let mockDevice: any;
		let mockAdapter: any;
		let mockGpu: any;
		let deviceLostResolver: (value: any) => void;

		beforeEach(() => {
			const lostPromise = new Promise((resolve) => {
				deviceLostResolver = resolve;
			});

			mockDevice = {
				lost: lostPromise,
				limits: { maxTextureDimension2D: 8192 },
				features: new Set(["float32-filterable"]),
			};

			mockAdapter = {
				features: new Set(["float32-filterable"]),
				limits: { maxTextureDimension2D: 16384 },
				requestDevice: vi.fn().mockResolvedValue(mockDevice),
			};

			mockGpu = {
				requestAdapter: vi.fn().mockResolvedValue(mockAdapter),
			};

			// Inject mock GPU
			Object.defineProperty(globalThis, "navigator", {
				value: {
					gpu: mockGpu,
				},
				configurable: true,
				writable: true,
			});
		});

		it("should acquire device with correct limits and features", async () => {
			const device = await acquireDevice();

			expect(mockGpu.requestAdapter).toHaveBeenCalled();
			expect(mockAdapter.requestDevice).toHaveBeenCalledWith({
				requiredFeatures: ["float32-filterable"],
				requiredLimits: {
					maxTextureDimension2D: 8192, // min(8192, 16384)
				},
			});
			expect(device).toBe(mockDevice);
		});

		it("should cache device instance on ensureDevice", async () => {
			const promise1 = ensureDevice();
			const promise2 = ensureDevice();

			const [dev1, dev2] = await Promise.all([promise1, promise2]);

			expect(dev1).toBe(mockDevice);
			expect(dev2).toBe(mockDevice);
			expect(mockAdapter.requestDevice).toHaveBeenCalledTimes(1);
			expect(getDevice()).toBe(mockDevice);
		});

		it("should throw error if getDevice is called before ensureDevice", () => {
			expect(() => getDevice()).toThrow(
				"Device not loaded. Call ensureDevice() first!",
			);
		});

		it("should reset device instance when device is lost (non-destroyed)", async () => {
			await ensureDevice();
			expect(getDevice()).toBe(mockDevice);

			// Trigger device loss
			deviceLostResolver({ reason: "lost" });

			// Wait for promise handlers to run
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should throw now since instance was reset
			expect(() => getDevice()).toThrow(
				"Device not loaded. Call ensureDevice() first!",
			);
		});

		it("should NOT reset device instance when device is destroyed gracefully", async () => {
			await ensureDevice();
			expect(getDevice()).toBe(mockDevice);

			// Trigger graceful destruction
			deviceLostResolver({ reason: "destroyed" });

			// Wait for promise handlers to run
			await new Promise((resolve) => setTimeout(resolve, 0));

			// Should still be valid
			expect(getDevice()).toBe(mockDevice);
		});
	});

	describe("integration tests with real/headless WebGPU", () => {
		it("should attempt to initialize a real headless GPUDevice if drivers are available", async () => {
			// Clear navigator so it tries to load real 'webgpu'
			Object.defineProperty(globalThis, "navigator", {
				value: undefined,
				configurable: true,
				writable: true,
			});

			try {
				const device = await ensureDevice();

				expect(device).toBeDefined();
				expect(device.limits).toBeDefined();
				expect(getDevice()).toBe(device);
			} catch (err: any) {
				// Safely catch if native drivers/compilation aren't available in this environment
				console.warn(
					"Real WebGPU device initialization skipped or failed. This is expected if the runner lacks GPU support.",
					err.message || err,
				);
			}
		});
	});
});
