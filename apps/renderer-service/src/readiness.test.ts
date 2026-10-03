import { describe, expect, it } from "vitest";
import { ReadinessTracker } from "./readiness.js";

describe("ReadinessTracker", () => {
	it("should initialize as not ready", () => {
		const tracker = new ReadinessTracker();
		expect(tracker.isReady).toBe(false);
		expect(tracker.status).toEqual({
			ready: false,
			components: {
				gpu: false,
				renderer: false,
			},
		});
	});

	it("should transition to ready when all components are set to true", () => {
		const tracker = new ReadinessTracker();

		tracker.setGpuReady(true);
		expect(tracker.isReady).toBe(false);

		tracker.setRendererReady(true);
		expect(tracker.isReady).toBe(true);

		expect(tracker.status).toEqual({
			ready: true,
			components: {
				gpu: true,
				renderer: true,
			},
		});
	});

	it("should include failure reason when set", () => {
		const tracker = new ReadinessTracker();
		tracker.setFailure("GPU initialization timed out");

		expect(tracker.isReady).toBe(false);
		expect(tracker.status).toEqual({
			ready: false,
			components: {
				gpu: false,
				renderer: false,
			},
			error: "GPU initialization timed out",
		});
	});
});
