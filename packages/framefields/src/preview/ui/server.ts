/**
 * The page's traffic with the preview server, behind one interface so the
 * page's logic can be driven by a stand-in in tests.
 */
import type {
	AudioStatus,
	LogLine,
	NoteRequest,
	PreviewMetaReply,
	PreviewNote,
} from "../protocol.js";

/** What the server pushes on `/events`. */
export interface ServerEvents {
	/** Sent on every (re)connect, with the serving process's session. */
	hello(session: string): void;
	/** The stream dropped: the preview command stopped (the browser retries). */
	lost(): void;
	notes(notes: PreviewNote[]): void;
	audio(status: AudioStatus): void;
}

export interface PreviewServer {
	meta(): Promise<PreviewMetaReply>;
	listNotes(): Promise<PreviewNote[]>;
	/** Resolves with the note as saved (the removed one, for `remove`). */
	changeNote(request: NoteRequest): Promise<PreviewNote>;
	/** A line for the preview's terminal; never fails. */
	log(line: LogLine): void;
	/** Asks the server to mix the soundtrack, when the page can't. */
	mixAudio(): void;
	/** The server's mix, as WAV bytes. */
	audio(): Promise<ArrayBuffer>;
	/** Subscribes to the event stream; returns a function that closes it. */
	events(on: ServerEvents): () => void;
}

/** The project's bundle: the page loads it as the player, a worker as the soundtrack's mixer. */
export const PLAYER_URL = "/@framefields/player.js";

async function json<T>(response: Promise<Response>): Promise<T> {
	const r = await response;
	if (!r.ok) throw new Error(`HTTP ${r.status}`);
	return (await r.json()) as T;
}

function post(url: string, body: unknown, keepalive = false) {
	return fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
		keepalive,
	});
}

/** The server this page came from. */
export function httpServer(): PreviewServer {
	return {
		meta: () => json(fetch("/meta")),
		listNotes: async () => {
			const list = await json<unknown>(fetch("/@framefields/notes"));
			return Array.isArray(list) ? (list as PreviewNote[]) : [];
		},
		changeNote: (request) => json(post("/@framefields/notes", request)),
		log(line) {
			post("/@framefields/log", line, true).catch(() => {});
		},
		mixAudio() {
			fetch("/audio/mix", { method: "POST" }).catch(() => {});
		},
		async audio() {
			const r = await fetch("/audio");
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
			return r.arrayBuffer();
		},
		events(on) {
			const source = new EventSource("/events");
			const data = (e: Event) => JSON.parse((e as MessageEvent<string>).data);
			source.addEventListener("hello", (e) => on.hello(data(e).session));
			source.addEventListener("error", () => on.lost());
			source.addEventListener("notes", (e) => on.notes(data(e)));
			source.addEventListener("audio", (e) => on.audio(data(e)));
			return () => source.close();
		},
	};
}
