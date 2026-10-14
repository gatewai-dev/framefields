import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import type { GitSession } from "./auth.js";
import {
	CommandError,
	classifyGitError,
	type ExecOptions,
	exec,
} from "./exec.js";
import type { HostProfile } from "./hosts.js";
import type { RepoRef } from "./repo-url.js";

export interface GitContext {
	config: RendererConfig;
	session: GitSession;
	profile: HostProfile;
	signal: AbortSignal;
}

export function git(
	ctx: GitContext,
	args: string[],
	options: Omit<ExecOptions, "env" | "signal"> & { timeoutSec?: number } = {},
) {
	return exec("git", [...ctx.session.configArgs, ...args], {
		...options,
		env: ctx.session.env,
		signal: ctx.signal,
		timeoutMs: (options.timeoutSec ?? ctx.config.limits.timeouts.git) * 1000,
	});
}

export function repoHash(repo: RepoRef): string {
	return createHash("sha256")
		.update(repo.id.toLowerCase())
		.digest("hex")
		.slice(0, 16);
}

/** Mirrors are per worker: a shared volume isn't safe for concurrent git writers (§6.1). */
export function mirrorPath(config: RendererConfig, repo: RepoRef): string {
	const worker = (process.env.RUNPOD_POD_ID || os.hostname()).replace(
		/[^\w.-]/g,
		"_",
	);
	return path.join(
		config.paths.cacheDir,
		"git",
		worker,
		`${repoHash(repo)}.git`,
	);
}

export interface RemoteRef {
	name: string;
	sha: string;
}

/** `git ls-remote`, with annotated tags peeled to their commit. */
export async function listRemote(
	ctx: GitContext,
	repo: RepoRef,
): Promise<RemoteRef[]> {
	try {
		const { stdout } = await git(ctx, ["ls-remote", "--", repo.url]);
		const refs = new Map<string, string>();
		for (const line of stdout.split("\n")) {
			const [sha, name] = line.trim().split(/\s+/);
			if (!sha || !name) continue;
			if (name.endsWith("^{}"))
				refs.set(name.slice(0, -3), sha); // peeled wins
			else if (!refs.has(name)) refs.set(name, sha);
		}
		return [...refs].map(([name, sha]) => ({ name, sha }));
	} catch (err) {
		throw classifyGitError(err, "resolve", { extraRules: ctx.profile.rules });
	}
}

export type RefSpec =
	| { kind: "ref"; name: string; sha: string }
	| { kind: "sha"; sha: string };

const HEX = /^[0-9a-f]{7,64}$/i;

/**
 * Resolves a job ref against the remote's refs. Full refs match exactly; bare
 * names match a branch or a tag (both → REF_AMBIGUOUS); hex strings that match
 * no ref are treated as a commit (prefix resolved after fetching).
 */
export function resolveRef(ref: string, remote: RemoteRef[]): RefSpec {
	const byName = new Map(remote.map((r) => [r.name, r.sha]));
	if (ref.startsWith("refs/")) {
		const sha = byName.get(ref);
		if (!sha)
			throw new RenderError(
				"REF_NOT_FOUND",
				`Ref ${ref} does not exist on the remote.`,
			);
		return { kind: "ref", name: ref, sha };
	}
	const head = byName.get(`refs/heads/${ref}`);
	const tag = byName.get(`refs/tags/${ref}`);
	if (head && tag && head !== tag) {
		throw new RenderError(
			"REF_AMBIGUOUS",
			`"${ref}" is both a branch and a tag pointing at different commits.`,
			{ hint: `Use refs/heads/${ref} or refs/tags/${ref}.` },
		);
	}
	if (head) return { kind: "ref", name: `refs/heads/${ref}`, sha: head };
	if (tag) return { kind: "ref", name: `refs/tags/${ref}`, sha: tag };
	if (ref === "HEAD" && byName.get("HEAD")) {
		return { kind: "ref", name: "HEAD", sha: byName.get("HEAD") as string };
	}
	if (HEX.test(ref)) return { kind: "sha", sha: ref.toLowerCase() };
	throw new RenderError(
		"REF_NOT_FOUND",
		`No branch or tag named "${ref}" on the remote.`,
		{
			hint: "Check the ref; deleted branches and typos end up here.",
		},
	);
}

/** Serialises mirror access within this process. */
const locks = new Map<string, Promise<unknown>>();
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const prev = locks.get(key) ?? Promise.resolve();
	const next = prev.catch(() => {}).then(fn);
	locks.set(key, next);
	try {
		return await next;
	} finally {
		if (locks.get(key) === next) locks.delete(key);
	}
}

export interface MirrorResult {
	path: string;
	sha: string;
	cache: "hit" | "miss" | "recloned";
}

/**
 * Creates/updates the bare mirror and makes sure `spec` is present in it.
 * A mirror that git can't read is deleted and re-cloned once.
 */
export async function syncMirror(
	ctx: GitContext,
	repo: RepoRef,
	spec: RefSpec,
): Promise<MirrorResult> {
	const dir = mirrorPath(ctx.config, repo);
	return withLock(dir, async () => {
		let cache: MirrorResult["cache"] = existsSync(dir) ? "hit" : "miss";
		try {
			return { path: dir, sha: await fetchInto(ctx, repo, dir, spec), cache };
		} catch (err) {
			if (!isCorruption(err)) throw err;
			await fs.rm(dir, { recursive: true, force: true });
			cache = "recloned";
			try {
				return { path: dir, sha: await fetchInto(ctx, repo, dir, spec), cache };
			} catch (retryErr) {
				if (isCorruption(retryErr)) {
					throw new RenderError(
						"GIT_CACHE_CORRUPT",
						"The git mirror is unreadable even after re-cloning.",
						{
							cause: retryErr,
							phase: "fetch",
						},
					);
				}
				throw retryErr;
			}
		}
	});
}

class CorruptMirror extends Error {}

function isCorruption(err: unknown): boolean {
	if (err instanceof CorruptMirror) return true;
	if (err instanceof RenderError && err.cause instanceof CommandError) {
		return /corrupt|bad object|did not send all necessary objects|unable to read|loose object .* is corrupt|fatal: not a git repository|missing blob|index file corrupt|packfile .* cannot be accessed/i.test(
			err.cause.result.stderr,
		);
	}
	return false;
}

async function fetchInto(
	ctx: GitContext,
	repo: RepoRef,
	dir: string,
	spec: RefSpec,
): Promise<string> {
	const g = (args: string[], timeoutSec?: number) =>
		git(ctx, ["--git-dir", dir, ...args], { timeoutSec }).catch((err) => {
			throw classifyGitError(err, "fetch", { extraRules: ctx.profile.rules });
		});

	if (!existsSync(path.join(dir, "HEAD"))) {
		await fs.mkdir(dir, { recursive: true });
		await g(["init", "--bare", "--quiet"]);
		await g(["config", "remote.origin.url", repo.url]);
		await g(["config", "remote.origin.promisor", "true"]);
		await g(["config", "remote.origin.partialclonefilter", "blob:none"]);
	} else {
		// Detect a broken mirror before trusting it.
		await g(["rev-parse", "--git-dir"]).catch((err) => {
			throw new CorruptMirror(String(err));
		});
		await g(["config", "remote.origin.url", repo.url]);
	}

	const fetchArgs = [
		"fetch",
		"--quiet",
		"--prune",
		"--no-tags",
		"--filter=blob:none",
		"origin",
	];
	const pinnable = spec.kind === "ref" || spec.sha.length >= 40;
	if (ctx.config.source.fetch === "single" && pinnable) {
		await g(
			[...fetchArgs, `+${spec.sha}:refs/ff/pinned`],
			ctx.config.limits.timeouts.git,
		);
	} else {
		await g(
			[...fetchArgs, "+refs/heads/*:refs/heads/*", "+refs/tags/*:refs/tags/*"],
			ctx.config.limits.timeouts.git,
		);
		// A commit outside branches/tags (e.g. a PR head) by full SHA.
		if (
			spec.kind === "sha" &&
			spec.sha.length >= 40 &&
			!(await hasCommit(ctx, dir, spec.sha))
		) {
			await g([...fetchArgs, spec.sha]).catch(() => undefined);
		}
	}

	if (spec.kind === "ref") {
		if (!(await hasCommit(ctx, dir, spec.sha))) {
			throw new RenderError(
				"REF_NOT_FOUND",
				`${spec.name} moved while fetching (force-push?); ${spec.sha.slice(0, 12)} is no longer reachable.`,
				{ phase: "fetch" },
			);
		}
		return spec.sha;
	}
	return resolveShaPrefix(ctx, dir, spec.sha);
}

async function hasCommit(
	ctx: GitContext,
	dir: string,
	sha: string,
): Promise<boolean> {
	try {
		await git(ctx, ["--git-dir", dir, "cat-file", "-e", `${sha}^{commit}`]);
		return true;
	} catch {
		return false;
	}
}

async function resolveShaPrefix(
	ctx: GitContext,
	dir: string,
	prefix: string,
): Promise<string> {
	try {
		const { stdout } = await git(ctx, [
			"--git-dir",
			dir,
			"rev-parse",
			"--verify",
			"--end-of-options",
			`${prefix}^{commit}`,
		]);
		return stdout.trim();
	} catch (err) {
		const stderr = err instanceof CommandError ? err.result.stderr : "";
		if (/ambiguous/i.test(stderr)) {
			throw new RenderError(
				"REF_AMBIGUOUS",
				`Commit prefix ${prefix} matches several commits; use more characters.`,
				{
					phase: "resolve",
				},
			);
		}
		throw new RenderError(
			"REF_NOT_FOUND",
			`Commit ${prefix} is not on any branch or tag of the remote.`,
			{
				phase: "resolve",
				hint: "Push the commit, or pass its full 40-character SHA.",
			},
		);
	}
}
