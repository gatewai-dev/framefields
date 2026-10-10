import path from "node:path";
import type { Command } from "commander";
import type { Project } from "framefields/project";
import {
	assetStatus,
	buildLockfile,
	LOCKFILE,
	planSync,
	pullAssets,
	readLockfile,
	upload,
	writeLockfile,
} from "../assets.js";
import type { Wrap } from "../cli.js";
import type { Context } from "../context.js";
import { CliError } from "../errors.js";
import * as git from "../git/index.js";

export interface SyncSummary {
	uploaded: string[];
	present: string[];
	removed: string[];
	skipped: { path: string; reason: string }[];
	lockfileChanged: boolean;
	dryRun: boolean;
}

/** The linked repository's id, if this directory has one (asset diffs can be org-wide without it). */
async function linkedRepoId(ctx: Context): Promise<string | undefined> {
	const root = await git.topLevel(ctx.cwd);
	if (!root) return undefined;
	return git.configGet(root, "framefields.repo");
}

/** Hash, upload what the cloud lacks, rewrite the lockfile. No git. */
export async function syncAssets(
	ctx: Context,
	project: Project,
	options: { dryRun?: boolean; repoId?: string } = {},
): Promise<SyncSummary> {
	const client = await ctx.client();
	client.requireToken();
	const repoId = options.repoId ?? (await linkedRepoId(ctx));
	ctx.out.info(`hashing ${project.assets.directory}/`);
	const plan = await planSync(client, repoId, project);
	const byHash = new Map(plan.assets.map((a) => [a.sha256, a]));
	const uploaded: string[] = [];
	for (const s of plan.skipped) ctx.out.warn(`skipping ${s.path}: ${s.reason}`);
	if (!options.dryRun) {
		for (const ticket of plan.missing) {
			const asset = byHash.get(ticket.sha256);
			if (!asset) continue;
			let lastPct = -1;
			await upload(
				client,
				ticket,
				path.join(project.root, asset.path),
				asset.size,
				({ bytes, total, done }) => {
					const pct = Math.floor((bytes / Math.max(1, total)) * 100);
					if (done)
						ctx.out.info(`uploaded ${asset.path} (${formatBytes(total)})`);
					else if (pct !== lastPct && pct % 10 === 0 && total > 8 * 1024 * 1024)
						ctx.out.info(`  ${asset.path} ${pct}%`);
					lastPct = pct;
				},
				asset.path,
			);
			uploaded.push(asset.path);
		}
	}
	const missingHashes = new Set(plan.missing.map((t) => t.sha256));
	const toUpload = plan.assets
		.filter((a) => missingHashes.has(a.sha256))
		.map((a) => a.path);
	let lockfileChanged = false;
	if (!options.dryRun) {
		lockfileChanged = writeLockfile(
			project,
			buildLockfile(readLockfile(project), plan.assets, repoId),
		);
	}
	return {
		uploaded: options.dryRun ? toUpload : uploaded,
		present: plan.assets
			.filter((a) => !missingHashes.has(a.sha256))
			.map((a) => a.path),
		removed: plan.removed,
		skipped: plan.skipped,
		lockfileChanged,
		dryRun: !!options.dryRun,
	};
}

export function printSync(ctx: Context, s: SyncSummary) {
	const verb = s.dryRun ? "would upload" : "uploaded";
	ctx.out.line(
		`${verb} ${s.uploaded.length}, already in cloud ${s.present.length}${s.removed.length ? `, dropped ${s.removed.length} no longer on disk` : ""}`,
	);
	for (const p of s.uploaded) ctx.out.line(`  + ${p}`);
	for (const p of s.removed) ctx.out.line(`  - ${p}`);
	if (!s.dryRun)
		ctx.out.line(
			s.lockfileChanged ? `${LOCKFILE} updated` : `${LOCKFILE} unchanged`,
		);
}

export async function pullProjectAssets(
	ctx: Context,
	project: Project,
	force = false,
) {
	const client = await ctx.client();
	client.requireToken();
	const result = await pullAssets(client, project, {
		force,
		onFile: (p) => ctx.out.info(`downloading ${p}`),
	});
	for (const f of result.failed) ctx.out.warn(`${f.path}: ${f.error}`);
	return result;
}

export function register(program: Command, wrap: Wrap) {
	const asset = program
		.command("asset")
		.description("Sync external assets with Framefields Cloud");

	asset
		.command("sync")
		.description(
			`Hash the assets directory, upload what the cloud lacks, rewrite ${LOCKFILE}`,
		)
		.option("--dry-run", "show what would be uploaded")
		.action(
			wrap(async (ctx, opts: { dryRun?: boolean }) => {
				const project = await ctx.project();
				const summary = await syncAssets(ctx, project, { dryRun: opts.dryRun });
				ctx.out.result(summary, () => printSync(ctx, summary));
			}),
		);

	asset
		.command("pull")
		.description(
			`Download ${LOCKFILE} entries missing on disk, verifying each SHA-256`,
		)
		.option("--force", "download every entry again")
		.action(
			wrap(async (ctx, opts: { force?: boolean }) => {
				const project = await ctx.project();
				if (!readLockfile(project)) {
					ctx.out.result({ downloaded: [], present: [], failed: [] }, () =>
						ctx.out.line(`no ${LOCKFILE}: nothing to pull`),
					);
					return;
				}
				const result = await pullProjectAssets(ctx, project, opts.force);
				ctx.out.result(result, () => {
					ctx.out.line(
						`downloaded ${result.downloaded.length}, already present ${result.present.length}`,
					);
					for (const p of result.downloaded) ctx.out.line(`  ${p}`);
				});
				if (result.failed.length)
					throw new CliError(
						`${result.failed.length} asset(s) failed to download`,
						{ hint: "ff asset pull" },
					);
			}),
		);

	asset
		.command("status")
		.description(
			"Local files vs lockfile vs cloud: new, modified, missing, not uploaded",
		)
		.action(
			wrap(async (ctx) => {
				const project = await ctx.project();
				const client = await ctx.client();
				const status = await assetStatus(
					client.token ? client : undefined,
					await linkedRepoId(ctx),
					project,
				);
				ctx.out.result(status, () => {
					const groups: [keyof typeof status, string, string][] = [
						["new", "new (not in the lockfile)", "ff asset sync"],
						["modified", "modified", "ff asset sync"],
						["missing", "missing on disk", "ff asset pull"],
						["notUploaded", "not in the cloud", "ff asset sync"],
					];
					let clean = true;
					for (const [key, label, fix] of groups) {
						if (status[key].length === 0) continue;
						clean = false;
						ctx.out.line(`${label} (${fix}):`);
						for (const p of status[key]) ctx.out.line(`  ${p}`);
					}
					if (clean) ctx.out.line(`${status.ok.length} assets, all in sync`);
					if (!client.token)
						ctx.out.info(
							"not logged in: cloud state not checked (ff auth login)",
						);
				});
			}),
		);
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let v = n / 1024;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}
