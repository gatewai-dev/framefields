import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { RendererConfig } from "../config/index.js";
import {
	moduleStoreDir,
	readManifests,
	releaseKeys,
	sweepStore,
} from "../install/shared-modules.js";
import { rendererLogger } from "../logger.js";

/** Marker whose mtime records when a mirror or workspace was last used. */
export const LAST_USED = ".ff-last-used";

const GB = 1024 ** 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Mirrors owned by other workers on a shared volume are only evicted when idle this long. */
const FOREIGN_MIRROR_IDLE_MS = 60 * 60 * 1000;
/** Package caches, evicted whole and only as a last resort. */
const STORES = [
	"pnpm-store",
	"npm-cache",
	"yarn-cache",
	"yarn-berry",
	"corepack",
];

let current: CacheJanitor | undefined;

/** The worker's janitor, for emergency eviction (e.g. the LFS disk preflight). */
export function activeJanitor(): CacheJanitor | undefined {
	return current;
}

export async function markUsed(dir: string): Promise<void> {
	const marker = path.join(dir, LAST_USED);
	const now = new Date();
	await fs.utimes(marker, now, now).catch(() => fs.writeFile(marker, ""));
}

/** A filesystem as statfs sees it. */
export interface DiskInfo {
	/** Identifies the filesystem: dirs with equal ids share free space. */
	id: string;
	totalBytes: number;
	freeBytes: number;
}

export type DiskProbe = (dir: string) => Promise<DiskInfo>;

const statDisk: DiskProbe = async (dir) => {
	const [fsStat, stat] = await Promise.all([fs.statfs(dir), fs.stat(dir)]);
	return {
		id: String(stat.dev),
		totalBytes: Number(fsStat.blocks) * Number(fsStat.bsize),
		freeBytes: Number(fsStat.bavail) * Number(fsStat.bsize),
	};
};

interface Candidate {
	path: string;
	bytes: number;
	lastUsed: number;
	kind: string;
}

/** One eviction stage on one disk: removes items until `enough()` says stop. */
type Stage = (
	enough: () => Promise<boolean>,
	removed: string[],
) => Promise<void>;

/**
 * Keeps the workspace and cache disks from filling up (PLAN.md §6.4). Runs
 * between jobs, so nothing it deletes is in use.
 *
 * Free space decides: when a disk has less free than
 * max(FF_DISK_MIN_FREE_PCT, FF_DISK_MIN_FREE_GB), the janitor evicts until
 * FF_DISK_TARGET_FREE_PCT is free. Order: workspaces (LRU) and the shared
 * module files only they used, then LFS objects (LRU), then git mirrors (LRU),
 * then whole package caches. When FF_WORK_DIR and FF_CACHE_DIR are on the
 * same disk the stages run in that order against one free-space figure.
 * FF_WORK_MAX_GB / FF_CACHE_MAX_GB optionally cap usage on top. Pinned vision
 * models are never evicted.
 */
export class CacheJanitor {
	private lastRun = 0;

	constructor(
		private readonly config: RendererConfig,
		private readonly workerId: string,
		private readonly intervalMs = 5 * 60 * 1000,
		private readonly disk: DiskProbe = statDisk,
		/** Repo hashes never evicted, whoever asks (e.g. the bound engine's). */
		private readonly alwaysProtect: () => readonly string[] = () => [],
	) {
		current = this;
	}

	/**
	 * Before each job: evicts right away when a disk is low on space (cheap
	 * statfs check), otherwise at most once per interval. Never throws.
	 */
	async maybeRun(protect: readonly string[], force = false): Promise<void> {
		const due = force || Date.now() - this.lastRun >= this.intervalMs;
		if (!due && !(await this.lowOnSpace().catch(() => false))) return;
		this.lastRun = Date.now();
		try {
			await this.enforce(protect);
		} catch (err) {
			rendererLogger.warn({ err: String(err) }, "Cache eviction failed");
		}
	}

	/** Free space per disk, for logs and /health. */
	async describeDisks(): Promise<
		Record<string, { freeGb: number; totalGb: number }>
	> {
		const { workDir, cacheDir } = this.config.paths;
		const out: Record<string, { freeGb: number; totalGb: number }> = {};
		for (const [name, dir] of [
			["work", workDir],
			["cache", cacheDir],
		] as const) {
			const d = await this.disk(dir);
			out[name] = {
				freeGb: Math.round((d.freeBytes / GB) * 10) / 10,
				totalGb: Math.round((d.totalBytes / GB) * 10) / 10,
			};
		}
		return out;
	}

	private thresholds(d: DiskInfo, extra = 0) {
		const { minFreePct, minFreeGb, targetFreePct } = this.config.paths;
		// A fixed GB floor can't demand most of a small disk.
		const floor = Math.min(minFreeGb * GB, d.totalBytes * 0.5);
		const low = Math.max((d.totalBytes * minFreePct) / 100, floor) + extra;
		const target = Math.max(
			Math.min((d.totalBytes * targetFreePct) / 100, d.totalBytes * 0.6),
			low,
		);
		return { low, target };
	}

	private async lowOnSpace(): Promise<boolean> {
		const { workDir, cacheDir } = this.config.paths;
		for (const dir of [workDir, cacheDir]) {
			if (!existsSync(dir)) continue;
			const d = await this.disk(dir);
			if (d.freeBytes < this.thresholds(d).low) return true;
		}
		return false;
	}

	/**
	 * Evicts until each disk has its target free space and the optional caps
	 * hold. `protect` lists repo hashes the next job needs (its workspace and
	 * mirror stay). `extraBytes` raises the bar, for a download that is about
	 * to need that much (LFS).
	 */
	async enforce(
		protectOnly: readonly string[],
		extraBytes = 0,
	): Promise<string[]> {
		const protect = [...protectOnly, ...this.alwaysProtect()];
		const removed: string[] = [];
		const { workDir, cacheDir, workMaxGb, cacheMaxGb } = this.config.paths;
		await fs.mkdir(workDir, { recursive: true });
		await fs.mkdir(cacheDir, { recursive: true });

		// Failed-job dirs kept for debugging expire after a day.
		for (const dir of await children(path.join(workDir, "jobs"))) {
			if (Date.now() - (await mtime(dir)) > DAY_MS) {
				await remove(dir, removed);
			}
		}

		const workStages: Stage[] = [
			(enough, out) => this.evictWorkspaces(protect, enough, out),
			async () => {
				await sweepStore(moduleStoreDir(workDir));
			},
		];
		const cacheStages: Stage[] = [
			(enough, out) =>
				evictEach(lfsObjects(path.join(cacheDir, "lfs")), enough, out),
			async (enough, out) => evictEach(this.mirrors(protect), enough, out),
			(enough, out) => evictEach(this.stores(), enough, out, false),
		];

		// Free space, per disk.
		const [work, cache] = await Promise.all([
			this.disk(workDir),
			this.disk(cacheDir),
		]);
		const disks =
			work.id === cache.id
				? [{ dir: workDir, stages: [...workStages, ...cacheStages] }]
				: [
						{ dir: workDir, stages: workStages },
						{ dir: cacheDir, stages: cacheStages },
					];
		for (const { dir, stages } of disks) {
			const first = await this.disk(dir);
			const { low, target } = this.thresholds(first, extraBytes);
			if (first.freeBytes >= low) continue;
			const enough = async () => (await this.disk(dir)).freeBytes >= target;
			for (const stage of stages) {
				if (await enough()) break;
				await stage(enough, removed);
			}
		}

		// Optional caps on top, measured by walking the trees.
		if (workMaxGb > 0) {
			const over = async () =>
				(await usage([
					path.join(workDir, "ws"),
					path.join(workDir, "jobs"),
					path.join(workDir, "store"),
				])) >
				workMaxGb * GB;
			const enough = async () => !(await over());
			if (await over()) {
				for (const stage of workStages) {
					if (await enough()) break;
					await stage(enough, removed);
				}
			}
		}
		if (cacheMaxGb > 0) {
			const enough = async () => (await usage([cacheDir])) <= cacheMaxGb * GB;
			for (const stage of cacheStages) {
				if (await enough()) break;
				await stage(enough, removed);
			}
		}
		if (removed.length) {
			rendererLogger.info(
				{
					removed: removed.length,
					paths: removed.slice(0, 20),
					...(extraBytes > 0 && {
						neededMb: Math.round(extraBytes / 1024 ** 2),
					}),
					disks: await this.describeDisks().catch(() => undefined),
				},
				"Cache eviction",
			);
		}
		return removed;
	}

	/** Oldest workspace first; each takes its now-unused shared module files along. */
	private async evictWorkspaces(
		protect: readonly string[],
		enough: () => Promise<boolean>,
		removed: string[],
	): Promise<void> {
		const { workDir } = this.config.paths;
		const store = moduleStoreDir(workDir);
		const workspaces = await Promise.all(
			(await children(path.join(workDir, "ws")))
				.filter((d) => !protect.includes(path.basename(d)))
				.map(async (d) => ({
					path: d,
					lastUsed: await mtime(path.join(d, LAST_USED), d),
				})),
		);
		workspaces.sort((a, b) => a.lastUsed - b.lastUsed);
		for (const ws of workspaces) {
			if (await enough()) return;
			// Remove the workspace first, so its store files drop to one link.
			const keys = await readManifests(ws.path);
			await remove(ws.path, removed);
			await releaseKeys(store, keys);
		}
	}

	private async mirrors(protect: readonly string[]): Promise<Candidate[]> {
		const out: Candidate[] = [];
		for (const workerDir of await children(
			path.join(this.config.paths.cacheDir, "git"),
		)) {
			const own = path.basename(workerDir) === this.workerId;
			for (const mirror of await children(workerDir)) {
				const hash = path.basename(mirror).replace(/\.git$/, "");
				if (own && protect.includes(hash)) continue;
				const lastUsed = await mtime(path.join(mirror, LAST_USED), mirror);
				// Another worker may be using its mirror right now.
				if (!own && Date.now() - lastUsed < FOREIGN_MIRROR_IDLE_MS) continue;
				out.push({ path: mirror, bytes: 0, lastUsed, kind: "mirror" });
			}
		}
		return out;
	}

	/** Package caches, largest first: one eviction usually suffices. */
	private async stores(): Promise<Candidate[]> {
		const stores = await Promise.all(
			STORES.map(async (s) => {
				const p = path.join(this.config.paths.cacheDir, s);
				return { path: p, bytes: await usage([p]), lastUsed: 0, kind: "store" };
			}),
		);
		return stores.filter((s) => s.bytes > 0).sort((a, b) => b.bytes - a.bytes);
	}
}

/** Removes candidates (oldest first unless `sort` is false) until `enough()`. */
async function evictEach(
	candidates: Promise<Candidate[]>,
	enough: () => Promise<boolean>,
	removed: string[],
	sort = true,
): Promise<void> {
	const list = await candidates;
	if (sort) list.sort((a, b) => a.lastUsed - b.lastUsed);
	for (const c of list) {
		if (await enough()) return;
		await remove(c.path, removed);
	}
}

async function remove(p: string, removed: string[]): Promise<void> {
	await fs.rm(p, { recursive: true, force: true });
	removed.push(p);
}

async function children(dir: string): Promise<string[]> {
	const entries = await fs
		.readdir(dir, { withFileTypes: true })
		.catch(() => []);
	return entries
		.filter((e) => e.isDirectory())
		.map((e) => path.join(dir, e.name));
}

async function mtime(p: string, fallback?: string): Promise<number> {
	const stat = await fs
		.stat(p)
		.catch(() =>
			fallback ? fs.stat(fallback).catch(() => undefined) : undefined,
		);
	return stat?.mtimeMs ?? 0;
}

/** git-lfs stores objects at lfs/objects/aa/bb/<oid>; LRU by access time. */
async function lfsObjects(root: string): Promise<Candidate[]> {
	const out: Candidate[] = [];
	const objects = path.join(root, "objects");
	if (!existsSync(objects)) return out;
	for (const a of await children(objects)) {
		for (const b of await children(a)) {
			for (const name of await fs.readdir(b).catch(() => [])) {
				const p = path.join(b, name);
				const stat = await fs.stat(p).catch(() => undefined);
				if (stat?.isFile()) {
					out.push({
						path: p,
						bytes: stat.size,
						lastUsed: Math.max(stat.atimeMs, stat.mtimeMs),
						kind: "lfs",
					});
				}
			}
		}
	}
	return out;
}

/**
 * Bytes on disk under `dirs` (symlinks not followed). A file hard-linked in
 * several places (shared node_modules) counts once.
 */
export async function usage(dirs: string[]): Promise<number> {
	let total = 0;
	const seen = new Set<string>();
	const walk = async (d: string): Promise<void> => {
		const entries = await fs
			.readdir(d, { withFileTypes: true })
			.catch(() => []);
		await Promise.all(
			entries.map(async (e) => {
				const p = path.join(d, e.name);
				if (e.isDirectory()) await walk(p);
				else if (e.isFile()) {
					const stat = await fs.lstat(p).catch(() => undefined);
					if (!stat) return;
					const id = `${stat.dev}:${stat.ino}`;
					if (seen.has(id)) return;
					seen.add(id);
					total += stat.size;
				}
			}),
		);
	};
	for (const dir of dirs) await walk(dir);
	return total;
}
