/**
 * The page's side of the embed protocol (../embed-protocol.ts): tells the
 * app embedding it what happens, and runs the commands it sends.
 */
import {
	PREVIEW_PROTOCOL,
	type PreviewCommandMessage,
	type PreviewMessage,
	type PreviewPosition,
	readPreviewCommand,
} from "../embed-protocol.js";
import type { PreviewApp } from "./app.js";

/** While playing, `state` goes out at most this often. */
export const STATE_INTERVAL_MS = 250;

export interface EmbedChannelOptions {
	/** Where messages from the parent arrive. Defaults to `window`. */
	win?: Window;
	now?: () => number;
}

/**
 * Connects the page to the app that embeds it: `parent` receives the page's
 * messages and is the only source whose commands run. Returns a function
 * that disconnects.
 */
export function connectEmbedder(
	app: PreviewApp,
	parent: Window,
	{ win = window, now = () => performance.now() }: EmbedChannelOptions = {},
): () => void {
	const post = (message: PreviewMessage) => parent.postMessage(message, "*");
	let last: PreviewPosition | null = null;
	let lastAt = Number.NEGATIVE_INFINITY;

	const offReady = app.on("ready", () => {
		const meta = app.meta;
		if (!meta) return;
		post({
			type: "framefields-preview:ready",
			protocol: PREVIEW_PROTOCOL,
			seekByHash: true,
			meta: {
				title: meta.title,
				width: meta.width,
				height: meta.height,
				fps: meta.fps,
				frames: meta.frameCount,
				duration: Number(((meta.frameCount - 1) / meta.fps).toFixed(3)),
			},
		});
	});

	// Every play, pause and finished seek; frames while playing, throttled.
	const offPosition = app.on("position", (p) => {
		const same = last && last.frame === p.frame && last.playing === p.playing;
		const ticking =
			p.playing && last?.playing && now() - lastAt < STATE_INTERVAL_MS;
		if (same || ticking) return;
		last = p;
		lastAt = now();
		post({ type: "framefields-preview:state", ...p });
	});

	const offBuild = app.on("build", (b) =>
		post({ type: "framefields-preview:build", ...b }),
	);

	const onMessage = (event: MessageEvent) => {
		if (event.source !== parent) return;
		const command = readPreviewCommand(event.data);
		if (command) void run(app, command).then(post);
	};
	win.addEventListener("message", onMessage);

	return () => {
		offReady();
		offPosition();
		offBuild();
		win.removeEventListener("message", onMessage);
	};
}

async function run(
	app: PreviewApp,
	message: PreviewCommandMessage,
): Promise<PreviewMessage> {
	const { id } = message;
	try {
		switch (message.command) {
			case "seek":
				await app.whenReady();
				await app.seek(message.time * (app.meta?.fps ?? 30));
				break;
			case "seekFrame":
				await app.whenReady();
				await app.seek(message.frame);
				break;
			case "play":
				await app.whenReady();
				app.play();
				break;
			case "pause":
				if (app.playing) app.pause();
				break;
			case "state":
				break;
		}
		return {
			type: "framefields-preview:reply",
			id,
			ok: true,
			state: app.position,
		};
	} catch (err) {
		return {
			type: "framefields-preview:reply",
			id,
			ok: false,
			error: String((err as Error | undefined)?.message ?? err),
		};
	}
}
