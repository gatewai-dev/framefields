/**
 * Lazy, verified human assets. Constructing the store does no I/O; a file
 * is fetched the first time `ensure` asks for it, checked against its pinned
 * size and SHA-256 (`@framefields/storage`'s verified download: temp file,
 * then rename), cached on disk across processes and in memory for the
 * process. Concurrent requests for one file share one download.
 *
 * Cache: `$FRAMEFIELDS_CACHE_DIR/makehuman/<commit>` (default
 * `~/.cache/framefields`). Mirror: `baseUrl` or `$FRAMEFIELDS_HUMAN_BASE_URL`
 * serves `<baseUrl>/<path>` in place of GitHub.
 */
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { downloadVerified, type FileDigest } from "@framefields/storage";
import { MAKEHUMAN_SOURCE } from "./source.js";

export function humanCacheDir(): string {
	const root = process.env.FRAMEFIELDS_CACHE_DIR
		? resolve(process.env.FRAMEFIELDS_CACHE_DIR)
		: resolve(homedir(), ".cache/framefields");
	return join(root, "makehuman", MAKEHUMAN_SOURCE.commit.slice(0, 12));
}

let pinsPromise: Promise<Map<string, FileDigest>> | undefined;

/** The pin table, loaded on first use (it lists every file, so it stays out of startup). */
async function pins(): Promise<Map<string, FileDigest>> {
	// A separate chunk: the table lists every file, so it stays out of startup.
	pinsPromise ??= import("./makehuman-pins.js").then(({ MAKEHUMAN_PINS }) => {
		if (MAKEHUMAN_PINS.commit !== MAKEHUMAN_SOURCE.commit)
			throw new Error(
				"makehuman-pins.ts is for another commit: rerun pin:makehuman",
			);
		return new Map(
			MAKEHUMAN_PINS.files.map(([path, size, sha256]) => [
				path,
				{ size, sha256 },
			]),
		);
	});
	return pinsPromise;
}

export interface HumanAssetStoreOptions {
	/** Cache directory. Default `humanCacheDir()`. */
	dir?: string;
	/** Mirror serving `<baseUrl>/<path>`. Default `$FRAMEFIELDS_HUMAN_BASE_URL`, else GitHub at the pinned commit. */
	baseUrl?: string;
	fetch?: typeof fetch;
	/** The pin table (path → size and SHA-256). Default: the pinned MakeHuman commit's. */
	pins?: ReadonlyMap<string, FileDigest>;
}

export class HumanAssetStore {
	readonly dir: string;
	private readonly baseUrl: string | undefined;
	private readonly fetchImpl: typeof fetch | undefined;
	private readonly table: ReadonlyMap<string, FileDigest> | undefined;
	private readonly memory = new Map<string, Promise<Uint8Array>>();

	constructor(options: HumanAssetStoreOptions = {}) {
		this.dir = options.dir ?? humanCacheDir();
		this.baseUrl = options.baseUrl ?? process.env.FRAMEFIELDS_HUMAN_BASE_URL;
		this.fetchImpl = options.fetch;
		this.table = options.pins;
	}

	private pinTable(): Promise<ReadonlyMap<string, FileDigest>> {
		return this.table ? Promise.resolve(this.table) : pins();
	}

	/** Every pinned path under a folder (e.g. "targets/nose/"). */
	async list(prefix: string): Promise<string[]> {
		return [...(await this.pinTable()).keys()].filter((p) =>
			p.startsWith(prefix),
		);
	}

	/** The file's bytes: from memory, the disk cache, or a verified download. */
	ensure(path: string): Promise<Uint8Array> {
		let p = this.memory.get(path);
		if (!p) {
			p = this.load(path);
			this.memory.set(path, p);
			p.catch(() => this.memory.delete(path));
		}
		return p;
	}

	async text(path: string): Promise<string> {
		return new TextDecoder().decode(await this.ensure(path));
	}

	private async load(path: string): Promise<Uint8Array> {
		const pin = (await this.pinTable()).get(path);
		if (!pin)
			throw new Error(`human assets: "${path}" is not a pinned MakeHuman file`);
		const dest = join(this.dir, path);
		const cached = await stat(dest).catch(() => null);
		// A file of the pinned size was verified when it was written (rename after the hash check).
		if (cached?.size !== pin.size) {
			const url = this.baseUrl
				? `${this.baseUrl.replace(/\/+$/, "")}/${path}`
				: MAKEHUMAN_SOURCE.url(path);
			await downloadVerified(
				url,
				dest,
				pin,
				this.fetchImpl ? { fetch: this.fetchImpl } : {},
			);
		}
		return new Uint8Array(await readFile(dest));
	}
}
