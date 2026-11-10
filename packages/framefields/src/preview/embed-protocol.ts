/**
 * The preview page's message channel with an app that embeds it in a frame
 * (protocol 1). The page talks only when embedded, with
 * `window.parent.postMessage(message, "*")`, and takes commands only from
 * `window.parent`. Every message has a `type` starting `framefields-preview:`.
 *
 * Page → parent: `ready` once the first frame shows; `state` on play, pause,
 * each finished seek, and up to 4 times a second while playing; `build`
 * around a rebuild (and `error` when a build or a frame fails); `reply` to
 * each command. Parent → page: `command`, answered by a `reply` with its `id`.
 *
 * The page also seeks when its address fragment changes (`#t=12.5`,
 * `#frame=375`), without a reload; `seekByHash` in `ready` says so.
 */

export const PREVIEW_PROTOCOL = 1;

/** The film the page shows. `frames` is its frame count, `duration` the last frame's time in seconds. */
export interface PreviewFilm {
	title: string;
	width: number;
	height: number;
	fps: number;
	frames: number;
	duration: number;
}

/** Where the page is. `time` is `frame / fps` in seconds. */
export interface PreviewPosition {
	frame: number;
	time: number;
	playing: boolean;
}

export interface PreviewReadyMessage {
	type: "framefields-preview:ready";
	protocol: typeof PREVIEW_PROTOCOL;
	/** Setting the frame's `#t=` / `#frame=` seeks in place. */
	seekByHash: true;
	meta: PreviewFilm;
}

export interface PreviewStateMessage extends PreviewPosition {
	type: "framefields-preview:state";
}

export interface PreviewBuildMessage {
	type: "framefields-preview:build";
	/**
	 * "building" before the page reloads into a rebuilt preview (its `ready`
	 * after the reload means it's done), "error" when a build or a frame
	 * failed, with the text.
	 */
	status: "building" | "ready" | "error";
	message?: string;
}

export type PreviewCommand =
	/** `time` in seconds. */
	| { command: "seek"; time: number }
	| { command: "seekFrame"; frame: number }
	| { command: "play" }
	| { command: "pause" }
	| { command: "state" };

export type PreviewCommandMessage = {
	type: "framefields-preview:command";
	/** Echoed in the reply. */
	id: string;
} & PreviewCommand;

/** The answer to a command, once it's done (a seek once the frame is drawn). */
export type PreviewReplyMessage = {
	type: "framefields-preview:reply";
	id: string;
} & ({ ok: true; state: PreviewPosition } | { ok: false; error: string });

/** Everything the page posts to its parent. */
export type PreviewMessage =
	| PreviewReadyMessage
	| PreviewStateMessage
	| PreviewBuildMessage
	| PreviewReplyMessage;

const COMMANDS = new Set(["seek", "seekFrame", "play", "pause", "state"]);

/** The command in a message from the parent, or null when it isn't a well-formed one. */
export function readPreviewCommand(
	data: unknown,
): PreviewCommandMessage | null {
	if (typeof data !== "object" || data === null) return null;
	const m = data as Record<string, unknown>;
	if (m.type !== "framefields-preview:command" || typeof m.id !== "string")
		return null;
	if (typeof m.command !== "string" || !COMMANDS.has(m.command)) return null;
	if (m.command === "seek" && !Number.isFinite(m.time)) return null;
	if (m.command === "seekFrame" && !Number.isFinite(m.frame)) return null;
	return m as unknown as PreviewCommandMessage;
}
