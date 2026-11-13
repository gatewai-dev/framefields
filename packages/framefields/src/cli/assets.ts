/**
 * `framefields assets`: media kept out of git, on an S3-compatible bucket
 * (R2, S3, B2, MinIO), pinned by content in `framefields.json`.
 *
 *   add <path...>   hash, upload what the bucket lacks, record, gitignore
 *   push            upload recorded assets the bucket lacks
 *   pull            download missing assets, verified byte for byte
 *   status          which assets are here, missing, or changed
 *
 * Reads need no keys when the remote has a `publicUrl` (a custom domain or
 * CDN in front of the bucket); otherwise they're signed with the remote's
 * keys. Cloud renders get signed URLs for private assets from the CLI, so
 * the keys never leave the machine.
 */
import { execFileSync } from "node:child_process";
import {
	appendFileSync,
	existsSync,
	readdirSync,
	readFileSync,
	statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
	type AssetEntry,
	type AssetManifest,
	Bucket,
	credentialEnvNames,
	credentialsFromEnv,
	downloadVerified,
	hashFile,
	isAssetPath,
	pickRemote,
	readUrl,
	type StorageConfig,
} from "@framefields/storage";
import { CONFIG_FILE, readConfig, writeConfig } from "./config.js";

export interface AssetOptions {
	/** Project folder (where framefields.json is). */
	cwd: string;
	/** Where remote keys come from. Default `process.env`. */
	env?: Readonly<Record<string, string | undefined>>;
	fetch?: typeof fetch;
	log?: (line: string) => void;
	signal?: AbortSignal;
}

export type AssetsErrorCode =
	| "no_storage"
	| "no_credentials"
	| "not_uploaded"
	| "outside_project"
	| "not_found";

export class AssetsError extends Error {
	override name = "AssetsError";
	constructor(
		message: string,
		readonly code: AssetsErrorCode,
	) {
		super(message);
	}
}

export type AssetState = "ok" | "missing" | "changed";

/** Hashes and uploads files (folders: every file in them), and records them. */
export async function addAssets(
	paths: string[],
	options: AssetOptions & { remote?: string },
): Promise<{ path: string; size: number; uploaded: boolean }[]> {
	const { cwd } = options;
	const { config } = readConfig(cwd);
	const { name, remote } = pickRemote(config.storage, options.remote);
	const bucket = openBucket(config.storage, name, options);
	const files = paths.flatMap((p) => expand(cwd, p));
	if (files.length === 0)
		throw new AssetsError(`No files in ${paths.join(", ")}.`, "not_found");
	const added: { path: string; size: number; uploaded: boolean }[] = [];
	const assets: AssetManifest = { ...config.assets };
	for (const file of files) {
		const digest = await hashFile(join(cwd, file));
		const uploaded = !(await bucket.has(digest.sha256, digest.size));
		if (uploaded) await upload(bucket, cwd, file, digest, options.log);
		const isDefault = name === pickRemote(config.storage).name;
		assets[file] = { ...digest, ...(!isDefault && { remote: name }) };
		added.push({ path: file, size: digest.size, uploaded });
	}
	writeConfig(cwd, { ...config, assets: sortKeys(assets) });
	ignore(cwd, files);
	const tracked = trackedByGit(cwd, files);
	if (tracked.length)
		options.log?.(
			`Already committed to git: ${tracked.join(", ")}. Stop tracking them with \`git rm --cached ${tracked.join(" ")}\` (the files stay here).`,
		);
	if (remote.publicUrl === undefined)
		options.log?.(
			`${name} has no publicUrl: cloud renders from the CLI sign reads, dashboard renders can't read it.`,
		);
	return added;
}

/** Uploads every recorded asset its bucket lacks, from the local file. */
export async function pushAssets(
	options: AssetOptions,
): Promise<{ uploaded: string[]; present: string[] }> {
	const { config } = readConfig(options.cwd);
	const uploaded: string[] = [];
	const present: string[] = [];
	const problems: string[] = [];
	for (const [path, entry] of storedAssets(config.assets)) {
		const bucket = openBucket(config.storage, entry.remote, options);
		if (await bucket.has(entry.sha256, entry.size)) {
			present.push(path);
			continue;
		}
		const state = await localState(options.cwd, path, entry);
		if (state !== "ok") {
			problems.push(`${path} (${state} here)`);
			continue;
		}
		await upload(bucket, options.cwd, path, entry, options.log);
		uploaded.push(path);
	}
	if (problems.length)
		throw new AssetsError(
			`Not on the bucket, and the local file doesn't match ${CONFIG_FILE}: ${problems.join(", ")}. Restore the file, or record the new version with \`framefields assets add\`.`,
			"not_uploaded",
		);
	return { uploaded, present };
}

/**
 * Downloads every asset that's missing here. Files changed locally are
 * left alone (and reported) unless `overwrite`.
 */
export async function pullAssets(
	options: AssetOptions & { overwrite?: boolean },
): Promise<{ downloaded: string[]; present: string[]; changed: string[] }> {
	const { config } = readConfig(options.cwd);
	const result = {
		downloaded: [] as string[],
		present: [] as string[],
		changed: [] as string[],
	};
	for (const [path, entry] of Object.entries(config.assets ?? {})) {
		const state = await localState(options.cwd, path, entry);
		if (state === "ok") {
			result.present.push(path);
			continue;
		}
		if (state === "changed" && !options.overwrite) {
			result.changed.push(path);
			continue;
		}
		const url = await readableUrl(entry, config.storage, options);
		options.log?.(`Downloading ${path} (${megabytes(entry.size)})`);
		await downloadVerified(url, join(options.cwd, path), entry, {
			fetch: options.fetch,
			signal: options.signal,
		});
		result.downloaded.push(path);
	}
	return result;
}

/** Each recorded asset's state here: present and matching, missing, or changed. */
export async function assetStatus(
	cwd: string,
): Promise<{ path: string; size: number; state: AssetState }[]> {
	const { config } = readConfig(cwd);
	return Promise.all(
		Object.entries(config.assets ?? {}).map(async ([path, entry]) => ({
			path,
			size: entry.size,
			state: await localState(cwd, path, entry),
		})),
	);
}

/**
 * Before a cloud render: uploads assets the bucket lacks (when there are
 * keys), checks public ones are reachable, and signs reads of private ones.
 * Returns the signed URLs by sha256, for the render request.
 */
export async function prepareCloudAssets(
	options: AssetOptions & { expiresSec?: number },
): Promise<Record<string, string>> {
	const { config } = readConfig(options.cwd);
	const signed: Record<string, string> = {};
	const missing: string[] = [];
	for (const [path, entry] of storedAssets(config.assets)) {
		const { name, remote } = pickRemote(config.storage, entry.remote);
		const keys = credentialsFromEnv(name, options.env);
		if (!keys) {
			if (!remote.publicUrl) throw noCredentials(name, path);
			const url = readUrl(entry, config.storage) as string;
			if (!(await reachable(url, options.fetch))) missing.push(path);
			continue;
		}
		const bucket = new Bucket(remote, keys, { fetch: options.fetch });
		if (!(await bucket.has(entry.sha256, entry.size))) {
			if ((await localState(options.cwd, path, entry)) !== "ok") {
				missing.push(path);
				continue;
			}
			await upload(bucket, options.cwd, path, entry, options.log);
		}
		if (!remote.publicUrl)
			signed[entry.sha256] = await bucket.presign(
				entry.sha256,
				options.expiresSec ?? 86_400,
			);
	}
	if (missing.length)
		throw new AssetsError(
			`Not on the bucket: ${missing.join(", ")}. Run \`framefields assets push\` from a machine that has them (and the remote's keys).`,
			"not_uploaded",
		);
	return signed;
}

/** Assets kept on a remote (not pinned to a fixed `url`). */
function storedAssets(
	assets: AssetManifest | undefined,
): [string, AssetEntry][] {
	return Object.entries(assets ?? {}).filter(([, entry]) => !entry.url);
}

export async function localState(
	cwd: string,
	path: string,
	entry: AssetEntry,
): Promise<AssetState> {
	const file = join(cwd, path);
	if (!existsSync(file)) return "missing";
	if (statSync(file).size !== entry.size) return "changed";
	return (await hashFile(file)).sha256 === entry.sha256 ? "ok" : "changed";
}

async function readableUrl(
	entry: AssetEntry,
	storage: StorageConfig | undefined,
	options: AssetOptions,
): Promise<string> {
	const url = readUrl(entry, storage);
	if (url) return url;
	return openBucket(storage, entry.remote, options).presign(entry.sha256, 3600);
}

function openBucket(
	storage: StorageConfig | undefined,
	remoteName: string | undefined,
	options: AssetOptions,
): Bucket {
	const { name, remote } = pickRemote(storage, remoteName);
	const keys = credentialsFromEnv(name, options.env);
	if (!keys) throw noCredentials(name);
	return new Bucket(remote, keys, { fetch: options.fetch });
}

function noCredentials(remote: string, path?: string): AssetsError {
	const [id, secret] = credentialEnvNames(remote);
	return new AssetsError(
		`${path ? `${path} is on ${remote}, which` : `Remote ${remote}`} needs keys: set ${id} and ${secret} (or AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)${path ? ", or give it a publicUrl" : ""}.`,
		"no_credentials",
	);
}

async function upload(
	bucket: Bucket,
	cwd: string,
	path: string,
	digest: { sha256: string; size: number },
	log?: (line: string) => void,
): Promise<void> {
	log?.(`Uploading ${path} (${megabytes(digest.size)})`);
	let shown = 0;
	await bucket.upload(join(cwd, path), digest, ({ sent, total }) => {
		const percent = Math.floor((sent / total) * 10) * 10;
		if (total > 64e6 && percent > shown && percent < 100) {
			shown = percent;
			log?.(`  ${percent}%`);
		}
	});
}

async function reachable(url: string, fetchImpl = fetch): Promise<boolean> {
	const res = await fetchImpl(url, { method: "HEAD" }).catch(() => undefined);
	return res?.ok ?? false;
}

/** Project-relative POSIX paths of `path`, or of every file under it. */
function expand(cwd: string, path: string): string[] {
	const abs = resolve(cwd, path);
	const rel = relative(cwd, abs).split(sep).join("/");
	if (!isAssetPath(rel) || rel.startsWith("../"))
		throw new AssetsError(`${path} is outside the project.`, "outside_project");
	if (!existsSync(abs))
		throw new AssetsError(`${path} does not exist.`, "not_found");
	if (!statSync(abs).isDirectory()) return [rel];
	return readdirSync(abs, { withFileTypes: true })
		.filter((d) => !d.name.startsWith("."))
		.flatMap((d) => expand(cwd, `${rel}/${d.name}`))
		.sort();
}

const IGNORE_HEADER =
	"# framefields assets: on the bucket, pinned in framefields.json";

/** Adds the files to .gitignore, under one marked block. */
export function ignore(cwd: string, files: string[]): void {
	const file = join(cwd, ".gitignore");
	const text = existsSync(file) ? readFileSync(file, "utf8") : "";
	const lines = new Set(text.split("\n"));
	const fresh = files.map((f) => `/${f}`).filter((l) => !lines.has(l));
	if (fresh.length === 0) return;
	const header = lines.has(IGNORE_HEADER) ? [] : [IGNORE_HEADER];
	const lead = text && !text.endsWith("\n") ? "\n" : "";
	appendFileSync(file, `${lead}${[...header, ...fresh].join("\n")}\n`);
}

function trackedByGit(cwd: string, files: string[]): string[] {
	try {
		return execFileSync("git", ["ls-files", "--", ...files], {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\n")
			.filter(Boolean);
	} catch {
		return [];
	}
}

export function sortKeys(assets: AssetManifest): AssetManifest {
	return Object.fromEntries(
		Object.entries(assets).sort(([a], [b]) => a.localeCompare(b)),
	);
}

export function megabytes(bytes: number): string {
	return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

const ASSETS_USAGE = `Usage: framefields assets add <path...> [--remote <name>]
       framefields assets push | pull [--overwrite] | status [--json]
`;

/** The `framefields assets` command. */
export async function runAssets(
	[sub, ...paths]: string[],
	options: AssetOptions & {
		remote?: string;
		overwrite?: boolean;
		json?: boolean;
	},
): Promise<number> {
	const log = options.log ?? (() => {});
	if (sub === "add" && paths.length > 0) {
		const added = await addAssets(paths, options);
		const sent = added.filter((a) => a.uploaded).length;
		log(
			`Recorded ${added.length} asset${added.length === 1 ? "" : "s"} in ${CONFIG_FILE} (${sent} uploaded, ${added.length - sent} already on the bucket). Commit ${CONFIG_FILE} and .gitignore.`,
		);
		return 0;
	}
	if (sub === "push") {
		const { uploaded, present } = await pushAssets(options);
		log(
			`Uploaded ${uploaded.length}; ${present.length} already on the bucket.`,
		);
		return 0;
	}
	if (sub === "pull") {
		const { downloaded, present, changed } = await pullAssets(options);
		log(`Downloaded ${downloaded.length}; ${present.length} already here.`);
		if (changed.length)
			log(
				`Changed here, left alone: ${changed.join(", ")}. \`framefields assets add\` records them, --overwrite restores them.`,
			);
		return changed.length ? 1 : 0;
	}
	if (sub === "status") {
		const entries = await assetStatus(options.cwd);
		if (options.json) log(JSON.stringify({ assets: entries }));
		else if (entries.length === 0) log(`No assets in ${CONFIG_FILE}.`);
		else
			for (const e of entries)
				log(`${e.state.padEnd(8)} ${e.path} (${megabytes(e.size)})`);
		return entries.some((e) => e.state !== "ok") ? 1 : 0;
	}
	process.stderr.write(ASSETS_USAGE);
	return 2;
}
