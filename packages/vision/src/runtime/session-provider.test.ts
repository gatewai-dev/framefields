import { afterEach, describe, expect, it, vi } from "vitest";
import {
	AutoSessionProvider,
	availableCpus,
	cpuSessionThreads,
	createDefaultSessionProvider,
	requestedVisionBackend,
	setDefaultSessionProvider,
	VISION_BACKEND_LISTENER,
	type VisionBackendInfo,
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

	it("reports the backend it picks to a registered listener", async () => {
		const reports: VisionBackendInfo[] = [];
		const g = globalThis as Record<symbol, unknown>;
		g[VISION_BACKEND_LISTENER] = (info: VisionBackendInfo) =>
			reports.push(info);
		try {
			vi.stubEnv("FRAMEFIELDS_VISION_PROVIDER", "cpu");
			// Not a model: the session fails, but the backend is decided first.
			await expect(
				new AutoSessionProvider().createSession(new Uint8Array([1, 2, 3])),
			).rejects.toThrow();
			expect(reports).toEqual([
				{
					backend: "cpu",
					sharedDevice: false,
					reason: "FRAMEFIELDS_VISION_PROVIDER=cpu",
				},
			]);
		} finally {
			delete g[VISION_BACKEND_LISTENER];
		}
	});

	it("knows its backend before the first real session, then keeps it", async () => {
		vi.stubEnv("FRAMEFIELDS_VISION_PROVIDER", "cpu");
		const provider = new AutoSessionProvider();
		expect(await provider.backend()).toBe("cpu");
		expect(provider.kind).toBe("node");
		vi.stubEnv("FRAMEFIELDS_VISION_PROVIDER", "webgpu");
		expect(await provider.backend()).toBe("cpu");
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
