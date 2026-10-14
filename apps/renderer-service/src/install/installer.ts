import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import { CommandError, exec } from "../git/exec.js";
import type { Pipeline, StepContext } from "../jobs/pipeline.js";
import { redact } from "../redact.js";
import {
	declaredEngineRange,
	inspectProject,
	needsNoInstall,
	type ProjectInfo,
} from "./project.js";

export const STAMP_FILE = ".ff-install-stamp";

let engineVersion: string | undefined;

/** Version of the framefields copy this worker renders with. */
export function bundledEngineVersion(): string {
	if (engineVersion) return engineVersion;
	// The package doesn't export ./package.json; walk up from its entry.
	let dir = path.dirname(fileURLToPath(import.meta.resolve("framefields")));
	for (;;) {
		const file = path.join(dir, "package.json");
		if (existsSync(file)) {
			const pkg = JSON.parse(readFileSync(file, "utf8")) as {
				name?: string;
				version: string;
			};
			if (pkg.name === "framefields") {
				engineVersion = pkg.version;
				return engineVersion;
			}
		}
		if (path.dirname(dir) === dir)
			throw new Error("framefields package.json not found");
		dir = path.dirname(dir);
	}
}

/**
 * Pipeline step: installs the project's dependencies (PLAN.md §7). Skipped
 * when the project only needs framefields, or when the lockfile hasn't
 * changed since the last install in this workspace slot.
 */
export const install: Pipeline["install"] = async (checkout, ctx) => {
	const project = await inspectProject(checkout.root, checkout.workdir);
	if (!project) {
		ctx.warn(
			"NO_PACKAGE_JSON",
			"The workdir has no package.json; rendering without installing dependencies.",
		);
		return { skipped: true, cache: { install: "skipped" } };
	}

	const declaredEngine = declaredEngineRange(project.pkg);
	checkEngine(declaredEngine, ctx);
	checkNodeEngine(project, ctx);

	if (needsNoInstall(project.pkg)) {
		return {
			skipped: true,
			packageManager: project.manager,
			declaredEngine,
			cache: { install: "skipped" },
		};
	}

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
	await runInstall(project, ctx, checkout.root);
	await fs.writeFile(stampPath, stamp);
	return {
		skipped: false,
		packageManager: project.manager,
		declaredEngine,
		cache: { install: "miss" },
	};
};

function checkEngine(declared: string | undefined, ctx: StepContext): void {
	if (!declared) return;
	const range = declared.replace(/^npm:framefields@/, "");
	if (!semver.validRange(range)) return; // workspace:*, file:, git URLs, tags
	const bundled = bundledEngineVersion();
	if (semver.satisfies(bundled, range, { includePrerelease: true })) return;
	const message = `The project asks for framefields ${range}; this worker renders with ${bundled}.`;
	if (ctx.config.install.enginePolicy === "fail") {
		throw new RenderError("ENGINE_INCOMPATIBLE", message, {
			phase: "install",
			hint: "Use a worker image whose framefields version matches, or update the project's dependency.",
		});
	}
	ctx.warn("ENGINE_MISMATCH", message);
}

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
		const useCorepack = await hasCorepack();
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
	const logTail = redact(
		output.trim().split("\n").slice(-40).join("\n"),
	).replaceAll(repoRoot, "<repo>");
	const fail = (hint?: string, transient = false) =>
		new RenderError(
			"INSTALL_FAILED",
			err.message.replaceAll(repoRoot, "<repo>"),
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
