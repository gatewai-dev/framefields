import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
	VISION_MODELS,
	type VisionModelDescriptor,
	type VisionModelKey,
} from "./registry.js";

export type ModelDownloadStatus = "pending" | "downloading" | "ready" | "error";

export interface VisionModelStoreOptions {
	readonly modelsDir?: string;
	/**
	 * Mirror origin: models are fetched from `<baseUrl>/<filename>` instead of their pinned
	 * Hugging Face URLs. Defaults to `$FRAMEFIELDS_MODELS_BASE_URL` when set.
	 */
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	/** Extra attempts after a network error, HTTP 429 or 5xx. Default 2. */
	readonly retries?: number;
	/** Base backoff between attempts (doubles each retry). Default 1000 ms. */
	readonly retryDelayMs?: number;
	/**
	 * Verify byte size + SHA-256 against the registry (default true). Only offline tests
	 * that serve fake bytes should turn this off.
	 */
	readonly verify?: boolean;
	/** Injectable fetch — offline unit tests inject a mock. */
	readonly fetchImpl?: typeof fetch;
	readonly onProgress?: (
		key: VisionModelKey,
		bytesLoaded: number,
		totalBytes: number,
	) => void;
}

/**
 * Resolves the default model cache directory:
 * 1. `FRAMEFIELDS_MODELS_DIR`
 * 2. `~/.cache/framefields/models`
 */
export function getDefaultModelsDir(): string {
	if (process.env.FRAMEFIELDS_MODELS_DIR) {
		return resolve(process.env.FRAMEFIELDS_MODELS_DIR);
	}
	return resolve(homedir(), ".cache/framefields/models");
}

/**
 * Lazy model store. The constructor performs ZERO I/O; the only entry that can hit the
 * network is `ensure(key)`, called by an inference function the first time it runs.
 * Concurrent callers of the same key share a single in-flight download (promise dedupe),
 * downloads are written atomically (temp + rename), and verified files on disk are reused
 * across processes.
 */
export class VisionModelStore {
	private readonly _modelsDir: string;
	private readonly _baseUrl?: string;
	private readonly _timeoutMs?: number;
	private readonly _retries: number;
	private readonly _retryDelayMs: number;
	private readonly _verify: boolean;
	private readonly _fetch: typeof fetch;
	private readonly _onProgress?: VisionModelStoreOptions["onProgress"];

	private _inflight = new Map<VisionModelKey, Promise<Uint8Array>>();
	private _buffers = new Map<VisionModelKey, Uint8Array>();
	private _status = new Map<VisionModelKey, ModelDownloadStatus>();

	constructor(options: VisionModelStoreOptions = {}) {
		this._modelsDir = options.modelsDir
			? resolve(options.modelsDir)
			: getDefaultModelsDir();
		this._baseUrl =
			options.baseUrl ?? process.env.FRAMEFIELDS_MODELS_BASE_URL ?? undefined;
		this._timeoutMs = options.timeoutMs;
		this._retries = Math.max(0, options.retries ?? 2);
		this._retryDelayMs = options.retryDelayMs ?? 1000;
		this._verify = options.verify !== false;
		this._fetch = options.fetchImpl ?? globalThis.fetch;
		this._onProgress = options.onProgress;
	}

	public get modelsDir(): string {
		return this._modelsDir;
	}

	public pathFor(key: VisionModelKey): string {
		return join(this._modelsDir, VISION_MODELS[key].filename);
	}

	public descriptor(key: VisionModelKey): VisionModelDescriptor {
		return VISION_MODELS[key];
	}

	/** The URL `ensure(key)` downloads from (mirror when `baseUrl` is set). */
	public urlFor(key: VisionModelKey): string {
		const desc = VISION_MODELS[key];
		if (!this._baseUrl) return desc.url;
		return `${this._baseUrl.replace(/\/+$/, "")}/${desc.filename}`;
	}

	/** True when a complete cached file exists (exact registry size when verifying). */
	public has(key: VisionModelKey): boolean {
		const targetPath = this.pathFor(key);
		if (!existsSync(targetPath)) {
			return false;
		}
		try {
			const size = statSync(targetPath).size;
			return this._verify ? size === VISION_MODELS[key].bytes : size > 0;
		} catch {
			return false;
		}
	}

	/** Drops a cached model (file + memory) so the next `ensure` re-downloads it. */
	public async evict(key: VisionModelKey): Promise<void> {
		this._buffers.delete(key);
		this._status.set(key, "pending");
		await unlink(this.pathFor(key)).catch(() => undefined);
	}

	public status(key: VisionModelKey): ModelDownloadStatus {
		return this._status.get(key) ?? "pending";
	}

	/** Snapshot of every tracked model's status (empty until anything is fetched). */
	public statuses(): ReadonlyMap<VisionModelKey, ModelDownloadStatus> {
		return new Map(this._status);
	}

	/** True when the model is resident in memory (loaded or downloaded this process). */
	public isLoaded(key: VisionModelKey): boolean {
		return this._buffers.has(key);
	}

	/**
	 * THE only download entry point. Returns the model bytes from memory (cached),
	 * loading from disk or fetching from the registry URL as needed.
	 */
	public async ensure(key: VisionModelKey): Promise<Uint8Array> {
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
	public async preload(keys: readonly VisionModelKey[]): Promise<void> {
		await Promise.all([...new Set(keys)].map((key) => this.ensure(key)));
	}

	private async load(key: VisionModelKey): Promise<Uint8Array> {
		const targetPath = this.pathFor(key);

		if (this.has(key)) {
			this._status.set(key, "ready");
			return this.readBuffer(key, targetPath);
		}

		const downloadUrl = this.urlFor(key);
		this._status.set(key, "downloading");

		if (!existsSync(dirname(targetPath))) {
			mkdirSync(dirname(targetPath), { recursive: true });
		}

		const tempPath = `${targetPath}.tmp.${Date.now()}`;
		try {
			const { buffer, totalBytes } = await this.download(key, downloadUrl);

			if (buffer.byteLength === 0) {
				throw new Error(`Downloaded vision model '${key}' is empty (0 bytes).`);
			}
			if (this._verify) {
				this.verifyBytes(key, buffer, downloadUrl);
			}

			this._onProgress?.(
				key,
				buffer.byteLength,
				totalBytes || buffer.byteLength,
			);

			// Write-then-rename keeps the cache atomic: a crash never leaves a partial model
			// at the final path.
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

	/** Fetches with retries on transient failures (network errors, HTTP 429/5xx). */
	private async download(
		key: VisionModelKey,
		url: string,
	): Promise<{ buffer: Uint8Array; totalBytes: number }> {
		for (let attempt = 0; ; attempt++) {
			let transient: unknown;
			try {
				const response = await this._fetch(url, {
					signal: this._timeoutMs
						? AbortSignal.timeout(this._timeoutMs)
						: undefined,
				});
				if (response.ok) {
					const totalBytes = Number(
						response.headers.get("content-length") ?? 0,
					);
					return {
						buffer: new Uint8Array(await response.arrayBuffer()),
						totalBytes,
					};
				}
				const error = new Error(
					`Failed to download vision model '${key}' from ${url}: HTTP ${response.status} ${response.statusText}`,
				);
				if (response.status !== 429 && response.status < 500) throw error;
				transient = error;
			} catch (error) {
				// fetch() rejects with a TypeError on network failures (reset, DNS, TLS).
				if (!(error instanceof TypeError)) throw error;
				transient = error;
			}
			if (attempt >= this._retries) {
				throw new Error(
					`Failed to download vision model '${key}' from ${url} after ${attempt + 1} attempts: ${String(transient)}`,
					{ cause: transient },
				);
			}
			await new Promise((r) => setTimeout(r, this._retryDelayMs * 2 ** attempt));
		}
	}

	private verifyBytes(
		key: VisionModelKey,
		buffer: Uint8Array,
		url: string,
	): void {
		const desc = VISION_MODELS[key];
		if (buffer.byteLength !== desc.bytes) {
			throw new Error(
				`Vision model '${key}' from ${url} is ${buffer.byteLength} bytes, expected ${desc.bytes}.`,
			);
		}
		const digest = createHash("sha256").update(buffer).digest("hex");
		if (digest !== desc.sha256) {
			throw new Error(
				`Vision model '${key}' from ${url} failed its SHA-256 check (got ${digest}, expected ${desc.sha256}).`,
			);
		}
	}

	private async readBuffer(
		key: VisionModelKey,
		targetPath: string,
	): Promise<Uint8Array> {
		const fileBuffer = await readFile(targetPath);
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
