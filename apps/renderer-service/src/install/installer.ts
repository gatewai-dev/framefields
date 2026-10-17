import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import semver from "semver";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import { CommandError, exec } from "../git/exec.js";
import type { Pipeline, StepContext } from "../jobs/pipeline.js";
import { rendererLogger } from "../logger.js";
import { redact } from "../redact.js";
import { depsLoadedFrom } from "../render/engine.js";
import { workerHealth } from "../worker/health.js";
import { activeJanitor } from "../worker/janitor.js";
import {
	declaredEngineRange,
	inspectProject,
	type ProjectInfo,
	readPackageJson,
} from "./project.js";
import {
	expectedInstallSize,
	moduleStoreDir,
	recordInstallSize,
	removeModules,
	shareModules,
} from "./shared-modules.js";

export const STAMP_FILE = ".ff-install-stamp";

/**
 * Pipeline step: installs the project's dependencies, including the
 * framefields version it renders with (PLAN.md §7). Skipped when the
 * lockfile hasn't changed since the last install in this workspace slot.
 */
export const install: Pipeline["install"] = async (checkout, ctx) => {
	const project = await inspectProject(checkout.root, checkout.workdir);
	if (!project) {
		throw new RenderError(
			"ENGINE_NOT_FOUND",
			"The workdir has no package.json, so there's no framefields to render with.",
			{
				phase: "install",
				hint: 'Point source.workdir at the package that depends on "framefields".',
			},
		);
	}

	const rootPkg = project.inWorkspace
		? await readPackageJson(project.installRoot)
		: undefined;
	const declaredEngine =
		declaredEngineRange(project.pkg) ??
		(rootPkg && declaredEngineRange(rootPkg));
	if (!declaredEngine) {
		throw new RenderError(
			"ENGINE_NOT_FOUND",
			"The project doesn't depend on framefields.",
			{
				phase: "install",
				hint: 'Add "framefields" to the dependencies in package.json and commit the lockfile.',
			},
		);
	}
	checkNodeEngine(project, ctx);

	if (!project.lockfile && !ctx.config.install.allowUnlocked) {
		throw new RenderError(
			"LOCKFILE_MISSING",
			"The project has no lockfile, so the install wouldn't be reproducible.",
			{
				phase: "install",
				hint: "Commit pnpm-lock.yaml / package-lock.json / yarn.lock (or set FF_ALLOW_UNLOCKED_INSTALL=true).",
			},
		);
	}

	const stampPath = path.join(project.installRoot, STAMP_FILE);
	const stamp = await installStamp(project, ctx.config, checkout.root);
	const previous = await fs.readFile(stampPath, "utf8").catch(() => "");
	if (
		previous === stamp &&
		existsSync(path.join(project.installRoot, "node_modules"))
	) {
		return {
			skipped: false,
			packageManager: project.manager,
			declaredEngine,
			cache: { install: "hit" },
		};
	}

	// A half-finished install must never be trusted by the next job.
	await fs.rm(stampPath, { force: true });
	const shared = ctx.config.paths.sharedModules;
	// Shared files are read-only hard links: a package manager must never
	// write into them, so the install starts from an empty node_modules.
	if (shared) await removeModules(checkout.root);
	// Room for a full extraction: sharing happens only after the install.
	const expected = await expectedInstallSize(ctx.config.paths.workDir, stamp);
	if (expected > 0) {
		await activeJanitor()?.enforce(
			[path.basename(path.dirname(checkout.root))],
			expected,
		);
	}
	await runInstall(project, ctx, checkout.root);
	if (shared) {
		const result = await shareModules(
			checkout.root,
			moduleStoreDir(ctx.config.paths.workDir),
		);
		await recordInstallSize(
			ctx.config.paths.workDir,
			stamp,
			result.installBytes,
		);
		rendererLogger.info(
			{
				files: result.files,
				linked: result.linked,
				savedMb: Math.round(result.savedBytes / 1024 ** 2),
				skipped: result.skipped,
			},
			"Shared node_modules with other workspaces",
		);
	}
	await fs.writeFile(stampPath, stamp);

	// This process holds the old dependencies in its module cache; only a
	// fresh worker can load the new ones (engine-alias.ts).
	if (depsLoadedFrom(checkout.root)) {
		workerHealth.requestRecycle("project dependencies changed");
		throw new RenderError(
			"ENGINE_SWITCH",
			"The project's dependencies changed since this worker loaded them.",
			{
				phase: "install",
				hint: "Retry: the worker restarts and loads the new dependencies (already installed).",
			},
		);
	}
	return {
		skipped: false,
		packageManager: project.manager,
		declaredEngine,
		cache: { install: "miss" },
	};
};

function checkNodeEngine(project: ProjectInfo, ctx: StepContext): void {
	const range = project.pkg.engines?.node;
	if (
		range &&
		semver.validRange(range) &&
		!semver.satisfies(process.versions.node, range)
	) {
		ctx.warn(
			"NODE_ENGINE_MISMATCH",
			`The project wants Node ${range}; the worker runs ${process.versions.node}.`,
		);
	}
}

/** Everything that changes what an install produces. */
async function installStamp(
	project: ProjectInfo,
	config: RendererConfig,
	repoRoot: string,
): Promise<string> {
	const hash = createHash("sha256");
	hash.update(
		project.lockfile ? await fs.readFile(project.lockfile) : "no-lockfile",
	);
	hash.update(
		await fs.readFile(path.join(project.installRoot, "package.json")),
	);
	if (project.inWorkspace)
		hash.update(
			await fs.readFile(path.join(project.packageDir, "package.json")),
		);
	hash.update(
		JSON.stringify({
			manager: project.managerSpec ?? project.manager,
			node: process.versions.modules,
			platform: `${process.platform}-${process.arch}`,
			scripts: config.install.scripts,
			filter: path.relative(repoRoot, project.packageDir),
			npmrc: config.install.npmrc
				? createHash("sha256").update(config.install.npmrc).digest("hex")
				: "",
		}),
	);
	return hash.digest("hex");
}

function installCommand(
	project: ProjectInfo,
	config: RendererConfig,
): string[] {
	const cache = config.paths.cacheDir;
	const rel = path.relative(project.installRoot, project.packageDir) || ".";
	const noScripts = !config.install.scripts;
	switch (project.manager) {
		case "pnpm":
			return [
				"pnpm",
				"install",
				project.lockfile ? "--frozen-lockfile" : "--no-frozen-lockfile",
				"--prefer-offline",
				"--reporter=append-only",
				"--config.confirmModulesPurge=false",
				`--store-dir=${path.join(cache, "pnpm-store")}`,
				...(project.inWorkspace ? [`--filter=./${rel}...`] : []),
				...(noScripts ? ["--ignore-scripts"] : []),
			];
		case "npm":
			return [
				"npm",
				project.lockfile ? "ci" : "install",
				"--prefer-offline",
				"--no-audit",
				"--no-fund",
				`--cache=${path.join(cache, "npm-cache")}`,
				...(project.inWorkspace
					? [`--workspace=${rel}`, "--include-workspace-root=false"]
					: []),
				...(noScripts ? ["--ignore-scripts"] : []),
			];
		case "yarn":
			return project.yarnBerry
				? [
						"yarn",
						"install",
						project.lockfile ? "--immutable" : "--no-immutable",
						"--inline-builds",
					]
				: [
						"yarn",
						"install",
						project.lockfile ? "--frozen-lockfile" : "--no-lockfile",
						"--prefer-offline",
						"--non-interactive",
						`--cache-folder=${path.join(cache, "yarn-cache")}`,
						...(noScripts ? ["--ignore-scripts"] : []),
					];
	}
}

async function runInstall(
	project: ProjectInfo,
	ctx: StepContext,
	repoRoot: string,
): Promise<void> {
	const config = ctx.config;
	const home = await fs.mkdtemp(path.join(os.tmpdir(), "ff-install-"));
	try {
		const env: NodeJS.ProcessEnv = {
			PATH: process.env.PATH,
			HOME: home,
			TMPDIR: home,
			CI: "true",
			LANG: "C.UTF-8",
			TZ: "UTC",
			COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
			COREPACK_ENABLE_STRICT: "0",
			COREPACK_HOME: path.join(config.paths.cacheDir, "corepack"),
			npm_config_update_notifier: "false",
			YARN_ENABLE_TELEMETRY: "0",
			YARN_ENABLE_GLOBAL_CACHE: "true",
			YARN_GLOBAL_FOLDER: path.join(config.paths.cacheDir, "yarn-berry"),
			...(project.yarnBerry &&
				!config.install.scripts && { YARN_ENABLE_SCRIPTS: "false" }),
		};
		if (config.install.npmrc) {
			const npmrc = path.join(home, ".npmrc");
			await fs.writeFile(npmrc, config.install.npmrc, { mode: 0o600 });
			env.npm_config_userconfig = npmrc;
			env.NPM_CONFIG_USERCONFIG = npmrc;
		}

		const [pm, ...args] = installCommand(project, config);
		// npm ships with Node, so corepack only runs it when the project pins a
		// version; an unpinned npm via corepack can be a different major than
		// the one that wrote the lockfile. pnpm and yarn always go through it.
		const useCorepack =
			(pm !== "npm" || Boolean(project.managerSpec)) && (await hasCorepack());
		const file = useCorepack ? "corepack" : pm;
		const argv = useCorepack ? [pm, ...args] : args;

		ctx.progress({
			phase: "installing",
			message: `${project.managerSpec ?? pm} ${args[0]}`,
		});
		const attempt = () =>
			exec(file, argv, {
				cwd: project.installRoot,
				env,
				signal: ctx.signal,
				timeoutMs: config.limits.timeouts.install * 1000,
				maxStdoutBytes: 1024 * 1024,
			});
		try {
			await attempt();
		} catch (err) {
			const classified = classifyInstallError(err, repoRoot);
			// One retry for registry hiccups; everything else is deterministic.
			if (classified.details?.transient && !ctx.signal.aborted) {
				await attempt().catch((retryErr) => {
					throw classifyInstallError(retryErr, repoRoot);
				});
			} else {
				throw classified;
			}
		}
	} finally {
		await fs.rm(home, { recursive: true, force: true });
	}
}

let corepackAvailable: Promise<boolean> | undefined;
function hasCorepack(): Promise<boolean> {
	corepackAvailable ??= exec("corepack", ["--version"], {
		timeoutMs: 10_000,
	}).then(
		() => true,
		() => false,
	);
	return corepackAvailable;
}

export function classifyInstallError(
	err: unknown,
	repoRoot: string,
): RenderError {
	if (err instanceof RenderError) return err;
	if (!(err instanceof CommandError)) {
		const message = err instanceof Error ? err.message : String(err);
		if (/ENOENT/.test(message)) {
			return new RenderError(
				"TOOL_MISSING",
				`Package manager not found: ${message}`,
				{ phase: "install" },
			);
		}
		return new RenderError("INSTALL_FAILED", redact(message), {
			phase: "install",
			cause: err,
		});
	}
	const output = `${err.result.stderr}\n${err.result.stdout}`;
	// Package managers put the cause first and usage/help text last: keep both ends.
	const lines = output
		.trim()
		.split("\n")
		.filter((l) => !/^npm error\s*$/.test(l));
	const excerpt =
		lines.length > 45
			? [...lines.slice(0, 15), "…", ...lines.slice(-30)]
			: lines;
	const logTail = redact(excerpt.join("\n")).replaceAll(repoRoot, "<repo>");
	// The first line that names the problem, e.g. npm's "`npm ci` can only install…".
	const cause =
		lines.find(
			(l) =>
				/ERR_PNPM_|error (?!code\b)|YN\d{4}|ERR!/i.test(l) &&
				l.replace(/^npm error\s*/, "").length > 12,
		) ??
		lines.at(-1) ??
		"unknown error";
	const fail = (hint?: string, transient = false) =>
		new RenderError(
			"INSTALL_FAILED",
			`${err.command} failed: ${redact(cause).replaceAll(repoRoot, "<repo>")}`,
			{
				phase: "install",
				hint,
				details: { log: logTail, ...(transient && { transient }) },
				cause: err,
			},
		);

	if (err.result.timedOut) {
		return new RenderError(
			"INSTALL_TIMEOUT",
			"The dependency install timed out.",
			{
				phase: "install",
				hint: "Raise FF_TIMEOUT_INSTALL_SEC, or keep a network volume so the package store stays warm.",
				details: { log: logTail },
			},
		);
	}
	if (/ENOSPC|No space left on device/i.test(output)) {
		return new RenderError("DISK_FULL", "Ran out of disk during the install.", {
			phase: "install",
			hint: "The install extracts every package before sharing them; give FF_WORK_DIR more disk (containerDiskInGb on RunPod).",
		});
	}
	if (
		/ERR_PNPM_OUTDATED_LOCKFILE|ERR_PNPM_LOCKFILE|frozen-lockfile|can only install packages when your package\.json and package-lock\.json|lockfile would have been modified|YN0028/i.test(
			output,
		)
	) {
		return fail(
			"The lockfile is out of date with package.json; run the install locally and commit the lockfile.",
		);
	}
	if (
		/E401|E403|ERR_PNPM_FETCH_40[13]|Unauthorized|authentication token/i.test(
			output,
		)
	) {
		return fail(
			"A private registry rejected the request; set FF_NPMRC with an auth token.",
		);
	}
	if (
		/E404|ERR_PNPM_FETCH_404|ERR_PNPM_NO_MATCHING_VERSION|Not Found - GET/i.test(
			output,
		)
	) {
		return fail("A dependency (or version) doesn't exist on the registry.");
	}
	if (
		/node-gyp|gyp ERR|make: \*\*\*|g\+\+|cc1plus|Python is not set/i.test(
			output,
		)
	) {
		return fail(
			"A native dependency needed compiling; use the -full image, which has a toolchain.",
		);
	}
	if (
		/ETIMEDOUT|ECONNRESET|EAI_AGAIN|ENOTFOUND|socket hang up|ERR_SOCKET_TIMEOUT|\b50[234]\b/i.test(
			output,
		)
	) {
		return fail("The package registry was unreachable.", true);
	}
	return fail();
}
