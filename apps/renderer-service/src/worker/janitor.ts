import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { RendererConfig } from "../config/index.js";
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

interface Candidate {
	path: string;
	bytes: number;
	lastUsed: number;
	kind: string;
}

/**
 * Keeps FF_WORK_DIR and FF_CACHE_DIR under their size limits (PLAN.md §6.4).
 * Runs between jobs, so nothing it deletes is in use. Eviction order:
 * workspaces (LRU), then LFS objects (LRU), then git mirrors (LRU), then
 * whole package caches. Pinned vision models are never evicted.
 */
export class CacheJanitor {
	private lastRun = 0;

	constructor(
		private readonly config: RendererConfig,
		private readonly workerId: string,
		private readonly intervalMs = 5 * 60 * 1000,
	) {
		current = this;
	}

	/** Runs at most once per interval unless forced. Never throws. */
	async maybeRun(protect: readonly string[], force = false): Promise<void> {
		if (!force && Date.now() - this.lastRun < this.intervalMs) return;
		this.lastRun = Date.now();
		try {
			const removed = await this.enforce(protect);
			if (removed.length) {
				rendererLogger.info(
					{ removed: removed.length, paths: removed.slice(0, 20) },
					"Cache eviction",
				);
			}
		} catch (err) {
			rendererLogger.warn({ err: String(err) }, "Cache eviction failed");
		}
	}

	/**
	 * Evicts until both limits hold. `protect` lists repo hashes the next job
	 * needs (its workspace and mirror stay).
	 */
	async enforce(protect: readonly string[]): Promise<string[]> {
		const removed: string[] = [];
		const { workDir, cacheDir, workMaxGb, cacheMaxGb } = this.config.paths;

		// Failed-job dirs kept for debugging expire after a day.
		for (const dir of await children(path.join(workDir, "jobs"))) {
			if (Date.now() - (await mtime(dir)) > DAY_MS) {
				await remove(dir, removed);
			}
		}

		if (workMaxGb > 0) {
			const workspaces = (await children(path.join(workDir, "ws"))).filter(
				(d) => !protect.includes(path.basename(d)),
			);
			const candidates = await Promise.all(
				workspaces.map(async (d) => ({
					path: d,
					bytes: await dirSize(d),
					lastUsed: await mtime(path.join(d, LAST_USED), d),
					kind: "workspace",
				})),
			);
			const total =
				(await dirSize(path.join(workDir, "ws"))) +
				(await dirSize(path.join(workDir, "jobs")));
			await evict(candidates, total - workMaxGb * GB, removed);
		}

		if (cacheMaxGb > 0) {
			let total = await dirSize(cacheDir);
			const over = () => total - cacheMaxGb * GB;
			if (over() > 0) {
				const lfs = await lfsObjects(path.join(cacheDir, "lfs"));
				total -= await evict(lfs, over(), removed);
			}
			if (over() > 0) {
				total -= await evict(await this.mirrors(protect), over(), removed);
			}
			if (over() > 0) {
				const stores = await Promise.all(
					STORES.map(async (s) => {
						const p = path.join(cacheDir, s);
						return {
							path: p,
							bytes: await dirSize(p),
							lastUsed: 0,
							kind: "store",
						};
					}),
				);
				// Largest first: one eviction usually suffices.
				stores.sort((a, b) => b.bytes - a.bytes);
				total -= await evict(
					stores.filter((s) => s.bytes > 0),
					over(),
					removed,
					false,
				);
			}
		}
		return removed;
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
				out.push({
					path: mirror,
					bytes: await dirSize(mirror),
					lastUsed,
					kind: "mirror",
				});
			}
		}
		return out;
	}
}

/** Removes candidates (oldest first unless `sort` is false) until `bytes` are freed. */
async function evict(
	candidates: Candidate[],
	bytes: number,
	removed: string[],
	sort = true,
): Promise<number> {
	if (bytes <= 0) return 0;
	if (sort) candidates.sort((a, b) => a.lastUsed - b.lastUsed);
	let freed = 0;
	for (const c of candidates) {
		if (freed >= bytes) break;
		await remove(c.path, removed);
		freed += c.bytes;
	}
	return freed;
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

/** Bytes on disk under `dir` (symlinks not followed). */
export async function dirSize(dir: string): Promise<number> {
	let total = 0;
	const walk = async (d: string): Promise<void> => {
		const entries = await fs
			.readdir(d, { withFileTypes: true })
			.catch(() => []);
		await Promise.all(
			entries.map(async (e) => {
				const p = path.join(d, e.name);
				if (e.isDirectory()) await walk(p);
				else if (e.isFile()) {
					// Read first: `total += await …` would add to a stale total.
					const size = (await fs.lstat(p).catch(() => undefined))?.size ?? 0;
					total += size;
				}
			}),
		);
	};
	await walk(dir);
	return total;
}
