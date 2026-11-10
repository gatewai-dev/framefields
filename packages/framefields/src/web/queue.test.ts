/**
 * The render queue: renders run one after another in the order enqueued,
 * a cancel takes a waiting or running render out of line, a failure never
 * blocks the renders behind it, and a queue opened again after a reload
 * picks up the render that was running first.
 */
import { describe, expect, it } from "vitest";
import {
	MemoryQueueState,
	type QueuedRender,
	type QueueRenderOptions,
	type QueueRunner,
	RenderQueue,
	type RenderQueueEvent,
} from "./queue.js";
import type { WebExportResult } from "./types.js";

/** Renders that take until released, so a test decides when each ends. */
class FakeRunner implements QueueRunner {
	readonly started: string[] = [];
	readonly discarded: string[] = [];
	private readonly gates = new Map<string, () => void>();
	private readonly arrived = new Map<string, () => void>();
	/** Renders (by quality) that fail. */
	failing = new Set<string>();

	async jobId(options: QueueRenderOptions): Promise<string> {
		return `job-${options.codec ?? "h264"}-${options.quality ?? "very_high"}`;
	}

	run(
		render: QueuedRender,
		control: { signal: AbortSignal; onProgress: (p: never) => void },
	): Promise<WebExportResult> {
		const name = String(render.options.quality);
		this.started.push(name);
		this.arrived.get(name)?.();
		return new Promise((resolve, reject) => {
			control.signal.addEventListener("abort", () =>
				reject(control.signal.reason),
			);
			this.gates.set(name, () => {
				if (this.failing.has(name)) reject(new Error(`${name} broke`));
				else resolve(result(name));
			});
		});
	}

	async file(): Promise<File | undefined> {
		return undefined;
	}

	async discard(render: QueuedRender): Promise<void> {
		this.discarded.push(String(render.options.quality));
	}

	/** Resolves once the render named `name` has started. */
	running(name: string): Promise<void> {
		if (this.started.includes(name)) return Promise.resolve();
		return new Promise((resolve) => this.arrived.set(name, resolve));
	}

	/** Lets a started render finish. */
	async finish(name: string): Promise<void> {
		await this.running(name);
		this.gates.get(name)?.();
	}
}

function result(name: string): WebExportResult {
	return {
		file: new File([name], `${name}.mp4`),
		frames: 10,
		durationSec: 1,
		jobId: `job-${name}`,
		chunks: [],
		elapsedMs: 5,
	};
}

/** Qualities double as render names in these tests. */
const as = (q: number) => ({ quality: q });

describe("RenderQueue", () => {
	it("runs renders one at a time, in the order enqueued", async () => {
		const runner = new FakeRunner();
		const queue = await RenderQueue.open(runner);
		const events: RenderQueueEvent[] = [];
		queue.subscribe((e) => events.push(e));
		const a = await queue.enqueue(as(1));
		const b = await queue.enqueue(as(2));
		const c = await queue.enqueue(as(3));

		await runner.running("1");
		expect(queue.list().map((r) => r.status)).toEqual([
			"rendering",
			"queued",
			"queued",
		]);
		await runner.finish("1");
		await runner.finish("2");
		await runner.finish("3");
		await queue.idle();

		expect(runner.started).toEqual(["1", "2", "3"]);
		for (const id of [a, b, c])
			expect((await queue.whenSettled(id)).status).toBe("done");
		expect(await (await queue.file(b))?.text()).toBe("2");
		// Plain JSON with a type and a line of text: postable to a native bridge.
		const first = events[0];
		expect(first).toMatchObject({ type: "queued", id: a });
		expect(typeof first.text).toBe("string");
		expect(JSON.parse(JSON.stringify(first))).toEqual(first);
		expect(events.filter((e) => e.id === a).map((e) => e.type)).toEqual([
			"queued",
			"started",
			"done",
		]);
	});

	it("cancels a waiting render before it starts, and a running one mid-way", async () => {
		const runner = new FakeRunner();
		const queue = await RenderQueue.open(runner);
		const a = await queue.enqueue(as(1));
		const b = await queue.enqueue(as(2));
		const c = await queue.enqueue(as(3));
		await runner.running("1");

		expect(await queue.cancel(b)).toBe(true);
		expect(await queue.cancel(a)).toBe(true); // running: aborted
		await runner.finish("3");
		await queue.idle();

		expect(runner.started).toEqual(["1", "3"]);
		expect(queue.get(a)?.status).toBe("cancelled");
		expect(queue.get(b)?.status).toBe("cancelled");
		expect(queue.get(c)?.status).toBe("done");
		// Cancelled renders delete what they wrote, unless asked to keep it.
		expect(runner.discarded.sort()).toEqual(["1", "2"]);
		expect(await queue.cancel(c)).toBe(false); // already done
	});

	it("keeps a cancelled render's chunks when asked, for a later resume", async () => {
		const runner = new FakeRunner();
		const queue = await RenderQueue.open(runner);
		const a = await queue.enqueue(as(1));
		await runner.running("1");
		await queue.cancel(a, { discard: false });
		expect(runner.discarded).toEqual([]);
		// The same render again is a new entry (the cancelled one is settled).
		const again = await queue.enqueue(as(1));
		expect(again).not.toBe(a);
	});

	it("moves past a failed render", async () => {
		const runner = new FakeRunner();
		runner.failing.add("1");
		const queue = await RenderQueue.open(runner);
		const a = await queue.enqueue(as(1));
		const b = await queue.enqueue(as(2));
		await runner.finish("1");
		await runner.finish("2");
		const failed = await queue.whenSettled(a);
		expect(failed).toMatchObject({ status: "failed", error: "1 broke" });
		expect((await queue.whenSettled(b)).status).toBe("done");
	});

	it("gives the same id for the same render instead of queueing it twice", async () => {
		const runner = new FakeRunner();
		const queue = await RenderQueue.open(runner);
		const a = await queue.enqueue(as(1));
		expect(await queue.enqueue(as(1))).toBe(a);
		expect(await queue.enqueue({ quality: 2 })).not.toBe(a);
		await runner.finish("1");
		await queue.whenSettled(a);
		// Done, and its file is still here: the same render is that one.
		expect(await queue.enqueue(as(1))).toBe(a);
		expect(queue.list()).toHaveLength(2);
	});

	it("opens again after a reload with the running render first", async () => {
		const state = new MemoryQueueState();
		const before = new FakeRunner();
		const first = await RenderQueue.open(before, state);
		const a = await first.enqueue(as(1));
		const b = await first.enqueue(as(2));
		await before.running("1");
		// The page goes away mid-render: nothing settles, the line is saved.
		const saved = await state.load();
		expect(saved?.map((r) => r.status)).toEqual(["rendering", "queued"]);

		const after = new FakeRunner();
		const reopened = await RenderQueue.open(after, state);
		expect(reopened.get(a)?.status).toBe("rendering");
		await after.finish("1");
		await after.finish("2");
		await reopened.idle();
		expect(after.started).toEqual(["1", "2"]);
		expect(reopened.get(b)?.status).toBe("done");
	});

	it("empties on clear, cancelling what waits and what runs", async () => {
		const runner = new FakeRunner();
		const queue = await RenderQueue.open(runner);
		const a = await queue.enqueue(as(1));
		await queue.enqueue(as(2));
		await runner.running("1");
		const settled = queue.whenSettled(a);
		await queue.clear();
		expect((await settled).status).toBe("cancelled");
		expect(runner.started).toEqual(["1"]);
		expect(queue.list()).toEqual([]);
	});
});
