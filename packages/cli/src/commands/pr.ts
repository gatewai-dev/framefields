import type { Command } from "commander";
import { loadProject } from "framefields/project";
import { readLockfile } from "../assets.js";
import type { Wrap } from "../cli.js";
import type { Repository } from "../cloud/client.js";
import type { Context } from "../context.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";
import { pullProjectAssets } from "./asset.js";
import { issueNumber, readBody, registerShared } from "./issue.js";
import { push } from "./sync.js";

const collect = (value: string, previous: string[] = []) => [
	...previous,
	value,
];

export function register(program: Command, wrap: Wrap) {
	const pr = program
		.command("pr")
		.description("Work with pull requests (gh-style)");

	pr.command("create")
		.description("Open a pull request; pushes the head branch first if needed")
		.option(
			"-B, --base <branch>",
			"branch to merge into (default: the repository's default branch)",
		)
		.option(
			"-H, --head <branch>",
			"branch with the changes (default: the current branch)",
		)
		.option("-t, --title <title>", "title")
		.option("-b, --body <text>", "body")
		.option("-F, --body-file <file>", "read the body from a file (- for stdin)")
		.option("-l, --label <label>", "add a label (repeatable)", collect, [])
		.option("-d, --draft", "open as a draft")
		.option("--remote <name>", "git remote", "origin")
		.action(
			wrap(
				async (
					ctx,
					opts: {
						base?: string;
						head?: string;
						title?: string;
						body?: string;
						bodyFile?: string;
						label: string[];
						draft?: boolean;
						remote: string;
					},
				) => {
					const root = await ctx.gitRoot();
					const repo = await ctx.repo();
					const client = await ctx.client();
					const head = opts.head ?? (await git.currentBranch(root));
					if (!head)
						throw usageError(
							"HEAD is detached: which branch?",
							"ff pr create --head <branch>",
						);
					const base = opts.base ?? repo.defaultBranch;
					if (head === base)
						throw usageError(
							`head and base are both '${base}'`,
							"create a branch for your changes: git switch -c <branch>",
						);
					let title = opts.title;
					if (!title && (await ctx.canPrompt()))
						title = await ctx.io.prompt("Title");
					if (!title)
						throw usageError(
							"a pull request needs a title",
							'ff pr create --title "…"',
						);
					const body = (await readBody(ctx, opts, undefined)) ?? "";

					// Push the head branch when the remote doesn't have it as it is here.
					const local = await git.gitMaybe(
						["rev-parse", "--verify", `refs/heads/${head}`],
						root,
					);
					if (local) {
						const remote = await git.gitMaybe(
							["rev-parse", "--verify", `refs/remotes/${opts.remote}/${head}`],
							root,
						);
						if (remote !== local) {
							ctx.out.info(`pushing ${head}`);
							await push(ctx, { remote: opts.remote, branch: head, repo });
						}
					}
					const created = await client.createIssue(repo.id, "pulls", {
						title,
						body,
						labels: opts.label,
						headRef: head,
						baseRef: base,
						draft: !!opts.draft,
					});
					const url = `${client.host}/repos/${repo.id}/pulls/${created.number}`;
					ctx.out.result({ ...created, url }, () => ctx.out.line(url));
				},
			),
		);

	registerShared(pr, "pulls", wrap);

	pr.command("ready")
		.description("Mark a draft pull request ready for review")
		.argument("<number>")
		.action(
			wrap(async (ctx, n: string) => {
				const repo = await ctx.repo();
				const num = issueNumber(n);
				await (await ctx.client()).updateIssue(repo.id, "pulls", num, {
					draft: false,
				});
				ctx.out.result({ ok: true, number: num, isDraft: false }, () =>
					ctx.out.line(`#${num} is ready for review`),
				);
			}),
		);

	pr.command("merge")
		.description(
			"Merge head into base with local git, push base, then record the merge",
		)
		.argument("<number>")
		.option("--squash", "squash the changes into one commit")
		.option("--merge", "create a merge commit (default)")
		.option("-d, --delete-branch", "delete the head branch afterwards")
		.option("--remote <name>", "git remote", "origin")
		.action(
			wrap(
				async (
					ctx,
					n: string,
					opts: {
						squash?: boolean;
						merge?: boolean;
						deleteBranch?: boolean;
						remote: string;
					},
				) => {
					if (opts.squash && opts.merge)
						throw usageError("--squash and --merge are exclusive");
					const root = await ctx.gitRoot();
					const repo = await ctx.repo();
					const client = await ctx.client();
					const num = issueNumber(n);
					const pull = await client.getIssue(repo.id, "pulls", num);
					if (pull.state !== "open")
						throw new CliError(`#${num} is ${pull.state}`);
					if (pull.isDraft)
						throw new CliError(`#${num} is a draft`, {
							hint: `ff pr ready ${num}`,
						});
					const head = pull.headRef as string;
					const base = pull.baseRef as string;
					if ((await git.dirtyFiles(root)).length) {
						throw new CliError("you have uncommitted changes", {
							hint: "commit or stash them, then ff pr merge again",
						});
					}
					const original = await git.currentBranch(root);
					const remote = opts.remote;
					await fetchBranches(ctx, root, repo, remote, [base, head]);
					await checkoutTracking(root, remote, base);

					const message = opts.squash
						? `${pull.title} (#${num})`
						: `Merge pull request #${num} from ${head}`;
					const merged = await git.git(
						opts.squash
							? ["merge", "--squash", `${remote}/${head}`]
							: ["merge", "--no-ff", "-m", message, `${remote}/${head}`],
						{ cwd: root },
					);
					if (merged.code !== 0) {
						await git.git(["merge", "--abort"], { cwd: root });
						await git.git(["reset", "--hard", "--quiet", "HEAD"], {
							cwd: root,
						});
						if (original && original !== base)
							await git.git(["checkout", "--quiet", original], { cwd: root });
						throw new CliError(`${head} does not merge cleanly into ${base}`, {
							hint: `merge ${base} into ${head}, resolve the conflicts, ff push, then ff pr merge ${num}`,
						});
					}
					if (opts.squash)
						await git.gitOk(["commit", "--quiet", "-m", message], {
							cwd: root,
						});

					const pushed = await push(ctx, { remote, branch: base, repo });
					const recorded = await client.mergePull(repo.id, num);

					if (opts.deleteBranch) {
						const { token } = await client.gitToken(repo.id, "write");
						await git.git(["push", remote, "--delete", head], {
							cwd: root,
							token,
						});
						await client
							.deleteAssetRefs(repo.id, `refs/heads/${head}`)
							.catch(() => {});
						if (original !== head)
							await git.git(["branch", "-D", head], { cwd: root });
					}
					const back =
						original &&
						original !== base &&
						!(opts.deleteBranch && original === head)
							? original
							: undefined;
					if (back)
						await git.gitOk(["checkout", "--quiet", back], { cwd: root });
					ctx.out.result(
						{ ...recorded, base, head, commitSha: pushed.commitSha },
						() =>
							ctx.out.line(
								`merged #${num} (${head} → ${base}, ${pushed.commitSha.slice(0, 7)})`,
							),
					);
				},
			),
		);

	pr.command("checkout")
		.description("Check out a pull request's head branch")
		.argument("<number>")
		.option("--remote <name>", "git remote", "origin")
		.action(
			wrap(async (ctx, n: string, opts: { remote: string }) => {
				const root = await ctx.gitRoot();
				const repo = await ctx.repo();
				const pull = await (await ctx.client()).getIssue(
					repo.id,
					"pulls",
					issueNumber(n),
				);
				const head = pull.headRef as string;
				if ((await git.dirtyFiles(root)).length) {
					throw new CliError("you have uncommitted changes", {
						hint: "commit or stash them first",
					});
				}
				await fetchBranches(ctx, root, repo, opts.remote, [head]);
				await checkoutTracking(root, opts.remote, head);
				const project = await loadProject(ctx.cwd).catch(() => undefined);
				const assets =
					project && readLockfile(project)
						? await pullProjectAssets(ctx, project)
						: null;
				ctx.out.result({ branch: head, assets }, () =>
					ctx.out.line(`switched to ${head}`),
				);
			}),
		);
}

async function fetchBranches(
	ctx: Context,
	root: string,
	repo: Repository,
	remote: string,
	branches: string[],
) {
	const { token } = await (await ctx.client()).gitToken(repo.id, "read");
	await git.gitOk(
		[
			"fetch",
			"--quiet",
			remote,
			...branches.map((b) => `+refs/heads/${b}:refs/remotes/${remote}/${b}`),
		],
		{ cwd: root, token },
	);
}

/** Checks out `branch`, creating it from (or fast-forwarding it to) `remote/branch`. */
async function checkoutTracking(root: string, remote: string, branch: string) {
	const exists = await git.gitMaybe(
		["rev-parse", "--verify", `refs/heads/${branch}`],
		root,
	);
	if (!exists) {
		await git.gitOk(
			["checkout", "--quiet", "-b", branch, "--track", `${remote}/${branch}`],
			{ cwd: root },
		);
		return;
	}
	await git.gitOk(["checkout", "--quiet", branch], { cwd: root });
	const ff = await git.git(
		["merge", "--ff-only", "--quiet", `${remote}/${branch}`],
		{ cwd: root },
	);
	if (ff.code !== 0) {
		throw new CliError(
			`local ${branch} has diverged from ${remote}/${branch}`,
			{
				hint: `reconcile it (git pull --rebase ${remote} ${branch}), then try again`,
			},
		);
	}
}
