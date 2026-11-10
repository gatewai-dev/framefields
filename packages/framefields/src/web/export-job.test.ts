/**
 * The on-device export job, run in Node with the Node renderer drawing its
 * chunks: planned chunks are rendered, kept in the store, stitched through
 * browser IO (Blobs in, a WritableStream out) into the same file
 * `stitchChunks` makes from the same pieces on disk; a stopped export
 * resumes from its first missing chunk; changed settings start over.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Composition, Layer, LayerAnimation } from "../index.js";
import { stitchChunks } from "../renderer/index.js";
import {
	type ExportBackend,
	type ExportSettings,
	exportJobId,
	runExportJob,
} from "./export-job.js";
import { RenderQueue } from "./queue.js";
import { MemoryExportStore, type StoreWriter } from "./store.js";

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

const W = 128;
const H = 72;
const FPS = 30;
const FRAMES = 36;

function film(): Composition {
	const comp = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationFrames: FRAMES,
		backgroundColor: "#101018",
	});
	comp.add(
		Layer.shape("rect", {
			fillColor: "#ff5030",
			width: 24,
			height: 24,
			y: 24,
		}).animate(
			LayerAnimation.create().fromTo("x", 0, W - 24, {
				start: 0,
				end: FRAMES,
			}),
		),
	);
	return comp;
}

const settings: ExportSettings = {
	bundleId: "test",
	totalFrames: FRAMES,
	fps: FPS,
	width: W,
	height: H,
	codec: "h264",
	quality: "high",
	keyFrameIntervalSec: 5,
	audio: true,
};

/** Puts a file's bytes into a store writer, as a muxer would. */
async function writeFile(writer: StoreWriter, file: string): Promise<void> {
	const w = writer.stream.getWriter();
	await w.write({
		type: "write",
		data: new Uint8Array(await fs.readFile(file)),
		position: 0,
	});
	await w.close();
}

/** Chunks and audio from the Node renderer; records which chunks it drew. */
function nodeBackend(dir: string, onChunk?: (start: number) => void) {
	const drawn: number[] = [];
	const backend: ExportBackend = {
		// 100 ms a frame: 3.6 s of work, cut into 1.2 s chunks.
		probe: async () => [{ frame: 0, ms: 100 }],
		async renderChunk(chunk, writer, onFrame) {
			const out = path.join(dir, `chunk-${chunk.start}.mp4`);
			await film().renderVideo({
				outputPath: out,
				frames: { start: chunk.start, end: chunk.end },
				audio: false,
				quality: "high",
			});
			await writeFile(writer, out);
			onFrame(chunk.end - chunk.start);
			drawn.push(chunk.start);
			onChunk?.(chunk.start);
		},
		async renderAudio(open) {
			const out = path.join(dir, "audio.m4a");
			await film().renderVideo({ outputPath: out, codec: "aac" });
			const writer = await open();
			await writeFile(writer, out);
			await writer.close();
			return true;
		},
	};
	return { backend, drawn };
}

const options = { chunkSec: 1.2, minChunkFrames: 6 };

describe("runExportJob", () => {
	it.skipIf(!hasFfmpeg)(
		"renders planned chunks and stitches them as stitchChunks does",
		async () => {
			const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-webjob-"));
			const store = new MemoryExportStore();
			const { backend, drawn } = nodeBackend(dir);
			const phases = new Set<string>();
			const result = await runExportJob({
				jobId: await exportJobId(settings),
				settings,
				store,
				backend,
				options: { ...options, onProgress: (p) => phases.add(p.phase) },
			});
			expect(drawn).toEqual([0, 12, 24]);
			expect(result.frames).toBe(FRAMES);
			expect(result.durationSec).toBeCloseTo(FRAMES / FPS, 3);
			expect(result.chunks.map((c) => [c.start, c.end, c.resumed])).toEqual([
				[0, 12, false],
				[12, 24, false],
				[24, 36, false],
			]);
			expect([...phases]).toEqual([
				"probe",
				"render",
				"audio",
				"stitch",
				"done",
			]);

			// The same pieces joined on disk by the cloud's stitch: same bytes.
			const reference = path.join(dir, "reference.mp4");
			await stitchChunks({
				chunks: [0, 12, 24].map((s) => path.join(dir, `chunk-${s}.mp4`)),
				audio: path.join(dir, "audio.m4a"),
				outputPath: reference,
			});
			const got = new Uint8Array(await result.file.arrayBuffer());
			expect(
				Buffer.compare(Buffer.from(got), await fs.readFile(reference)),
			).toBe(0);
			const probe = execFileSync("ffprobe", [
				"-v",
				"error",
				"-count_frames",
				"-show_entries",
				"stream=codec_type,nb_read_frames",
				"-of",
				"csv=p=0",
				reference,
			]).toString();
			expect(probe).toContain(`video,${FRAMES}`);
			expect(probe).toContain("audio");
		},
		120_000,
	);

	it("resumes a stopped export from its first missing chunk", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-webjob-"));
		// Kept across both runs, as OPFS keeps it across an app restart.
		const store = new MemoryExportStore({ persistent: true });
		const jobId = await exportJobId(settings);
		const stop = new AbortController();
		const first = nodeBackend(dir, (start) => {
			if (start === 12) stop.abort(new Error("backgrounded"));
		});
		await expect(
			runExportJob({
				jobId,
				settings,
				store,
				backend: first.backend,
				options: { ...options, signal: stop.signal },
			}),
		).rejects.toThrow(/backgrounded/);
		expect(first.drawn).toEqual([0, 12]);

		const second = nodeBackend(dir);
		const messages: string[] = [];
		const result = await runExportJob({
			jobId,
			settings,
			store,
			backend: second.backend,
			options: { ...options, onProgress: (p) => messages.push(p.message) },
		});
		expect(second.drawn).toEqual([24]);
		expect(messages[0]).toMatch(/Resuming: 2 of 3 chunks/);
		expect(result.chunks.map((c) => c.resumed)).toEqual([true, true, false]);
		expect(result.frames).toBe(FRAMES);
		// What the export leaves: the output only.
		expect(await store.file("job.json")).toBeUndefined();
		expect(await store.file("chunk-0000.mp4")).toBeUndefined();
	}, 120_000);

	it("starts over when the settings changed", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-webjob-"));
		const store = new MemoryExportStore({ persistent: true });
		const stop = new AbortController();
		const first = nodeBackend(dir, () => stop.abort(new Error("stopped")));
		await expect(
			runExportJob({
				jobId: await exportJobId(settings),
				settings,
				store,
				backend: first.backend,
				options: { ...options, signal: stop.signal },
			}),
		).rejects.toThrow(/stopped/);

		const changed = { ...settings, quality: "low" as const };
		expect(await exportJobId(changed)).not.toBe(await exportJobId(settings));
		const second = nodeBackend(dir);
		await runExportJob({
			jobId: await exportJobId(changed),
			settings: changed,
			store,
			backend: second.backend,
			options,
		});
		expect(second.drawn).toEqual([0, 12, 24]);
	}, 120_000);

	it("resumes through the queue: stopped keeping its chunks, enqueued again", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-webjob-"));
		// One kept store per export, as OPFS keeps one folder per job id.
		const stores = new Map<string, MemoryExportStore>();
		const storeOf = (jobId: string) => {
			let store = stores.get(jobId);
			if (!store)
				stores.set(
					jobId,
					(store = new MemoryExportStore({ persistent: true })),
				);
			return store;
		};
		let queue!: RenderQueue;
		let id = "";
		const drawn: number[] = [];
		const backend = nodeBackend(dir, (start) => {
			drawn.push(start);
			if (start === 12 && drawn.length === 2)
				void queue.cancel(id, { discard: false });
		}).backend;
		queue = await RenderQueue.open({
			jobId: async () => exportJobId(settings),
			run: async (render, control) =>
				runExportJob({
					jobId: render.jobId,
					settings,
					store: storeOf(render.jobId),
					backend,
					options: { ...options, ...control },
				}),
			file: async () => undefined,
			discard: async (render) => {
				stores.delete(render.jobId);
			},
		});
		id = await queue.enqueue({ quality: "high" });
		expect((await queue.whenSettled(id)).status).toBe("cancelled");
		expect(drawn).toEqual([0, 12]);

		const again = await queue.enqueue({ quality: "high" });
		const done = await queue.whenSettled(again);
		expect(done.status).toBe("done");
		// Only the missing chunk was drawn again.
		expect(drawn).toEqual([0, 12, 24]);
		expect(done.result?.chunks.map((c) => c.resumed)).toEqual([
			true,
			true,
			false,
		]);
		expect(done.result?.frames).toBe(FRAMES);
	}, 120_000);
});
