import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import { CommandError } from "../git/exec.js";
import type { CheckoutResult, StepContext } from "../jobs/pipeline.js";
import { _resetEngineBinding, markDepsLoaded } from "../render/engine.js";
import { testConfig } from "../test-helpers.js";
import { classifyInstallError, install, STAMP_FILE } from "./installer.js";
import { inspectProject } from "./project.js";

let tmp: string;

beforeAll(async () => {
	tmp = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "ff-install-test-")),
	);
});
afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
	_resetEngineBinding();
});

async function project(name: string, files: Record<string, unknown>) {
	const root = path.join(tmp, name);
	for (const [rel, content] of Object.entries(files)) {
		const file = path.join(root, rel);
		await fs.mkdir(path.dirname(file), { recursive: true });
		await fs.writeFile(
			file,
			typeof content === "string" ? content : JSON.stringify(content, null, 2),
		);
	}
	return root;
}

function context(env: Record<string, string> = {}) {
	const warnings: string[] = [];
	const ctx: StepContext = {
		jobId: "t",
		config: testConfig({
			FF_CACHE_DIR: path.join(tmp, "cache"),
			FF_WORK_DIR: path.join(tmp, "work"),
			...env,
		}),
		signal: new AbortController().signal,
		jobDir: tmp,
		progress: () => {},
		warn: (code) => warnings.push(code),
	};
	return { ctx, warnings };
}

const checkoutOf = (root: string, workdir = root): CheckoutResult => ({
	root,
	workdir,
	sha: "x",
	cache: {},
	release: async () => {},
});

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "no error";
	} catch (err) {
		return err instanceof RenderError ? err.code : String(err);
	}
}

describe("project inspection", () => {
	it("finds the workspace root and package manager above the workdir", async () => {
		const root = await project("mono", {
			"package.json": {
				name: "root",
				packageManager: "pnpm@10.13.1+sha512.abc",
			},
			"pnpm-workspace.yaml": "packages:\n  - videos/*\n",
			"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
			"videos/launch/package.json": { name: "launch" },
		});
		const info = await inspectProject(root, path.join(root, "videos/launch"));
		expect(info).toMatchObject({
			installRoot: root,
			manager: "pnpm",
			managerSpec: "pnpm@10.13.1",
			inWorkspace: true,
		});
	});

	it("detects yarn berry from the lockfile", async () => {
		const root = await project("berry", {
			"package.json": { name: "b" },
			"yarn.lock": "__metadata:\n  version: 8\n",
		});
		expect((await inspectProject(root, root))?.yarnBerry).toBe(true);
	});

	it("rejects bun lockfiles", async () => {
		const root = await project("bun", {
			"package.json": { name: "b" },
			"bun.lockb": "",
		});
		expect(await codeOf(inspectProject(root, root))).toBe("INSTALL_FAILED");
	});
});

describe("install step", () => {
	it("requires the project to depend on framefields", async () => {
		const root = await project("no-engine", {
			"package.json": { name: "p", dependencies: { "left-pad": "1.3.0" } },
		});
		expect(await codeOf(install(checkoutOf(root), context().ctx))).toBe(
			"ENGINE_NOT_FOUND",
		);
		const empty = await project("no-package", { "readme.md": "hi" });
		expect(await codeOf(install(checkoutOf(empty), context().ctx))).toBe(
			"ENGINE_NOT_FOUND",
		);
	});

	it("accepts framefields declared at the workspace root", async () => {
		const root = await project("root-engine", {
			"package.json": {
				name: "root",
				workspaces: ["videos/*"],
				dependencies: { framefields: "^2.1.0" },
			},
			"videos/launch/package.json": { name: "launch" },
		});
		// No lockfile, so it stops there, after the engine check passed.
		expect(
			await codeOf(
				install(
					checkoutOf(root, path.join(root, "videos/launch")),
					context().ctx,
				),
			),
		).toBe("LOCKFILE_MISSING");
	});

	it("requires a lockfile", async () => {
		const root = await project("nolock", {
			"package.json": { name: "p", dependencies: { framefields: "^2.1.0" } },
		});
		expect(await codeOf(install(checkoutOf(root), context().ctx))).toBe(
			"LOCKFILE_MISSING",
		);
	});

	it("runs npm ci once, reuses it until the lockfile changes, and asks for a restart when loaded deps change", async () => {
		const root = await project("npm-project", {
			// A stand-in engine package, so npm ci works offline.
			"package.json": {
				name: "film",
				version: "1.0.0",
				dependencies: { framefields: "file:./engine" },
			},
			"engine/package.json": { name: "framefields", version: "9.9.9" },
			"engine/index.js": "module.exports = 1;\n",
		});
		execFileSync(
			"npm",
			[
				"install",
				"--package-lock-only",
				"--offline",
				"--no-audit",
				"--no-fund",
			],
			{
				cwd: root,
				stdio: "ignore",
			},
		);

		const first = await install(checkoutOf(root), context().ctx);
		expect(first).toMatchObject({
			declaredEngine: "file:./engine",
			cache: { install: "miss" },
		});
		expect(
			existsSync(path.join(root, "node_modules/framefields/index.js")),
		).toBe(true);
		expect(existsSync(path.join(root, STAMP_FILE))).toBe(true);

		expect((await install(checkoutOf(root), context().ctx)).cache.install).toBe(
			"hit",
		);

		const pkg = JSON.parse(
			await fs.readFile(path.join(root, "package.json"), "utf8"),
		);
		pkg.description = "changed";
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
		expect((await install(checkoutOf(root), context().ctx)).cache.install).toBe(
			"miss",
		);

		// Once this process loaded modules from the workspace, new dependencies
		// need a fresh worker: installed, then ENGINE_SWITCH (retryable).
		markDepsLoaded(root);
		pkg.description = "changed again";
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
		expect(await codeOf(install(checkoutOf(root), context().ctx))).toBe(
			"ENGINE_SWITCH",
		);
		expect(existsSync(path.join(root, STAMP_FILE))).toBe(true);
	}, 120_000);
});

describe("install error classification", () => {
	const failure = (stderr: string, timedOut = false) =>
		new CommandError("pnpm install", {
			stdout: "",
			stderr,
			code: 1,
			timedOut,
			aborted: false,
		});

	it.each([
		[
			"ERR_PNPM_OUTDATED_LOCKFILE Cannot install with frozen-lockfile",
			"INSTALL_FAILED",
			/lockfile/,
		],
		["npm ERR! code E401 Unable to authenticate", "INSTALL_FAILED", /FF_NPMRC/],
		["gyp ERR! build error", "INSTALL_FAILED", /-full image/],
		["ENOSPC: no space left on device", "DISK_FULL", undefined],
	])("%s → %s", (stderr, code, hint) => {
		const err = classifyInstallError(failure(stderr), "/repo");
		expect(err.code).toBe(code);
		if (hint) expect(err.hint).toMatch(hint);
	});

	it("marks registry outages transient and timeouts as INSTALL_TIMEOUT", () => {
		expect(
			classifyInstallError(failure("ECONNRESET"), "/r").details?.transient,
		).toBe(true);
		expect(classifyInstallError(failure("", true), "/r").code).toBe(
			"INSTALL_TIMEOUT",
		);
	});

	it("keeps the repo path out of messages", () => {
		const err = classifyInstallError(
			failure("failed in /work/ws/abc/0/videos"),
			"/work/ws/abc/0",
		);
		expect(JSON.stringify(err.toJSON())).not.toContain("/work/ws/abc/0");
	});
});
