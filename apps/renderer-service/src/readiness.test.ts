import { describe, expect, it } from "vitest";
import { ReadinessTracker } from "./readiness.js";

describe("ReadinessTracker", () => {
	it("is ready once tools are present, before any engine is bound", () => {
		const tracker = new ReadinessTracker();
		expect(tracker.isReady).toBe(false);
		tracker.setToolsReady(true);
		expect(tracker.status).toMatchObject({
			ready: true,
			components: { tools: true, engine: null, gpu: { adapter: null } },
		});
		tracker.setEngine("2.1.3");
		expect(tracker.status.components.engine).toBe("2.1.3");
	});

	it("reports failures and stops being ready", () => {
		const tracker = new ReadinessTracker();
		tracker.setToolsReady(true);
		tracker.setFailure("TOOL_MISSING: git-lfs");
		expect(tracker.isReady).toBe(false);
		expect(tracker.status.error).toBe("TOOL_MISSING: git-lfs");
	});
});
