import fs from "node:fs/promises";
import path from "node:path";
import { RenderError } from "../errors.js";
import { CommandError, classifyGitError } from "./exec.js";
import { type GitContext, git } from "./mirror.js";

const POINTER_HEADER = "version https://git-lfs.github.com/spec/v1";
const DISK_MARGIN_BYTES = 2 * 1024 * 1024 * 1024;

export interface LfsOptions {
	enabled?: boolean;
	include: string[];
	exclude: string[];
	/** Directories that must be fully usable (workdir, sparse paths). */
	scope: string[];
}

export interface LfsResult {
	used: boolean;
	files: number;
	bytes: number;
	cache: "hit" | "partial" | "miss" | "off";
}

interface LfsFile {
	name: string;
	size: number;
	downloaded?: boolean;
}

/** True when any tracked .gitattributes routes files through LFS. */
export async function usesLfs(root: string, ctx: GitContext): Promise<boolean> {
	const { stdout } = await git(ctx, [
		"-C",
		root,
		"ls-files",
		"-z",
		"--",
		":(glob)**/.gitattributes",
		".gitattributes",
	]).catch(() => ({ stdout: "" }));
	for (const file of stdout.split("\0").filter(Boolean)) {
		const text = await fs
			.readFile(path.join(root, file), "utf8")
			.catch(() => "");
		if (/filter=lfs/.test(text)) return true;
	}
	return false;
}

/**
 * Pulls LFS objects for the include/exclude patterns into the shared object
 * store, with a disk-space preflight and a pointer-file postflight (§6.2.5).
 */
export async function pullLfs(
	root: string,
	ctx: GitContext,
	options: LfsOptions,
): Promise<LfsResult> {
	const enabled = options.enabled ?? (await usesLfs(root, ctx));
	if (!enabled) return { used: false, files: 0, bytes: 0, cache: "off" };

	const storage = path.join(ctx.config.paths.cacheDir, "lfs");
	await fs.mkdir(storage, { recursive: true });
	const lfsArgs = [
		"-C",
		root,
		"-c",
		`lfs.storage=${storage}`,
		"-c",
		`lfs.concurrenttransfers=${Math.max(1, ctx.config.source.lfsConcurrency)}`,
		"-c",
		"lfs.fetchrecentalways=false",
		"-c",
		"lfs.skipdownloaderrors=false",
	];
	const filters = [
		...(options.include.length ? ["-I", options.include.join(",")] : []),
		...(options.exclude.length ? ["-X", options.exclude.join(",")] : []),
	];
	const lfsError = (err: unknown) =>
		err instanceof RenderError
			? err
			: classifyGitError(err, "lfs", {
					lfs: true,
					extraRules: ctx.profile.lfsRules,
					fallback: "GIT_NETWORK",
				});

	// Preflight: what would be downloaded, and does it fit?
	let files: LfsFile[];
	try {
		const { stdout } = await git(ctx, [
			...lfsArgs,
			"lfs",
			"ls-files",
			"--json",
			...filters,
		]);
		files = (JSON.parse(stdout || "{}").files ?? []) as LfsFile[];
	} catch (err) {
		if (
			err instanceof CommandError &&
			/unknown flag: --json/.test(err.result.stderr)
		) {
			throw new RenderError(
				"TOOL_MISSING",
				"git-lfs ≥ 3.3 is required (ls-files --json).",
				{ phase: "lfs" },
			);
		}
		throw lfsError(err);
	}
	const missing = files.filter((f) => !f.downloaded);
	const needed = missing.reduce((sum, f) => sum + (f.size ?? 0), 0);
	const total = files.reduce((sum, f) => sum + (f.size ?? 0), 0);
	// Objects land in the store, then get copied into the checkout.
	await assertFreeSpace(storage, needed);
	await assertFreeSpace(root, total);

	const attempts = 3;
	for (let attempt = 1; ; attempt++) {
		try {
			await git(ctx, [...lfsArgs, "lfs", "pull", ...filters], {
				timeoutSec: ctx.config.limits.timeouts.lfs,
			});
			break;
		} catch (err) {
			const classified = lfsError(err);
			if (!classified.retryable || attempt >= attempts || ctx.signal.aborted)
				throw classified;
			await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
		}
	}

	await assertNoPointers(root, files, options.scope);

	return {
		used: true,
		files: files.length,
		bytes: total,
		cache:
			missing.length === 0
				? "hit"
				: missing.length === files.length
					? "miss"
					: "partial",
	};
}

/**
 * After the pull, any file in scope that still holds a pointer is an asset
 * the render would choke on. Fail with the exact paths instead.
 */
async function assertNoPointers(
	root: string,
	files: LfsFile[],
	scope: string[],
): Promise<void> {
	const inScope = (name: string) =>
		scope.length === 0 ||
		scope.some(
			(s) =>
				s === "." || name === s || name.startsWith(`${s.replace(/\/$/, "")}/`),
		);
	const unresolved: string[] = [];
	for (const file of files) {
		if (!inScope(file.name)) continue;
		const handle = await fs
			.open(path.join(root, file.name), "r")
			.catch(() => undefined);
		if (!handle) continue;
		try {
			const buf = Buffer.alloc(POINTER_HEADER.length);
			await handle.read(buf, 0, buf.length, 0);
			if (buf.toString("utf8") === POINTER_HEADER) unresolved.push(file.name);
		} finally {
			await handle.close();
		}
	}
	if (unresolved.length > 0) {
		throw new RenderError(
			"LFS_POINTER_UNRESOLVED",
			`${unresolved.length} LFS file(s) were not downloaded: ${unresolved.slice(0, 10).join(", ")}${unresolved.length > 10 ? ", …" : ""}`,
			{ phase: "lfs", details: { files: unresolved.slice(0, 100) } },
		);
	}
}

/**
 * Pointer files that are outside the job's include patterns but inside its
 * workdir: likely assets the render needs. Reported as a warning up front.
 */
export async function findPointers(
	root: string,
	scope: string,
	limit = 20,
): Promise<string[]> {
	const found: string[] = [];
	const walk = async (dir: string): Promise<void> => {
		if (found.length >= limit) return;
		const entries = await fs
			.readdir(dir, { withFileTypes: true })
			.catch(() => []);
		for (const entry of entries) {
			if (found.length >= limit) return;
			if (entry.name === ".git" || entry.name === "node_modules") continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) await walk(full);
			else if (entry.isFile()) {
				const stat = await fs.stat(full);
				if (stat.size > 200) continue;
				const text = await fs.readFile(full, "utf8").catch(() => "");
				if (text.startsWith(POINTER_HEADER))
					found.push(path.relative(root, full));
			}
		}
	};
	await walk(path.join(root, scope));
	return found;
}

export async function assertFreeSpace(
	dir: string,
	bytes: number,
): Promise<void> {
	if (bytes <= 0) return;
	const stat = await fs.statfs(dir);
	const free = Number(stat.bavail) * Number(stat.bsize);
	if (free < bytes + DISK_MARGIN_BYTES) {
		throw new RenderError(
			"DISK_FULL",
			`Need ${gb(bytes)} (+${gb(DISK_MARGIN_BYTES)} margin) in ${dir} but only ${gb(free)} is free.`,
			{
				phase: "lfs",
				hint: "Raise containerDiskInGb / the volume size, or narrow source.lfs.include.",
			},
		);
	}
}

const gb = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
