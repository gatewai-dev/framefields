import { afterEach, describe, expect, it, vi } from "vitest";
import {
	availableCpus,
	cpuSessionThreads,
	createDefaultSessionProvider,
	requestedVisionBackend,
	setDefaultSessionProvider,
} from "./session-provider.js";

afterEach(() => {
	vi.unstubAllEnvs();
	setDefaultSessionProvider(undefined);
});

describe("session provider selection", () => {
	it("reads FRAMEFIELDS_VISION_PROVIDER, defaulting to auto", () => {
		expect(requestedVisionBackend()).toBe("auto");
		vi.stubEnv("FRAMEFIELDS_VISION_PROVIDER", " CUDA ");
		expect(requestedVisionBackend()).toBe("cuda");
		vi.stubEnv("FRAMEFIELDS_VISION_PROVIDER", "tpu");
		expect(requestedVisionBackend()).toBe("auto");
	});

	it("shares one default provider per process", () => {
		expect(createDefaultSessionProvider()).toBe(createDefaultSessionProvider());
	});
});

describe("CPU session threads", () => {
	it("honours FRAMEFIELDS_VISION_THREADS", async () => {
		vi.stubEnv("FRAMEFIELDS_VISION_THREADS", "3");
		expect(await cpuSessionThreads()).toBe(3);
	});

	it("never exceeds the CPUs the process may use", async () => {
		const cpus = await availableCpus();
		expect(cpus).toBeGreaterThanOrEqual(1);
		const threads = await cpuSessionThreads();
		if (process.platform === "linux") expect(threads).toBe(cpus);
		else expect(threads).toBeUndefined();
	});
});
