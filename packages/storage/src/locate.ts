/**
 * Finding a project's pinned assets from file paths: what a preview or an
 * engine asks for is an absolute path, and a pinned file that isn't on disk
 * is read from its bucket instead.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { Bucket, credentialsFromEnv } from "./bucket.js";
import {
	type AssetEntry,
	type AssetManifest,
	ManifestError,
	parseAssets,
	parseStorage,
	pickRemote,
	readUrl,
	type StorageConfig,
} from "./manifest.js";

const FILE = "framefields.json";

export interface ProjectManifest {
	storage?: StorageConfig;
	assets: AssetManifest;
}

/** The nearest folder at or above `dir` holding a framefields.json. */
export function findProjectDir(dir: string): string | undefined {
	for (let at = dir; ; at = dirname(at)) {
		if (existsSync(join(at, FILE))) return at;
		if (dirname(at) === at) return undefined;
	}
}

/** The `storage` and `assets` of the project at `dir`; undefined without assets. */
export async function readProjectManifest(
	dir: string,
): Promise<ProjectManifest | undefined> {
	const file = join(dir, FILE);
	if (!existsSync(file)) return undefined;
	let raw: { storage?: unknown; assets?: unknown };
	try {
		raw = JSON.parse(await readFile(file, "utf8")) as typeof raw;
	} catch (err) {
		throw new ManifestError(
			`${FILE} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (raw.assets === undefined) return undefined;
	const storage =
		raw.storage === undefined ? undefined : parseStorage(raw.storage);
	return { storage, assets: parseAssets(raw.assets, storage) };
}

export interface AssetLocator {
	/** The project folder (where framefields.json is). */
	readonly root: string;
	/** The pinned entry for an absolute path, if the project pins it. */
	entry(file: string): AssetEntry | undefined;
	/**
	 * A URL to read a pinned file from: its public domain or own URL, else
	 * a GET signed with the remote's keys from the environment. Undefined
	 * when the file isn't pinned, or is private and there are no keys.
	 */
	url(file: string): Promise<string | undefined>;
}

/** Signatures last 6 h and are reused for 5, so long sessions keep working. */
const SIGNED_SEC = 6 * 3600;
const REUSE_MS = 5 * 3600 * 1000;

/**
 * Pinned-asset lookup for the project at or above `dir`, or undefined when
 * it pins none.
 */
export async function openAssetLocator(
	dir: string,
	options: {
		env?: Readonly<Record<string, string | undefined>>;
		fetch?: typeof fetch;
	} = {},
): Promise<AssetLocator | undefined> {
	const root = findProjectDir(dir);
	const manifest = root && (await readProjectManifest(root));
	if (!root || !manifest) return undefined;
	const signed = new Map<string, { url: string; at: number }>();
	const entry = (file: string) => {
		const rel = relative(root, file).split(sep).join("/");
		return rel.startsWith("../") ? undefined : manifest.assets[rel];
	};
	return {
		root,
		entry,
		async url(file) {
			const pinned = entry(file);
			if (!pinned) return undefined;
			const open = readUrl(pinned, manifest.storage);
			if (open) return open;
			const cached = signed.get(pinned.sha256);
			if (cached && Date.now() - cached.at < REUSE_MS) return cached.url;
			const { name, remote } = pickRemote(manifest.storage, pinned.remote);
			const keys = credentialsFromEnv(name, options.env);
			if (!keys) return undefined;
			const url = await new Bucket(remote, keys, {
				fetch: options.fetch,
			}).presign(pinned.sha256, SIGNED_SEC);
			signed.set(pinned.sha256, { url, at: Date.now() });
			return url;
		},
	};
}
