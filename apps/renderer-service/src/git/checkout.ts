import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../errors.js";
import type { CheckoutResult, Pipeline } from "../jobs/pipeline.js";
import { resolveInside } from "../paths.js";
import { activeJanitor, markUsed } from "../worker/janitor.js";
import { openGitSession } from "./auth.js";
import { hostProfile } from "./hosts.js";
import { findPointers, pullLfs } from "./lfs.js";
import {
	type GitContext,
	git,
	listRemote,
	repoHash,
	resolveRef,
	syncMirror,
} from "./mirror.js";
import { checkoutWorkspace, initSubmodules } from "./workspace.js";

/**
 * Pipeline step: resolve → fetch → checkout → submodules → LFS (PLAN.md §6.2).
 * The ref is resolved once; everything after uses the SHA.
 */
export const checkout: Pipeline["checkout"] = async (job, ctx) => {
	const { input, repo, ref } = job;
	const source = input.source;
	const session = await openGitSession(repo, ctx.config, source.auth);
	const gctx: GitContext = {
		config: ctx.config,
		session,
		profile: hostProfile(repo.host, ctx.config),
		signal: ctx.signal,
	};

	try {
		ctx.progress({ phase: "resolving" });
		const spec = resolveRef(ref, await listRemote(gctx, repo));

		ctx.progress({ phase: "fetching" });
		const mirror = await syncMirror(gctx, repo, spec);
		await markUsed(mirror.path);
		if (source.commit && !mirror.sha.startsWith(source.commit.toLowerCase())) {
			throw new RenderError(
				"COMMIT_MISMATCH",
				`${ref} is at ${mirror.sha.slice(0, 12)}, not ${source.commit}.`,
				{
					phase: "resolve",
					hint: "The branch moved since the job was created.",
				},
			);
		}

		const ws = await checkoutWorkspace(gctx, repo, mirror.path, mirror.sha, {
			sparse: sparsePaths(source.sparse, source.workdir),
		});
		await markUsed(path.dirname(ws.root));
		if (source.submodules) await initSubmodules(gctx, ws.root, repo);

		const workdir = await resolveInside(ws.root, source.workdir).catch(
			(err) => {
				if (err instanceof RenderError) throw err;
				throw new RenderError(
					"JOB_INVALID",
					`workdir "${source.workdir}" does not exist at ${mirror.sha.slice(0, 12)}.`,
					{
						phase: "fetch",
					},
				);
			},
		);
		const scope = source.workdir === "." ? [] : [source.workdir];
		await assertSupportedFilters(gctx, ws.root, scope);

		ctx.progress({ phase: "lfs" });
		const include = source.lfs.include.length
			? source.lfs.include
			: ctx.config.source.lfsDefaultInclude;
		const lfs = await pullLfs(ws.root, gctx, {
			enabled: source.lfs.enabled,
			include,
			exclude: source.lfs.exclude,
			scope: include.length ? [] : scope,
			makeRoom: async (bytes) => {
				await activeJanitor()?.enforce([repoHash(repo)], bytes);
			},
		});
		const leftover = await findPointers(ws.root, source.workdir);
		if (leftover.length > 0) {
			ctx.warn(
				"LFS_POINTERS_LEFT",
				`LFS pointer files in the workdir were not downloaded (${leftover.slice(0, 5).join(", ")}${leftover.length > 5 ? ", …" : ""}). Widen source.lfs.include if the render needs them.`,
			);
		}

		return {
			root: ws.root,
			workdir,
			sha: mirror.sha,
			cache: {
				mirror: mirror.cache,
				workspace: ws.warm ? "warm" : "cold",
				lfs: lfs.cache,
			},
			release: async () => {},
		} satisfies CheckoutResult;
	} finally {
		await session.dispose();
	}
};

/** Sparse checkouts always include the workdir itself. */
function sparsePaths(
	sparse: string[] | undefined,
	workdir: string,
): string[] | undefined {
	if (!sparse?.length) return undefined;
	return workdir === "." || sparse.includes(workdir)
		? sparse
		: [...sparse, workdir];
}

/**
 * Files in scope routed through a filter other than LFS (git-crypt, …) would
 * be checked out encrypted or as placeholders: refuse them up front.
 */
async function assertSupportedFilters(
	ctx: GitContext,
	root: string,
	scope: string[],
): Promise<void> {
	const { stdout: attrFiles } = await git(ctx, [
		"-C",
		root,
		"ls-files",
		"-z",
		"--",
		".gitattributes",
		":(glob)**/.gitattributes",
	]).catch(() => ({ stdout: "" }));
	let suspicious = false;
	for (const file of attrFiles.split("\0").filter(Boolean)) {
		const text = await fs
			.readFile(path.join(root, file), "utf8")
			.catch(() => "");
		if (/filter=(?!lfs\b)[\w-]+/.test(text)) suspicious = true;
	}
	if (!suspicious) return;

	const { stdout: tracked } = await git(ctx, [
		"-C",
		root,
		"ls-files",
		"-z",
		"--",
		...(scope.length ? scope : ["."]),
	]);
	const { stdout } = await git(
		ctx,
		["-C", root, "check-attr", "--stdin", "-z", "filter"],
		{ input: tracked },
	);
	const parts = stdout.split("\0");
	const offending: string[] = [];
	for (let i = 0; i + 2 < parts.length; i += 3) {
		const [file, , value] = [parts[i], parts[i + 1], parts[i + 2]];
		if (!["unspecified", "unset", "lfs", "set", ""].includes(value))
			offending.push(`${file} (${value})`);
	}
	if (offending.length > 0) {
		throw new RenderError(
			"UNSUPPORTED_GIT_FILTER",
			`Files use git filters the renderer can't apply: ${offending.slice(0, 5).join(", ")}${offending.length > 5 ? ", …" : ""}`,
			{
				phase: "lfs",
				hint: "Only LFS is supported; decrypted assets must be committed or served over HTTPS.",
			},
		);
	}
}
