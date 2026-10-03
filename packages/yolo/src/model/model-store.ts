import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	DEFAULT_YOLO_BASE_URL,
	YOLO_MODELS,
	type YoloModelDescriptor,
	type YoloModelKey,
} from "./registry.js";

export type ModelDownloadStatus = "pending" | "downloading" | "ready" | "error";

export interface YoloModelStoreOptions {
	readonly modelsDir?: string;
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	/** Injectable fetch — offline unit tests inject a mock. */
	readonly fetchImpl?: typeof fetch;
	readonly onProgress?: (
		key: YoloModelKey,
		bytesLoaded: number,
		totalBytes: number,
	) => void;
}

/**
 * Resolves the default model cache directory:
 * 1. `GITFRAMES_MODELS_DIR`
 * 2. `~/.cache/gitframes/models`
 */
export function getDefaultModelsDir(): string {
	if (process.env.GITFRAMES_MODELS_DIR) {
		return resolve(process.env.GITFRAMES_MODELS_DIR);
	}
	return resolve(homedir(), ".cache/gitframes/models");
}

/**
 * Lazy YOLO model store. Constructor performs ZERO I/O; the only entry that can hit the
 * network is `ensure(key)`, called by an inference function the first time it runs.
 * Concurrent callers of the same key share a single in-flight download (promise dedupe),
 * and verified files on disk are reused across processes.
 *
 * Mirrors the proven mechanics of the old MediaPipe model manager (atomic temp+rename,
 * size verification, `GITFRAMES_MODELS_DIR` override) minus its eager constructor downloads.
 */
export class YoloModelStore {
	private readonly _modelsDir: string;
	private readonly _baseUrl: string;
	private readonly _timeoutMs?: number;
	private readonly _fetch: typeof fetch;
	private readonly _onProgress?: YoloModelStoreOptions["onProgress"];

	private _inflight = new Map<YoloModelKey, Promise<Uint8Array>>();
	private _buffers = new Map<YoloModelKey, Uint8Array>();
	private _status = new Map<YoloModelKey, ModelDownloadStatus>();

	constructor(options: YoloModelStoreOptions = {}) {
		this._modelsDir = options.modelsDir
			? resolve(options.modelsDir)
			: getDefaultModelsDir();
		this._baseUrl =
			options.baseUrl ??
			process.env.GITFRAMES_YOLO_BASE_URL ??
			DEFAULT_YOLO_BASE_URL;
		this._timeoutMs = options.timeoutMs;
		this._fetch = options.fetchImpl ?? globalThis.fetch;
		this._onProgress = options.onProgress;
	}

	public get modelsDir(): string {
		return this._modelsDir;
	}

	public pathFor(key: YoloModelKey): string {
		return join(this._modelsDir, YOLO_MODELS[key].filename);
	}

	public descriptor(key: YoloModelKey): YoloModelDescriptor {
		return YOLO_MODELS[key];
	}

	/**
	 * Smallest file we trust as a cached model. Every YOLO11 export in the registry
	 * ships well above 1 MB (smallest is yolo11n-cls ≈ 1.2 MB); a smaller file is a
	 * partial/stub write (e.g. a 4 KiB test fixture) and must be re-downloaded.
	 */
	static readonly MIN_VALID_MODEL_BYTES = 512 * 1024;

	public has(key: YoloModelKey): boolean {
		const targetPath = this.pathFor(key);
		if (!existsSync(targetPath)) {
			return false;
		}
		try {
			return statSync(targetPath).size >= YoloModelStore.MIN_VALID_MODEL_BYTES;
		} catch {
			return false;
		}
	}

	/** Drops a cached model (file + memory) so the next `ensure` re-downloads it. */
	public async evict(key: YoloModelKey): Promise<void> {
		this._buffers.delete(key);
		this._status.set(key, "pending");
		await unlink(this.pathFor(key)).catch(() => undefined);
	}

	/** Direct download helper for arbitrary model URLs, respecting injected fetch. */
	public async fetchDirect(url: string): Promise<Uint8Array> {
		const res = await this._fetch(url);
		if (!res.ok) {
			throw new Error(`Failed to fetch model from ${url}: ${res.statusText}`);
		}
		const buf = await res.arrayBuffer();
		return new Uint8Array(buf);
	}

	public status(key: YoloModelKey): ModelDownloadStatus {
		return this._status.get(key) ?? "pending";
	}

	/** Snapshot of every tracked model's status (empty until anything is fetched). */
	public statuses(): ReadonlyMap<YoloModelKey, ModelDownloadStatus> {
		return new Map(this._status);
	}

	/** True when the model is resident in memory (loaded or downloaded this process). */
	public isLoaded(key: YoloModelKey): boolean {
		return this._buffers.has(key);
	}

	/**
	 * THE only download entry point. Returns the model bytes from memory (cached),
	 * loading from disk or fetching from the registry URL as needed.
	 */
	public async ensure(key: YoloModelKey): Promise<Uint8Array> {
		const inMemory = this._buffers.get(key);
		if (inMemory) {
			return inMemory;
		}
		const inflight = this._inflight.get(key);
		if (inflight) {
			return inflight;
		}
		const promise = this.load(key).finally(() => this._inflight.delete(key));
		this._inflight.set(key, promise);
		return promise;
	}

	/** Explicit warm-up — fetch multiple models ahead of use (agents, renderers). */
	public async preload(keys: readonly YoloModelKey[]): Promise<void> {
		await Promise.all(keys.map((key) => this.ensure(key)));
	}

	private async load(key: YoloModelKey): Promise<Uint8Array> {
		const targetPath = this.pathFor(key);

		if (this.has(key)) {
			this._status.set(key, "ready");
			return this.readBuffer(key, targetPath);
		}

		const desc = YOLO_MODELS[key];
		const downloadUrl = desc.url ?? `${this._baseUrl}${desc.filename}`;
		this._status.set(key, "downloading");

		if (!existsSync(dirname(targetPath))) {
			mkdirSync(dirname(targetPath), { recursive: true });
		}

		const tempPath = `${targetPath}.tmp.${Date.now()}`;
		try {
			const response = await this._fetch(downloadUrl, {
				signal: this._timeoutMs
					? AbortSignal.timeout(this._timeoutMs)
					: undefined,
			});
			if (!response.ok) {
				throw new Error(
					`Failed to download YOLO model '${key}' from ${downloadUrl}: HTTP ${response.status} ${response.statusText}`,
				);
			}
			const totalBytes = Number(response.headers.get("content-length") ?? 0);
			const arrayBuffer = await response.arrayBuffer();
			const buffer = new Uint8Array(arrayBuffer);

			if (buffer.byteLength === 0) {
				throw new Error(`Downloaded YOLO model '${key}' is empty (0 bytes).`);
			}

			if (this._onProgress) {
				this._onProgress(
					key,
					buffer.byteLength,
					totalBytes || buffer.byteLength,
				);
			}

			// Write-then-rename keeps the cache atomic: a crash never leaves a partial model
			// at the final path (verified by has(): size > 1 KiB).
			await writeFile(tempPath, buffer);
			await rename(tempPath, targetPath);

			this._buffers.set(key, buffer);
			this._status.set(key, "ready");
			return buffer;
		} catch (error) {
			this._status.set(key, "error");
			if (existsSync(tempPath)) {
				await unlink(tempPath).catch(() => undefined);
			}
			throw error;
		}
	}

	private readBuffer(key: YoloModelKey, targetPath: string): Uint8Array {
		const fileBuffer = readFileSync(targetPath);
		const buffer = new Uint8Array(
			fileBuffer.buffer,
			fileBuffer.byteOffset,
			fileBuffer.byteLength,
		);
		this._buffers.set(key, buffer);
		return buffer;
	}

	/** Drops in-memory buffers (model stays on disk for the next run). */
	public clearMemoryCache(): void {
		this._buffers.clear();
	}
}
