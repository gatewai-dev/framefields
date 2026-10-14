import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../errors.js";
import { classifyGitError } from "./exec.js";
import { type GitContext, git, repoHash } from "./mirror.js";
import { isRepoAllowed, parseRepoUrl, type RepoRef } from "./repo-url.js";

export interface Workspace {
	root: string;
	warm: boolean;
}

/** Files that survive `git clean` between jobs in a warm slot. */
export const KEEP_ON_CLEAN = ["node_modules", ".ff-install-stamp"];

/**
 * Checks `sha` out into this repo's workspace slot on local disk. A slot that
 * still belongs to the current mirror is reused (warm: keeps node_modules);
 * anything else is rebuilt from scratch.
 */
export async function checkoutWorkspace(
	ctx: GitContext,
	repo: RepoRef,
	mirror: string,
	sha: string,
	options: { sparse?: string[] },
): Promise<Workspace> {
	const root = path.join(ctx.config.paths.workDir, "ws", repoHash(repo), "0");
	const inSlot = (args: string[], timeoutSec?: number) =>
		git(ctx, ["-C", root, ...args], { timeoutSec }).catch((err) => {
			throw classifyGitError(err, "fetch", { extraRules: ctx.profile.rules });
		});

	let warm = await isLiveWorktree(ctx, root, mirror);
	if (!warm) {
		await fs.rm(root, { recursive: true, force: true });
		await fs.mkdir(path.dirname(root), { recursive: true });
		await git(ctx, ["--git-dir", mirror, "worktree", "prune"]).catch(
			() => undefined,
		);
		await git(ctx, [
			"--git-dir",
			mirror,
			"worktree",
			"add",
			"--force",
			"--detach",
			"--no-checkout",
			root,
			sha,
		]).catch((err) => {
			throw classifyGitError(err, "fetch", { extraRules: ctx.profile.rules });
		});
	}

	if (options.sparse?.length) {
		await inSlot(["sparse-checkout", "set", "--cone", "--", ...options.sparse]);
	} else if (warm && existsSync(path.join(root, ".git"))) {
		await inSlot(["sparse-checkout", "disable"]).catch(() => undefined);
	}

	// Blobs of a partial mirror are fetched on demand here.
	await inSlot(
		["checkout", "--force", "--detach", sha],
		ctx.config.limits.timeouts.git,
	);
	if (warm) {
		await inSlot([
			"clean",
			"-ffdx",
			"--quiet",
			...KEEP_ON_CLEAN.flatMap((p) => ["-e", p]),
		]);
	}
	const { stdout } = await inSlot(["rev-parse", "HEAD"]);
	if (stdout.trim() !== sha) {
		warm = false;
		throw new RenderError(
			"GIT_CACHE_CORRUPT",
			`Checkout ended on ${stdout.trim()}, expected ${sha}.`,
			{
				phase: "fetch",
			},
		);
	}
	return { root, warm };
}

async function isLiveWorktree(
	ctx: GitContext,
	root: string,
	mirror: string,
): Promise<boolean> {
	if (!existsSync(path.join(root, ".git"))) return false;
	try {
		const { stdout } = await git(ctx, [
			"-C",
			root,
			"rev-parse",
			"--git-common-dir",
		]);
		const common = path.resolve(root, stdout.trim());
		return (await fs.realpath(common)) === (await fs.realpath(mirror));
	} catch {
		return false;
	}
}

/**
 * Initialises submodules level by level, checking every submodule URL against
 * the allowlist before git touches it (relative URLs resolve against the parent).
 */
export async function initSubmodules(
	ctx: GitContext,
	dir: string,
	parent: RepoRef,
	depth = 0,
): Promise<void> {
	if (depth > 8) {
		throw new RenderError(
			"JOB_INVALID",
			"Submodules nest deeper than 8 levels.",
			{ phase: "fetch" },
		);
	}
	if (!existsSync(path.join(dir, ".gitmodules"))) return;

	const { stdout } = await git(ctx, [
		"-C",
		dir,
		"config",
		"-f",
		".gitmodules",
		"--get-regexp",
		"^submodule\\..*\\.url$",
	]).catch(() => ({ stdout: "" }));
	for (const line of stdout.split("\n").filter(Boolean)) {
		const url = line.slice(line.indexOf(" ") + 1).trim();
		const sub = parseRepoUrl(resolveRelativeUrl(url, parent), {
			allowLocal: ctx.config.source.allowLocal,
		});
		if (
			sub.protocol !== "file" &&
			!isRepoAllowed(sub.id, ctx.config.source.allowlist)
		) {
			throw new RenderError(
				"REPO_NOT_ALLOWED",
				`Submodule ${sub.id} is not in FF_REPO_ALLOWLIST.`,
				{
					phase: "fetch",
				},
			);
		}
	}

	await git(ctx, ["-C", dir, "submodule", "sync", "--quiet"]);
	await git(
		ctx,
		["-C", dir, "submodule", "update", "--init", "--force", "--checkout"],
		{
			timeoutSec: ctx.config.limits.timeouts.git,
		},
	).catch((err) => {
		throw classifyGitError(err, "fetch", { extraRules: ctx.profile.rules });
	});

	const { stdout: paths } = await git(ctx, [
		"-C",
		dir,
		"submodule",
		"--quiet",
		"foreach",
		"--quiet",
		"pwd",
	]).catch(() => ({ stdout: "" }));
	for (const subDir of paths.split("\n").filter(Boolean)) {
		const { stdout: subUrl } = await git(ctx, [
			"-C",
			subDir,
			"config",
			"remote.origin.url",
		]).catch(() => ({
			stdout: "",
		}));
		if (!subUrl.trim()) continue;
		await initSubmodules(
			ctx,
			subDir,
			parseRepoUrl(subUrl.trim(), { allowLocal: ctx.config.source.allowLocal }),
			depth + 1,
		);
	}
}

/** `../other.git` relative to `https://host/acme/films` → `https://host/acme/other.git` */
export function resolveRelativeUrl(url: string, parent: RepoRef): string {
	if (!url.startsWith("./") && !url.startsWith("../")) return url;
	const base = parent.url.replace(/\/+$/, "");
	if (parent.protocol === "ssh" && !base.includes("://")) {
		const [hostPart, repoPath] = base.split(/:(.*)/s);
		return `${hostPart}:${path.posix.normalize(path.posix.join(repoPath, url))}`;
	}
	const u = new URL(base);
	u.pathname = path.posix.normalize(path.posix.join(u.pathname, url));
	return u.toString();
}
