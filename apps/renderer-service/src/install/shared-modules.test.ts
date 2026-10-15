import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	expectedInstallSize,
	manifestPath,
	readManifests,
	recordInstallSize,
	releaseKeys,
	removeModules,
	shareModules,
	sweepStore,
} from "./shared-modules.js";

let tmp: string;
let store: string;

beforeAll(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ff-shared-"));
	store = path.join(tmp, "work/store/v1");
});
afterAll(async () => {
	// Shared files are read-only; their dirs aren't, so rm still works.
	await fs.rm(tmp, { recursive: true, force: true });
});

const BIG = Buffer.alloc(2 * 1024 * 1024, 7);

/** A workspace slot as an install leaves it. */
async function slot(repo: string, extra: Record<string, string | Buffer> = {}) {
	const root = path.join(tmp, "work/ws", repo, "0");
	const files: Record<string, string | Buffer> = {
		"src/film.ts": "export {}",
		"node_modules/framefields/dist/index.mjs": "export const v = 1;",
		"node_modules/framefields/package.json": '{"name":"framefields"}',
		"node_modules/webgpu/dawn.node": BIG,
		"node_modules/.bin/tool.js": "#!/usr/bin/env node",
		"node_modules/empty.js": "",
		"packages/app/node_modules/left-pad/index.js": "module.exports = 1;",
		...extra,
	};
	for (const [rel, content] of Object.entries(files)) {
		const p = path.join(root, rel);
		await fs.mkdir(path.dirname(p), { recursive: true });
		await fs.writeFile(p, content);
	}
	await fs.chmod(path.join(root, "node_modules/.bin/tool.js"), 0o755);
	await fs.symlink(
		"../framefields/dist/index.mjs",
		path.join(root, "node_modules/.bin/framefields"),
	);
	return root;
}

const ino = async (p: string) => (await fs.lstat(p)).ino;

describe("shareModules", () => {
	let a: string;
	let b: string;

	it("stores the first project's files once", async () => {
		a = await slot("repo-a");
		const result = await shareModules(a, store);
		expect(result.skipped).toBeUndefined();
		expect(result.files).toBe(5); // the empty file and the symlink are left alone
		expect(result.linked).toBe(0);
		const manifest = (await fs.readFile(manifestPath(a), "utf8")).split("\n");
		expect(manifest).toHaveLength(5);
		expect(manifest.filter((k) => k.endsWith("x"))).toHaveLength(1);
	});

	it("links a second project's identical files to the same copy", async () => {
		b = await slot("repo-b", { "node_modules/only-b.js": "b" });
		const result = await shareModules(b, store);
		expect(result.linked).toBe(5);
		expect(result.savedBytes).toBeGreaterThanOrEqual(BIG.length);

		for (const rel of [
			"node_modules/webgpu/dawn.node",
			"node_modules/framefields/dist/index.mjs",
			"packages/app/node_modules/left-pad/index.js",
		]) {
			expect(await ino(path.join(b, rel))).toBe(await ino(path.join(a, rel)));
		}
		const dawn = await fs.stat(path.join(b, "node_modules/webgpu/dawn.node"));
		expect(dawn.nlink).toBe(3); // a, b and the store
		expect(dawn.mode & 0o222).toBe(0); // read-only
		const tool = await fs.stat(path.join(b, "node_modules/.bin/tool.js"));
		expect(tool.mode & 0o111).not.toBe(0); // still executable

		// Project sources and symlinks are untouched.
		expect((await fs.stat(path.join(b, "src/film.ts"))).nlink).toBe(1);
		expect(
			(
				await fs.lstat(path.join(b, "node_modules/.bin/framefields"))
			).isSymbolicLink(),
		).toBe(true);
		expect(
			await fs.readFile(path.join(b, "node_modules/only-b.js"), "utf8"),
		).toBe("b");
	});

	it("is a no-op on files that are already shared", async () => {
		const again = await shareModules(b, store);
		expect(again.linked).toBe(0);
		expect(again.files).toBe(6);
	});

	it("refuses in-place writes to shared files", async () => {
		await expect(
			fs.writeFile(path.join(a, "node_modules/framefields/package.json"), "{}"),
		).rejects.toMatchObject({ code: "EACCES" });
	});

	it("drops store files once no workspace links them", async () => {
		// b reinstalls with a different framefields build.
		await removeModules(b);
		await fs.mkdir(path.join(b, "node_modules/framefields/dist"), {
			recursive: true,
		});
		await fs.writeFile(
			path.join(b, "node_modules/framefields/dist/index.mjs"),
			"export const v = 2;",
		);
		await shareModules(b, store);
		expect(await fs.readdir(path.join(b, "packages/app"))).toEqual([]);

		// The store holds exactly what a and b still link: only-b.js was
		// released; the old framefields build stays because a links it.
		const keysA = await readManifests(path.dirname(a));
		const keysB = await readManifests(path.dirname(b));
		const storeFiles = async () =>
			(await fs.readdir(store, { recursive: true })).filter(
				(f) => f.length > 3,
			);
		expect((await storeFiles()).length).toBe(
			new Set([...keysA, ...keysB]).size,
		);

		// Evicting a: its files used by nobody else go too.
		await fs.rm(path.dirname(a), { recursive: true, force: true });
		await releaseKeys(store, keysA);
		expect((await storeFiles()).length).toBe(keysB.size);
		await expect(
			fs.stat(path.join(b, "node_modules/framefields/dist/index.mjs")),
		).resolves.toBeTruthy();
	});

	it("sweeps store files nothing links to", async () => {
		await fs.rm(path.dirname(b), { recursive: true, force: true });
		const freed = await sweepStore(store);
		expect(freed).toBeGreaterThan(0);
		const left = (await fs.readdir(store, { recursive: true })).filter(
			(f) => f.length > 3,
		);
		expect(left).toEqual([]);
	});
});

describe("install sizes", () => {
	it("expects this lockfile's last size, else the largest seen", async () => {
		const work = path.join(tmp, "sizes");
		expect(await expectedInstallSize(work, "x")).toBe(0);
		await recordInstallSize(work, "lock-a", 800);
		await recordInstallSize(work, "lock-b", 300);
		expect(await expectedInstallSize(work, "lock-b")).toBe(300);
		expect(await expectedInstallSize(work, "lock-new")).toBe(800);
		await recordInstallSize(work, "lock-a", 500);
		expect(await expectedInstallSize(work, "lock-a")).toBe(500);
	});
});
