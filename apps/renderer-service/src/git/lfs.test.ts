import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import type { StepContext } from "../jobs/pipeline.js";
import { validateJob } from "../jobs/validate.js";
import { testConfig, testJob } from "../test-helpers.js";
import { checkout } from "./checkout.js";

/**
 * End to end with real git-lfs: origin repos with LFS-tracked assets, served
 * over file:// (git-lfs's standalone transfer), checked out the way a job is.
 */
const hasLfs = (() => {
	try {
		execFileSync("git", ["lfs", "version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

let tmp: string;
const assets: Record<string, Buffer> = {
	"video/assets/hero.mp4": randomBytes(300 * 1024),
	"video/assets/music.bin": randomBytes(120 * 1024),
	"other/huge.bin": randomBytes(200 * 1024),
};

const gitEnv = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
};
const sh = (cwd: string, args: string[]) =>
	execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

/** A repo whose assets are committed as LFS pointers, objects in its .git/lfs. */
async function lfsOrigin(name: string): Promise<string> {
	const dir = path.join(tmp, name);
	await fs.mkdir(dir, { recursive: true });
	sh(dir, ["init", "--quiet", "--initial-branch=main"]);
	sh(dir, ["lfs", "install", "--local"]);
	await fs.writeFile(
		path.join(dir, ".gitattributes"),
		"*.mp4 filter=lfs diff=lfs merge=lfs -text\n*.bin filter=lfs diff=lfs merge=lfs -text\n",
	);
	await fs.mkdir(path.join(dir, "video/src"), { recursive: true });
	await fs.writeFile(path.join(dir, "video/package.json"), '{"name":"v"}');
	await fs.writeFile(path.join(dir, "video/src/film.ts"), "export {}\n");
	for (const [rel, content] of Object.entries(assets)) {
		await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
		await fs.writeFile(path.join(dir, rel), content);
	}
	sh(dir, ["add", "-A"]);
	sh(dir, ["commit", "--quiet", "-m", "assets"]);
	// Committed as pointers, not the bytes.
	const blob = sh(dir, ["show", "HEAD:video/assets/hero.mp4"]);
	if (!blob.startsWith("version https://git-lfs")) {
		throw new Error("fixture: LFS clean filter did not run");
	}
	return dir;
}

function setup(repo: string, lfs: Record<string, unknown> = {}) {
	const config = testConfig({
		FF_ALLOW_LOCAL_REPOS: "true",
		FF_CACHE_DIR: path.join(tmp, "cache"),
		FF_WORK_DIR: path.join(tmp, "work"),
	});
	const job = validateJob(
		testJob({
			source: { repo: `file://${repo}`, ref: "main", workdir: "video", lfs },
		}),
		config,
	);
	const warnings: string[] = [];
	const ctx: StepContext = {
		jobId: "lfs-test",
		config,
		signal: new AbortController().signal,
		jobDir: path.join(tmp, "job"),
		progress: () => {},
		warn: (code) => warnings.push(code),
	};
	return { job, ctx, warnings };
}

const isPointer = async (file: string) =>
	(await fs.readFile(file, "utf8").catch(() => "")).startsWith(
		"version https://git-lfs.github.com/spec/v1",
	);

describe.skipIf(!hasLfs)("LFS (real git-lfs, file:// remotes)", () => {
	let origin: string;

	beforeAll(async () => {
		tmp = await fs.realpath(
			await fs.mkdtemp(path.join(os.tmpdir(), "ff-lfs-test-")),
		);
		origin = await lfsOrigin("origin");
	});
	afterAll(async () => {
		await fs.rm(tmp, { recursive: true, force: true });
	});

	it("downloads the assets into the checkout (cold)", async () => {
		const { job, ctx, warnings } = setup(origin);
		const result = await checkout(job, ctx);
		expect(result.cache.lfs).toBe("miss");
		for (const [rel, content] of Object.entries(assets)) {
			expect(await fs.readFile(path.join(result.root, rel))).toEqual(content);
		}
		expect(warnings).toEqual([]);
		// Objects land in the shared store on the cache volume.
		const objects = await fs.readdir(path.join(tmp, "cache/lfs/objects"), {
			recursive: true,
		});
		expect(objects.filter((o) => o.length === 64 + 6)).toHaveLength(3);
	});

	it("serves a warm checkout from the object store", async () => {
		const { job, ctx } = setup(origin);
		const result = await checkout(job, ctx);
		expect(result.cache).toMatchObject({ workspace: "warm", lfs: "hit" });
		expect(
			await fs.readFile(path.join(result.root, "video/assets/hero.mp4")),
		).toEqual(assets["video/assets/hero.mp4"]);
	});

	it("shares objects across repos (content-addressed)", async () => {
		// Another repo with the same assets: nothing to download.
		const fork = path.join(tmp, "fork");
		await fs.cp(origin, fork, { recursive: true });
		const { job, ctx } = setup(fork);
		const result = await checkout(job, ctx);
		expect(result.cache).toMatchObject({ workspace: "cold", lfs: "hit" });
		expect(
			await fs.readFile(path.join(result.root, "video/assets/music.bin")),
		).toEqual(assets["video/assets/music.bin"]);
	});

	it("downloads only the include patterns, warning about the rest of the workdir", async () => {
		// A cold workspace: a warm one keeps assets an earlier job downloaded.
		const fresh = path.join(tmp, "include-only");
		await fs.cp(origin, fresh, { recursive: true });
		await fs.rm(path.join(tmp, "cache/lfs"), { recursive: true, force: true });
		const { job, ctx, warnings } = setup(fresh, {
			include: ["video/assets/hero.mp4"],
		});
		const result = await checkout(job, ctx);
		expect(result.cache.lfs).toBe("miss");
		expect(
			await isPointer(path.join(result.root, "video/assets/hero.mp4")),
		).toBe(false);
		expect(
			await isPointer(path.join(result.root, "video/assets/music.bin")),
		).toBe(true);
		expect(warnings).toContain("LFS_POINTERS_LEFT");
	});

	it("can skip LFS entirely", async () => {
		const { job, ctx } = setup(origin, { enabled: false });
		const result = await checkout(job, ctx);
		expect(result.cache.lfs).toBe("off");
	});

	it("fails with LFS_OBJECT_MISSING when the server lacks an object", async () => {
		const broken = await lfsOrigin("broken");
		// Lose the object behind music.bin, as if it was never pushed.
		const pointer = sh(broken, ["show", "HEAD:video/assets/music.bin"]);
		const oid = /oid sha256:([0-9a-f]{64})/.exec(pointer)?.[1] ?? "";
		await fs.rm(
			path.join(
				broken,
				".git/lfs/objects",
				oid.slice(0, 2),
				oid.slice(2, 4),
				oid,
			),
		);
		await fs.rm(path.join(tmp, "cache/lfs"), { recursive: true, force: true });
		const { job, ctx } = setup(broken);
		const err = await checkout(job, ctx).then(
			() => undefined,
			(e: unknown) => e,
		);
		expect(err).toBeInstanceOf(RenderError);
		expect((err as RenderError).code).toBe("LFS_OBJECT_MISSING");
	});
});
