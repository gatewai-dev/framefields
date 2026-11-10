/**
 * What the preview server and its page say to each other: the shapes of
 * `/meta`, the `audio` and `notes` events and the notes requests. Types only,
 * so the page's bundle and the server share them without sharing code.
 */
import type { NewNote, PreviewNote } from "./notes.js";

export type { NewNote, PreviewNote };

/** Where the soundtrack is, as the server reports it. */
export type AudioStatus =
	/** The page mixes it (the default); the server only when the page asks. */
	| { state: "browser" }
	| { state: "mixing" }
	| { state: "ready"; durationSec: number; peaks: number[] }
	| { state: "none" }
	| { state: "error"; error: string };

/** `GET /meta`: the film and this server's session. */
export interface PreviewMeta {
	/** Changes with each preview process; a tab reloads when it does. */
	session: string;
	/** Where notes are kept; null when they are off. */
	notesDir: string | null;
	title: string;
	fps: number;
	frameCount: number;
	width: number;
	height: number;
}

export type PreviewMetaReply = PreviewMeta & { audio: AudioStatus };

/** `POST /@framefields/notes`: one change. */
export type NoteRequest =
	| { op: "add"; note: NewNote }
	| { op: "update"; id: number; done?: boolean; text?: string }
	| { op: "remove"; id: number };

/** `POST /@framefields/log`: a line for the preview's terminal. */
export interface LogLine {
	level: "error" | "warning";
	message: string;
}

/** Sent to the embedding page once the preview shows its first frame. */
export interface PreviewReadyMessage {
	type: "framefields-preview:ready";
	/** The page seeks when its address fragment (`#t=`, `#frame=`) changes. */
	seekByHash: true;
}
