import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testConfig } from "../test-helpers.js";
import { CacheJanitor, dirSize, LAST_USED } from "./janitor.js";

const MB = 1024 * 1024;
let tmp: string;

beforeAll(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ff-janitor-"));
});
afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
});

async function blob(p: string, mb: number, ageMin = 0) {
	await fs.mkdir(path.dirname(p), { recursive: true });
	await fs.writeFile(p, Buffer.alloc(mb * MB));
	const t = new Date(Date.now() - ageMin * 60_000);
	await fs.utimes(p, t, t);
}

/** Limits are whole GB, so tests scale sizes via a fractional limit hack: 1 GB = 1024 MB. */
function janitor(root: string, env: Record<string, string>) {
	const config = testConfig({
		FF_WORK_DIR: path.join(root, "work"),
		FF_CACHE_DIR: path.join(root, "cache"),
		...env,
	});
	return { j: new CacheJanitor(config, "me", 0), config };
}

describe("CacheJanitor", () => {
	it("evicts least-recently-used workspaces, sparing the protected one", async () => {
		const root = path.join(tmp, "ws-case");
		const ws = path.join(root, "work/ws");
		await blob(path.join(ws, "old/0/big.bin"), 600);
		await blob(path.join(ws, "old", LAST_USED), 0, 120);
		await blob(path.join(ws, "mid/0/big.bin"), 300);
		await blob(path.join(ws, "mid", LAST_USED), 0, 60);
		await blob(path.join(ws, "protected/0/big.bin"), 600);
		await blob(path.join(ws, "protected", LAST_USED), 0, 500);
		const { j } = janitor(root, { FF_WORK_MAX_GB: "1", FF_CACHE_MAX_GB: "0" });

		const removed = await j.enforce(["protected"]);
		expect(removed.map((p) => path.basename(p))).toEqual(["old"]);
		expect(await dirSize(ws)).toBeLessThanOrEqual(1024 * MB);
	});

	it("evicts LFS objects before mirrors, and leaves other workers' busy mirrors", async () => {
		const root = path.join(tmp, "cache-case");
		const cache = path.join(root, "cache");
		await blob(path.join(cache, "lfs/objects/aa/bb/old-oid"), 500, 300);
		await blob(path.join(cache, "lfs/objects/cc/dd/new-oid"), 100, 1);
		await blob(path.join(cache, "git/me/repo1.git/pack.bin"), 300);
		await blob(path.join(cache, "git/me/repo1.git", LAST_USED), 0, 200);
		await blob(path.join(cache, "git/other/repo2.git/pack.bin"), 300);
		await blob(path.join(cache, "git/other/repo2.git", LAST_USED), 0, 5);
		await blob(path.join(cache, "models/vision.onnx"), 100);
		const { j } = janitor(root, { FF_CACHE_MAX_GB: "1", FF_WORK_MAX_GB: "0" });

		// 1300 MB total, limit 1024: the old LFS object (500) alone is enough.
		const removed = await j.enforce([]);
		expect(removed.map((p) => path.basename(p))).toEqual(["old-oid"]);

		// Over again: the oldest LFS object covers it on its own.
		await blob(path.join(cache, "lfs/objects/ee/ff/more"), 700, 2);
		expect((await j.enforce([])).map((p) => path.basename(p))).toEqual([
			"more",
		]);

		// Far over: LFS first, then our own idle mirror, then the package store.
		// The other worker's recently used mirror and the models stay.
		await blob(path.join(cache, "pnpm-store/v10/blob"), 1200);
		const again = await j.enforce([]);
		expect(again.map((p) => path.basename(p))).toEqual([
			"new-oid",
			"repo1.git",
			"pnpm-store",
		]);
		await expect(
			fs.stat(path.join(cache, "git/other/repo2.git")),
		).resolves.toBeTruthy();
		await expect(
			fs.stat(path.join(cache, "models/vision.onnx")),
		).resolves.toBeTruthy();
	});

	it("drops failed-job dirs older than a day", async () => {
		const root = path.join(tmp, "jobs-case");
		const old = path.join(root, "work/jobs/old-job");
		await blob(path.join(old, "out/x.mp4"), 1);
		const t = new Date(Date.now() - 2 * 24 * 3600_000);
		await fs.utimes(old, t, t);
		await blob(path.join(root, "work/jobs/new-job/out/x.mp4"), 1);
		const { j } = janitor(root, {});
		const removed = await j.enforce([]);
		expect(removed.map((p) => path.basename(p))).toEqual(["old-job"]);
	});
});
