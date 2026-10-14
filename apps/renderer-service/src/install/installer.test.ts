import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import { CommandError } from "../git/exec.js";
import type { CheckoutResult, StepContext } from "../jobs/pipeline.js";
import { testConfig } from "../test-helpers.js";
import {
	bundledEngineVersion,
	classifyInstallError,
	install,
	STAMP_FILE,
} from "./installer.js";
import { inspectProject, needsNoInstall } from "./project.js";

let tmp: string;

beforeAll(async () => {
	tmp = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), "ff-install-test-")),
	);
});
afterAll(async () => {
	await fs.rm(tmp, { recursive: true, force: true });
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

	it("needs no install when only framefields and tooling are used", () => {
		expect(
			needsNoInstall({
				dependencies: {
					framefields: "^2.1.0",
					"@framefields/compositions": "workspace:*",
				},
				devDependencies: { typescript: "^5", tsx: "^4", "@types/node": "^24" },
			}),
		).toBe(true);
		expect(
			needsNoInstall({ dependencies: { framefields: "^2", mediabunny: "^1" } }),
		).toBe(false);
	});
});

describe("install step", () => {
	it("skips projects that only need framefields, warning on a version mismatch", async () => {
		const root = await project("plain", {
			"package.json": { name: "p", dependencies: { framefields: "^0.1.0" } },
		});
		const { ctx, warnings } = context();
		const result = await install(checkoutOf(root), ctx);
		expect(result).toMatchObject({ skipped: true, declaredEngine: "^0.1.0" });
		expect(warnings).toContain("ENGINE_MISMATCH");
	});

	it("fails on an engine mismatch when the policy says so", async () => {
		const root = await project("strict", {
			"package.json": { name: "p", dependencies: { framefields: "^0.1.0" } },
		});
		const { ctx } = context({ FF_ENGINE_POLICY: "fail" });
		expect(await codeOf(install(checkoutOf(root), ctx))).toBe(
			"ENGINE_INCOMPATIBLE",
		);
	});

	it("accepts the bundled version and workspace ranges", async () => {
		const root = await project("ok", {
			"package.json": {
				name: "p",
				dependencies: { framefields: `^${bundledEngineVersion()}` },
				devDependencies: { "@framefields/x": "workspace:*" },
			},
		});
		const { ctx, warnings } = context();
		await install(checkoutOf(root), ctx);
		expect(warnings).toEqual([]);
	});

	it("requires a lockfile when dependencies must be installed", async () => {
		const root = await project("nolock", {
			"package.json": { name: "p", dependencies: { "left-pad": "1.3.0" } },
		});
		expect(await codeOf(install(checkoutOf(root), context().ctx))).toBe(
			"LOCKFILE_MISSING",
		);
	});

	it("runs npm ci once, then reuses node_modules until the lockfile changes", async () => {
		const root = await project("npm-project", {
			"package.json": {
				name: "film",
				version: "1.0.0",
				dependencies: { helper: "file:./helper" },
			},
			"helper/package.json": { name: "helper", version: "1.0.0" },
			"helper/index.js": "module.exports = 1;\n",
		});
		// Generate a real lockfile offline (file: deps need no registry).
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
		expect(first.cache.install).toBe("miss");
		expect(existsSync(path.join(root, "node_modules/helper/index.js"))).toBe(
			true,
		);
		expect(existsSync(path.join(root, STAMP_FILE))).toBe(true);

		const second = await install(checkoutOf(root), context().ctx);
		expect(second.cache.install).toBe("hit");

		const pkg = JSON.parse(
			await fs.readFile(path.join(root, "package.json"), "utf8"),
		);
		pkg.description = "changed";
		await fs.writeFile(path.join(root, "package.json"), JSON.stringify(pkg));
		const third = await install(checkoutOf(root), context().ctx);
		expect(third.cache.install).toBe("miss");
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
