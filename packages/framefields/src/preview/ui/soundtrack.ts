/**
 * The soundtrack, streamed. The page mixes it with the export's mixer in
 * BLOCK_SEC blocks: the ones at the playhead first, as it plays, the rest in
 * the background (which draws the waveform and finds the film's loudest
 * sample for the master gain). Blocks play back to back on the AudioContext
 * clock. Sources stream straight from where they live, pinned assets from
 * their bucket. The mixing runs in a worker with its own GPU device, so it
 * never holds up drawing; if the worker can't, the page mixes, and if that
 * fails too, the server does.
 */
import type { MixReply, MixRequest, PreviewMix } from "../audio-mixer.js";
import { PEAK_BINS, SILENT_PEAK } from "../peaks.js";
import type { PreviewPlayer } from "../player.js";
import type { AudioStatus } from "../protocol.js";
import { PLAYER_URL, type PreviewServer } from "./server.js";

export type AudioState = "mixing" | "loading" | "ready" | "none" | "error";

export const AUDIO_LABEL: Record<AudioState, string> = {
	mixing: "Mixing audio",
	loading: "Loading audio",
	ready: "Audio ready",
	none: "No audio",
	error: "Audio failed",
};

const BLOCK_SEC = 2;
const AHEAD_SEC = 4;
const KEEP_BLOCKS = 64;

type Chain = "fill" | "play";
type MixRange = MixRequest["range"];

interface Block {
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
	exact: boolean;
}

interface Job {
	i: number;
	chain: Chain;
	/** The block's own request (its pending entry), not a fill of one asked already. */
	own: boolean;
	resolve(block: Block | undefined): void;
	reject(err: unknown): void;
}

interface MixerWorker {
	mix(range: MixRange, chain: Chain): Promise<PreviewMix>;
	stop(): void;
}

/** The project's bundle, loaded as a worker, runs the mixer instead of a player. */
function mixerWorker(): MixerWorker | null {
	let worker: Worker;
	try {
		worker = new Worker(PLAYER_URL, { type: "module" });
	} catch {
		return null;
	}
	const calls = new Map<
		number,
		{ resolve(mix: PreviewMix): void; reject(err: Error): void }
	>();
	let next = 0;
	let failed: Error | null = null;
	const fail = (err: Error) => {
		failed ??= err;
		for (const call of calls.values()) call.reject(failed);
		calls.clear();
	};
	const ready = new Promise<void>((resolve, reject) => {
		worker.onmessage = (e: MessageEvent<MixReply>) => {
			const d = e.data;
			if ("ready" in d) {
				if (d.ready) resolve();
				else {
					const err = new Error(d.error);
					reject(err);
					fail(err);
				}
				return;
			}
			const call = calls.get(d.id);
			if (!call) return;
			calls.delete(d.id);
			if ("error" in d) call.reject(new Error(d.error));
			else call.resolve(d.mix);
		};
		worker.onerror = (e) => {
			const err = new Error(e.message || "the mixing worker failed");
			reject(err);
			fail(err);
		};
	});
	ready.catch(() => {});
	return {
		async mix(range, chain) {
			await ready;
			if (failed) throw failed;
			return new Promise<PreviewMix>((resolve, reject) => {
				const id = ++next;
				calls.set(id, { resolve, reject });
				worker.postMessage({ id, range, chain } satisfies MixRequest);
			});
		},
		stop() {
			worker.terminate();
			fail(new Error("stopped"));
		},
	};
}

/** One player's soundtrack, being mixed. */
class Stream {
	worker: MixerWorker | null = mixerWorker();
	readonly blocks = new Map<number, Block>();
	readonly order: number[] = [];
	readonly pending = new Map<number, Promise<Block | undefined>>();
	readonly queue: Job[] = [];
	busy = false;
	readonly seen = new Set<number>();
	peak = 0;
	gain = 1;
	/** The next block of the fill chain, which runs from the film's start. */
	fill = 0;
	filling = false;
	readonly total: number;

	constructor(
		readonly player: PreviewPlayer,
		filmSec: number,
	) {
		this.total = Math.max(1, Math.ceil(filmSec / BLOCK_SEC));
	}

	/** In the worker; on the page itself once the worker has failed. */
	mix(range: MixRange, chain: Chain): Promise<PreviewMix> {
		const worker = this.worker;
		if (!worker) return this.player.mixAudio(range, chain);
		return worker.mix(range, chain).catch((err: unknown) => {
			if (this.worker) {
				console.warn(
					"The soundtrack's mixing worker failed, so the page mixes it:",
					err,
				);
				this.worker.stop();
				this.worker = null;
			}
			return this.player.mixAudio(range, chain);
		});
	}
}

interface Playback {
	t0: number;
	startAt: number;
	next: number;
	sources: AudioBufferSourceNode[];
	timer: ReturnType<typeof setInterval> | undefined;
}

/** The master stage on a block: the film's gain, then the export's soft limiter. */
export function mastered(
	channel: Float32Array,
	gain: number,
): Float32Array<ArrayBuffer> {
	const out = new Float32Array(channel.length);
	for (let k = 0; k < channel.length; k++) {
		const v = Math.tanh(channel[k] * gain);
		out[k] = Number.isNaN(v) ? 0 : v;
	}
	return out;
}

export interface SoundtrackHost {
	server: PreviewServer;
	/** The film's length and rate, once known. */
	film(): { fps: number; frameCount: number } | null;
	/** Something shown changed: state, waveform, volume. */
	changed(): void;
}

export class Soundtrack {
	/** Where it mixes: in this page ("browser"), or on the server. */
	mode: "browser" | "server" = "browser";
	state: AudioState = "mixing";
	error = "";
	/** The server's whole mix, when it mixed. */
	buffer: AudioBuffer | null = null;
	/** Waveform, 0–1 per bin. */
	peaks: number[] | null = null;
	/** Bumped when the peaks change, so the waveform redraws. */
	peaksVersion = 0;
	muted = false;
	volume = 0.9;

	#ctx: AudioContext | null = null;
	#gain: GainNode | null = null;
	#src: AudioBufferSourceNode | null = null;
	#stream: Stream | null = null;
	#playback: Playback | null = null;
	#player: PreviewPlayer | null = null;

	constructor(private readonly host: SoundtrackHost) {}

	/** Mute and volume work once there is something to hear. */
	get usable(): boolean {
		return this.state === "ready" && (!!this.buffer || !!this.#stream);
	}

	/** Seconds the waveform spans: the server's mix, or the film. */
	get durationSec(): number | null {
		return this.buffer ? this.buffer.duration : null;
	}

	/** Soundtrack blocks mixed in this page so far, of the film's. */
	get mixed(): { blocks: number; of: number; exact: number } | null {
		const s = this.#stream;
		if (!s) return null;
		let exact = 0;
		for (const b of s.blocks.values()) if (b.exact) exact++;
		return { blocks: s.seen.size, of: s.total, exact };
	}

	/** Where the soundtrack mixes: off the page's thread, on it, or on the server. */
	get mixer(): "worker" | "page" | "server" | null {
		if (this.#stream) return this.#stream.worker ? "worker" : "page";
		return this.mode === "server" ? "server" : null;
	}

	/** The player is ready: mix its soundtrack, from the block at `frame`. */
	attach(player: PreviewPlayer, frame: number): void {
		this.#player = player;
		if (this.mode === "browser") this.#begin(player, frame);
	}

	/** The server's word on the soundtrack (at load, and on each change). */
	load(status: AudioStatus | undefined, frame: number): void {
		if (status?.state === "browser") {
			this.mode = "browser";
			this.#set("mixing");
			if (this.#player) this.#begin(this.#player, frame);
			return;
		}
		// Any other word means the server has it (or there is none to mix).
		this.mode = "server";
		this.stopClock();
		this.buffer = null;
		this.#setPeaks(null);
		if (status?.state !== "ready") {
			this.#set(
				status?.state ?? "none",
				status?.state === "error" ? status.error : "",
			);
			return;
		}
		this.#setPeaks(status.peaks);
		this.#set("loading");
		const ctx = this.#context();
		this.host.server
			.audio()
			.then((data) => ctx.decodeAudioData(data))
			.then(
				(buf) => {
					this.buffer = buf;
					this.#set("ready");
				},
				(err: unknown) =>
					this.#set("error", String((err as Error)?.message ?? err)),
			);
	}

	/**
	 * Waits for the block at `frame` (when this page mixes): sound starts
	 * with picture. Resolves either way.
	 */
	async ready(frame: number): Promise<void> {
		const s = this.#stream;
		if (!s || this.state === "none") return;
		await this.#block(s, this.#blockAt(frame), true).catch(() => {});
		if (this.#stream && this.state === "mixing") this.#set("ready");
	}

	/** Whether playing needs to wait for this soundtrack first. */
	get waitsBeforePlay(): boolean {
		return !!this.#stream && this.state !== "none";
	}

	setMuted(muted: boolean): void {
		this.muted = muted;
		this.#applyVolume();
	}

	setVolume(volume: number): void {
		this.volume = volume;
		this.muted = volume === 0;
		this.#applyVolume();
	}

	/**
	 * The clock for real-time playback from `f0`: the soundtrack when there
	 * is one, otherwise the wall clock. Audio as master keeps picture and
	 * sound in sync. Returns seconds since playback started.
	 */
	startClock(f0: number, fps: number): () => number {
		const ctx = this.#ctx;
		if (this.#stream && ctx && this.state === "ready")
			return this.#startStream(this.#stream, ctx, f0 / fps);
		if (this.buffer && ctx && this.#gain) {
			void ctx.resume();
			const src = ctx.createBufferSource();
			src.buffer = this.buffer;
			src.connect(this.#gain);
			const startAt = ctx.currentTime + 0.06;
			const offset = f0 / fps;
			if (offset < this.buffer.duration) src.start(startAt, offset);
			this.#src = src;
			return () => Math.max(0, ctx.currentTime - startAt);
		}
		const t0 = performance.now();
		return () => (performance.now() - t0) / 1000;
	}

	stopClock(): void {
		this.#stopStream();
		const src = this.#src;
		if (!src) return;
		try {
			src.stop();
		} catch {}
		src.disconnect();
		this.#src = null;
	}

	// ── internals ──

	#set(state: AudioState, error = ""): void {
		this.state = state;
		this.error = error;
		this.host.changed();
	}

	#setPeaks(peaks: number[] | null): void {
		this.peaks = peaks;
		this.peaksVersion++;
	}

	#filmSec(): number {
		const film = this.host.film();
		return film ? film.frameCount / film.fps : 0;
	}

	#blockAt(frame: number): number {
		const fps = this.host.film()?.fps ?? 30;
		return Math.floor(frame / fps / BLOCK_SEC);
	}

	#context(): AudioContext {
		if (this.#ctx) return this.#ctx;
		const Ctx =
			window.AudioContext ??
			(window as { webkitAudioContext?: typeof AudioContext })
				.webkitAudioContext;
		const ctx = new Ctx();
		this.#gain = ctx.createGain();
		this.#gain.connect(ctx.destination);
		this.#ctx = ctx;
		this.#applyVolume();
		return ctx;
	}

	#applyVolume(): void {
		if (this.#gain) this.#gain.gain.value = this.muted ? 0 : this.volume;
		this.host.changed();
	}

	#begin(player: PreviewPlayer, frame: number): void {
		this.#stream?.worker?.stop();
		this.stopClock();
		this.buffer = null;
		this.#setPeaks(new Array<number>(PEAK_BINS).fill(0));
		const s = new Stream(player, this.#filmSec());
		this.#stream = s;
		this.#context();
		this.#set("mixing");
		this.#block(s, this.#blockAt(frame), true).then(
			() => {
				if (this.#stream === s && this.state === "mixing") this.#set("ready");
			},
			() => {},
		);
	}

	// Blocks mix on two chains, each continuing its own effect state from the
	// block before: "fill" runs through the film from its start, so its blocks
	// are exactly the export's; "play" starts at a seek with a lead-in and
	// carries on from there. An exact block is never replaced by a lead-in one.
	#block(s: Stream, i: number, urgent: boolean): Promise<Block | undefined> {
		const have = s.blocks.get(i);
		if (have) return Promise.resolve(have);
		const waiting = s.pending.get(i);
		if (waiting) {
			if (urgent) promote(s, i);
			return waiting;
		}
		const queued = enqueue(s, i, i === s.fill ? "fill" : "play", urgent, true);
		this.#pump(s);
		return queued;
	}

	#pump(s: Stream): void {
		if (s.busy || this.#stream !== s) return;
		if (!s.queue.length) {
			// Idle: the fill chain mixes its next block, every block in order, so
			// its effect state runs on unbroken from the film's start.
			if (!s.filling && s.fill < s.total)
				enqueue(s, s.fill, "fill", false, !s.pending.has(s.fill));
			if (!s.queue.length) return;
		}
		s.busy = true;
		const job = s.queue.shift() as Job;
		const filmSec = this.#filmSec();
		const range = {
			startSec: job.i * BLOCK_SEC,
			endSec: Math.min(filmSec, (job.i + 1) * BLOCK_SEC),
		};
		s.mix(range, job.chain)
			.then(
				(mix) => {
					if (this.#stream === s) this.#keep(s, job.i, mix);
					if (job.chain === "fill") {
						s.fill = job.i + 1;
						s.filling = false;
					}
					job.resolve(s.blocks.get(job.i));
				},
				(err: unknown) => {
					if (job.chain === "fill") s.filling = false;
					job.reject(err);
					this.#failed(s, err);
				},
			)
			.then(() => {
				if (job.own) s.pending.delete(job.i);
				s.busy = false;
				this.#pump(s);
			});
	}

	#keep(s: Stream, i: number, mix: PreviewMix): void {
		const block: Block = {
			left: mix.left,
			right: mix.right,
			sampleRate: mix.sampleRate,
			exact: mix.exact,
		};
		const had = s.blocks.get(i);
		if (!had || !had.exact || block.exact) {
			s.blocks.set(i, block);
			s.order.push(i);
			while (s.order.length > KEEP_BLOCKS)
				s.blocks.delete(s.order.shift() as number);
		}
		if (s.seen.has(i)) return;
		s.seen.add(i);
		s.peak = Math.max(s.peak, mix.peak);
		this.#drawPeaks(i, block);
		if (s.seen.size < s.total) {
			this.host.changed();
			return;
		}
		// The whole film is mixed: master as the export does, or say it's silent.
		s.gain = s.peak > 0.95 ? 0.92 / s.peak : 1;
		if (s.peak < SILENT_PEAK) this.#set("none");
		else this.host.changed();
	}

	#drawPeaks(i: number, block: Block): void {
		const peaks = this.peaks;
		if (!peaks) return;
		const dur = this.#filmSec();
		const from = Math.floor(((i * BLOCK_SEC) / dur) * PEAK_BINS);
		const to = Math.min(
			PEAK_BINS,
			Math.ceil((Math.min(dur, (i + 1) * BLOCK_SEC) / dur) * PEAK_BINS),
		);
		const perBin = (dur / PEAK_BINS) * block.sampleRate;
		const origin = i * BLOCK_SEC * block.sampleRate;
		for (let b = from; b < to; b++) {
			const lo = Math.max(0, Math.floor(b * perBin - origin));
			const hi = Math.min(
				block.left.length,
				Math.floor((b + 1) * perBin - origin),
			);
			let m = peaks[b];
			for (let k = lo; k < hi; k++)
				m = Math.max(m, Math.abs(block.left[k]), Math.abs(block.right[k]));
			peaks[b] = Math.min(1, m);
		}
		this.peaksVersion++;
	}

	#failed(s: Stream, err: unknown): void {
		if (this.#stream !== s) return;
		s.worker?.stop();
		this.#stream = null;
		this.stopClock();
		console.warn(
			"Mixing the soundtrack in the browser failed, so the preview server mixes it:",
			err,
		);
		this.mode = "server";
		this.#set("mixing");
		this.host.server.mixAudio();
	}

	#startStream(s: Stream, ctx: AudioContext, t0: number): () => number {
		void ctx.resume();
		const pb: Playback = {
			t0,
			startAt: ctx.currentTime + 0.08,
			next: Math.floor(t0 / BLOCK_SEC),
			sources: [],
			timer: undefined,
		};
		this.#playback = pb;
		const tick = (): void => {
			if (this.#playback !== pb || this.#stream !== s) return;
			const now = ctx.currentTime - pb.startAt + pb.t0;
			while (pb.next < s.total && pb.next * BLOCK_SEC < now + AHEAD_SEC) {
				const have = s.blocks.get(pb.next);
				if (!have) {
					this.#block(s, pb.next, true).then(tick, () => {});
					return;
				}
				this.#schedule(ctx, pb, pb.next, have, s.gain);
				pb.next++;
			}
		};
		pb.timer = setInterval(tick, 250);
		tick();
		return () => Math.max(0, ctx.currentTime - pb.startAt);
	}

	// Block i starts at film second i * BLOCK_SEC: on the clock, that is
	// startAt + (i * BLOCK_SEC - t0). A block that comes late starts part way
	// in, so sound and picture stay on the same clock.
	#schedule(
		ctx: AudioContext,
		pb: Playback,
		i: number,
		block: Block,
		gain: number,
	): void {
		if (!this.#gain) return;
		const buf = ctx.createBuffer(2, block.left.length, block.sampleRate);
		buf.copyToChannel(mastered(block.left, gain), 0);
		buf.copyToChannel(mastered(block.right, gain), 1);
		const src = ctx.createBufferSource();
		src.buffer = buf;
		src.connect(this.#gain);
		const when = pb.startAt + (i * BLOCK_SEC - pb.t0);
		const at = Math.max(when, ctx.currentTime + 0.02);
		const offset = at - when;
		if (offset >= buf.duration) return;
		src.start(at, offset);
		pb.sources.push(src);
		src.onended = () => {
			pb.sources = pb.sources.filter((x) => x !== src);
		};
	}

	#stopStream(): void {
		const pb = this.#playback;
		this.#playback = null;
		if (!pb) return;
		clearInterval(pb.timer);
		for (const src of pb.sources) {
			try {
				src.stop();
			} catch {}
			src.disconnect();
		}
	}
}

function enqueue(
	s: Stream,
	i: number,
	chain: Chain,
	urgent: boolean,
	own: boolean,
): Promise<Block | undefined> {
	if (chain === "fill") s.filling = true;
	const waiting = new Promise<Block | undefined>((resolve, reject) => {
		const job: Job = { i, chain, own, resolve, reject };
		if (urgent) s.queue.unshift(job);
		else s.queue.push(job);
	});
	if (own) s.pending.set(i, waiting);
	else waiting.catch(() => {});
	return waiting;
}

function promote(s: Stream, i: number): void {
	const at = s.queue.findIndex((j) => j.i === i);
	if (at > 0) s.queue.unshift(s.queue.splice(at, 1)[0]);
}
