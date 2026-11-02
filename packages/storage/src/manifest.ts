/**
 * The `storage` and `assets` sections of a project's `framefields.json`.
 *
 * ```json
 * {
 *   "storage": {
 *     "remotes": {
 *       "media": {
 *         "endpoint": "https://<account>.r2.cloudflarestorage.com",
 *         "bucket": "films",
 *         "publicUrl": "https://media.example.com"
 *       }
 *     }
 *   },
 *   "assets": {
 *     "assets/footage/intro.mp4": { "sha256": "…", "size": 48213 }
 *   }
 * }
 * ```
 *
 * Assets are stored by content (`sha256/ab/<hash>`), so the manifest pins
 * exact bytes the way a lockfile pins packages, and the files themselves
 * stay out of git.
 */

/** An S3-compatible bucket: Cloudflare R2, AWS S3, Backblaze B2, MinIO, … */
export interface StorageRemote {
	/** The S3 API endpoint, e.g. `https://<account>.r2.cloudflarestorage.com`. */
	endpoint: string;
	bucket: string;
	/** SigV4 region. Default `auto` (R2); AWS needs the bucket's region. */
	region?: string;
	/** Key prefix inside the bucket, e.g. `films/launch/`. */
	prefix?: string;
	/**
	 * Where the bucket is publicly readable: a custom domain (an R2 custom
	 * domain or any CDN in front of the bucket) or the `r2.dev` URL. Reads use
	 * it instead of signed URLs, so anyone can pull and render without keys.
	 */
	publicUrl?: string;
}

export interface StorageConfig {
	/** The remote new assets go to. Default: the only remote. */
	default?: string;
	remotes: Record<string, StorageRemote>;
}

/** One file the project needs, pinned by content. */
export interface AssetEntry {
	sha256: string;
	size: number;
	/** The remote holding it. Default: `storage.default`. */
	remote?: string;
	/** A fixed https URL to fetch it from instead of a remote (public media). */
	url?: string;
}

export type AssetManifest = Record<string, AssetEntry>;

export const REMOTE_NAME = /^[A-Za-z0-9][\w-]{0,63}$/;
export const SHA256 = /^[0-9a-f]{64}$/;
const FILE = "framefields.json";

export class ManifestError extends Error {
	override name = "ManifestError";
}

/** Validates `storage`; errors name the remote and field at fault. */
export function parseStorage(value: unknown): StorageConfig {
	if (!isRecord(value) || !isRecord(value.remotes))
		throw new ManifestError(
			`${FILE}: "storage" needs "remotes", e.g. { "remotes": { "media": { "endpoint": "https://<account>.r2.cloudflarestorage.com", "bucket": "films" } } }`,
		);
	const remotes: Record<string, StorageRemote> = {};
	for (const [name, spec] of Object.entries(value.remotes))
		remotes[name] = parseRemote(name, spec);
	const names = Object.keys(remotes);
	if (names.length === 0)
		throw new ManifestError(`${FILE}: "storage.remotes" is empty`);
	if (value.default !== undefined && !names.includes(value.default as string))
		throw new ManifestError(
			`${FILE}: "storage.default" must name a remote (${names.join(", ")})`,
		);
	return {
		...(typeof value.default === "string" && { default: value.default }),
		remotes,
	};
}

function parseRemote(name: string, spec: unknown): StorageRemote {
	const fail = (message: string): never => {
		throw new ManifestError(`${FILE}: storage.remotes.${name} ${message}`);
	};
	if (!REMOTE_NAME.test(name))
		fail("has an invalid name: use letters, digits, - and _ (at most 64)");
	if (!isRecord(spec)) fail("must be an object with an endpoint and a bucket");
	const s = spec as Record<string, unknown>;
	if (!isHttpUrl(s.endpoint))
		fail(
			'needs "endpoint": the S3 API URL, e.g. "https://<account>.r2.cloudflarestorage.com"',
		);
	if (
		typeof s.bucket !== "string" ||
		!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(s.bucket)
	)
		fail('needs "bucket": the bucket name');
	if (s.region !== undefined && typeof s.region !== "string")
		fail('"region" must be a string');
	if (
		s.prefix !== undefined &&
		(typeof s.prefix !== "string" ||
			s.prefix.startsWith("/") ||
			s.prefix.split("/").includes(".."))
	)
		fail('"prefix" must be a key prefix such as "films/launch/"');
	if (s.publicUrl !== undefined && !isHttpUrl(s.publicUrl))
		fail(
			'"publicUrl" must be an http(s) URL, e.g. "https://media.example.com"',
		);
	return {
		endpoint: s.endpoint as string,
		bucket: s.bucket as string,
		...(s.region !== undefined && { region: s.region as string }),
		...(typeof s.prefix === "string" &&
			s.prefix && { prefix: normalizePrefix(s.prefix) }),
		...(s.publicUrl !== undefined && { publicUrl: s.publicUrl as string }),
	};
}

/** Validates `assets`; errors name the path and field at fault. */
export function parseAssets(
	value: unknown,
	storage?: StorageConfig,
): AssetManifest {
	if (!isRecord(value))
		throw new ManifestError(
			`${FILE}: "assets" must map project paths to { "sha256", "size" }`,
		);
	const out: AssetManifest = {};
	for (const [path, entry] of Object.entries(value)) {
		const fail = (message: string): never => {
			throw new ManifestError(`${FILE}: assets["${path}"] ${message}`);
		};
		if (!isAssetPath(path))
			fail("must be a path inside the project, e.g. assets/footage/intro.mp4");
		if (!isRecord(entry)) fail('must be { "sha256", "size" }');
		const e = entry as Record<string, unknown>;
		if (typeof e.sha256 !== "string" || !SHA256.test(e.sha256))
			fail('needs "sha256": 64 lowercase hex digits');
		if (
			typeof e.size !== "number" ||
			!Number.isSafeInteger(e.size) ||
			e.size < 0
		)
			fail('needs "size" in bytes');
		if (e.url !== undefined && !isHttpUrl(e.url))
			fail('"url" must be an http(s) URL');
		if (e.remote !== undefined) {
			if (typeof e.remote !== "string" || !storage?.remotes[e.remote])
				fail(`"remote" must name a remote in "storage.remotes"`);
		} else if (e.url === undefined && !storage)
			fail('needs a "url", or a "storage" section with a remote to hold it');
		out[path] = {
			sha256: e.sha256 as string,
			size: e.size as number,
			...(e.remote !== undefined && { remote: e.remote as string }),
			...(e.url !== undefined && { url: e.url as string }),
		};
	}
	return out;
}

/** The remote an asset (or a new one, without `name`) belongs to. */
export function pickRemote(
	storage: StorageConfig | undefined,
	name?: string,
): { name: string; remote: StorageRemote } {
	const names = Object.keys(storage?.remotes ?? {});
	const chosen =
		name ?? storage?.default ?? (names.length === 1 ? names[0] : undefined);
	if (!storage || names.length === 0)
		throw new ManifestError(
			`${FILE} has no "storage" remotes: add one (an R2 or S3 bucket) first`,
		);
	if (!chosen)
		throw new ManifestError(
			`${FILE}: name the remote (${names.join(", ")}), or set "storage.default"`,
		);
	const remote = storage.remotes[chosen];
	if (!remote)
		throw new ManifestError(
			`${FILE}: no remote named "${chosen}" (${names.join(", ")})`,
		);
	return { name: chosen, remote };
}

/** The object key holding `sha256`: `<prefix>sha256/ab/<hash>`. */
export function objectKey(sha256: string, prefix = ""): string {
	return `${prefix}sha256/${sha256.slice(0, 2)}/${sha256}`;
}

/** The asset's URL on the remote's public domain, if it has one. */
export function publicUrl(
	remote: StorageRemote,
	sha256: string,
): string | undefined {
	if (!remote.publicUrl) return undefined;
	return `${remote.publicUrl.replace(/\/+$/, "")}/${objectKey(sha256, remote.prefix)}`;
}

/**
 * Where to download an asset without credentials: a signed URL handed in
 * (`signed`, by sha256), its own `url`, or its remote's public domain.
 * Undefined means the asset is on a private remote and needs a signature.
 */
export function readUrl(
	entry: AssetEntry,
	storage: StorageConfig | undefined,
	signed?: Readonly<Record<string, string>>,
): string | undefined {
	const given = signed?.[entry.sha256];
	if (given) return given;
	if (entry.url) return entry.url;
	if (!storage) return undefined;
	return publicUrl(pickRemote(storage, entry.remote).remote, entry.sha256);
}

export function isAssetPath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 1024 &&
		!path.startsWith("/") &&
		!path.includes("\\") &&
		!path
			.split("/")
			.some((part) => part === "" || part === "." || part === "..")
	);
}

function normalizePrefix(prefix: string): string {
	return prefix.endsWith("/") ? prefix : `${prefix}/`;
}

function isHttpUrl(value: unknown): boolean {
	if (typeof value !== "string") return false;
	try {
		const { protocol } = new URL(value);
		return protocol === "https:" || protocol === "http:";
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
