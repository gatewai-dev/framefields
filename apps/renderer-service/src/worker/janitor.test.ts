import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { moduleStoreDir, shareModules } from "../install/shared-modules.js";
import { testConfig } from "../test-helpers.js";
import { CacheJanitor, type DiskProbe, LAST_USED, usage } from "./janitor.js";

/** Test sizes are in "MB" of 64 KiB, so the scenarios stay fast. */
const MB = 64 * 1024;
let fill = 0;
let tmp: string;

beforeAll(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ff-janitor-"));
});
afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
});

async function blob(p: string, mb: number, ageMin = 0, byte?: number) {
	await fs.mkdir(path.dirname(p), { recursive: true });
	// Distinct contents, unless deliberately shared via hard links.
	await fs.writeFile(p, Buffer.alloc(mb * MB, byte ?? ++fill % 256));
	const t = new Date(Date.now() - ageMin * 60_000);
	await fs.utimes(p, t, t);
}

/**
 * Fake disks of `capacityMb`: free space is the capacity minus what is
 * actually stored under the dirs on that disk (hard links count once).
 */
function fakeDisks(
	root: string,
	capacityMb: number,
	sameDisk = true,
): DiskProbe {
	return async (dir) => {
		const work = path.join(root, "work");
		const cache = path.join(root, "cache");
		const onWork = dir.startsWith(work);
		const dirs = sameDisk ? [work, cache] : [onWork ? work : cache];
		return {
			id: sameDisk || onWork ? "work" : "cache",
			totalBytes: capacityMb * MB,
			freeBytes: capacityMb * MB - (await usage(dirs)),
		};
	};
}

function janitor(
	root: string,
	disk: DiskProbe,
	env: Record<string, string> = {},
	intervalMs = 0,
	alwaysProtect: () => string[] = () => [],
) {
	const config = testConfig({
		FF_WORK_DIR: path.join(root, "work"),
		FF_CACHE_DIR: path.join(root, "cache"),
		// 15% free triggers eviction, which then frees up to 25%.
		FF_DISK_MIN_FREE_GB: "0",
		...env,
	});
	return new CacheJanitor(config, "me", intervalMs, disk, alwaysProtect);
}

const names = (paths: string[]) => paths.map((p) => path.basename(p));

describe("CacheJanitor (free space)", () => {
	it("leaves everything while the disk has room", async () => {
		const root = path.join(tmp, "roomy");
		await blob(path.join(root, "work/ws/old/0/big.bin"), 600, 120);
		const j = janitor(root, fakeDisks(root, 4000));
		expect(await j.enforce([])).toEqual([]);
	});

	it("evicts least-recently-used workspaces until the target is free", async () => {
		const root = path.join(tmp, "ws-case");
		const ws = path.join(root, "work/ws");
		await blob(path.join(ws, "old/0/big.bin"), 600);
		await blob(path.join(ws, "old", LAST_USED), 0, 120);
		await blob(path.join(ws, "mid/0/big.bin"), 300);
		await blob(path.join(ws, "mid", LAST_USED), 0, 60);
		await blob(path.join(ws, "protected/0/big.bin"), 600);
		await blob(path.join(ws, "protected", LAST_USED), 0, 500);

		// 1700 MB disk, 1500 used: 200 free < 255 (15%); target 425.
		// Removing "old" (the least recently used) leaves 800 free.
		const j = janitor(root, fakeDisks(root, 1700));
		expect(names(await j.enforce(["protected"]))).toEqual(["old"]);
	});

	it("frees shared module files only when their last workspace goes", async () => {
		const root = path.join(tmp, "shared-case");
		const store = moduleStoreDir(path.join(root, "work"));
		const slot = async (repo: string, ageMin: number) => {
			const dir = path.join(root, "work/ws", repo);
			await blob(path.join(dir, "0/node_modules/webgpu/dawn.node"), 400, 0, 7);
			await blob(path.join(dir, "0/node_modules", `${repo}.js`), 100);
			await shareModules(path.join(dir, "0"), store);
			await blob(path.join(dir, LAST_USED), 0, ageMin);
		};
		await slot("a", 60);
		await slot("b", 30);
		await slot("c", 1);
		// Stored once: 400 shared + 3 × 100 own = 700 MB.
		const used = async () =>
			Math.round((await usage([path.join(root, "work")])) / MB);
		expect(await used()).toBe(700);

		// 810 MB disk: 110 free < 121 (15%); target 202. Removing "a" frees
		// only its own 100 MB (b and c still link dawn.node): 210 free.
		const j = janitor(root, fakeDisks(root, 810));
		expect(names(await j.enforce(["c"]))).toEqual(["a"]);
		expect(await used()).toBe(600);

		// Tighter disk: b goes too, but dawn.node stays for c.
		const tight = janitor(root, fakeDisks(root, 650));
		expect(names(await tight.enforce(["c"]))).toEqual(["b"]);
		await expect(
			fs.stat(path.join(root, "work/ws/c/0/node_modules/webgpu/dawn.node")),
		).resolves.toBeTruthy();
		expect(await used()).toBe(500);
	});

	it("on a separate cache disk: LFS objects, then mirrors, then package caches", async () => {
		const root = path.join(tmp, "cache-case");
		const cache = path.join(root, "cache");
		await blob(path.join(cache, "lfs/objects/aa/bb/old-oid"), 500, 300);
		await blob(path.join(cache, "lfs/objects/cc/dd/new-oid"), 100, 1);
		await blob(path.join(cache, "git/me/repo1.git/pack.bin"), 300);
		await blob(path.join(cache, "git/me/repo1.git", LAST_USED), 0, 200);
		await blob(path.join(cache, "git/other/repo2.git/pack.bin"), 300);
		await blob(path.join(cache, "git/other/repo2.git", LAST_USED), 0, 5);
		await blob(path.join(cache, "models/vision.onnx"), 100);
		// A full work disk is not the cache disk's problem.
		await blob(path.join(root, "work/ws/x/0/big.bin"), 10);
		const disk = fakeDisks(root, 1500, false);
		const j = janitor(root, disk);

		// 1300 used of 1500: 200 free < 225. The oldest LFS object suffices.
		expect(names(await j.enforce([]))).toEqual(["old-oid"]);

		await blob(path.join(cache, "lfs/objects/ee/ff/more"), 700, 2);
		expect(names(await j.enforce([]))).toEqual(["more"]);

		// Far over: LFS first, then our own idle mirror, then the package store.
		// The other worker's recently used mirror and the models stay.
		await blob(path.join(cache, "pnpm-store/v10/blob"), 1200);
		expect(names(await j.enforce([]))).toEqual([
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
		await expect(
			fs.stat(path.join(root, "work/ws/x/0/big.bin")),
		).resolves.toBeTruthy();
	});

	it("never evicts the workspace the engine was loaded from", async () => {
		const root = path.join(tmp, "engine");
		await blob(path.join(root, "work/ws/engine/0/big.bin"), 500);
		await blob(path.join(root, "work/ws/engine", LAST_USED), 0, 500);
		await blob(path.join(root, "work/ws/other/0/big.bin"), 100);
		const j = janitor(root, fakeDisks(root, 650), {}, 0, () => ["engine"]);
		// Low on space, but the oldest workspace holds the engine.
		expect(names(await j.enforce([]))).toEqual(["other"]);
	});

	it("on one shared disk, evicts workspaces before caches", async () => {
		const root = path.join(tmp, "one-disk");
		await blob(path.join(root, "cache/lfs/objects/aa/bb/oid"), 300, 500);
		await blob(path.join(root, "work/ws/r/0/big.bin"), 300);
		await blob(path.join(root, "work/ws/r", LAST_USED), 0, 1);
		const j = janitor(root, fakeDisks(root, 650));
		// 50 free < 97; target 162: the workspace goes, the LFS object stays.
		expect(names(await j.enforce([]))).toEqual(["r"]);
	});

	it("makes extra room for a download that is about to start", async () => {
		const root = path.join(tmp, "extra");
		await blob(path.join(root, "cache/lfs/objects/aa/bb/oid"), 300, 500);
		const j = janitor(root, fakeDisks(root, 2000));
		expect(await j.enforce([])).toEqual([]);
		// 1700 free, but 1600 more are needed on top of the 300 floor.
		expect(names(await j.enforce([], 1600 * MB))).toEqual(["oid"]);
	});

	it("runs between intervals as soon as a disk runs low", async () => {
		const root = path.join(tmp, "interval");
		let capacity = 4000;
		const disk: DiskProbe = (dir) => fakeDisks(root, capacity)(dir);
		await blob(path.join(root, "work/ws/r/0/big.bin"), 500);
		const j = janitor(root, disk, {}, 60 * 60 * 1000);
		await j.maybeRun([]); // first run: nothing to do
		capacity = 550;
		await j.maybeRun([]);
		await expect(fs.stat(path.join(root, "work/ws/r"))).rejects.toThrow();
	});

	it("still honours optional size caps", async () => {
		const root = path.join(tmp, "caps");
		// Caps are whole GB: sparse files report real sizes without the writes.
		const sparse = async (p: string, bytes: number) => {
			await fs.mkdir(path.dirname(p), { recursive: true });
			await fs.writeFile(p, "");
			await fs.truncate(p, bytes);
		};
		await sparse(path.join(root, "work/ws/a/0/big.bin"), 700 * 1024 ** 2);
		await blob(path.join(root, "work/ws/a", LAST_USED), 0, 60);
		await sparse(path.join(root, "work/ws/b/0/big.bin"), 700 * 1024 ** 2);
		const j = janitor(root, fakeDisks(root, 100_000), { FF_WORK_MAX_GB: "1" });
		expect(names(await j.enforce([]))).toEqual(["a"]);
	});

	it("reports disks for /health from a background snapshot", async () => {
		const root = path.join(tmp, "health");
		await blob(path.join(root, "work/ws/r/0/big.bin"), 900);
		const j = janitor(root, fakeDisks(root, 1000));
		expect(j.disks()).toBeUndefined(); // first call starts the measurement
		await j.describeDisks();
		expect(j.disks()).toMatchObject({
			work: { lowOnSpace: true, path: path.join(root, "work") },
			cache: { sameDiskAs: "work" },
		});
	});

	it("drops failed-job dirs older than a day", async () => {
		const root = path.join(tmp, "jobs-case");
		const old = path.join(root, "work/jobs/old-job");
		await blob(path.join(old, "out/x.mp4"), 1);
		const t = new Date(Date.now() - 2 * 24 * 3600_000);
		await fs.utimes(old, t, t);
		await blob(path.join(root, "work/jobs/new-job/out/x.mp4"), 1);
		const j = janitor(root, fakeDisks(root, 100_000));
		expect(names(await j.enforce([]))).toEqual(["old-job"]);
	});
});
