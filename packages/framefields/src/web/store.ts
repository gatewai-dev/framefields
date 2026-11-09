/// <reference lib="dom" />
/**
 * Where an on-device export keeps its pieces (chunk files, the audio render,
 * the job's state) until they are stitched: the origin private file system,
 * so finished chunks survive the app being killed and nothing large sits in
 * memory, or memory when OPFS is missing.
 */
import type { StreamTargetChunk } from "mediabunny";

/** A file being written: positioned writes, as mediabunny's `StreamTarget` makes them. */
export interface StoreWriter {
	stream: WritableStream<StreamTargetChunk>;
	/** Commits the file; until then it does not exist under its name. */
	close(): Promise<void>;
	/** Drops what was written. */
	abort(): Promise<void>;
}

export interface ExportStore {
	/** Survives a reload (an export can resume from it). */
	readonly persistent: boolean;
	readJson<T>(name: string): Promise<T | undefined>;
	writeJson(name: string, value: unknown): Promise<void>;
	write(name: string): Promise<StoreWriter>;
	/** A finished file, or `undefined`. */
	file(name: string): Promise<File | undefined>;
	remove(name: string): Promise<void>;
	/** Removes everything this job wrote. */
	clear(): Promise<void>;
}

/** Where exports keep their folders in OPFS: one per job id. */
export const EXPORTS_DIR = "framefields-exports";

/** OPFS, one folder per job. Writes go to the file directly (Safari's `createWritable` commits on close). */
export class OpfsExportStore implements ExportStore {
	readonly persistent = true;

	private constructor(
		private readonly parent: FileSystemDirectoryHandle,
		private dir: FileSystemDirectoryHandle,
	) {}

	static available(): boolean {
		return (
			typeof navigator !== "undefined" &&
			typeof navigator.storage?.getDirectory === "function" &&
			typeof FileSystemFileHandle !== "undefined" &&
			"createWritable" in FileSystemFileHandle.prototype
		);
	}

	static async open(jobId: string): Promise<OpfsExportStore> {
		const root = await navigator.storage.getDirectory();
		const parent = await root.getDirectoryHandle(EXPORTS_DIR, {
			create: true,
		});
		const dir = await parent.getDirectoryHandle(jobId, { create: true });
		return new OpfsExportStore(parent, dir);
	}

	/** Removes every export's folder, finished or not. */
	static async clearAll(): Promise<void> {
		const root = await navigator.storage.getDirectory();
		await root
			.removeEntry(EXPORTS_DIR, { recursive: true })
			.catch((err: unknown) => {
				if ((err as DOMException).name !== "NotFoundError") throw err;
			});
	}

	async readJson<T>(name: string): Promise<T | undefined> {
		const file = await this.file(name);
		if (!file) return undefined;
		try {
			return JSON.parse(await file.text()) as T;
		} catch {
			return undefined; // torn by a kill mid-write: start over
		}
	}

	async writeJson(name: string, value: unknown): Promise<void> {
		const handle = await this.dir.getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		await writable.write(JSON.stringify(value));
		await writable.close();
	}

	async write(name: string): Promise<StoreWriter> {
		const handle = await this.dir.getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		// mediabunny writes `{ type: "write", data, position }`, which
		// FileSystemWritableFileStream takes as is.
		const stream = writable as unknown as WritableStream<StreamTargetChunk>;
		return {
			stream,
			close: async () => {
				// The muxer closes the stream when it finalizes; closing twice throws.
				if (!stream.locked) await writable.close().catch(ignoreClosed);
			},
			abort: async () => {
				await writable.abort().catch(() => {});
				await this.remove(name);
			},
		};
	}

	async file(name: string): Promise<File | undefined> {
		try {
			const handle = await this.dir.getFileHandle(name);
			return await handle.getFile();
		} catch {
			return undefined;
		}
	}

	async remove(name: string): Promise<void> {
		await this.dir.removeEntry(name).catch(() => {});
	}

	async clear(): Promise<void> {
		const name = this.dir.name;
		await this.parent.removeEntry(name, { recursive: true }).catch(() => {});
		this.dir = await this.parent.getDirectoryHandle(name, { create: true });
	}
}

function ignoreClosed(err: unknown): void {
	if ((err as DOMException | undefined)?.name !== "TypeError") throw err;
}

/** Files as Blobs in memory: for browsers without OPFS, and tests. Not persistent. */
export class MemoryExportStore implements ExportStore {
	readonly persistent: boolean;
	private readonly files = new Map<string, File>();

	/** `persistent` lets a test treat a store kept across runs as a reload-safe one. */
	constructor(options: { persistent?: boolean } = {}) {
		this.persistent = options.persistent ?? false;
	}

	async readJson<T>(name: string): Promise<T | undefined> {
		const file = this.files.get(name);
		return file ? (JSON.parse(await file.text()) as T) : undefined;
	}

	async writeJson(name: string, value: unknown): Promise<void> {
		this.files.set(name, new File([JSON.stringify(value)], name));
	}

	async write(name: string): Promise<StoreWriter> {
		const parts: Array<{ position: number; data: Uint8Array }> = [];
		let committed = false;
		const commit = () => {
			if (committed) return;
			committed = true;
			this.files.set(name, new File([assemble(parts)], name));
		};
		const stream = new WritableStream<StreamTargetChunk>({
			write(chunk) {
				parts.push({ position: chunk.position, data: chunk.data.slice() });
			},
			close: commit,
		});
		return {
			stream,
			close: async () => {
				if (!stream.locked) await stream.close();
				commit();
			},
			abort: async () => {
				committed = true;
				this.files.delete(name);
			},
		};
	}

	async file(name: string): Promise<File | undefined> {
		return this.files.get(name);
	}

	async remove(name: string): Promise<void> {
		this.files.delete(name);
	}

	async clear(): Promise<void> {
		this.files.clear();
	}
}

/** Positioned writes laid out as the file they make (later writes win). */
function assemble(
	parts: ReadonlyArray<{ position: number; data: Uint8Array }>,
): Uint8Array<ArrayBuffer> {
	let size = 0;
	for (const { position, data } of parts)
		size = Math.max(size, position + data.length);
	const out = new Uint8Array(size);
	for (const { position, data } of parts) out.set(data, position);
	return out;
}
