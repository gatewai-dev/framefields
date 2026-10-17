import { createHash, randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { rendererLogger } from "../logger.js";

/**
 * Shared node_modules (PLAN.md §7.1). Projects on one worker mostly install
 * the same packages (framefields and its native binaries are hundreds of
 * MB), but npm and yarn extract a full copy per project, and pnpm copies too
 * when its store is on another disk (the network volume). After each install
 * every node_modules file is hashed and hard-linked to one copy in a content
 * store on the workspace disk, so each distinct file is stored once.
 *
 * Shared files are made read-only: a hard link writes through to every
 * project, so an in-place write must fail rather than change other projects.
 * Installs never write in place here (installer.ts removes node_modules
 * before reinstalling), and deleting a link only drops that project's copy.
 *
 * Each workspace slot lists the store keys it links in a manifest next to the
 * slot (outside the git worktree, so `git clean` keeps it). The janitor uses
 * it to drop store files nothing links to any more (nlink 1).
 */

/** Store root, on the same disk as the workspaces (hard links can't cross disks). */
export function moduleStoreDir(workDir: string): string {
	return path.join(workDir, "store", "v1");
}

/** Manifest of store keys a workspace slot links: ws/<repo>/<slot>.modules. */
export function manifestPath(slotRoot: string): string {
	return `${slotRoot}.modules`;
}

interface ShareResult {
	files: number;
	/** Size of the files as the install wrote them (before sharing). */
	installBytes: number;
	/** Files now linked to a copy that already existed (bytes saved). */
	linked: number;
	savedBytes: number;
	/** Why nothing was shared, if so. */
	skipped?: string;
}

const PARALLEL = 32;
const SMALL_FILE = 1024 * 1024;

async function hashFile(file: string, size: number): Promise<string> {
	const hash = createHash("sha256");
	if (size <= SMALL_FILE) {
		hash.update(await fs.readFile(file));
	} else {
		for await (const chunk of createReadStream(file)) hash.update(chunk);
	}
	return hash.digest("hex");
}

/** Regular files under every node_modules dir in `root` (symlinks skipped). */
async function* moduleFiles(
	dir: string,
	inModules = false,
): AsyncGenerator<string> {
	const entries = await fs
		.readdir(dir, { withFileTypes: true })
		.catch(() => []);
	for (const e of entries) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (!inModules && e.name === ".git") continue;
			yield* moduleFiles(p, inModules || e.name === "node_modules");
		} else if (inModules && e.isFile()) {
			yield p;
		}
	}
}

/** Removes every node_modules dir under `root`, before a reinstall. */
export async function removeModules(root: string): Promise<void> {
	const walk = async (dir: string): Promise<void> => {
		const entries = await fs
			.readdir(dir, { withFileTypes: true })
			.catch(() => []);
		await Promise.all(
			entries
				.filter((e) => e.isDirectory() && e.name !== ".git")
				.map((e) => {
					const p = path.join(dir, e.name);
					return e.name === "node_modules"
						? fs.rm(p, { recursive: true, force: true })
						: walk(p);
				}),
		);
	};
	await walk(root);
}

/** Store path for a key: <store>/ab/<key>. */
function storePath(store: string, key: string): string {
	return path.join(store, key.slice(0, 2), key);
}

async function readManifest(file: string): Promise<Set<string>> {
	const text = await fs.readFile(file, "utf8").catch(() => "");
	return new Set(text.split("\n").filter(Boolean));
}

/** Deletes store files for `keys` that no workspace links any more. */
export async function releaseKeys(
	store: string,
	keys: Iterable<string>,
): Promise<number> {
	let freed = 0;
	for (const key of keys) {
		const file = storePath(store, key);
		const stat = await fs.lstat(file).catch(() => undefined);
		if (stat?.isFile() && stat.nlink <= 1) {
			await fs.rm(file, { force: true });
			freed += stat.size;
		}
	}
	return freed;
}

/** Store keys linked by every slot of a repo's workspace dir. */
export async function readManifests(repoDir: string): Promise<Set<string>> {
	const keys = new Set<string>();
	for (const name of await fs.readdir(repoDir).catch(() => [])) {
		if (!name.endsWith(".modules")) continue;
		for (const key of await readManifest(path.join(repoDir, name))) {
			keys.add(key);
		}
	}
	return keys;
}

/** Deletes every store file nothing links to. Returns bytes freed. */
export async function sweepStore(store: string): Promise<number> {
	let freed = 0;
	for (const shard of await fs.readdir(store).catch(() => [])) {
		const dir = path.join(store, shard);
		for (const name of await fs.readdir(dir).catch(() => [])) {
			const file = path.join(dir, name);
			const stat = await fs.lstat(file).catch(() => undefined);
			if (!stat?.isFile()) {
				// Leftover temp names from an interrupted share.
				if (name.includes(".tmp-")) await fs.rm(file, { force: true });
				continue;
			}
			if (stat.nlink <= 1) {
				await fs.rm(file, { force: true });
				freed += stat.size;
			}
		}
	}
	return freed;
}

/**
 * Links every node_modules file under `slotRoot` to the store, then writes
 * the slot's manifest and releases keys the previous install used but this
 * one doesn't. Never throws: a failure leaves files unshared, not broken.
 */
export async function shareModules(
	slotRoot: string,
	store: string,
): Promise<ShareResult> {
	const result: ShareResult = {
		files: 0,
		installBytes: 0,
		linked: 0,
		savedBytes: 0,
	};
	try {
		await fs.mkdir(store, { recursive: true });
		const [a, b] = await Promise.all([fs.stat(slotRoot), fs.stat(store)]);
		if (a.dev !== b.dev) {
			return { ...result, skipped: "store and workspaces on different disks" };
		}

		const keys = new Set<string>();
		// Files already hard-linked to each other are hashed once.
		const byInode = new Map<string, string>();
		const share = async (file: string): Promise<void> => {
			const stat = await fs.lstat(file);
			if (!stat.isFile() || stat.size === 0) return;
			result.files++;
			result.installBytes += stat.size;
			const inode = `${stat.dev}:${stat.ino}`;
			const exec = (stat.mode & 0o111) !== 0;
			const key =
				byInode.get(inode) ??
				(await hashFile(file, stat.size)) + (exec ? "x" : "");
			byInode.set(inode, key);
			const target = storePath(store, key);

			const existing = await fs.lstat(target).catch(() => undefined);
			if (existing?.ino === stat.ino) {
				keys.add(key);
				return;
			}
			if (existing) {
				if (existing.size !== stat.size) return; // corrupt store entry
				// Swap the file for a link to the shared copy, atomically.
				const tmp = `${file}.ff-tmp-${randomBytes(4).toString("hex")}`;
				try {
					await fs.link(target, tmp);
				} catch (err) {
					// EMLINK: the shared copy has the maximum number of links.
					if ((err as NodeJS.ErrnoException).code === "EMLINK") return;
					throw err;
				}
				await fs.rename(tmp, file);
				result.linked++;
				result.savedBytes += stat.size;
				keys.add(key);
				return;
			}
			// First copy: this file becomes the shared one.
			await fs.mkdir(path.dirname(target), { recursive: true });
			try {
				await fs.link(file, target);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code === "EEXIST") {
					return share(file); // linked meanwhile: take the other path
				}
				throw err;
			}
			await fs.chmod(target, exec ? 0o555 : 0o444);
			keys.add(key);
		};

		let batch: Promise<void>[] = [];
		for await (const file of moduleFiles(slotRoot)) {
			batch.push(share(file));
			if (batch.length >= PARALLEL) {
				await Promise.all(batch);
				batch = [];
			}
		}
		await Promise.all(batch);

		const manifest = manifestPath(slotRoot);
		const previous = await readManifest(manifest);
		await fs.writeFile(manifest, [...keys].join("\n"));
		await releaseKeys(
			store,
			[...previous].filter((k) => !keys.has(k)),
		);
		return result;
	} catch (err) {
		rendererLogger.warn(
			{ err: err instanceof Error ? err.message : String(err) },
			"Sharing node_modules failed; this workspace keeps its own copies",
		);
		return { ...result, skipped: "error" };
	}
}

const SIZES_FILE = "install-sizes.json";
const SIZES_KEPT = 20;

/**
 * Remembers how much an install wrote before sharing: npm and yarn extract a
 * full copy first, so the next install needs that much free disk even when
 * most of it is shared afterwards.
 */
export async function recordInstallSize(
	workDir: string,
	stamp: string,
	bytes: number,
): Promise<void> {
	const file = path.join(workDir, "store", SIZES_FILE);
	const sizes = await readSizes(file);
	delete sizes[stamp];
	sizes[stamp] = bytes;
	const kept = Object.entries(sizes).slice(-SIZES_KEPT);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify(Object.fromEntries(kept)));
}

/** Expected install size: this lockfile's last install, else the largest seen. */
export async function expectedInstallSize(
	workDir: string,
	stamp: string,
): Promise<number> {
	const sizes = await readSizes(path.join(workDir, "store", SIZES_FILE));
	return sizes[stamp] ?? Math.max(0, ...Object.values(sizes));
}

async function readSizes(file: string): Promise<Record<string, number>> {
	try {
		const parsed = JSON.parse(await fs.readFile(file, "utf8"));
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}
