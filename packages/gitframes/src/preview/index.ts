import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { VirtualMediaData } from "@gitframes/core";
import { encodeStereoWav } from "../audio/index.js";
import { HeadlessMediaRenderer } from "../renderer/index.js";
import {
	bundleProject,
	ENGINE_URL,
	engineDir,
	onnxRuntimeWeb,
	visionModelsDir,
} from "./bundle.js";
import { previewPage } from "./page.js";

/** Where the composition comes from: the module that builds it. */
export interface PreviewSource {
	/** Path or file URL of the module, e.g. `new URL("./film.ts", import.meta.url)`. */
	entry: string | URL;
	/**
	 * The export to preview: a function returning a `Composition` (it may be
	 * async), or a `Composition`. Defaults to `"default"`.
	 */
	export?: string;
}

/** What the server needs from the composition: its size, timing and soundtrack. */
interface PreviewTarget {
	toVirtualMedia?(): VirtualMediaData;
	toVirtualMediaAsync?(): Promise<VirtualMediaData>;
	computeDuration?(): Promise<number>;
	fps?: number;
	durationMs?: number;
	width?: number;
	height?: number;
}

export interface PreviewOptions {
	/**
	 * Port to listen on. Defaults to a port derived from the working directory,
	 * so every preview of a project lands on the same URL and an open tab picks
	 * up the next one by itself. A preview already running there is replaced.
	 */
	port?: number;
	/** Interface to bind. Defaults to "127.0.0.1" so the preview never leaves the machine. */
	host?: string;
	/**
	 * Also open the page in the system's default browser. Off by default: the
	 * caller shows the URL where it suits, e.g. an agent app's own browser
	 * pane. Skipped when a tab from an earlier preview reconnects on its own.
	 */
	open?: boolean;
	/** Title shown in the page header. */
	title?: string;
	/** Mix and play the composition's audio. Defaults to true. */
	audio?: boolean;
	/** Optional shared renderer instance, used to mix the soundtrack. */
	renderer?: HeadlessMediaRenderer;
	/**
	 * Close the server this many milliseconds after the last open tab goes
	 * away (closed, not reloaded). Defaults to 5000. `false` keeps it serving
	 * until `close()`. Nothing closes before a tab has connected.
	 */
	idleCloseMs?: number | false;
	/**
	 * Files the page may load by absolute path (the composition's assets).
	 * Defaults to the project that holds the entry: the nearest `.git`, else
	 * the nearest `package.json`, else the entry's directory. Pass one path or
	 * several to allow assets kept outside it.
	 */
	root?: string | string[];
}

export interface PreviewSession {
	url: string;
	close(): Promise<void>;
	/** Resolves when the server stops: `close()`, an idle tab, or a newer preview took over its port. */
	closed: Promise<void>;
}

interface PreviewMeta {
	session: string;
	title: string;
	fps: number;
	frameCount: number;
	width: number;
	height: number;
}

type AudioStatus =
	| { state: "mixing" }
	| { state: "ready"; durationSec: number; peaks: number[] }
	| { state: "none" }
	| { state: "error"; error: string };

const PEAK_BINS = 1200;
/** Requests carrying this header come from another preview process, not a page. */
const TAKEOVER_HEADER = "x-gitframes-preview";
const PLAYER_PATH = "/@gitframes/player.js";

/**
 * Serves a localhost player for a composition. The page loads the
 * composition's own code, bundled with the engine, and renders every frame
 * with WebGPU in the browser, like the editor's player; nothing is streamed.
 * The server provides the bundle, the project's files, and the soundtrack,
 * which it mixes with the export engine.
 *
 * The server runs until its tab closes or `close()`. Starting another preview
 * on the same port (the default for a project) stops this one, and open tabs
 * reload into it.
 */
export async function startPreview(
	source: PreviewSource,
	options: PreviewOptions = {},
): Promise<PreviewSession> {
	const entry =
		source.entry instanceof URL || String(source.entry).startsWith("file:")
			? fileURLToPath(source.entry)
			: path.resolve(String(source.entry));
	const exportName = source.export ?? "default";
	// Vision nodes load their cached models, and onnxruntime-web's files when
	// the project has it installed.
	const modelsDir = visionModelsDir();
	const ort = onnxRuntimeWeb(path.dirname(entry));
	const roots = [
		...(options.root === undefined
			? [repoRoot(path.dirname(entry))]
			: Array.isArray(options.root)
				? options.root
				: [options.root]),
		modelsDir,
		ort.dir,
	]
		.filter((r): r is string => !!r)
		.map((r) => path.resolve(r));
	const sseClients = new Set<http.ServerResponse>();
	const idleCloseMs = options.idleCloseMs ?? 5000;
	let idleTimer: NodeJS.Timeout | undefined;
	const title = options.title ?? "gitframes preview";
	const session = randomUUID();

	const target = await loadTarget(entry, exportName);
	const meta = await resolveMeta(target, title, session);
	// The project's own code, bundled against the browser engine; the engine
	// itself is prebuilt (or built once, running from source).
	let bundle: Promise<string> | undefined;
	const playerBundle = () => {
		if (!bundle) {
			const built = bundleProject({
				entry,
				exportName,
				modelsDir,
				ortBase: ort.base,
			}).then((b) => b.code);
			bundle = built;
			built.catch(() => {
				// Let a later request try again, unless it started its own build.
				if (bundle === built) bundle = undefined;
			});
		}
		return bundle;
	};
	const engine = engineDir();
	engine.catch(() => {});

	// ── Audio: mixed once, by the export engine ──
	let audio: AudioStatus = {
		state: options.audio === false ? "none" : "mixing",
	};
	let audioWav: Buffer | undefined;

	function broadcast(event: string, data: unknown) {
		for (const client of sseClients) {
			client.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
		}
	}

	function setAudio(next: AudioStatus) {
		audio = next;
		broadcast("audio", audio);
	}

	function startAudio() {
		if (audio.state !== "mixing") return;
		if (!target.toVirtualMediaAsync && !target.toVirtualMedia) {
			setAudio({ state: "none" });
			return;
		}
		const renderer = options.renderer ?? new HeadlessMediaRenderer();
		(async () => {
			const vm = target.toVirtualMediaAsync
				? await target.toVirtualMediaAsync()
				: (target.toVirtualMedia as () => VirtualMediaData)();
			return renderer.renderAudio(vm, { fps: meta.fps });
		})().then(
			({ channels, sampleRate }) => {
				const left = channels[0] ?? new Float32Array(0);
				const right = channels[1] ?? left;
				const peaks = computePeaks(left, right, PEAK_BINS);
				if (left.length === 0 || Math.max(...peaks) < 0.001) {
					setAudio({ state: "none" });
					return;
				}
				audioWav = encodeStereoWav([left, right], { sampleRate });
				setAudio({
					state: "ready",
					durationSec: left.length / sampleRate,
					peaks: peaks.map((p) => Math.round(p * 1000) / 1000),
				});
			},
			(err: unknown) => {
				setAudio({
					state: "error",
					error: err instanceof Error ? err.message : String(err),
				});
			},
		);
	}

	let resolveClosed!: () => void;
	const closed = new Promise<void>((r) => {
		resolveClosed = r;
	});
	let closing: Promise<void> | undefined;
	function close(): Promise<void> {
		closing ??= new Promise<void>((resolve) => {
			clearTimeout(idleTimer);
			for (const client of sseClients) client.end();
			sseClients.clear();
			server.close(() => {
				resolve();
				resolveClosed();
			});
			server.closeAllConnections();
		});
		return closing;
	}

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? "/", "http://localhost");
		// Cross-origin isolation: lets onnxruntime-web use SharedArrayBuffer and
		// threads for vision models (single-threaded otherwise). "credentialless"
		// keeps cross-origin assets such as the font stylesheet loading.
		res.setHeader("cross-origin-opener-policy", "same-origin");
		res.setHeader("cross-origin-embedder-policy", "credentialless");
		try {
			if (req.method === "GET" && url.pathname === "/") {
				res.writeHead(200, {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(previewPage);
				return;
			}
			if (req.method === "GET" && url.pathname === "/meta") {
				sendJson(res, 200, { ...meta, audio });
				return;
			}
			if (req.method === "GET" && url.pathname.startsWith(`${ENGINE_URL}/`)) {
				const dir = await engine;
				const file = path.resolve(
					dir,
					`.${url.pathname.slice(ENGINE_URL.length)}`,
				);
				if (isInside(dir, file) && (await isFile(file))) {
					await sendFile(req, res, file);
					return;
				}
				sendJson(res, 404, { error: "not found" });
				return;
			}
			if (req.method === "GET" && url.pathname === PLAYER_PATH) {
				let code: string;
				try {
					await engine;
					code = await playerBundle();
				} catch (err) {
					// Shown on the page: usually an error in the composition's code.
					const message = err instanceof Error ? err.message : String(err);
					code = `throw new Error(${JSON.stringify(`Could not build the preview:\n${message}`)});`;
				}
				res.writeHead(200, {
					"content-type": "text/javascript; charset=utf-8",
					"cache-control": "no-store",
				});
				res.end(code);
				return;
			}
			// `fs.existsSync` / `statSync` in the page: a missing file is an
			// answer here, not a 404 the browser logs as an error.
			if (req.method === "GET" && url.pathname === "/@gitframes/stat") {
				const file = path.resolve(url.searchParams.get("path") ?? "");
				let size = -1;
				if (roots.some((r) => isInside(r, file))) {
					size = await fs.promises.stat(file).then(
						(st) => (st.isFile() ? st.size : -1),
						() => -1,
					);
				}
				sendJson(res, 200, { exists: size >= 0, size: Math.max(0, size) });
				return;
			}
			if (req.method === "GET" && url.pathname === "/events") {
				res.writeHead(200, {
					"content-type": "text/event-stream",
					"cache-control": "no-store",
					connection: "keep-alive",
				});
				// Reconnect fast: a tab left open finds the next preview's
				// server within a second of it starting.
				res.write("retry: 1000\n");
				res.write(
					`event: hello\ndata: ${JSON.stringify({ session: meta.session })}\n\n`,
				);
				sseClients.add(res);
				clearTimeout(idleTimer);
				onClient?.();
				req.on("close", () => {
					sseClients.delete(res);
					// A reload reconnects within a second; a closed tab doesn't.
					if (sseClients.size === 0 && idleCloseMs !== false && !closing) {
						idleTimer = setTimeout(() => {
							if (sseClients.size === 0) void close();
						}, idleCloseMs);
					}
				});
				return;
			}
			// A newer preview of the same project wants this port. The custom
			// header keeps web pages from triggering it (it forces a CORS preflight).
			if (
				req.method === "POST" &&
				url.pathname === "/takeover" &&
				req.headers[TAKEOVER_HEADER] === "1"
			) {
				sendJson(res, 200, { ok: true });
				setImmediate(() => void close());
				return;
			}
			if (req.method === "GET" && url.pathname === "/audio") {
				if (audio.state !== "ready" || !audioWav) {
					sendJson(res, 404, { error: `audio is ${audio.state}` });
					return;
				}
				res.writeHead(200, {
					"content-type": "audio/wav",
					"content-length": audioWav.length,
					"cache-control": "no-store",
				});
				res.end(audioWav);
				return;
			}
			// Fonts referenced by family only resolve to assets/fonts/<Family>.ttf,
			// read from the project's folder, as the export engine does.
			const fontMatch = /^\/assets\/fonts\/([^/]+)$/.exec(url.pathname);
			if (fontMatch && (req.method === "GET" || req.method === "HEAD")) {
				const file = path.join(
					process.cwd(),
					"assets",
					"fonts",
					decodeURIComponent(fontMatch[1]),
				);
				if (await isFile(file)) {
					await sendFile(req, res, file);
					return;
				}
			}
			// The composition's files, by absolute path: what the program
			// references loads as-is.
			if (req.method === "GET" || req.method === "HEAD") {
				// The engine asks for local files under Vite's `/@fs/` prefix.
				const file = path.resolve(
					decodeURIComponent(url.pathname.replace(/^\/@fs(?=\/)/, "")),
				);
				if (roots.some((r) => isInside(r, file)) && (await isFile(file))) {
					await sendFile(req, res, file);
					return;
				}
			}
			sendJson(res, 404, { error: "not found" });
		} catch (err) {
			if (!res.headersSent) {
				sendJson(res, 500, {
					error: err instanceof Error ? err.message : String(err),
				});
			} else {
				res.end();
			}
		}
	});

	let onClient: (() => void) | undefined;
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? stablePort();
	const listen = (p: number) =>
		new Promise<void>((resolve, reject) => {
			const fail = (err: Error) => {
				server.off("listening", ok);
				reject(err);
			};
			const ok = () => {
				server.off("error", fail);
				resolve();
			};
			server.once("error", fail);
			server.once("listening", ok);
			server.listen(p, host);
		});
	try {
		await listen(port);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
		// Most likely the previous preview of this project: ask it to step aside.
		if (await requestTakeover(host, port)) {
			await listen(port).catch(() => listen(0));
		} else if (options.port === undefined) {
			await listen(0);
		} else {
			throw err;
		}
	}
	const { port: actualPort } = server.address() as AddressInfo;
	const url = `http://${host.includes(":") ? `[${host}]` : host}:${actualPort}/`;

	// Build the page's bundle and mix the soundtrack while the browser opens.
	void playerBundle().catch(() => {});
	startAudio();
	if (options.open === true) {
		// A tab from the last preview reconnects within ~1 s and reloads itself;
		// only open a new one when nobody comes back.
		const reconnected = await new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), 2000);
			onClient = () => {
				clearTimeout(timer);
				resolve(true);
			};
			if (sseClients.size > 0) onClient();
		});
		onClient = undefined;
		if (!reconnected) openBrowser(url);
	}

	return { url, closed, close };
}

async function loadTarget(
	entry: string,
	exportName: string,
): Promise<PreviewTarget> {
	const mod = (await import(pathToFileURL(entry).href)) as Record<
		string,
		unknown
	>;
	const exported = mod[exportName];
	if (exported === undefined) {
		throw new Error(
			`[gitframes] ${entry} has no export named "${exportName}" to preview.`,
		);
	}
	return (
		typeof exported === "function"
			? await (exported as () => unknown)()
			: exported
	) as PreviewTarget;
}

/**
 * The project holding `dir`: the nearest `.git`, else the nearest
 * `package.json`, else `dir` itself. A repo wins over a nested package, so a
 * monorepo's shared assets stay reachable.
 */
function repoRoot(dir: string): string {
	let project: string | undefined;
	for (let d = dir; ; d = path.dirname(d)) {
		if (fs.existsSync(path.join(d, ".git"))) return d;
		if (!project && fs.existsSync(path.join(d, "package.json"))) project = d;
		if (path.dirname(d) === d) return project ?? dir;
	}
}

function isInside(root: string, file: string): boolean {
	const rel = path.relative(root, file);
	return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

async function isFile(file: string): Promise<boolean> {
	try {
		return (await fs.promises.stat(file)).isFile();
	} catch {
		return false;
	}
}

const CONTENT_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".mp4": "video/mp4",
	".mov": "video/quicktime",
	".webm": "video/webm",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".m4a": "audio/mp4",
	".ogg": "audio/ogg",
	".ttf": "font/ttf",
	".otf": "font/otf",
	".woff": "font/woff",
	".woff2": "font/woff2",
	".json": "application/json",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".wasm": "application/wasm",
	".onnx": "application/octet-stream",
	".srt": "text/plain; charset=utf-8",
	".txt": "text/plain; charset=utf-8",
};

/** Serves a file, with byte ranges so video can seek without loading it whole. */
async function sendFile(
	req: http.IncomingMessage,
	res: http.ServerResponse,
	file: string,
) {
	const { size } = await fs.promises.stat(file);
	const type =
		CONTENT_TYPES[path.extname(file).toLowerCase()] ??
		"application/octet-stream";
	const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
	let start = 0;
	let end = size - 1;
	if (range && (range[1] || range[2])) {
		if (range[1]) {
			start = Number(range[1]);
			if (range[2]) end = Math.min(end, Number(range[2]));
		} else {
			start = Math.max(0, size - Number(range[2]));
		}
		if (start > end || start >= size) {
			res.writeHead(416, { "content-range": `bytes */${size}` });
			res.end();
			return;
		}
	}
	res.writeHead(range ? 206 : 200, {
		"content-type": type,
		"content-length": end - start + 1,
		"accept-ranges": "bytes",
		"cache-control": "no-cache",
		...(range && { "content-range": `bytes ${start}-${end}/${size}` }),
	});
	if (req.method === "HEAD") {
		res.end();
		return;
	}
	fs.createReadStream(file, { start, end }).pipe(res);
}

async function resolveMeta(
	target: PreviewTarget,
	title: string,
	session: string,
): Promise<PreviewMeta> {
	const fps = target.fps ?? 24;
	const durationMs =
		target.durationMs ?? (await target.computeDuration?.()) ?? 5000;
	return {
		session,
		title,
		fps,
		frameCount: Math.max(1, Math.round((durationMs / 1000) * fps)),
		width: target.width ?? 1920,
		height: target.height ?? 1080,
	};
}

/** Same project, same port: 41000–41899, from the working directory. */
function stablePort(): number {
	const digest = createHash("sha1").update(process.cwd()).digest();
	return 41000 + (digest.readUInt16BE(0) % 900);
}

/** Asks a preview already on `port` to shut down; false if something else is there. */
async function requestTakeover(host: string, port: number): Promise<boolean> {
	// A fresh connection (no agent): a pooled keep-alive socket may point at a
	// server that is already gone.
	const ok = await new Promise<boolean>((resolve) => {
		const req = http.request(
			{
				host,
				port,
				method: "POST",
				path: "/takeover",
				agent: false,
				headers: { [TAKEOVER_HEADER]: "1" },
				timeout: 1500,
			},
			(res) => {
				res.resume();
				resolve(res.statusCode === 200);
			},
		);
		req.on("timeout", () => req.destroy());
		req.on("error", () => resolve(false));
		req.end();
	});
	// Give it a moment to release the socket.
	if (ok) await new Promise((r) => setTimeout(r, 150));
	return ok;
}

/** Max absolute amplitude of both channels per bin, 0..1. */
function computePeaks(
	left: Float32Array,
	right: Float32Array,
	bins: number,
): number[] {
	const peaks = new Array<number>(bins).fill(0);
	if (left.length === 0) return peaks;
	const per = left.length / bins;
	for (let b = 0; b < bins; b++) {
		const start = Math.floor(b * per);
		const end = Math.min(left.length, Math.floor((b + 1) * per));
		let max = 0;
		for (let i = start; i < end; i++) {
			const v = Math.max(Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
			if (v > max) max = v;
		}
		peaks[b] = Math.min(1, max);
	}
	return peaks;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown) {
	res.writeHead(status, {
		"content-type": "application/json",
		"cache-control": "no-store",
	});
	res.end(JSON.stringify(body));
}

function openBrowser(url: string) {
	const [cmd, args] =
		process.platform === "darwin"
			? ["open", [url]]
			: process.platform === "win32"
				? ["cmd", ["/c", "start", "", url]]
				: ["xdg-open", [url]];
	try {
		spawn(cmd, args, { stdio: "ignore", detached: true })
			.on("error", () => {})
			.unref();
	} catch {}
}
