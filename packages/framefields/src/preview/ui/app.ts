/// <reference lib="dom" />
/**
 * The preview page's state and logic, without its looks: what is shown,
 * playback on the player's clock, notes, the soundtrack, the server's events
 * and the address fragment. The page's elements render from it and call it;
 * it says when anything changed with a `change` event.
 */
import type { PreviewPlayer } from "../player.js";
import type {
	AudioStatus,
	PreviewMeta,
	PreviewNote,
	PreviewReadyMessage,
} from "../protocol.js";
import { captureNote } from "./capture.js";
import { clampFrame, frameFromHash, hashForFrame } from "./format.js";
import { FpsMeter, type MeterReading } from "./meter.js";
import { createReporter, type Report } from "./report.js";
import { httpServer, type PreviewServer } from "./server.js";
import { type AudioState, Soundtrack } from "./soundtrack.js";

export type PageState = "loading" | "ready" | "error";

/** A note being written: its moment and spot (or area), not saved yet. */
export interface Draft {
	frame: number;
	x: number;
	y: number;
	w?: number;
	h?: number;
	text: string;
}

/** What `window.framefieldsPreview.state()` returns. */
export interface PreviewStateSnapshot {
	state: PageState;
	error: string | null;
	frame: number;
	time: number;
	playing: boolean;
	buffering: boolean;
	audio: AudioState;
	/** Soundtrack blocks mixed in this page so far, of the film's. */
	audioMixed: { blocks: number; of: number; exact: number } | null;
	/** Where the soundtrack mixes: "worker" (off the page's thread), "page", or "server". */
	audioMixer: "worker" | "page" | "server" | null;
	connected: boolean;
	/**
	 * Frames shown per second over the last 2 s of playback (the last
	 * playback's while paused), and how long the last frame took to draw.
	 */
	playbackFps: number | null;
	renderMs: number | null;
	meta: {
		title: string;
		width: number;
		height: number;
		fps: number;
		frameCount: number;
		duration: number;
	} | null;
}

/** For scripts and agents driving the page: seek, play and read the state instead of clicking at coordinates. */
export interface PreviewApi {
	/** Shows the frame at a time in seconds; resolves once it is drawn. */
	seek(sec: number): Promise<void>;
	/** Shows a frame by number; resolves once it is drawn. */
	seekFrame(frame: number): Promise<void>;
	play(): Promise<void>;
	pause(): void;
	/** Notes pinned on the page, as saved in notes.json. */
	notes(): PreviewNote[];
	/** Where the preview is: loading, ready or error, and what it shows. */
	state(): PreviewStateSnapshot;
}

declare global {
	interface Window {
		framefieldsPreview?: PreviewApi;
	}
}

export interface PreviewAppOptions {
	server?: PreviewServer;
	/** The window the page runs in. */
	win?: Window;
	/**
	 * The page embedding this one, told when the preview is ready. Defaults
	 * to `window.parent` when the page is in a frame.
	 */
	embedder?: Window | null;
}

/** The draft a press on the picture makes: an area when dragged far enough, else a spot. */
export function draftAt(
	frame: number,
	spot: { x: number; y: number },
	area: { x: number; y: number; w: number; h: number } | null,
): Draft {
	return area && area.w > 0.01 && area.h > 0.01
		? { frame, ...area, text: "" }
		: { frame, x: spot.x, y: spot.y, text: "" };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class PreviewApp extends EventTarget {
	meta: PreviewMeta | null = null;
	player: PreviewPlayer | null = null;
	pageState: PageState = "loading";
	error: string | null = null;
	/** The frame the timecode shows. */
	frame = 0;
	playing = false;
	/** Waiting on frames (or sound) mid-playback: the play button spins too. */
	stalled = false;
	/** The preview command isn't running; the tab reconnects when it does. */
	offline = false;
	fps: MeterReading = { state: "paused", fps: null };

	/** Off when the server keeps no notes. */
	notesOn = false;
	notes: PreviewNote[] = [];
	draft: Draft | null = null;
	/** The note whose card is open. */
	openId: number | null = null;
	saving = false;
	saveError = false;
	panelOpen = false;
	toastText = "";
	toastOn = false;

	readonly soundtrack: Soundtrack;
	readonly report: Report;
	readonly server: PreviewServer;

	readonly #win: Window;
	readonly #embedder: Window | null;
	readonly #meter: FpsMeter;
	#session: string | null = null;
	#drawing = false;
	#playToken = 0;
	#warmTimer: ReturnType<typeof setTimeout> | undefined;
	#warmToken = 0;
	readonly #warmed = new Set<number>();
	#readyWaiters: Array<[() => void, (err: Error) => void]> = [];
	#toastTimer: ReturnType<typeof setTimeout> | undefined;
	#fpsTimer: ReturnType<typeof setInterval> | undefined;
	readonly #listening = new AbortController();
	#changeQueued = false;

	constructor(options: PreviewAppOptions = {}) {
		super();
		this.server = options.server ?? httpServer();
		this.#win = options.win ?? window;
		this.#embedder =
			options.embedder !== undefined
				? options.embedder
				: this.#win.parent !== this.#win
					? this.#win.parent
					: null;
		this.report = createReporter((line) => this.server.log(line));
		this.#meter = new FpsMeter(() => this.meta?.fps ?? Infinity);
		this.soundtrack = new Soundtrack({
			server: this.server,
			film: () => this.meta,
			changed: () => this.changed(),
		});
	}

	// ── State ──

	get lastFrame(): number {
		return (this.meta?.frameCount ?? 1) - 1;
	}

	/** The spinner over the picture: a frame drawing, or playback waiting. */
	get buffering(): boolean {
		return this.pageState !== "error" && (this.#drawing || this.stalled);
	}

	noteById(id: number): PreviewNote | undefined {
		return this.notes.find((n) => n.id === id);
	}

	get openCount(): number {
		return this.notes.filter((n) => !n.done).length;
	}

	/** Pins and areas can be placed: notes are on, a player draws, it's paused. */
	get canNote(): boolean {
		return this.notesOn && !!this.player && !this.playing;
	}

	/** Tells the page's elements to render; changes in one turn coalesce. */
	changed(): void {
		if (this.#changeQueued) return;
		this.#changeQueued = true;
		queueMicrotask(() => {
			this.#changeQueued = false;
			this.dispatchEvent(new Event("change"));
		});
	}

	subscribe(listener: () => void): () => void {
		this.addEventListener("change", listener);
		return () => this.removeEventListener("change", listener);
	}

	// ── Start ──

	/** Connects to the server, loads the film and waits for the player. */
	async start(): Promise<void> {
		const win = this.#win;
		const signal = this.#listening.signal;
		const closeEvents = this.server.events({
			hello: (session) => this.#hello(session),
			lost: () => this.#lost(),
			notes: (notes) => this.#setNotes(notes),
			audio: (status) => this.#audioStatus(status),
		});
		signal.addEventListener("abort", closeEvents);
		const on = { signal };
		win.addEventListener(
			"framefields:player",
			() => {
				if (this.meta) this.#whenPlayer();
			},
			on,
		);
		win.addEventListener(
			"error",
			(e) => {
				if (!this.player) this.showError(e.error ?? e.message);
				else this.report("error", [e.error ?? e.message]);
			},
			on,
		);
		win.addEventListener(
			"unhandledrejection",
			(e) => this.report("error", [e.reason]),
			on,
		);
		win.addEventListener("hashchange", () => this.#hashChanged(), on);
		// A hidden tab's timers are throttled, so playback would stutter: pause.
		win.document.addEventListener(
			"visibilitychange",
			() => {
				if (win.document.hidden && this.playing) this.pause();
			},
			on,
		);
		win.framefieldsPreview = this.api();

		const reply = await this.server.meta();
		const { audio, ...meta } = reply;
		this.#session = meta.session;
		this.meta = meta;
		win.document.title = `${meta.title} · preview`;
		this.notesOn = !!meta.notesDir;
		this.#loadNotes();
		this.soundtrack.load(audio, this.frame);
		this.#setTime(
			frameFromHash(win.location.hash, meta.fps, meta.frameCount) ?? 0,
		);
		this.#drawing = true;
		this.#whenPlayer();
	}

	/** Stops playback and listening to the server and the window. */
	close(): void {
		this.#listening.abort();
		this.#stop();
	}

	// The composition's bundle announces its player on `window`.
	#whenPlayer(): void {
		const pending = this.#win.framefieldsPlayer;
		if (!pending) return;
		pending.then(
			(p) => {
				this.player = p;
				this.soundtrack.attach(p, this.frame);
				this.changed();
				void this.#show(this.frame).then(() => this.#ready());
			},
			(err: unknown) => {
				this.showError(err);
				this.#win.document.documentElement.dataset.preview = "error";
				this.#settleReady(err instanceof Error ? err : new Error(String(err)));
			},
		);
	}

	#ready(): void {
		this.pageState = "ready";
		this.#win.document.documentElement.dataset.preview = "ready";
		this.#settleReady();
		this.#scheduleWarm();
		this.changed();
		this.#embedder?.postMessage(
			{
				type: "framefields-preview:ready",
				seekByHash: true,
			} satisfies PreviewReadyMessage,
			"*",
		);
	}

	whenReady(): Promise<void> {
		if (this.player) return Promise.resolve();
		if (this.pageState === "error")
			return Promise.reject(new Error(this.error ?? "the preview failed"));
		return new Promise((resolve, reject) =>
			this.#readyWaiters.push([resolve, reject]),
		);
	}

	#settleReady(err?: Error): void {
		for (const [resolve, reject] of this.#readyWaiters.splice(0)) {
			if (err) reject(err);
			else resolve();
		}
	}

	showError(err: unknown): void {
		this.report("error", [err]);
		this.pageState = "error";
		this.error = String((err as Error | undefined)?.message ?? err);
		this.changed();
	}

	// ── Server events ──

	// When the preview command ends the event stream drops and the browser
	// keeps retrying. The next preview of this project (same port) says hello
	// with a new session, and this tab reloads into it.
	#hello(session: string): void {
		if (this.#session && session !== this.#session) {
			this.#win.location.reload();
			return;
		}
		this.offline = false;
		this.changed();
	}

	#lost(): void {
		if (!this.meta) return;
		if (this.playing) {
			this.#stop();
			this.#keepPosition();
		}
		this.offline = true;
		this.changed();
	}

	#audioStatus(status: AudioStatus): void {
		if (this.meta) this.soundtrack.load(status, this.frame);
	}

	// ── Frames ──

	#setTime(frame: number): void {
		this.frame = frame;
		this.changed();
	}

	/** Draws a frame; calls made while one draws collapse to the latest. */
	#show(frame: number): Promise<void> {
		this.#setTime(frame);
		const player = this.player;
		if (!player) return Promise.resolve();
		this.#drawing = true;
		return player.render(frame).then(() => {
			this.#drawing = false;
			this.changed();
		});
	}

	/** Shows a frame, paused; resolves once it is drawn. */
	seek(frame: number): Promise<void> {
		this.#stop();
		const done = this.#show(clampFrame(frame, this.meta?.frameCount ?? 1));
		this.#keepPosition();
		this.#scheduleWarm();
		return done;
	}

	step(by: number): Promise<void> {
		return this.seek(this.frame + by);
	}

	// ── Position in the address: #t=12.5 opens there, a reload (the next
	// preview taking over) comes back to the same moment, and a new fragment
	// (an embedding app's time link) seeks in place ──

	#keepPosition(): void {
		if (!this.meta) return;
		const { location, history } = this.#win;
		const at =
			hashForFrame(this.frame, this.meta.fps) ||
			location.pathname + location.search;
		try {
			// Doesn't fire `hashchange`.
			history.replaceState(null, "", at);
		} catch {}
	}

	#hashChanged(): void {
		const meta = this.meta;
		if (!meta) return;
		const target = frameFromHash(
			this.#win.location.hash,
			meta.fps,
			meta.frameCount,
		);
		if (target === null) return;
		if (this.playing) this.pause();
		if (target !== this.frame) void this.seek(target);
	}

	// ── Analysing ahead: while paused, frames after the playhead are drawn
	// off-screen so vision results are cached before they play ──

	#scheduleWarm(): void {
		clearTimeout(this.#warmTimer);
		this.#warmToken++;
		if (!this.player?.hasVision || this.playing) return;
		this.#warmTimer = setTimeout(() => void this.#warmAhead(), 1000);
	}

	async #warmAhead(): Promise<void> {
		const player = this.player;
		const meta = this.meta;
		if (!player || !meta) return;
		const token = ++this.#warmToken;
		const end = Math.min(
			this.lastFrame,
			this.frame + Math.round(meta.fps * 20),
		);
		for (
			let f = this.frame + 1;
			f <= end && token === this.#warmToken && !this.playing;
			f++
		) {
			if (this.#warmed.has(f)) continue;
			if (!(await player.warm(f))) {
				this.#scheduleWarm();
				return;
			}
			this.#warmed.add(f);
			await sleep(0);
		}
	}

	// ── Playback ──

	play(): void {
		if (this.playing || !this.player) return;
		this.playing = true;
		clearTimeout(this.#warmTimer);
		this.#warmToken++;
		const token = ++this.#playToken;
		const alive = () => this.playing && token === this.#playToken;
		if (this.openId != null) this.closePop();
		if (this.draft && !this.draft.text.trim()) this.cancelDraft();
		if (this.frame >= this.lastFrame) this.frame = 0;
		this.changed();
		this.#playFrames(this.player, alive)
			.catch((err: unknown) => this.report("error", [err]))
			.finally(() => {
				if (token === this.#playToken && this.playing) this.pause();
			});
	}

	/** Pausing settles on exactly the frame the timecode shows. */
	pause(): void {
		this.#stop();
		this.#keepPosition();
		void this.#show(this.frame).then(() => this.#scheduleWarm());
	}

	togglePlay(): void {
		if (this.playing) this.pause();
		else this.play();
	}

	#stop(): void {
		this.playing = false;
		this.soundtrack.stopClock();
		this.stalled = false;
		this.#meter.stop();
		clearInterval(this.#fpsTimer);
		this.#fpsTimer = undefined;
		this.#readFps();
	}

	#readFps(): void {
		this.fps = this.#meter.read();
		this.changed();
	}

	#setStalled(on: boolean): void {
		this.stalled = on;
		this.changed();
	}

	// Real time: nothing is rendered ahead. Each turn draws the frame due on
	// the clock straight to the screen, and frames that drawing missed are
	// skipped. Playback starts at once and the sound keeps its speed; a device
	// that can't keep up shows fewer frames, and the frame rate says how many.
	async #playFrames(player: PreviewPlayer, alive: () => boolean) {
		const fps = this.meta?.fps ?? 30;
		this.#meter.start();
		this.#readFps();
		this.#fpsTimer = setInterval(() => this.#readFps(), 500);
		// Sound starts with picture: wait for the block at the playhead.
		if (this.soundtrack.waitsBeforePlay) {
			this.#setStalled(true);
			await this.soundtrack.ready(this.frame);
			if (!alive()) return;
			this.#setStalled(false);
		}
		// A soundtrack still downloading would start late: wait for it.
		if (this.soundtrack.state === "loading") {
			this.#setStalled(true);
			while (alive() && this.soundtrack.state === "loading") await sleep(50);
			// A newer playback may be waiting too: only this one's own stall ends here.
			if (!alive()) return;
			this.#setStalled(false);
		}
		const f0 = this.frame;
		const clock = this.soundtrack.startClock(f0, fps);
		let presented = -1;
		while (alive()) {
			const due = Math.min(this.lastFrame, f0 + Math.floor(clock() * fps));
			if (due === presented) {
				await sleep(4);
				continue;
			}
			this.#setTime(due);
			// Each frame is drawn once; caching it would cost a texture and a copy per frame.
			const drawn = await player.render(due, { cache: false });
			if (!alive()) return;
			presented = drawn;
			this.#meter.record(drawn);
			if (drawn >= this.lastFrame) return;
		}
	}

	// ── Notes: pause, click the picture (or drag an area) and say what should
	// change. Each is saved with its moment, its spot and a picture of the
	// frame with the spot marked, for whoever edits the film ──

	#loadNotes(): void {
		if (!this.notesOn) return;
		this.server.listNotes().then(
			(list) => this.#setNotes(list),
			() => {},
		);
	}

	#setNotes(notes: PreviewNote[]): void {
		this.notes = notes;
		if (this.openId != null && !this.noteById(this.openId)) this.closePop();
		this.changed();
	}

	#upsert(note: PreviewNote): void {
		const i = this.notes.findIndex((n) => n.id === note.id);
		if (i >= 0) this.notes[i] = note;
		else this.notes.push(note);
		this.changed();
	}

	/** Starts writing a note at the current frame. */
	beginDraft(
		spot: { x: number; y: number },
		area: { x: number; y: number; w: number; h: number } | null,
	): void {
		this.openId = null;
		this.saveError = false;
		this.draft = draftAt(this.frame, spot, area);
		this.changed();
	}

	setDraftText(text: string): void {
		if (!this.draft) return;
		this.draft.text = text;
		this.changed();
	}

	cancelDraft(): void {
		if (!this.draft) return;
		this.draft = null;
		this.closePop();
	}

	/** Saves the draft, with a picture of its spot; false when it couldn't. */
	async saveDraft(): Promise<boolean> {
		const d = this.draft;
		const meta = this.meta;
		const text = d?.text.trim();
		if (!d || !meta || !text || this.saving) return false;
		this.saving = true;
		this.saveError = false;
		this.changed();
		try {
			let image: string | undefined;
			try {
				if (this.player) image = await captureNote(this.player, d);
			} catch (err) {
				this.report("warning", ["[framefields] no picture for the note:", err]);
			}
			const note = await this.server.changeNote({
				op: "add",
				note: {
					frame: d.frame,
					time: d.frame / meta.fps,
					x: d.x,
					y: d.y,
					w: d.w,
					h: d.h,
					text,
					image,
				},
			});
			if (this.draft === d) this.draft = null;
			this.closePop();
			this.#upsert(note);
			this.toast(`Note ${note.id} saved`);
			return true;
		} catch {
			this.saveError = true;
			return false;
		} finally {
			this.saving = false;
			this.changed();
		}
	}

	openCard(id: number): void {
		if (!this.noteById(id)) return;
		if (this.draft) this.cancelDraft();
		this.openId = id;
		this.changed();
	}

	closePop(): void {
		this.openId = null;
		this.changed();
	}

	setDone(id: number, done: boolean): void {
		this.server.changeNote({ op: "update", id, done }).then(
			(n) => this.#upsert(n),
			() => this.toast("Couldn't save. Is the preview running?"),
		);
	}

	removeNote(id: number): void {
		this.server.changeNote({ op: "remove", id }).then(
			() => {
				this.notes = this.notes.filter((n) => n.id !== id);
				this.closePop();
			},
			() => this.toast("Couldn't delete. Is the preview running?"),
		);
	}

	/** Seeks to a note's moment and opens its card. */
	goToNote(id: number): void {
		const n = this.noteById(id);
		if (!n) return;
		this.panelOpen = false;
		void this.seek(n.frame).then(() => this.openCard(id));
	}

	setPanel(open: boolean): void {
		this.panelOpen = open;
		this.changed();
	}

	toast(text: string): void {
		this.toastText = text;
		this.toastOn = true;
		clearTimeout(this.#toastTimer);
		this.#toastTimer = setTimeout(() => {
			this.toastOn = false;
			this.changed();
		}, 2200);
		this.changed();
	}

	// ── For scripts and agents ──

	api(): PreviewApi {
		return {
			seek: async (sec) => {
				await this.whenReady();
				return this.seek(Number(sec) * (this.meta?.fps ?? 30));
			},
			seekFrame: async (frame) => {
				await this.whenReady();
				return this.seek(frame);
			},
			play: async () => {
				await this.whenReady();
				this.play();
			},
			pause: () => {
				if (this.playing) this.pause();
			},
			notes: () => this.notes.slice(),
			state: () => this.snapshot(),
		};
	}

	snapshot(): PreviewStateSnapshot {
		const meta = this.meta;
		const rate = this.#meter.read().fps;
		return {
			state: this.pageState,
			error: this.pageState === "error" ? this.error : null,
			frame: this.frame,
			time: meta ? Number((this.frame / meta.fps).toFixed(3)) : 0,
			playing: this.playing,
			buffering: this.stalled,
			audio: this.soundtrack.state,
			audioMixed: this.soundtrack.mixed,
			audioMixer: this.soundtrack.mixer,
			connected: !this.offline,
			playbackFps: rate == null ? null : Number(rate.toFixed(1)),
			renderMs: this.player ? Math.round(this.player.lastRenderMs) : null,
			meta: meta && {
				title: meta.title,
				width: meta.width,
				height: meta.height,
				fps: meta.fps,
				frameCount: meta.frameCount,
				duration: Number((this.lastFrame / meta.fps).toFixed(3)),
			},
		};
	}
}
