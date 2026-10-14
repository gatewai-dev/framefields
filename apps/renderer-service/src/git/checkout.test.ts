import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import type { StepContext } from "../jobs/pipeline.js";
import { validateJob } from "../jobs/validate.js";
import { testConfig, testJob } from "../test-helpers.js";
import { checkout } from "./checkout.js";
import { mirrorPath } from "./mirror.js";
import { parseRepoUrl, type RepoRef } from "./repo-url.js";
import { resolveRelativeUrl } from "./workspace.js";

let tmp: string;
let origin: string;
let originUrl: string;
const shas: Record<string, string> = {};

const gitEnv = {
	...process.env,
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_AUTHOR_NAME: "t",
	GIT_AUTHOR_EMAIL: "t@example.com",
	GIT_COMMITTER_NAME: "t",
	GIT_COMMITTER_EMAIL: "t@example.com",
};
const sh = (args: string[], cwd = origin) =>
	execFileSync("git", args, { cwd, env: gitEnv, encoding: "utf8" }).trim();

async function write(rel: string, content: string) {
	await fs.mkdir(path.dirname(path.join(origin, rel)), { recursive: true });
	await fs.writeFile(path.join(origin, rel), content);
}

beforeAll(async () => {
	tmp = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "ff-git-test-")),
	);
	origin = path.join(tmp, "origin");
	await fs.mkdir(origin);
	originUrl = `file://${origin}`;
	sh(["init", "--quiet", "--initial-branch=main"]);

	await write("videos/launch/package.json", '{"name":"launch"}');
	await write("videos/launch/src/film.ts", "export const v = 1;\n");
	await write("other/readme.md", "other\n");
	sh(["add", "-A"]);
	sh(["commit", "--quiet", "-m", "one"]);
	shas.one = sh(["rev-parse", "HEAD"]);
	sh(["tag", "-a", "v1", "-m", "v1"]);

	await write("videos/launch/src/film.ts", "export const v = 2;\n");
	sh(["commit", "--quiet", "-am", "two"]);
	shas.two = sh(["rev-parse", "HEAD"]);

	// "release" is a branch at `two` and a tag at `one` → ambiguous.
	sh(["branch", "release"]);
	sh(["tag", "release", shas.one]);

	sh(["checkout", "--quiet", "-b", "feature/intro"]);
	await write("videos/launch/src/film.ts", "export const v = 3;\n");
	sh(["commit", "--quiet", "-am", "three"]);
	shas.three = sh(["rev-parse", "HEAD"]);

	sh(["checkout", "--quiet", "-b", "crypt", shas.one]);
	await write(".gitattributes", "secrets/** filter=git-crypt diff=git-crypt\n");
	await write("secrets/key.bin", "encrypted\n");
	await write(
		"videos/launch/assets/hero.mp4",
		"version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
	);
	sh(["add", "-A"]);
	sh(["commit", "--quiet", "-m", "crypt"]);

	sh(["checkout", "--quiet", "main"]);
});

afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
});

function setup(
	overrides: Record<string, unknown> = {},
	env: Record<string, string> = {},
) {
	const config = testConfig({
		FF_ALLOW_LOCAL_REPOS: "true",
		FF_CACHE_DIR: path.join(tmp, "cache"),
		FF_WORK_DIR: path.join(tmp, "work"),
		...env,
	});
	const job = validateJob(
		testJob({
			source: {
				repo: originUrl,
				ref: "main",
				workdir: "videos/launch",
				...overrides,
			},
		}),
		config,
	);
	const warnings: string[] = [];
	const controller = new AbortController();
	const ctx: StepContext = {
		jobId: "test",
		config,
		signal: controller.signal,
		jobDir: path.join(tmp, "job"),
		progress: () => {},
		warn: (code) => warnings.push(code),
	};
	return { job, ctx, warnings, controller, config };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
	try {
		await promise;
		return "no error";
	} catch (err) {
		return err instanceof RenderError
			? err.code
			: `not a RenderError: ${String(err)}`;
	}
}

const film = (root: string) =>
	fs.readFile(path.join(root, "videos/launch/src/film.ts"), "utf8");

describe("checkout (local repos)", () => {
	it("checks out a branch and pins the SHA", async () => {
		const { job, ctx } = setup();
		const result = await checkout(job, ctx);
		expect(result.sha).toBe(shas.two);
		expect(result.workdir).toBe(path.join(result.root, "videos/launch"));
		expect(await film(result.root)).toContain("v = 2");
		expect(result.cache).toMatchObject({ workspace: "cold", lfs: "off" });
	});

	it("resolves branches with slashes, annotated tags and SHA prefixes", async () => {
		expect(
			(await checkout(setup({ ref: "feature/intro" }).job, setup().ctx)).sha,
		).toBe(shas.three);
		expect((await checkout(setup({ ref: "v1" }).job, setup().ctx)).sha).toBe(
			shas.one,
		);
		expect(
			(await checkout(setup({ ref: "refs/tags/v1" }).job, setup().ctx)).sha,
		).toBe(shas.one);
		expect(
			(await checkout(setup({ ref: shas.one.slice(0, 10) }).job, setup().ctx))
				.sha,
		).toBe(shas.one);
	});

	it("reuses the warm slot, keeping node_modules and dropping other untracked files", async () => {
		const first = await checkout(setup().job, setup().ctx);
		await fs.mkdir(path.join(first.workdir, "node_modules/x"), {
			recursive: true,
		});
		await fs.writeFile(path.join(first.workdir, "output.mp4"), "stale");

		const { job, ctx } = setup({ ref: "feature/intro" });
		const second = await checkout(job, ctx);
		expect(second.cache.workspace).toBe("warm");
		expect(second.cache.mirror).toBe("hit");
		expect(await film(second.root)).toContain("v = 3");
		expect(existsSync(path.join(second.workdir, "node_modules/x"))).toBe(true);
		expect(existsSync(path.join(second.workdir, "output.mp4"))).toBe(false);
	});

	it.each([
		[{ ref: "release" }, "REF_AMBIGUOUS"],
		[{ ref: "nope" }, "REF_NOT_FOUND"],
		[{ ref: "refs/heads/nope" }, "REF_NOT_FOUND"],
		[{ ref: "deadbeefdeadbeef" }, "REF_NOT_FOUND"],
		[{ ref: "main", commit: "0000000" }, "COMMIT_MISMATCH"],
		[{ ref: "main", workdir: "missing/dir" }, "JOB_INVALID"],
		[{ ref: "crypt", workdir: "." }, "UNSUPPORTED_GIT_FILTER"],
	])("fails %o with %s", async (overrides, code) => {
		const { job, ctx } = setup(overrides);
		expect(await codeOf(checkout(job, ctx))).toBe(code);
	});

	it("accepts the commit check when it matches", async () => {
		const { job, ctx } = setup({ commit: shas.two.slice(0, 8) });
		expect((await checkout(job, ctx)).sha).toBe(shas.two);
	});

	it("warns about LFS pointers left in the workdir when LFS is off", async () => {
		const { job, ctx, warnings } = setup({
			ref: "crypt",
			lfs: { enabled: false },
		});
		// The crypt branch's filtered files are outside this workdir.
		await checkout(job, ctx);
		expect(warnings).toContain("LFS_POINTERS_LEFT");
	});

	it("rejects a workdir that escapes through a symlink", async () => {
		sh(["checkout", "--quiet", "-b", "escape", "main"]);
		await fs.symlink("/tmp", path.join(origin, "videos/out"));
		sh(["add", "-A"]);
		sh(["commit", "--quiet", "-m", "symlink"]);
		sh(["checkout", "--quiet", "main"]);
		const { job, ctx } = setup({ ref: "escape", workdir: "videos/out" });
		expect(await codeOf(checkout(job, ctx))).toBe("PATH_ESCAPE");
	});

	it("re-clones a corrupt mirror", async () => {
		const { job, ctx, config } = setup();
		await checkout(job, ctx);
		const repo = parseRepoUrl(originUrl, { allowLocal: true });
		await fs.writeFile(path.join(mirrorPath(config, repo), "HEAD"), "garbage");
		const again = setup();
		const result = await checkout(again.job, again.ctx);
		expect(result.sha).toBe(shas.two);
		expect(result.cache.mirror).toBe("recloned");
		expect(result.cache.workspace).toBe("cold");
	});

	it("fetches only the sparse paths plus the workdir", async () => {
		const { job, ctx } = setup({ sparse: ["videos"] });
		const result = await checkout(job, ctx);
		expect(
			existsSync(path.join(result.root, "videos/launch/src/film.ts")),
		).toBe(true);
		expect(existsSync(path.join(result.root, "other/readme.md"))).toBe(false);

		const full = setup();
		const after = await checkout(full.job, full.ctx);
		expect(existsSync(path.join(after.root, "other/readme.md"))).toBe(true);
	});

	it("stops when the job is aborted", async () => {
		const { job, ctx, controller } = setup();
		controller.abort(new RenderError("CANCELLED", "x"));
		expect(await codeOf(checkout(job, ctx))).toBe("CANCELLED");
	});

	it("refuses file:// repos unless allowed", () => {
		expect(() =>
			validateJob(testJob({ source: { repo: originUrl } }), testConfig()),
		).toThrow(/FF_ALLOW_LOCAL_REPOS/);
	});
});

describe("submodule URLs", () => {
	const parent = (url: string): RepoRef => parseRepoUrl(url);
	it("resolves relative URLs against https and scp-like parents", () => {
		expect(
			resolveRelativeUrl(
				"../shared.git",
				parent("https://github.com/acme/films.git"),
			),
		).toBe("https://github.com/acme/shared.git");
		expect(
			resolveRelativeUrl(
				"../shared.git",
				parent("git@github.com:acme/films.git"),
			),
		).toBe("git@github.com:acme/shared.git");
		expect(
			resolveRelativeUrl(
				"https://x.dev/a/b",
				parent("https://github.com/acme/films"),
			),
		).toBe("https://x.dev/a/b");
	});
});
