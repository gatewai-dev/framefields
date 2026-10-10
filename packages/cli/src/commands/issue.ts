import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import type { Wrap } from "../cli.js";
import type { Issue, IssueKind } from "../cloud/client.js";
import { readConfig } from "../config.js";
import type { Context } from "../context.js";
import { usageError } from "../errors.js";

const collect = (value: string, previous: string[] = []) => [
	...previous,
	value,
];

export function issueNumber(value: string): number {
	const n = Number(value.replace(/^#/, ""));
	if (!Number.isInteger(n) || n < 1)
		throw usageError(`'${value}' is not an issue or pull request number`);
	return n;
}

/** --body, --body-file (`-` for stdin), else the editor on a terminal, else `fallback`. */
export async function readBody(
	ctx: Context,
	opts: { body?: string; bodyFile?: string },
	fallback: string | undefined,
): Promise<string | undefined> {
	if (opts.body !== undefined && opts.bodyFile !== undefined)
		throw usageError("--body and --body-file are exclusive");
	if (opts.body !== undefined) return opts.body;
	if (opts.bodyFile === "-") return ctx.io.readStdin();
	if (opts.bodyFile !== undefined)
		return fs.readFileSync(path.resolve(ctx.cwd, opts.bodyFile), "utf8");
	if (fallback === undefined && (await ctx.canPrompt()))
		return editText(ctx, "");
	return fallback;
}

/** Opens the user's editor on a temp file and returns what they saved. */
async function editText(ctx: Context, initial: string): Promise<string> {
	const editor =
		(await readConfig(ctx.env)).editor ??
		ctx.env.VISUAL ??
		ctx.env.EDITOR ??
		"vi";
	const file = path.join(
		fs.mkdtempSync(path.join(os.tmpdir(), "ff-")),
		"BODY.md",
	);
	fs.writeFileSync(file, initial);
	try {
		const result = spawnSync(`${editor} "${file}"`, {
			stdio: "inherit",
			shell: true,
		});
		if (result.status !== 0)
			throw usageError(
				`${editor} exited with ${result.status}`,
				"pass --body or --body-file instead",
			);
		return fs.readFileSync(file, "utf8").trim();
	} finally {
		fs.rmSync(path.dirname(file), { recursive: true, force: true });
	}
}

const noun = (kind: IssueKind) => (kind === "pulls" ? "pull request" : "issue");

export function printIssue(ctx: Context, item: Issue, comments: boolean) {
	ctx.out.line(ctx.out.style("bold", `${item.title} #${item.number}`));
	ctx.out.view([
		["state", item.isDraft && item.state === "open" ? "draft" : item.state],
		["author", item.author?.name ?? null],
		["labels", item.labels.length ? item.labels.join(", ") : undefined],
		[
			"branches",
			item.kind === "pull" ? `${item.headRef} → ${item.baseRef}` : undefined,
		],
		["comments", item.commentCount],
		["created", item.createdAt],
		["merged", item.mergedAt ?? undefined],
	]);
	if (item.body.trim()) {
		ctx.out.line();
		ctx.out.line(item.body.trim());
	}
	if (comments) {
		for (const e of item.timeline ?? []) {
			ctx.out.line();
			const who = e.author?.name ?? "someone";
			if (e.kind === "comment") {
				ctx.out.line(ctx.out.style("dim", `${who} · ${e.createdAt}`));
				ctx.out.line(e.body ?? "");
			} else
				ctx.out.line(
					ctx.out.style("dim", `${who} ${e.kind} this · ${e.createdAt}`),
				);
		}
	}
}

/** list, view, comment, close, reopen and edit: the same for issues and pull requests. */
export function registerShared(parent: Command, kind: IssueKind, wrap: Wrap) {
	const what = noun(kind);

	parent
		.command("list")
		.description(`List ${what}s`)
		.option("-s, --state <state>", "open, closed or all", "open")
		.option("-S, --search <query>", "search titles and bodies")
		.option("-L, --limit <n>", "at most this many", "30")
		.action(
			wrap(
				async (
					ctx,
					opts: { state: string; search?: string; limit: string },
				) => {
					if (!["open", "closed", "all"].includes(opts.state))
						throw usageError("--state is open, closed or all");
					const repo = await ctx.repo();
					const res = await (await ctx.client()).listIssues(repo.id, kind, {
						state: opts.state,
						q: opts.search,
					});
					const items = res.items.slice(
						0,
						Math.max(1, Number(opts.limit) || 30),
					);
					ctx.out.result(items, () => {
						if (items.length === 0)
							ctx.out.info(
								`no ${opts.state === "all" ? "" : `${opts.state} `}${what}s in ${repo.name}`,
							);
						ctx.out.table(
							items.map((i) => ({
								number: `#${i.number}`,
								title: i.title,
								branch: i.headRef ? `${i.headRef} → ${i.baseRef}` : undefined,
								labels: i.labels.join(", "),
								state: i.isDraft && i.state === "open" ? "draft" : i.state,
								updated: i.updatedAt,
							})),
							[
								{ key: "number", label: "#" },
								{ key: "title", label: "title" },
								...(kind === "pulls"
									? [{ key: "branch", label: "branch" }]
									: [{ key: "labels", label: "labels" }]),
								{ key: "state", label: "state" },
								{ key: "updated", label: "updated" },
							],
						);
					});
				},
			),
		);

	parent
		.command("view")
		.description(`Show a ${what}`)
		.argument("<number>")
		.option("-c, --comments", "include comments and events")
		.action(
			wrap(async (ctx, n: string, opts: { comments?: boolean }) => {
				const repo = await ctx.repo();
				const item = await (await ctx.client()).getIssue(
					repo.id,
					kind,
					issueNumber(n),
				);
				ctx.out.result(item, () => printIssue(ctx, item, !!opts.comments));
			}),
		);

	parent
		.command("comment")
		.description(`Comment on a ${what}`)
		.argument("<number>")
		.option("-b, --body <text>", "comment text")
		.option(
			"-F, --body-file <file>",
			"read the comment from a file (- for stdin)",
		)
		.action(
			wrap(
				async (ctx, n: string, opts: { body?: string; bodyFile?: string }) => {
					const repo = await ctx.repo();
					const body = (await readBody(ctx, opts, undefined))?.trim();
					if (!body)
						throw usageError(
							"the comment is empty",
							`ff ${kind === "pulls" ? "pr" : "issue"} comment ${n} --body "…"`,
						);
					await (await ctx.client()).commentIssue(
						repo.id,
						kind,
						issueNumber(n),
						body,
					);
					ctx.out.result({ ok: true, number: issueNumber(n) }, () =>
						ctx.out.line(`commented on #${issueNumber(n)}`),
					);
				},
			),
		);

	parent
		.command("close")
		.description(`Close a ${what}`)
		.argument("<number>")
		.option("-c, --comment <text>", "leave a comment first")
		.action(
			wrap(async (ctx, n: string, opts: { comment?: string }) => {
				const repo = await ctx.repo();
				const client = await ctx.client();
				const num = issueNumber(n);
				if (opts.comment)
					await client.commentIssue(repo.id, kind, num, opts.comment);
				await client.updateIssue(repo.id, kind, num, { state: "closed" });
				ctx.out.result({ ok: true, number: num, state: "closed" }, () =>
					ctx.out.line(`closed #${num}`),
				);
			}),
		);

	parent
		.command("reopen")
		.description(`Reopen a ${what}`)
		.argument("<number>")
		.action(
			wrap(async (ctx, n: string) => {
				const repo = await ctx.repo();
				const num = issueNumber(n);
				await (await ctx.client()).updateIssue(repo.id, kind, num, {
					state: "open",
				});
				ctx.out.result({ ok: true, number: num, state: "open" }, () =>
					ctx.out.line(`reopened #${num}`),
				);
			}),
		);

	parent
		.command("edit")
		.description(`Edit a ${what}'s title, body or labels`)
		.argument("<number>")
		.option("-t, --title <title>", "new title")
		.option("-b, --body <text>", "new body")
		.option("-F, --body-file <file>", "read the body from a file (- for stdin)")
		.option("--add-label <label>", "add a label (repeatable)", collect, [])
		.option(
			"--remove-label <label>",
			"remove a label (repeatable)",
			collect,
			[],
		)
		.action(
			wrap(
				async (
					ctx,
					n: string,
					opts: {
						title?: string;
						body?: string;
						bodyFile?: string;
						addLabel: string[];
						removeLabel: string[];
					},
				) => {
					const repo = await ctx.repo();
					const client = await ctx.client();
					const num = issueNumber(n);
					const patch: Record<string, unknown> = {};
					if (opts.title !== undefined) patch.title = opts.title;
					const body =
						opts.body !== undefined || opts.bodyFile !== undefined
							? await readBody(ctx, opts, "")
							: undefined;
					if (body !== undefined) patch.body = body;
					if (opts.addLabel.length || opts.removeLabel.length) {
						const current = await client.getIssue(repo.id, kind, num);
						const labels = new Set(current.labels);
						for (const l of opts.addLabel) labels.add(l);
						for (const l of opts.removeLabel) labels.delete(l);
						patch.labels = [...labels];
					}
					if (Object.keys(patch).length === 0)
						throw usageError(
							"nothing to change",
							"pass --title, --body, --add-label or --remove-label",
						);
					await client.updateIssue(repo.id, kind, num, patch);
					ctx.out.result({ ok: true, number: num, ...patch }, () =>
						ctx.out.line(`updated #${num}`),
					);
				},
			),
		);
}

export function register(program: Command, wrap: Wrap) {
	const issue = program
		.command("issue")
		.description("Work with issues (gh-style)");

	issue
		.command("create")
		.description("Open an issue")
		.requiredOption("-t, --title <title>", "title")
		.option("-b, --body <text>", "body")
		.option("-F, --body-file <file>", "read the body from a file (- for stdin)")
		.option("-l, --label <label>", "add a label (repeatable)", collect, [])
		.action(
			wrap(
				async (
					ctx,
					opts: {
						title: string;
						body?: string;
						bodyFile?: string;
						label: string[];
					},
				) => {
					const repo = await ctx.repo();
					const body = (await readBody(ctx, opts, undefined)) ?? "";
					const created = await (await ctx.client()).createIssue(
						repo.id,
						"issues",
						{ title: opts.title, body, labels: opts.label },
					);
					const url = `${(await ctx.client()).host}/repos/${repo.id}/issues/${created.number}`;
					ctx.out.result({ ...created, url }, () => ctx.out.line(url));
				},
			),
		);

	registerShared(issue, "issues", wrap);
}
