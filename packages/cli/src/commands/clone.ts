import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { loadProject } from "framefields/project";
import { readLockfile } from "../assets.js";
import type { Wrap } from "../cli.js";
import type { Repository } from "../cloud/client.js";
import type { Context } from "../context.js";
import { CliError } from "../errors.js";
import * as git from "../git/index.js";
import { pullProjectAssets } from "./asset.js";

/** `git clone` with a read token for this one invocation, link the directory, then pull assets. */
export async function cloneRepo(ctx: Context, repo: Repository, dir?: string) {
	const target = path.resolve(ctx.cwd, dir ?? repo.name);
	if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
		throw new CliError(
			`${ctx.relativeCwd(target)} already exists and is not empty`,
			{ hint: `ff clone ${repo.name} <dir>` },
		);
	}
	const client = await ctx.client();
	const { token } = await client.gitToken(repo.id, "read");
	const progress =
		ctx.out.options.quiet || ctx.out.json
			? undefined
			: (t: string) => ctx.io.stderr(t);
	const result = await git.git(["clone", repo.remoteUrl, target], {
		cwd: ctx.cwd,
		token,
		onStderr: progress,
	});
	if (result.code !== 0) {
		throw new CliError(
			`git clone failed:\n  ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join("\n  ")}`,
		);
	}
	await ctx.link(target, repo);
	const project = await loadProject(target).catch(() => undefined);
	const assets =
		project && readLockfile(project)
			? await pullProjectAssets(ctx, project)
			: null;
	return { directory: ctx.relativeCwd(target), repository: repo, assets };
}

export function register(program: Command, wrap: Wrap) {
	program
		.command("clone")
		.description("Clone a Framefields Cloud repository and download its assets")
		.argument("<repo>", "repository name or id")
		.argument("[dir]", "directory (default: the repository name)")
		.action(
			wrap(async (ctx, ref: string, dir: string | undefined) => {
				const repo = await ctx.repo(ref);
				const result = await cloneRepo(ctx, repo, dir);
				ctx.out.result(result, () => {
					ctx.out.line(result.directory);
					if (result.assets)
						ctx.out.info(
							`assets: downloaded ${result.assets.downloaded.length}`,
						);
				});
				if (result.assets?.failed.length) {
					throw new CliError(
						`${result.assets.failed.length} asset(s) failed to download`,
						{
							hint: `cd ${result.directory} && ff asset pull`,
						},
					);
				}
			}),
		);
}
