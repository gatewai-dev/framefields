/**
 * Queued rendering: renders wait in line and run one after another on the
 * page's one GPU device, each as an on-device export (chunked, its chunks
 * kept in storage). The caller enqueues and moves on; events say what
 * happens. The line is saved with every change, so after a reload or an app
 * kill the queue opens where it stopped: the render that was running starts
 * again first and resumes from its last finished chunk.
 *
 * Events are plain JSON with a `type` and a one-line `text`, ready to post
 * to a native message handler as they are.
 */
import type {
	WebExportChunkStats,
	WebExportOptions,
	WebExportProgress,
	WebExportResult,
} from "./types.js";

/** Export options that can wait in a saved queue: no signal, no callback. */
export type QueueRenderOptions = Omit<
	WebExportOptions,
	"signal" | "onProgress"
>;

export type QueuedRenderStatus =
	| "queued"
	| "rendering"
	| "done"
	| "failed"
	| "cancelled";

/** A render in the queue, as saved and as events carry it. */
export interface QueuedRender {
	id: string;
	status: QueuedRenderStatus;
	options: QueueRenderOptions;
	/** The export it makes: renders with the same id make the same file. */
	jobId: string;
	enqueuedAt: number;
	startedAt?: number;
	finishedAt?: number;
	/** The latest progress while it renders (and its last one after). */
	progress?: WebExportProgress;
	/** Why it failed. */
	error?: string;
	result?: {
		frames: number;
		durationSec: number;
		bytes: number;
		elapsedMs: number;
		chunks: WebExportChunkStats[];
	};
}

export type RenderQueueEventType =
	| "queued"
	| "started"
	| "progress"
	| "done"
	| "failed"
	| "cancelled"
	| "removed";

export interface RenderQueueEvent {
	type: RenderQueueEventType;
	/** The render's id. */
	id: string;
	/** One line for a log or a status label. */
	text: string;
	render: QueuedRender;
}

/** What runs a render: the bundle's export on this page, or a test's stand-in. */
export interface QueueRunner {
	/** The export id the options make (see `QueuedRender.jobId`). */
	jobId(options: QueueRenderOptions): Promise<string>;
	/** Renders it; rejects when `signal` aborts (with its reason) or the render fails. */
	run(
		render: QueuedRender,
		control: {
			signal: AbortSignal;
			onProgress: (progress: WebExportProgress) => void;
		},
	): Promise<WebExportResult>;
	/** The file a render finished in an earlier session, if storage still has it. */
	file(render: QueuedRender): Promise<File | undefined>;
	/** Deletes what a render stored: written chunks, its file. */
	discard(render: QueuedRender): Promise<void>;
}

/** Where the line is saved. */
export interface QueueState {
	load(): Promise<QueuedRender[] | undefined>;
	save(renders: readonly QueuedRender[]): Promise<void>;
}

/** Not saved: a queue for this page's life only. */
export class MemoryQueueState implements QueueState {
	private saved: QueuedRender[] | undefined;
	async load() {
		return this.saved && structuredClone(this.saved);
	}
	async save(renders: readonly QueuedRender[]) {
		this.saved = structuredClone([...renders]);
	}
}

const SETTLED = new Set<QueuedRenderStatus>(["done", "failed", "cancelled"]);

/** Progress events at most this often, besides phase changes. */
const PROGRESS_EVERY_MS = 250;

export class RenderQueue {
	private renders: QueuedRender[];
	private readonly listeners = new Set<(event: RenderQueueEvent) => void>();
	private readonly waiters = new Map<string, Array<() => void>>();
	/** Files finished in this session (memory storage keeps them only here). */
	private readonly files = new Map<string, File>();
	private running?: { id: string; abort: AbortController; discard: boolean };
	private pumping?: Promise<void>;
	private saving: Promise<void> = Promise.resolve();

	private constructor(
		private readonly runner: QueueRunner,
		private readonly state: QueueState,
		renders: QueuedRender[],
	) {
		this.renders = renders;
	}

	/**
	 * Opens the saved queue and starts on it: a render that was running when
	 * the page went away runs again first (resuming from its chunks), then
	 * the rest in the order they were enqueued.
	 */
	static async open(
		runner: QueueRunner,
		state: QueueState = new MemoryQueueState(),
	): Promise<RenderQueue> {
		const saved = (await state.load()) ?? [];
		for (const render of saved) {
			if (render.status === "rendering") render.status = "queued";
		}
		const queue = new RenderQueue(runner, state, saved);
		queue.pump();
		return queue;
	}

	/**
	 * Adds a render and returns its id at once. Options that make the same
	 * file as a render already queued, running or done give that render's
	 * id instead of rendering it twice.
	 */
	async enqueue(options: QueueRenderOptions = {}): Promise<string> {
		const jobId = await this.runner.jobId(options);
		const same = this.renders.find(
			(r) =>
				r.jobId === jobId && r.status !== "failed" && r.status !== "cancelled",
		);
		if (same && (same.status !== "done" || (await this.file(same.id))))
			return same.id;
		if (same) this.forget(same.id); // done, but its file is gone
		const render: QueuedRender = {
			id: newId(),
			status: "queued",
			options: structuredClone(options),
			jobId,
			enqueuedAt: Date.now(),
		};
		this.renders.push(render);
		await this.change(render, "queued", `queued (${describe(options)})`);
		this.pump();
		return render.id;
	}

	/** Every render, in the order they were enqueued. */
	list(): QueuedRender[] {
		return this.renders.map((r) => structuredClone(r));
	}

	get(id: string): QueuedRender | undefined {
		const render = this.find(id);
		return render && structuredClone(render);
	}

	/**
	 * Takes a render out of line: a queued one never runs, a running one
	 * stops between frames. `discard: false` keeps what it wrote, so the same
	 * render enqueued again resumes; by default it is deleted. False when the
	 * render is unknown or already settled.
	 */
	async cancel(
		id: string,
		options: { discard?: boolean } = {},
	): Promise<boolean> {
		const render = this.find(id);
		if (!render || SETTLED.has(render.status)) return false;
		const discard = options.discard !== false;
		if (render.status === "rendering" && this.running?.id === id) {
			this.running.discard = discard;
			this.running.abort.abort(new DOMException("Cancelled", "AbortError"));
			await this.whenSettled(id);
			return true;
		}
		render.status = "cancelled";
		render.finishedAt = Date.now();
		if (discard) await this.runner.discard(render);
		await this.change(render, "cancelled", "cancelled");
		return true;
	}

	/** Forgets a settled render and deletes its file. */
	async remove(id: string): Promise<boolean> {
		const render = this.find(id);
		if (!render || !SETTLED.has(render.status)) return false;
		const shared = this.renders.some(
			(r) => r.id !== id && r.jobId === render.jobId && !SETTLED.has(r.status),
		);
		if (!shared) await this.runner.discard(render);
		this.forget(id);
		await this.save();
		this.emit({ type: "removed", id, text: "removed", render });
		return true;
	}

	/** The MP4 of a finished render, while storage holds it. */
	async file(id: string): Promise<File | undefined> {
		const render = this.find(id);
		if (render?.status !== "done") return undefined;
		return this.files.get(id) ?? (await this.runner.file(render));
	}

	/** Resolves with the render once it is done, failed or cancelled. */
	whenSettled(id: string): Promise<QueuedRender> {
		const render = this.find(id);
		if (!render)
			return Promise.reject(new Error(`No render ${id} in the queue.`));
		if (SETTLED.has(render.status))
			return Promise.resolve(structuredClone(render));
		return new Promise((resolve) => {
			const list = this.waiters.get(id) ?? [];
			list.push(() => resolve(this.get(id) as QueuedRender));
			this.waiters.set(id, list);
		});
	}

	/** Every event, as it happens. Returns the unsubscribe. */
	subscribe(listener: (event: RenderQueueEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Resolves when nothing is queued or running. */
	async idle(): Promise<void> {
		while (this.pumping) await this.pumping;
	}

	/** Cancels everything and empties the queue (storage is the caller's to clear). */
	async clear(): Promise<void> {
		// Queued ones first, so none starts once the running one stops.
		const open = this.renders.filter((r) => !SETTLED.has(r.status));
		open.sort(
			(a, b) =>
				Number(a.status === "rendering") - Number(b.status === "rendering"),
		);
		for (const r of open) await this.cancel(r.id);
		await this.idle();
		this.renders = [];
		this.files.clear();
		await this.save();
	}

	/** Runs queued renders one at a time until none is left. */
	private pump(): void {
		if (this.pumping) return;
		this.pumping = (async () => {
			for (;;) {
				const next = this.renders.find((r) => r.status === "queued");
				if (!next) break;
				await this.runOne(next);
			}
		})().finally(() => {
			this.pumping = undefined;
			// Enqueued while the loop was finishing.
			if (this.renders.some((r) => r.status === "queued")) this.pump();
		});
	}

	private async runOne(render: QueuedRender): Promise<void> {
		const abort = new AbortController();
		this.running = { id: render.id, abort, discard: true };
		render.status = "rendering";
		render.startedAt = Date.now();
		delete render.error;
		await this.change(render, "started", "rendering");
		let lastEmit = 0;
		try {
			const result = await this.runner.run(structuredClone(render), {
				signal: abort.signal,
				onProgress: (progress) => {
					const phaseChanged = render.progress?.phase !== progress.phase;
					render.progress = progress;
					const now = Date.now();
					if (!phaseChanged && now - lastEmit < PROGRESS_EVERY_MS) return;
					lastEmit = now;
					this.emit({
						type: "progress",
						id: render.id,
						text: progressText(progress),
						render: structuredClone(render),
					});
				},
			});
			this.files.set(render.id, result.file);
			render.status = "done";
			render.result = {
				frames: result.frames,
				durationSec: result.durationSec,
				bytes: result.file.size,
				elapsedMs: result.elapsedMs,
				chunks: result.chunks,
			};
			render.finishedAt = Date.now();
			await this.change(
				render,
				"done",
				`done: ${(result.file.size / 1e6).toFixed(1)} MB in ${(result.elapsedMs / 1000).toFixed(1)} s`,
			);
		} catch (err) {
			render.finishedAt = Date.now();
			if (abort.signal.aborted) {
				render.status = "cancelled";
				if (this.running?.discard) await this.runner.discard(render);
				await this.change(render, "cancelled", "cancelled");
			} else {
				// A failed render steps aside; the next one runs.
				render.status = "failed";
				render.error = err instanceof Error ? err.message : String(err);
				await this.change(render, "failed", `failed: ${render.error}`);
			}
		} finally {
			this.running = undefined;
		}
	}

	private async change(
		render: QueuedRender,
		type: RenderQueueEventType,
		text: string,
	): Promise<void> {
		await this.save();
		this.emit({ type, id: render.id, text, render: structuredClone(render) });
		if (SETTLED.has(render.status)) {
			const waiting = this.waiters.get(render.id) ?? [];
			this.waiters.delete(render.id);
			for (const wake of waiting) wake();
		}
	}

	/** Saves in order, never two writes at once. */
	private save(): Promise<void> {
		const snapshot = this.renders.map((r) => structuredClone(r));
		this.saving = this.saving.then(
			() => this.state.save(snapshot),
			() => this.state.save(snapshot),
		);
		return this.saving;
	}

	private emit(event: RenderQueueEvent): void {
		for (const listener of this.listeners) {
			try {
				listener(event);
			} catch (err) {
				console.error("[framefields] queue listener failed", err);
			}
		}
	}

	private find(id: string): QueuedRender | undefined {
		return this.renders.find((r) => r.id === id);
	}

	private forget(id: string): void {
		this.renders = this.renders.filter((r) => r.id !== id);
		this.files.delete(id);
	}
}

function newId(): string {
	return globalThis.crypto.randomUUID();
}

function describe(options: QueueRenderOptions): string {
	return [options.codec ?? "h264", String(options.quality ?? "very_high")].join(
		", ",
	);
}

function progressText(p: WebExportProgress): string {
	return p.etaSec ? `${p.message} · ${Math.ceil(p.etaSec)} s left` : p.message;
}
