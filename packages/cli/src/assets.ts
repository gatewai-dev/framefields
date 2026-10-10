/**
 * External assets: files under `assets.directory` live in Framefields Cloud
 * blob storage, addressed by SHA-256, and `framefields.assets.json` (committed
 * to git) maps each path to its hash. Every step can be re-run after an
 * interruption: hashes are cached, the server resumes multipart uploads, and
 * downloads land in a temp file that is verified before it replaces anything.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Project } from "framefields/project";
import type {
	AssetClaim,
	AssetDiff,
	AssetLockfile,
	CloudClient,
	RequestBody,
	UploadTicket,
} from "./cloud/client.js";
import { CliError } from "./errors.js";
import { matchesAny } from "./glob.js";

export const LOCKFILE = "framefields.assets.json";
export const LOCKFILE_SCHEMA = "https://framefields.dev/schemas/assets.v1.json";
const CACHE_FILE = path.join(".framefields", "asset-hashes.json");

export interface LocalAsset {
	/** Project-relative, forward slashes: the lockfile key. */
	path: string;
	sha256: string;
	size: number;
	mimeType: string;
}

// ── Scanning ──

/** Every file under the assets directory, minus exclusions, hashed (with a size+mtime cache). */
export async function scanAssets(project: Project): Promise<LocalAsset[]> {
	const dir = path.join(project.root, project.assets.directory);
	if (!fs.existsSync(dir)) return [];
	const cacheFile = path.join(project.root, CACHE_FILE);
	const cache = readCache(cacheFile);
	const next: HashCache = {};
	const assets: LocalAsset[] = [];
	for (const abs of walk(dir)) {
		const fromRoot = toPosix(path.relative(project.root, abs));
		const fromDir = toPosix(path.relative(dir, abs));
		if (
			matchesAny(project.assets.exclude, fromRoot) ||
			matchesAny(project.assets.exclude, fromDir)
		)
			continue;
		const stat = fs.statSync(abs);
		const key = `${stat.size}:${stat.mtimeMs}`;
		const sha256 =
			cache[fromRoot]?.key === key
				? cache[fromRoot].sha256
				: await hashFile(abs);
		next[fromRoot] = { key, sha256 };
		assets.push({
			path: fromRoot,
			sha256,
			size: stat.size,
			mimeType: mimeType(abs),
		});
	}
	writeCache(cacheFile, next);
	return assets.sort((a, b) => a.path.localeCompare(b.path));
}

function* walk(dir: string): Generator<string> {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const abs = path.join(dir, entry.name);
		if (entry.isDirectory()) yield* walk(abs);
		else if (entry.isFile()) yield abs;
	}
}

export async function hashFile(file: string): Promise<string> {
	const hash = createHash("sha256");
	await pipeline(fs.createReadStream(file), hash);
	return hash.digest("hex");
}

type HashCache = Record<string, { key: string; sha256: string }>;

function readCache(file: string): HashCache {
	try {
		return JSON.parse(fs.readFileSync(file, "utf8")) as HashCache;
	} catch {
		return {};
	}
}

function writeCache(file: string, cache: HashCache) {
	try {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		// `.framefields` keeps itself out of git, as the preview's notes do.
		const ignore = path.join(path.dirname(file), ".gitignore");
		if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
		fs.writeFileSync(file, JSON.stringify(cache));
	} catch {
		// Only a cache.
	}
}

const toPosix = (p: string) => p.split(path.sep).join("/");

const MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".avif": "image/avif",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mkv": "video/x-matroska",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".aac": "audio/aac",
	".ogg": "audio/ogg",
	".flac": "audio/flac",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".glb": "model/gltf-binary",
	".gltf": "model/gltf+json",
	".obj": "model/obj",
	".onnx": "application/octet-stream",
	".json": "application/json",
	".lottie": "application/zip",
	".cube": "text/plain",
	".srt": "text/plain",
	".vtt": "text/vtt",
	".txt": "text/plain",
};

export const mimeType = (file: string) =>
	MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";

// ── Lockfile ──

export function lockfilePath(project: Project): string {
	return path.join(project.root, LOCKFILE);
}

export function readLockfile(project: Project): AssetLockfile | undefined {
	const file = lockfilePath(project);
	if (!fs.existsSync(file)) return undefined;
	try {
		const data = JSON.parse(fs.readFileSync(file, "utf8")) as AssetLockfile;
		return { ...data, assets: data.assets ?? {} };
	} catch (err) {
		throw new CliError(
			`${LOCKFILE} is not valid JSON: ${(err as Error).message}`,
			{ code: "project" },
		);
	}
}

/** The lockfile for `assets`, keeping fields of unchanged entries (and unknown top-level keys). */
export function buildLockfile(
	previous: AssetLockfile | undefined,
	assets: LocalAsset[],
	repositoryId?: string,
): AssetLockfile {
	const entries: AssetLockfile["assets"] = {};
	for (const a of assets) {
		const old = previous?.assets[a.path];
		entries[a.path] =
			old?.sha256 === a.sha256
				? { ...old, size: a.size, mimeType: a.mimeType }
				: {
						sha256: a.sha256,
						size: a.size,
						mimeType: a.mimeType,
						uploadedAt: new Date().toISOString(),
					};
	}
	return {
		...previous,
		$schema: previous?.$schema ?? LOCKFILE_SCHEMA,
		version: previous?.version ?? 1,
		...(repositoryId && { repository: repositoryId }),
		assets: entries,
	};
}

export const serializeLockfile = (lock: AssetLockfile) =>
	`${JSON.stringify(lock, null, "\t")}\n`;

/** Writes the lockfile if its content changed; true when it did. */
export function writeLockfile(project: Project, lock: AssetLockfile): boolean {
	const file = lockfilePath(project);
	const text = serializeLockfile(lock);
	const old = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : undefined;
	if (old !== undefined && sameAssets(old, lock)) return false;
	fs.writeFileSync(file, text);
	return true;
}

/** Equal up to formatting and `uploadedAt` stamps. */
function sameAssets(oldText: string, lock: AssetLockfile): boolean {
	try {
		const old = JSON.parse(oldText) as AssetLockfile;
		const strip = (l: AssetLockfile) =>
			JSON.stringify({
				...l,
				assets: Object.fromEntries(
					Object.entries(l.assets ?? {})
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([k, { uploadedAt: _, ...v }]) => [k, v]),
				),
			});
		return strip(old) === strip(lock);
	} catch {
		return false;
	}
}

// ── Sync (upload) ──

export interface SyncPlan {
	assets: LocalAsset[];
	/** Hashes the cloud already holds. */
	present: string[];
	/** Tickets for hashes it lacks. */
	missing: UploadTicket[];
	/** Lockfile paths that are no longer on disk. */
	removed: string[];
	skipped: { path: string; reason: string }[];
}

export async function planSync(
	client: CloudClient,
	repoId: string | undefined,
	project: Project,
): Promise<SyncPlan> {
	const scanned = await scanAssets(project);
	const skipped = scanned
		.filter((a) => a.size === 0)
		.map((a) => ({ path: a.path, reason: "empty file" }));
	const assets = scanned.filter((a) => a.size > 0);
	const lock = readLockfile(project);
	const onDisk = new Set(assets.map((a) => a.path));
	const removed = Object.keys(lock?.assets ?? {}).filter((p) => !onDisk.has(p));
	const diff: AssetDiff = assets.length
		? await client.assetsDiff(
				repoId,
				assets.map<AssetClaim>((a) => ({
					path: a.path,
					sha256: a.sha256,
					size: a.size,
					mimeType: a.mimeType,
				})),
			)
		: { present: [], missing: [] };
	return {
		assets,
		present: diff.present,
		missing: diff.missing,
		removed,
		skipped,
	};
}

export type UploadProgress = (event: {
	path: string;
	sha256: string;
	bytes: number;
	total: number;
	done?: boolean;
}) => void;

/** Uploads one asset per its ticket, skipping parts the server already has, then confirms. */
export async function upload(
	client: CloudClient,
	ticket: UploadTicket,
	file: string,
	size: number,
	progress?: UploadProgress,
	label = file,
) {
	const report = (bytes: number, done?: boolean) =>
		progress?.({
			path: label,
			sha256: ticket.sha256,
			bytes,
			total: size,
			done,
		});
	if (ticket.transport === "direct") {
		const res = await client.raw(ticket.method, ticket.url, {
			anonymous: !ticket.url.startsWith(client.host),
			headers: { ...ticket.headers, "Content-Length": String(size) },
			rawBody: Readable.toWeb(
				fs.createReadStream(file),
			) as unknown as RequestBody,
			duplex: true,
		});
		if (!res.ok)
			throw new CliError(
				`upload of ${label} failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim(),
			);
		report(size);
	} else {
		const done = new Set(ticket.uploadedParts);
		let sent = [...done].reduce(
			(sum, n) => sum + partLength(n, ticket.partSize, ticket.partCount, size),
			0,
		);
		report(sent);
		for (let n = 1; n <= ticket.partCount; n++) {
			if (done.has(n)) continue;
			const length = partLength(n, ticket.partSize, ticket.partCount, size);
			const start = (n - 1) * ticket.partSize;
			const res = await client.raw("PUT", `${ticket.partUrl}${n}`, {
				headers: {
					"Content-Type": "application/octet-stream",
					"Content-Length": String(length),
				},
				rawBody: Readable.toWeb(
					fs.createReadStream(file, { start, end: start + length - 1 }),
				) as unknown as RequestBody,
				duplex: true,
			});
			if (!res.ok) {
				throw new CliError(
					`upload of ${label} (part ${n}/${ticket.partCount}) failed: HTTP ${res.status} ${await res.text().catch(() => "")}`.trim(),
					{
						hint: "run the command again to resume",
					},
				);
			}
			sent += length;
			report(sent);
		}
	}
	await client.confirmUpload(ticket.confirmUrl);
	report(size, true);
}

const partLength = (
	n: number,
	partSize: number,
	count: number,
	size: number,
) => (n < count ? partSize : size - partSize * (count - 1));

// ── Pull (download) ──

export interface PullResult {
	downloaded: string[];
	present: string[];
	failed: { path: string; error: string }[];
}

/** Downloads lockfile entries missing on disk (or all, with `force`), verifying each SHA-256. */
export async function pullAssets(
	client: CloudClient,
	project: Project,
	options: { force?: boolean; onFile?: (path: string) => void } = {},
): Promise<PullResult> {
	const lock = readLockfile(project);
	const result: PullResult = { downloaded: [], present: [], failed: [] };
	if (!lock) return result;
	for (const [rel, entry] of Object.entries(lock.assets)) {
		const file = path.resolve(project.root, rel);
		if (path.relative(project.root, file).startsWith("..")) {
			result.failed.push({ path: rel, error: "path is outside the project" });
			continue;
		}
		const size = entry.size ?? entry.sizeBytes;
		if (!options.force && fs.existsSync(file)) {
			const stat = fs.statSync(file);
			if (size === undefined || stat.size === size) {
				result.present.push(rel);
				continue;
			}
		}
		options.onFile?.(rel);
		try {
			await downloadBlob(client, entry.sha256, file);
			result.downloaded.push(rel);
		} catch (err) {
			result.failed.push({ path: rel, error: (err as Error).message });
		}
	}
	return result;
}

async function downloadBlob(client: CloudClient, sha256: string, file: string) {
	client.requireToken();
	// The server answers with the bytes or a redirect to a signed URL; fetch
	// drops the Authorization header on cross-origin redirects.
	const res = await client.raw("GET", `/v1/assets/${sha256}`);
	if (!res.ok || !res.body) throw new CliError(`HTTP ${res.status}`);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.ff-download`;
	const hash = createHash("sha256");
	const out = fs.createWriteStream(tmp);
	try {
		await pipeline(
			Readable.fromWeb(res.body as never),
			async function* (source) {
				for await (const chunk of source) {
					hash.update(chunk as Buffer);
					yield chunk;
				}
			},
			out,
		);
		const actual = hash.digest("hex");
		if (actual !== sha256)
			throw new CliError(
				`checksum mismatch (expected ${sha256.slice(0, 12)}…, got ${actual.slice(0, 12)}…)`,
			);
		fs.renameSync(tmp, file);
	} finally {
		fs.rmSync(tmp, { force: true });
	}
}

// ── Status ──

export interface AssetStatus {
	/** On disk, not in the lockfile. */
	new: string[];
	/** On disk with a different hash than the lockfile. */
	modified: string[];
	/** In the lockfile, not on disk (`ff asset pull`). */
	missing: string[];
	/** In the lockfile, but the cloud doesn't hold the blob (`ff asset sync`). */
	notUploaded: string[];
	/** Unchanged and uploaded. */
	ok: string[];
}

export async function assetStatus(
	client: CloudClient | undefined,
	repoId: string | undefined,
	project: Project,
): Promise<AssetStatus> {
	// Empty files are never synced (the cloud stores no zero-byte blobs).
	const local = (await scanAssets(project)).filter((a) => a.size > 0);
	const lock = readLockfile(project)?.assets ?? {};
	const byPath = new Map(local.map((a) => [a.path, a]));
	const status: AssetStatus = {
		new: [],
		modified: [],
		missing: [],
		notUploaded: [],
		ok: [],
	};
	for (const a of local) {
		const entry = lock[a.path];
		if (!entry) status.new.push(a.path);
		else if (entry.sha256 !== a.sha256) status.modified.push(a.path);
	}
	for (const p of Object.keys(lock)) if (!byPath.has(p)) status.missing.push(p);
	const locked = Object.entries(lock).filter(
		([, e]) => (e.size ?? e.sizeBytes ?? 0) > 0,
	);
	let held = new Set<string>(locked.map(([, e]) => e.sha256));
	if (client?.token && locked.length) {
		const diff = await client.assetsDiff(
			repoId,
			locked.map(([p, e]) => ({
				path: p,
				sha256: e.sha256,
				size: (e.size ?? e.sizeBytes) as number,
				mimeType: e.mimeType ?? mimeType(p),
			})),
		);
		held = new Set(diff.present);
	}
	for (const [p, e] of Object.entries(lock)) {
		if (!held.has(e.sha256) && (e.size ?? e.sizeBytes ?? 0) > 0)
			status.notUploaded.push(p);
		else if (!status.modified.includes(p) && !status.missing.includes(p))
			status.ok.push(p);
	}
	return status;
}
