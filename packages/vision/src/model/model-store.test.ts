import { createHash } from "node:crypto";
import { existsSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VisionModelStore } from "./model-store.js";
import { VISION_MODELS } from "./registry.js";

describe("VisionModelStore (lazy download semantics)", () => {
	let dir: string;
	let fetches: Array<{ url: string }>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "vision-store-"));
		fetches = [];
	});

	afterEach(() => {
		fetches = [];
	});

	const store = () =>
		new VisionModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			verify: false,
			fetchImpl: (async (url: unknown) => {
				fetches.push({ url: String(url) });
				return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
			}) as typeof fetch,
			timeoutMs: 5000,
		});

	it("constructor performs ZERO I/O (no fetch, no status change)", () => {
		const s = store();
		expect(fetches).toHaveLength(0);
		expect(s.status("rtmdet-ins-s")).toBe("pending");
	});

	it("downloads only when ensure() is called, caches in flight, and persists", async () => {
		const s = store();
		const [a, b] = await Promise.all([
			s.ensure("rtmdet-ins-s"),
			s.ensure("rtmdet-ins-s"),
		]);
		expect(fetches).toHaveLength(1); // in-flight dedupe
		expect(a).toEqual(b);
		expect(s.status("rtmdet-ins-s")).toBe("ready");
		// second ensure hits the memory cache — no new fetch
		await s.ensure("rtmdet-ins-s");
		expect(fetches).toHaveLength(1);
		// file persisted for future processes
		expect(existsSync(s.pathFor("rtmdet-ins-s"))).toBe(true);
	});

	it("distinct models fetch independently from the mirror", async () => {
		const s = store();
		await s.ensure("rtmo-s");
		expect(fetches).toHaveLength(1);
		expect(fetches[0].url).toBe(
			`https://example.test/models/${VISION_MODELS["rtmo-s"].filename}`,
		);
		expect(s.status("rtmdet-ins-s")).toBe("pending");
		await s.ensure("rtmdet-ins-s");
		expect(fetches).toHaveLength(2);
	});

	it("uses the pinned Hugging Face URL when no mirror is set", () => {
		const s = new VisionModelStore({ modelsDir: dir });
		for (const desc of Object.values(VISION_MODELS)) {
			if (process.env.FRAMEFIELDS_MODELS_BASE_URL) break;
			expect(s.urlFor(desc.key)).toBe(desc.url);
			expect(desc.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
		}
	});

	it("preload() downloads only the requested keys", async () => {
		const s = store();
		await s.preload(["rtmdet-ins-s", "rtmo-s", "rtmo-s"]);
		expect(fetches).toHaveLength(2);
		expect(s.status("rtmo-s")).toBe("ready");
		expect(s.status("selfie-square")).toBe("pending");
	});

	it("rejects bytes whose size or SHA-256 does not match the registry", async () => {
		const s = new VisionModelStore({
			modelsDir: dir,
			fetchImpl: (async () =>
				new Response(new Uint8Array([1, 2, 3]))) as typeof fetch,
		});
		await expect(s.ensure("selfie-square")).rejects.toThrow(/bytes, expected/);
		expect(s.status("selfie-square")).toBe("error");
		expect(existsSync(s.pathFor("selfie-square"))).toBe(false);
	});

	it("re-downloads a partial cached file instead of trusting it", async () => {
		const desc = VISION_MODELS["selfie-square"];
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(join(dir, desc.filename), new Uint8Array(4096));
		const good = new Uint8Array(desc.bytes);
		const s = new VisionModelStore({
			modelsDir: dir,
			fetchImpl: (async () => new Response(good)) as typeof fetch,
		});
		expect(s.has("selfie-square")).toBe(false);
		// the fake bytes are the right size but the wrong hash → loud failure
		const digest = createHash("sha256").update(good).digest("hex");
		expect(digest).not.toBe(desc.sha256);
		await expect(s.ensure("selfie-square")).rejects.toThrow(/SHA-256/);
	});

	it("evict() drops the file and resets to pending so the next ensure re-downloads", async () => {
		const s = store();
		await s.ensure("rtmdet-ins-s");
		expect(existsSync(s.pathFor("rtmdet-ins-s"))).toBe(true);
		await s.evict("rtmdet-ins-s");
		expect(existsSync(s.pathFor("rtmdet-ins-s"))).toBe(false);
		expect(s.has("rtmdet-ins-s")).toBe(false);
		expect(s.status("rtmdet-ins-s")).toBe("pending");
		await s.ensure("rtmdet-ins-s");
		expect(fetches).toHaveLength(2); // re-downloaded, not served from memory
	});

	it("surfaces an error status and can retry after failure", async () => {
		let calls = 0;
		const s = new VisionModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			verify: false,
			fetchImpl: (async () => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return new Response(new Uint8Array([9, 9, 9]));
			}) as typeof fetch,
		});
		await expect(s.ensure("rtmdet-ins-s")).rejects.toThrow("boom");
		expect(s.status("rtmdet-ins-s")).toBe("error");
		expect(s.has("rtmdet-ins-s")).toBe(false);
		const bytes = await s.ensure("rtmdet-ins-s");
		expect([...bytes]).toEqual([9, 9, 9]);
		expect(s.status("rtmdet-ins-s")).toBe("ready");
	});

	it("retries transient network and 5xx failures, but not 4xx", async () => {
		let calls = 0;
		const flaky = new VisionModelStore({
			modelsDir: dir,
			verify: false,
			retryDelayMs: 1,
			fetchImpl: (async () => {
				calls += 1;
				if (calls === 1) throw new TypeError("fetch failed");
				if (calls === 2) return new Response("busy", { status: 503 });
				return new Response(new Uint8Array([7]));
			}) as typeof fetch,
		});
		expect([...(await flaky.ensure("rtmo-s"))]).toEqual([7]);
		expect(calls).toBe(3);

		calls = 0;
		const missing = new VisionModelStore({
			modelsDir: dir,
			verify: false,
			retryDelayMs: 1,
			fetchImpl: (async () => {
				calls += 1;
				return new Response("nope", { status: 404 });
			}) as typeof fetch,
		});
		await expect(missing.ensure("rtmo-t")).rejects.toThrow(/HTTP 404/);
		expect(calls).toBe(1);
	});

	it("gives up after the configured retries with the cause attached", async () => {
		const s = new VisionModelStore({
			modelsDir: dir,
			verify: false,
			retries: 1,
			retryDelayMs: 1,
			fetchImpl: (async () => {
				throw new TypeError("fetch failed");
			}) as typeof fetch,
		});
		await expect(s.ensure("rtmo-m")).rejects.toThrow(/after 2 attempts/);
	});

	it("treats a zero-length download as an error", async () => {
		const s = new VisionModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			verify: false,
			fetchImpl: (async () => new Response(new Uint8Array(0))) as typeof fetch,
		});
		await expect(s.ensure("rtmdet-ins-s")).rejects.toThrow(/empty/i);
		expect(s.status("rtmdet-ins-s")).toBe("error");
	});
});
