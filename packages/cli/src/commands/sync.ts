/** `ff push` and `ff pull`: git plus external assets. */
import path from "node:path";
import type { Command } from "commander";
import { loadProject } from "framefields/project";
import { LOCKFILE, readLockfile } from "../assets.js";
import type { Wrap } from "../cli.js";
import type { Repository } from "../cloud/client.js";
import { type Context, fromProjectError } from "../context.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";
import {
	formatBytes,
	printSync,
	pullProjectAssets,
	type SyncSummary,
	syncAssets,
} from "./asset.js";

export interface PushResult {
	remote: string;
	branch: string;
	ref: string;
	commitSha: string;
	assets: SyncSummary | null;
	lockfileCommitted: boolean;
	assetRefs: Record<string, unknown> | null;
	lockfile: { assets: number; bytes: number } | null;
}

/** Streams git's progress to stderr unless --quiet or --json. */
const gitProgress = (ctx: Context) =>
	ctx.out.options.quiet || ctx.out.json
		? undefined
		: (t: string) => ctx.io.stderr(t);

/**
 * 1. ff asset sync. 2. Commit framefields.assets.json if it changed.
 * 3. git push with a short-lived token. 4. Record the ref's lockfile.
 */
export async function push(
	ctx: Context,
	options: { remote?: string; branch?: string; repo?: Repository } = {},
): Promise<PushResult> {
	const root = await ctx.gitRoot();
	const repo = options.repo ?? (await ctx.repo());
	const client = await ctx.client();
	const remote = options.remote ?? "origin";
	const branch = options.branch ?? (await git.currentBranch(root));
	if (!branch)
		throw usageError(
			"HEAD is detached: which branch?",
			`ff push ${remote} <branch>`,
		);
	if (!(await git.remoteUrl(root, remote))) {
		throw new CliError(`no git remote named '${remote}'`, {
			hint: `git remote add ${remote} ${repo.remoteUrl}`,
		});
	}

	// The project, if this repo has one (its assets ride along with the push).
	const project = await loadProject(ctx.cwd).catch((err: unknown) => {
		const mapped = fromProjectError(err);
		if (
			mapped instanceof CliError &&
			mapped.code === "project" &&
			/no framefields project/.test(mapped.message)
		)
			return undefined;
		throw mapped;
	});
	let assets: SyncSummary | null = null;
	let lockfileCommitted = false;
	if (project) {
		assets = await syncAssets(ctx, project, { repoId: repo.id });
		if (!ctx.out.json && (assets.uploaded.length || assets.removed.length))
			printSync(ctx, assets);
		const lockRel = path
			.relative(root, path.join(project.root, LOCKFILE))
			.split(path.sep)
			.join("/");
		const changed = await git.gitOk(["status", "--porcelain", "--", lockRel], {
			cwd: root,
		});
		if (changed) {
			const onBranch = await git.currentBranch(root);
			if (onBranch !== branch) {
				ctx.out.warn(
					`${LOCKFILE} changed but ${branch} is not checked out; commit it on ${branch} yourself`,
				);
			} else {
				await git.gitOk(["add", "--", lockRel], { cwd: root });
				await git.gitOk(
					[
						"commit",
						"--quiet",
						"-m",
						"assets: sync external assets",
						"--",
						lockRel,
					],
					{ cwd: root },
				);
				lockfileCommitted = true;
				ctx.out.info(`committed ${lockRel} (assets: sync external assets)`);
			}
		}
	}

	const { token } = await client.gitToken(repo.id, "write");
	const result = await git.git(
		[
			"push",
			"--porcelain",
			remote,
			`refs/heads/${branch}:refs/heads/${branch}`,
		],
		{
			cwd: root,
			token,
			onStderr: gitProgress(ctx),
		},
	);
	if (result.code !== 0) {
		throw new CliError(
			`git push failed:\n  ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n  ")}`,
			{
				hint: /rejected|non-fast-forward|fetch first/.test(
					result.stderr + result.stdout,
				)
					? "ff pull, then ff push again"
					: undefined,
			},
		);
	}
	const commitSha = await git.gitOk(["rev-parse", `refs/heads/${branch}`], {
		cwd: root,
	});
	const ref = `refs/heads/${branch}`;
	let assetRefs: Record<string, unknown> | null = null;
	let lockSummary: PushResult["lockfile"] = null;
	const lock = project ? readLockfile(project) : undefined;
	if (lock) {
		assetRefs = await client.putAssetRefs(repo.id, {
			ref,
			commitSha,
			lockfile: lock,
		});
		const entries = Object.values(lock.assets);
		lockSummary = {
			assets: entries.length,
			bytes: entries.reduce((s, e) => s + (e.size ?? e.sizeBytes ?? 0), 0),
		};
	}
	return {
		remote,
		branch,
		ref,
		commitSha,
		assets,
		lockfileCommitted,
		assetRefs,
		lockfile: lockSummary,
	};
}

export function register(program: Command, wrap: Wrap) {
	program
		.command("push")
		.description(
			`Sync assets, commit ${LOCKFILE} if it changed, git push, and record the ref's assets`,
		)
		.argument("[remote]", "git remote", "origin")
		.argument("[branch]", "branch (default: the current branch)")
		.option(
			"--delete <branch>",
			"delete a remote branch and release its assets",
		)
		.action(
			wrap(
				async (
					ctx,
					remote: string,
					branch: string | undefined,
					opts: { delete?: string },
				) => {
					if (opts.delete) {
						const root = await ctx.gitRoot();
						const repo = await ctx.repo();
						const client = await ctx.client();
						const { token } = await client.gitToken(repo.id, "write");
						await git.gitOk(["push", remote, "--delete", opts.delete], {
							cwd: root,
							token,
							onStderr: gitProgress(ctx),
						});
						const released = await client.deleteAssetRefs(
							repo.id,
							`refs/heads/${opts.delete}`,
						);
						ctx.out.result({ deleted: opts.delete, released }, () =>
							ctx.out.line(`deleted ${remote}/${opts.delete}`),
						);
						return;
					}
					const result = await push(ctx, { remote, branch });
					ctx.out.result(result, () => {
						ctx.out.line(
							`pushed ${result.branch} → ${result.remote} (${result.commitSha.slice(0, 7)})`,
						);
						if (result.lockfile) {
							ctx.out.line(
								`${LOCKFILE}: ${result.lockfile.assets} assets, ${formatBytes(result.lockfile.bytes)} recorded for ${result.ref}`,
							);
						}
					});
				},
			),
		);

	program
		.command("pull")
		.description("git pull, then download assets the lockfile needs")
		.argument("[remote]", "git remote", "origin")
		.argument("[branch]", "branch (default: the current branch's upstream)")
		.action(
			wrap(async (ctx, remote: string, branch: string | undefined) => {
				const root = await ctx.gitRoot();
				const repo = await ctx.repo();
				const client = await ctx.client();
				const { token } = await client.gitToken(repo.id, "read");
				const args = ["pull", "--ff", remote, ...(branch ? [branch] : [])];
				const result = await git.git(args, {
					cwd: root,
					token,
					onStderr: gitProgress(ctx),
				});
				if (result.code !== 0) {
					throw new CliError(
						`git pull failed:\n  ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n  ")}`,
					);
				}
				const project = await ctx.project().catch(() => undefined);
				const assets =
					project && readLockfile(project)
						? await pullProjectAssets(ctx, project)
						: null;
				ctx.out.result({ git: result.stdout.trim(), assets }, () => {
					if (result.stdout.trim()) ctx.out.line(result.stdout.trim());
					if (assets)
						ctx.out.line(
							`assets: downloaded ${assets.downloaded.length}, already present ${assets.present.length}`,
						);
				});
				if (assets?.failed.length)
					throw new CliError(
						`${assets.failed.length} asset(s) failed to download`,
						{ hint: "ff asset pull" },
					);
			}),
		);
}
