import { existsSync, mkdtempSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { YoloModelStore } from "./model-store.js";
import { YOLO_MODELS } from "./registry.js";

describe("YoloModelStore (lazy download semantics)", () => {
	let dir: string;
	let fetches: Array<{ url: string }>;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "yolo-store-"));
		fetches = [];
	});

	afterEach(() => {
		fetches = [];
	});

	const store = () =>
		new YoloModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			fetchImpl: (async (url: unknown) => {
				fetches.push({ url: String(url) });
				return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
			}) as typeof fetch,
			timeoutMs: 5000,
		});

	it("constructor performs ZERO I/O (no fetch, no status change)", () => {
		const s = store();
		expect(fetches).toHaveLength(0);
		expect(s.status("yolo11n")).toBe("pending");
	});

	it("downloads only when ensure() is called, caches in flight, and maps downloads", async () => {
		const s = store();
		const [a, b] = await Promise.all([
			s.ensure("yolo11n"),
			s.ensure("yolo11n"),
		]);
		expect(fetches).toHaveLength(1); // in-flight dedupe
		expect(a).toEqual(b);
		expect(s.status("yolo11n")).toBe("ready");
		// second ensure hits the memory cache — no new fetch
		await s.ensure("yolo11n");
		expect(fetches).toHaveLength(1);
		// file persisted for future processes
		expect(existsSync(s.pathFor("yolo11n"))).toBe(true);
	});

	it("distinct tasks map to distinct models and fetch independently", async () => {
		const s = store();
		// only segment is fetched; detect stays pending
		await s.ensure("yolo11n-seg");
		expect(fetches).toHaveLength(1);
		expect(fetches[0].url).toContain(YOLO_MODELS["yolo11n-seg"].filename);
		expect(s.status("yolo11n")).toBe("pending");
		await s.ensure("yolo11n");
		expect(fetches).toHaveLength(2);
		expect(s.status("yolo11n")).toBe("ready");
	});

	it("preload() downloads only the requested keys", async () => {
		const s = store();
		await s.preload(["yolo11n", "yolo11n-pose"]);
		expect(fetches).toHaveLength(2);
		expect(s.status("yolo11n-pose")).toBe("ready");
		expect(s.status("yolo11n-seg")).toBe("pending");
	});

	it("re-downloads a stub/partial cached file instead of trusting it", async () => {
		// a 4 KiB orphan (e.g. a test fixture or interrupted write) is below the
		// validity floor — has() must be false and ensure() must re-fetch
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(join(dir, "yolo11n.onnx"), new Uint8Array(4096));
		const s = store();
		expect(s.has("yolo11n")).toBe(false);
		await s.ensure("yolo11n");
		expect(fetches).toHaveLength(1);
		expect(s.status("yolo11n")).toBe("ready");
	});

	it("evict() drops the file and resets to pending so the next ensure re-downloads", async () => {
		const s = store();
		await s.ensure("yolo11n");
		expect(existsSync(s.pathFor("yolo11n"))).toBe(true);
		await s.evict("yolo11n");
		expect(existsSync(s.pathFor("yolo11n"))).toBe(false);
		expect(s.has("yolo11n")).toBe(false);
		expect(s.status("yolo11n")).toBe("pending");
		await s.ensure("yolo11n");
		expect(fetches).toHaveLength(2); // re-downloaded, not served from memory
	});

	it("surfaces an error status and can retry after failure", async () => {
		let calls = 0;
		const s = new YoloModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			fetchImpl: (async () => {
				calls += 1;
				if (calls === 1) throw new Error("boom");
				return new Response(new Uint8Array([9, 9, 9]));
			}) as typeof fetch,
		});
		await expect(s.ensure("yolo11n")).rejects.toThrow("boom");
		expect(s.status("yolo11n")).toBe("error");
		expect(s.has("yolo11n")).toBe(false);
		const bytes = await s.ensure("yolo11n");
		expect([...bytes]).toEqual([9, 9, 9]);
		expect(s.status("yolo11n")).toBe("ready");
	});

	it("does not re-download a corrupt/empty (zero-length) file — treats as error", async () => {
		const s = new YoloModelStore({
			modelsDir: dir,
			baseUrl: "https://example.test/models",
			fetchImpl: (async () => new Response(new Uint8Array(0))) as typeof fetch,
		});
		await expect(s.ensure("yolo11n")).rejects.toThrow(/empty/i);
		expect(s.status("yolo11n")).toBe("error");
	});
});
