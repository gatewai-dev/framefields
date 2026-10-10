import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import type { CompositionsResponse } from "../cloud/client.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";
import { cloneRepo } from "./clone.js";
import { push } from "./sync.js";

const NAME = /^[A-Za-z0-9._-]{1,64}$/;

export function register(program: Command, wrap: Wrap) {
	const repo = program
		.command("repo")
		.description(
			"Create, view, fork and delete Framefields Cloud repositories",
		);

	repo
		.command("create")
		.description(
			"Create a cloud repository, add it as a git remote and link this directory",
		)
		.argument("[name]", "repository name (default: the directory name)")
		.option("--public", "anyone can fork it")
		.option("--private", "only your organization (default)")
		.option("-d, --description <text>", "description")
		.option("--remote <name>", "git remote to add", "origin")
		.option("--push", "push the current branch afterwards")
		.action(
			wrap(
				async (
					ctx,
					name: string | undefined,
					opts: {
						public?: boolean;
						private?: boolean;
						description?: string;
						remote: string;
						push?: boolean;
					},
				) => {
					if (opts.public && opts.private)
						throw usageError("--public and --private are exclusive");
					const project = await ctx.project().catch(() => undefined);
					const dir = (await git.topLevel(ctx.cwd)) ?? project?.root ?? ctx.cwd;
					const repoName =
						name ?? path.basename(dir).replace(/[^A-Za-z0-9._-]+/g, "-");
					if (!NAME.test(repoName))
						throw usageError(
							`'${repoName}' is not a valid repository name`,
							"use letters, digits, '.', '_' and '-'",
						);
					const existing = await git.remoteUrl(dir, opts.remote);
					if (existing) {
						throw new CliError(
							`this repository already has a '${opts.remote}' remote (${existing})`,
							{
								hint: `ff repo create ${repoName} --remote framefields`,
							},
						);
					}
					const client = await ctx.client();
					const created = await client.createRepo({
						name: repoName,
						description: opts.description,
						visibility: opts.public ? "public" : "private",
					});
					const { token: _token, ...repository } = created;
					if (!(await git.isRepo(dir))) {
						await git.gitOk(["init", "--quiet", "-b", created.defaultBranch], {
							cwd: dir,
						});
						ctx.out.info(`initialized git in ${ctx.relativeCwd(dir)}`);
					}
					await git.gitOk(["remote", "add", opts.remote, created.remoteUrl], {
						cwd: dir,
					});
					await ctx.link(dir, repository);
					let pushed = null;
					if (opts.push) {
						if (!(await git.gitMaybe(["rev-parse", "--verify", "HEAD"], dir))) {
							ctx.out.warn("nothing to push yet: commit first, then ff push");
						} else
							pushed = await push(ctx, {
								remote: opts.remote,
								repo: repository,
							});
					}
					ctx.out.result({ ...repository, pushed }, () => {
						ctx.out.line(`created ${repository.name} (${repository.id})`);
						ctx.out.line(`remote ${opts.remote} → ${repository.remoteUrl}`);
						if (pushed)
							ctx.out.line(
								`pushed ${pushed.branch} (${pushed.commitSha.slice(0, 7)})`,
							);
					});
				},
			),
		);

	repo
		.command("view")
		.description(
			"Show a repository: visibility, default branch, remote, compositions",
		)
		.argument("[repo]", "name or id (default: the linked repository)")
		.option("--web", "open it in the browser")
		.option("--ref <ref>", "branch to read compositions from")
		.action(
			wrap(
				async (
					ctx,
					ref: string | undefined,
					opts: { web?: boolean; ref?: string },
				) => {
					const r = await ctx.repo(ref);
					const client = await ctx.client();
					if (opts.web) {
						const url = `${client.host}/repos/${r.id}`;
						ctx.io.openUrl(url);
						ctx.out.result({ url }, () => ctx.out.line(url));
						return;
					}
					const compositions: CompositionsResponse | null = await client
						.compositions(r.id, opts.ref)
						.catch(() => null);
					ctx.out.result({ ...r, compositions }, () => {
						ctx.out.view([
							["name", r.name],
							["id", r.id],
							["description", r.description || undefined],
							["visibility", r.visibility],
							["default branch", r.defaultBranch],
							["remote", r.remoteUrl],
							["url", `${client.host}/repos/${r.id}`],
						]);
						if (compositions?.source === "invalid")
							ctx.out.line(
								`compositions: invalid framefields.json: ${compositions.error}`,
							);
						else if (compositions) {
							ctx.out.line(`compositions (${compositions.ref}):`);
							for (const c of compositions.compositions) {
								ctx.out.line(
									`  ${c.id}${c.default ? " (default)" : ""}  ${c.title}  ${c.entry}#${c.export}`,
								);
							}
						}
					});
				},
			),
		);

	repo
		.command("list")
		.description("List repositories in the organization")
		.action(
			wrap(async (ctx) => {
				const repos = await (await ctx.client()).listRepos();
				ctx.out.result(repos, () => {
					if (repos.length === 0)
						ctx.out.info("no repositories yet: ff repo create");
					ctx.out.table(
						repos.map((r) => ({ ...r, updated: r.updatedAt })),
						[
							{ key: "name", label: "name" },
							{ key: "id", label: "id" },
							{ key: "visibility", label: "visibility" },
							{ key: "defaultBranch", label: "branch" },
							{ key: "updated", label: "updated" },
						],
					);
				});
			}),
		);

	repo
		.command("fork")
		.description("Fork a repository (its assets are shared, not copied)")
		.argument("<repo>", "name or id")
		.option("--name <name>", "name of the fork (default <repo>-fork)")
		.option("--clone", "clone the fork")
		.action(
			wrap(
				async (ctx, ref: string, opts: { name?: string; clone?: boolean }) => {
					const source = await ctx.repo(ref);
					const { token: _token, ...fork } = await (
						await ctx.client()
					).forkRepo(source.id, { name: opts.name });
					const cloned = opts.clone ? await cloneRepo(ctx, fork) : null;
					ctx.out.result({ ...fork, cloned }, () => {
						ctx.out.line(`forked ${source.name} → ${fork.name} (${fork.id})`);
						if (cloned) ctx.out.line(cloned.directory);
					});
				},
			),
		);

	repo
		.command("delete")
		.description("Delete a repository")
		.argument("<repo>", "name or id")
		.action(
			wrap(async (ctx, ref: string) => {
				const r = await ctx.repo(ref);
				if (!ctx.yes) {
					if (!(await ctx.canPrompt()))
						throw usageError(
							`deleting ${r.name} needs confirmation`,
							`ff repo delete ${r.name} --yes`,
						);
					const typed = await ctx.io.prompt(`Type ${r.name} to delete it`);
					if (typed !== r.name)
						throw new CliError("not deleted: the name didn't match");
				}
				await (await ctx.client()).deleteRepo(r.id);
				ctx.out.result({ deleted: r.id, name: r.name }, () =>
					ctx.out.line(`deleted ${r.name}`),
				);
			}),
		);
}
