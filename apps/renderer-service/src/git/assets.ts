import { constants, existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	type AssetEntry,
	AssetError,
	downloadVerified,
	hashFile,
	ManifestError,
	readProjectManifest,
	readUrl,
	type StorageConfig,
} from "@framefields/storage";
import { RenderError } from "../errors.js";
import { resolveInside } from "../paths.js";

/** Under the cache dir: verified asset bytes at assets/aa/<sha256>. */
export const ASSET_CACHE = "assets";
const CONCURRENCY = 4;

export interface AssetOptions {
	cacheDir: string;
	/** Signed GET URLs for private assets, by sha256 (`source.assets`). */
	signed?: Readonly<Record<string, string>>;
	signal?: AbortSignal;
	/** Evicts caches so `bytes` more fit (the janitor). */
	makeRoom?: (bytes: number) => Promise<void>;
	fetch?: typeof fetch;
}

export interface AssetResult {
	files: number;
	bytes: number;
	cache: "hit" | "partial" | "miss" | "off";
}

/**
 * Pipeline step after LFS: puts every asset the project's framefields.json
 * pins in place, from the worker's cache or its URL (the remote's public
 * domain, the asset's own URL, or a signature the job carries), checked
 * against its sha256.
 */
export async function fetchAssets(
	workdir: string,
	options: AssetOptions,
): Promise<AssetResult> {
	const manifest = await readManifest(workdir);
	const entries = Object.entries(manifest?.assets ?? {});
	if (!manifest || entries.length === 0)
		return { files: 0, bytes: 0, cache: "off" };

	const plan = await Promise.all(
		entries.map(async ([rel, entry]) => ({
			rel,
			entry,
			dest: path.join(workdir, rel),
			cached: cachePath(options.cacheDir, entry.sha256),
		})),
	);
	const todo: typeof plan = [];
	for (const item of plan)
		if (!(await present(item.dest, item.entry))) todo.push(item);
	const misses = todo.filter((t) => !existsSync(t.cached));
	const missBytes = misses.reduce((n, t) => n + t.entry.size, 0);
	if (missBytes > 0) await options.makeRoom?.(missBytes);

	let next = 0;
	const worker = async () => {
		while (next < todo.length) {
			const item = todo[next++];
			if (!existsSync(item.cached))
				await download(
					item.rel,
					item.entry,
					item.cached,
					manifest.storage,
					options,
				);
			await place(workdir, item.rel, item.cached);
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker),
	);
	return {
		files: entries.length,
		bytes: missBytes,
		cache:
			misses.length === 0
				? "hit"
				: misses.length === entries.length
					? "miss"
					: "partial",
	};
}

async function readManifest(workdir: string) {
	try {
		return await readProjectManifest(workdir);
	} catch (err) {
		if (err instanceof ManifestError)
			throw new RenderError("ASSET_MANIFEST_INVALID", err.message, {
				hint: "`npx framefields assets status` reads the same file locally.",
			});
		throw err;
	}
}

/**
 * Copies the cached bytes to `rel`, refusing folders that symlink out of
 * the checkout and replacing (not writing through) a symlink at `rel`.
 */
async function place(workdir: string, rel: string, cached: string) {
	let existing = path.posix.dirname(rel);
	while (existing !== "." && !existsSync(path.join(workdir, existing)))
		existing = path.posix.dirname(existing);
	await resolveInside(workdir, existing);
	const dest = path.join(workdir, rel);
	await fs.mkdir(path.dirname(dest), { recursive: true });
	await fs.rm(dest, { force: true });
	await fs.copyFile(cached, dest, constants.COPYFILE_FICLONE);
}

/** A file already in the checkout counts when its bytes match. */
async function present(dest: string, entry: AssetEntry): Promise<boolean> {
	const stat = await fs.lstat(dest).catch(() => undefined);
	if (!stat?.isFile() || stat.size !== entry.size) return false;
	return (await hashFile(dest)).sha256 === entry.sha256;
}

async function download(
	rel: string,
	entry: AssetEntry,
	cached: string,
	storage: StorageConfig | undefined,
	options: AssetOptions,
): Promise<void> {
	const url = readUrl(entry, storage, options.signed);
	if (!url)
		throw new RenderError(
			"ASSET_PRIVATE",
			`${rel} is on a private remote and the job carries no signed URL for it.`,
			{
				hint: "Render from the CLI or renderCloud (they sign reads with your keys), or give the remote a publicUrl.",
			},
		);
	try {
		await downloadVerified(url, cached, entry, {
			fetch: options.fetch,
			signal: options.signal,
		});
	} catch (err) {
		if (!(err instanceof AssetError)) throw err;
		throw new RenderError(ERROR_CODES[err.code], `${rel}: ${err.message}`, {
			hint: HINTS[err.code],
			cause: err,
		});
	}
}

const ERROR_CODES = {
	ASSET_NOT_FOUND: "ASSET_NOT_UPLOADED",
	ASSET_FORBIDDEN: "ASSET_FORBIDDEN",
	ASSET_DOWNLOAD_FAILED: "ASSET_DOWNLOAD_FAILED",
	ASSET_HASH_MISMATCH: "ASSET_HASH_MISMATCH",
} as const;

const HINTS: Record<AssetError["code"], string> = {
	ASSET_NOT_FOUND: "Run `npx framefields assets push` and render again.",
	ASSET_FORBIDDEN:
		"The publicUrl doesn't serve the bucket, or a signed URL expired: render again from the CLI.",
	ASSET_DOWNLOAD_FAILED: "The bucket or CDN didn't answer; retried.",
	ASSET_HASH_MISMATCH:
		"The bucket holds other bytes than framefields.json pins: `npx framefields assets push` from the machine with the right file.",
};

function cachePath(cacheDir: string, sha256: string): string {
	return path.join(cacheDir, ASSET_CACHE, sha256.slice(0, 2), sha256);
}
