import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { VirtualMediaData } from "@framefields/core";
import { encodeStereoWav } from "../audio/index.js";
import { HeadlessMediaRenderer } from "../renderer/index.js";
import {
	bundleProject,
	ENGINE_URL,
	engineDir,
	ORT_WEB_CDN,
	onnxRuntimeWeb,
	visionModelsDir,
} from "./bundle.js";
import { describeNote, type NewNote, NoteStore } from "./notes.js";
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
	 *
	 * A function opens it your way instead, e.g. in a browser started with
	 * particular flags. It gets the URL, and is skipped in the same way.
	 * An asynchronous opener is awaited; failures are logged without closing the server.
	 */
	open?: boolean | ((url: string) => void | Promise<void>);
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
	/**
	 * Where the preview reports what happens out of sight: the page opening,
	 * errors in the page (a failed build, a frame that threw, no WebGPU), and
	 * why the server stopped. Defaults to stderr, so whoever runs the preview
	 * (an agent's background command, say) reads them in its output. `false`
	 * keeps it quiet.
	 */
	log?: ((line: string) => void) | false;
	/**
	 * Where notes pinned on the page are kept: `notes.json` and, per note, the
	 * frame with its spot marked. Defaults to `.framefields/preview-notes` in the
	 * working directory (`.framefields` ignores itself in git). `false` turns
	 * notes off.
	 */
	notesDir?: string | false;
}

/** Why a preview stopped. */
export type PreviewCloseReason =
	/** `close()` was called. */
	| "closed"
	/** Its last tab closed (see `idleCloseMs`). */
	| "idle"
	/** A newer preview of the project took over its port. */
	| "replaced";

export interface PreviewSession {
	url: string;
	close(): Promise<void>;
	/** Resolves with the reason when the server stops. */
	closed: Promise<PreviewCloseReason>;
}

interface PreviewMeta {
	session: string;
	/** Where notes are kept; null when they are off. */
	notesDir: string | null;
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
const TAKEOVER_HEADER = "x-framefields-preview";
const PLAYER_PATH = "/@framefields/player.js";

/**
 * Serves a localhost player for a composition. The page loads the
 * composition's own code, bundled with the engine, and renders its frames
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
	const entry = entryPath(source.entry);
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
	const title = options.title ?? "framefields preview";
	const session = randomUUID();
	const log =
		options.log === false
			? () => {}
			: (options.log ?? ((line: string) => console.error(line)));
	const say = (line: string) => log(`[framefields preview] ${line}`);
	// Each distinct page error is reported once; playback repeats them per frame.
	const reported = new Set<string>();
	let pageOpened = false;

	const notes =
		options.notesDir === false
			? undefined
			: new NoteStore(
					path.resolve(
						options.notesDir ??
							path.join(process.cwd(), ".framefields", "preview-notes"),
					),
				);
	// Changes run one at a time: each reads and rewrites notes.json.
	let noteQueue: Promise<unknown> = Promise.resolve();

	const target = await loadTarget(entry, exportName);
	const meta = await resolveMeta(target, title, session, notes?.dir ?? null);
	const page = previewPage({
		meta: "/meta",
		audio: "/audio",
		player: PLAYER_PATH,
		live: true,
	});
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
			built.catch((err: unknown) => {
				say(
					`could not build ${path.relative(process.cwd(), entry)}:\n${errorText(err)}`,
				);
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
		mixSoundtrack(target, meta.fps, options.renderer).then(
			(mixed) => {
				audioWav = mixed.wav;
				setAudio(mixed.status);
			},
			(err: unknown) => {
				setAudio({
					state: "error",
					error: err instanceof Error ? err.message : String(err),
				});
			},
		);
	}

	let resolveClosed!: (reason: PreviewCloseReason) => void;
	const closed = new Promise<PreviewCloseReason>((r) => {
		resolveClosed = r;
	});
	let closing: Promise<void> | undefined;
	function close(reason: PreviewCloseReason = "closed"): Promise<void> {
		closing ??= new Promise<void>((resolve) => {
			clearTimeout(idleTimer);
			if (reason === "idle") say("stopped: its tab was closed");
			if (reason === "replaced") say("stopped: a newer preview took over");
			for (const client of sseClients) client.end();
			sseClients.clear();
			server.close(() => {
				resolve();
				resolveClosed(reason);
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
				res.end(page);
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
			if (req.method === "GET" && url.pathname === "/@framefields/stat") {
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
				if (!pageOpened) {
					pageOpened = true;
					say(
						idleCloseMs === false
							? "page opened"
							: `page opened; the server stops ${Number((idleCloseMs / 1000).toFixed(1))} s after its last tab closes`,
					);
				}
				onClient?.();
				req.on("close", () => {
					sseClients.delete(res);
					// A reload reconnects within a second; a closed tab doesn't.
					if (sseClients.size === 0 && idleCloseMs !== false && !closing) {
						idleTimer = setTimeout(() => {
							if (sseClients.size === 0) void close("idle");
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
				setImmediate(() => void close("replaced"));
				return;
			}
			// Errors in the page, so they reach the terminal (and an agent)
			// without anyone looking at the browser. JSON only: other sites
			// can't send that without a preflight this server doesn't answer.
			if (
				req.method === "POST" &&
				url.pathname === "/@framefields/log" &&
				req.headers["content-type"] === "application/json"
			) {
				const body = await readBody(req, 16 * 1024);
				const { message, level } = JSON.parse(body) as {
					message?: unknown;
					level?: unknown;
				};
				const text = String(message ?? "").trim();
				if (text && !reported.has(text) && reported.size < 200) {
					reported.add(text);
					say(
						`${level === "warning" ? "warning" : "error"} in the page: ${text}`,
					);
				}
				res.writeHead(204).end();
				return;
			}
			if (notes && url.pathname === "/@framefields/notes") {
				if (req.method === "GET") {
					sendJson(res, 200, await notes.list());
					return;
				}
				if (
					req.method === "POST" &&
					req.headers["content-type"] === "application/json"
				) {
					const body = JSON.parse(await readBody(req, 16 * 1024 * 1024)) as {
						op?: string;
						id?: number;
						done?: boolean;
						text?: string;
						note?: NewNote;
					};
					const change = noteQueue.then(() =>
						changeNote(notes, body, meta.fps, say),
					);
					noteQueue = change.catch(() => {});
					const note = await change;
					broadcast("notes", await notes.list());
					sendJson(res, note ? 200 : 404, note ?? { error: "no such note" });
					return;
				}
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
	if (options.open) {
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
		if (!reconnected) {
			if (typeof options.open === "function") {
				// The caller's opener must not take down a preview that is already serving.
				try {
					await options.open(url);
				} catch (err) {
					say(
						`could not open ${url}: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			} else openBrowser(url);
		}
	}

	return { url, closed, close: () => close() };
}

/** A composition to export, with its page's title. */
export interface ExportPreviewSource extends PreviewSource {
	/** Title shown in the page header. Defaults to `title` in the options, else the name. */
	title?: string;
	/** This composition's soundtrack, in place of `audio` in the options. */
	audio?: PreviewAudio;
}

/**
 * The soundtrack of an exported preview. `true` mixes it with the export
 * engine, as `startPreview` does, into a WAV file; `false` leaves it out.
 * `{ file, peaks }` publishes an audio file you already have instead (any
 * format browsers decode: WAV, MP3, M4A, Ogg), with `peaks` for the
 * waveform: levels from 0 to 1, spread evenly over the composition's length.
 */
export type PreviewAudio = boolean | { file: string; peaks?: number[] };

export interface ExportPreviewOptions {
	/**
	 * Folder to write the preview into. Files the export writes are replaced;
	 * anything else there is left alone.
	 */
	outDir: string;
	/**
	 * URL path the folder is served under, e.g. `"/films/preview/"`. Every URL
	 * in the export starts with it, so it must match. Defaults to `"/"`.
	 * Use unescaped URL-safe segments; query strings and dot segments are rejected.
	 */
	basePath?: string;
	/** Title shown in the page header. */
	title?: string;
	/**
	 * The project folder. It is published at `basePath`: a file the
	 * composition reads at `<root>/assets/logo.svg` is served at
	 * `<basePath>assets/logo.svg`, and the paths the code builds from
	 * `import.meta.url` point there. Defaults to the project that holds the
	 * entry, as for `startPreview`.
	 */
	root?: string;
	/**
	 * Files and folders to publish, relative to `root`: whatever the
	 * composition loads (images, video, fonts, data it reads with `fs`).
	 * Defaults to `assets`, when there is one. Fonts named by family only
	 * (`assets/fonts/<Family>.ttf` in the working directory) are added.
	 */
	files?: string | string[];
	/** The soundtrack; see `PreviewAudio`. Defaults to `true`, mixed. */
	audio?: PreviewAudio;
	/** Optional shared renderer instance, used to mix the soundtrack. */
	renderer?: HeadlessMediaRenderer;
}

export interface PreviewExport {
	/** The folder written. */
	outDir: string;
	/** URL path of each page by name; `""` for a single composition. */
	pages: Record<string, string>;
	/** URL paths of the project's files published with it. */
	files: string[];
}

/** Where an export puts the browser engine, inside `basePath`. */
const STATIC_ENGINE = "framefields-engine";

/**
 * Writes the preview as a static site: the page, the composition's code
 * bundled against the browser engine, the engine itself, the project files
 * the composition loads, and the soundtrack. Any static host can serve the
 * folder under `basePath`; no preview server runs, so notes and reloading
 * into the next version are off. Vision models are not published.
 *
 * Pass one composition, or several by name: each gets a page at
 * `<basePath><name>/`, and they share one engine and one copy of the files.
 */
export async function exportPreview(
	source: ExportPreviewSource | Record<string, ExportPreviewSource>,
	options: ExportPreviewOptions,
): Promise<PreviewExport> {
	const sources: Record<string, ExportPreviewSource> = isPreviewSource(source)
		? { "": source }
		: source;
	const names = Object.keys(sources);
	if (names.length === 0) {
		throw new Error(
			"[framefields] exportPreview has no composition to export.",
		);
	}
	for (const name of names) {
		if (name && (!/^[\w-][\w.-]*$/.test(name) || name === STATIC_ENGINE)) {
			throw new Error(
				`[framefields] "${name}" can't name a preview page: use letters, digits, "-", "_" and ".".`,
			);
		}
	}
	const trimmed = (options.basePath ?? "/").replace(/^\/+|\/+$/g, "");
	if (
		trimmed.length > 0 &&
		trimmed
			.split("/")
			.some(
				(part) =>
					!part || part === "." || part === ".." || !/^[\w.~!-]+$/.test(part),
			)
	) {
		throw new Error(
			"[framefields] basePath must be a URL path of unescaped letters, digits, '.', '~', '!', '_' or '-' segments.",
		);
	}
	const base = trimmed ? `/${trimmed}/` : "/";
	const outDir = path.resolve(options.outDir);
	const entries = names.map((name) => entryPath(sources[name].entry));
	const root = path.resolve(options.root ?? repoRoot(path.dirname(entries[0])));
	if (outDir === root || isInside(outDir, root)) {
		throw new Error(
			"[framefields] outDir must not be the project folder or one of its parents.",
		);
	}
	for (const entry of entries) {
		if (!isInside(root, entry) || isInside(outDir, entry)) {
			throw new Error(
				`[framefields] entry ${entry} must be inside root and outside outDir.`,
			);
		}
	}
	const urlOf = (dir: string, file: string, prefix = base) =>
		prefix + path.relative(dir, file).split(path.sep).join("/");

	// The project's files, by the URL path they are served at.
	const published = new Map<string, string>();
	const include =
		options.files === undefined
			? [path.join(root, "assets")].filter((dir) => fs.existsSync(dir))
			: (Array.isArray(options.files) ? options.files : [options.files]).map(
					(f) => path.resolve(root, f),
				);
	for (const item of include) {
		if (item !== root && !isInside(root, item)) {
			throw new Error(
				`[framefields] ${item} is outside the project folder ${root}. Pass root to publish it.`,
			);
		}
		if (!fs.existsSync(item)) {
			throw new Error(`[framefields] ${item} does not exist.`);
		}
		for (const file of await listFiles(item, outDir)) {
			published.set(urlOf(root, file), file);
		}
	}
	// Fonts named by family load from assets/fonts beside the page (see the
	// <base> element), as the preview server serves them from the working
	// directory.
	const fonts = path.join(process.cwd(), "assets", "fonts");
	for (const file of await listFiles(fonts, outDir)) {
		const url = urlOf(fonts, file, `${base}assets/fonts/`);
		if (!published.has(url)) published.set(url, file);
	}
	for (const url of published.keys()) {
		const relative = url.slice(base.length);
		const top = relative.split("/")[0];
		const rootPageFile =
			names.includes("") &&
			(["index.html", "meta.json", "player.js"].includes(top) ||
				/^audio(?:\.|$)/.test(top));
		if (top === STATIC_ENGINE || (names.includes(top) && top) || rootPageFile) {
			throw new Error(
				`[framefields] the project file at ${url} would overlap the export's own ${top}/ folder.`,
			);
		}
	}

	await fs.promises.mkdir(outDir, { recursive: true });
	const engineOut = path.join(outDir, STATIC_ENGINE);
	await fs.promises.rm(engineOut, { recursive: true, force: true });
	await fs.promises.cp(await engineDir(), engineOut, { recursive: true });
	const files: Record<string, number> = {};
	for (const [url, file] of published) {
		const to = path.join(outDir, ...url.slice(base.length).split("/"));
		await fs.promises.mkdir(path.dirname(to), { recursive: true });
		await fs.promises.copyFile(file, to);
		files[url] = (await fs.promises.stat(file)).size;
	}

	const pages: Record<string, string> = Object.create(null);
	for (const [i, name] of names.entries()) {
		const src = sources[name];
		const entry = entries[i];
		const exportName = src.export ?? "default";
		const dir = name ? path.join(outDir, name) : outDir;
		const pageUrl = name ? `${base}${name}/` : base;
		const target = await loadTarget(entry, exportName);
		const title = src.title ?? options.title ?? (name || "framefields preview");
		// The session only lets a live tab notice a newer preview; a static page has
		// none, so a fixed value keeps repeated exports of the same sources identical.
		const meta = await resolveMeta(
			target,
			title,
			`static-${name || "page"}`,
			null,
		);
		await fs.promises.mkdir(dir, { recursive: true });

		let audio: AudioStatus = { state: "none" };
		let audioUrl = "";
		const sound = src.audio ?? options.audio ?? true;
		if (sound === true) {
			const mixed = await mixSoundtrack(target, meta.fps, options.renderer);
			if (mixed.wav) {
				await fs.promises.writeFile(path.join(dir, "audio.wav"), mixed.wav);
				audioUrl = `${pageUrl}audio.wav?v=${digest(mixed.wav)}`;
			}
			audio = mixed.status;
		} else if (sound) {
			const file = path.resolve(root, sound.file);
			const data = await fs.promises.readFile(file);
			const shared = [...published].find(([, f]) => f === file)?.[0];
			if (shared) {
				audioUrl = `${shared.split("/").map(encodeURIComponent).join("/")}?v=${digest(data)}`;
			} else {
				const copy = `audio${path.extname(file).toLowerCase()}`;
				await fs.promises.writeFile(path.join(dir, copy), data);
				audioUrl = `${pageUrl}${encodeURIComponent(copy)}?v=${digest(data)}`;
			}
			audio = {
				state: "ready",
				durationSec: meta.frameCount / meta.fps,
				peaks: sound.peaks ?? [],
			};
		}

		const bundle = await bundleProject({
			entry,
			exportName,
			modelsDir: `${base}framefields-models`,
			ortBase: ORT_WEB_CDN,
			engineUrl: `${base}${STATIC_ENGINE}`,
			fileRoot: { dir: root, url: base },
		});
		const metaJson = JSON.stringify({ ...meta, audio });
		await fs.promises.writeFile(path.join(dir, "player.js"), bundle.code);
		await fs.promises.writeFile(path.join(dir, "meta.json"), metaJson);
		await fs.promises.writeFile(
			path.join(dir, "index.html"),
			previewPage({
				meta: `${pageUrl}meta.json?v=${digest(metaJson)}`,
				audio: audioUrl,
				player: `${pageUrl}player.js?v=${digest(bundle.code)}`,
				live: false,
				base,
				files,
			}),
		);
		pages[name] = pageUrl;
	}
	return { outDir, pages, files: Object.keys(files) };
}

function isPreviewSource(source: object): source is ExportPreviewSource {
	const entry = (source as { entry?: unknown }).entry;
	return typeof entry === "string" || entry instanceof URL;
}

function entryPath(entry: string | URL): string {
	return entry instanceof URL || String(entry).startsWith("file:")
		? fileURLToPath(entry)
		: path.resolve(String(entry));
}

/** A file, or the files in a folder, leaving out hidden ones, node_modules and `skip`. */
async function listFiles(
	item: string,
	skip: string,
	ancestors = new Set<string>(),
): Promise<string[]> {
	if (item === skip || isInside(skip, item)) return [];
	const real = await fs.promises.realpath(item).catch(() => undefined);
	if (!real) return [];
	const realSkip = await fs.promises.realpath(skip).catch(() => skip);
	if (real === realSkip || isInside(realSkip, real)) return [];
	if (ancestors.has(real)) {
		throw new Error(
			`[framefields] circular symbolic link in published files: ${item}`,
		);
	}
	const next = new Set(ancestors).add(real);
	const stat = await fs.promises.stat(item).catch(() => undefined);
	if (stat?.isFile()) return [item];
	if (!stat?.isDirectory() || item === skip) return [];
	const files: string[] = [];
	for (const child of await fs.promises.readdir(item, {
		withFileTypes: true,
	})) {
		if (child.name.startsWith(".") || child.name === "node_modules") continue;
		files.push(...(await listFiles(path.join(item, child.name), skip, next)));
	}
	return files.sort();
}

function digest(data: string | Buffer): string {
	return createHash("sha1").update(data).digest("hex").slice(0, 10);
}

/** The composition's soundtrack, mixed by the export engine, as a WAV file. */
async function mixSoundtrack(
	target: PreviewTarget,
	fps: number,
	renderer?: HeadlessMediaRenderer,
): Promise<{ status: AudioStatus; wav?: Buffer }> {
	if (!target.toVirtualMediaAsync && !target.toVirtualMedia) {
		return { status: { state: "none" } };
	}
	const vm = target.toVirtualMediaAsync
		? await target.toVirtualMediaAsync()
		: (target.toVirtualMedia as () => VirtualMediaData)();
	const { channels, sampleRate } = await (
		renderer ?? new HeadlessMediaRenderer()
	).renderAudio(vm, { fps });
	const left = channels[0] ?? new Float32Array(0);
	const right = channels[1] ?? left;
	const peaks = computePeaks(left, right, PEAK_BINS);
	if (left.length === 0 || Math.max(...peaks) < 0.001) {
		return { status: { state: "none" } };
	}
	return {
		wav: encodeStereoWav([left, right], { sampleRate }),
		status: {
			state: "ready",
			durationSec: left.length / sampleRate,
			peaks: peaks.map((p) => Math.round(p * 1000) / 1000),
		},
	};
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
			`[framefields] ${entry} has no export named "${exportName}" to preview.`,
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

/** Applies one change from the page and says what it was. */
async function changeNote(
	notes: NoteStore,
	body: {
		op?: string;
		id?: number;
		done?: boolean;
		text?: string;
		note?: NewNote;
	},
	fps: number,
	say: (line: string) => void,
) {
	if (body.op === "add" && body.note && String(body.note.text).trim()) {
		const note = await notes.add(body.note);
		const files = [
			note.image && `frame with the spot marked: ${note.image}`,
			`all notes: ${notes.file}`,
		];
		say(`${describeNote(note, fps)}\n  ${files.filter(Boolean).join(" · ")}`);
		return note;
	}
	const id = Number(body.id);
	if (body.op === "update") {
		const note = await notes.update(id, body);
		if (note && typeof body.done === "boolean")
			say(`note ${id} marked ${note.done ? "done" : "open"}`);
		return note;
	}
	if (body.op === "remove") {
		const note = await notes.remove(id);
		if (note) say(`note ${id} deleted`);
		return note;
	}
	return undefined;
}

function errorText(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk: string) => {
			body += chunk;
			if (body.length > limit) {
				reject(new Error("request body too large"));
				req.destroy();
			}
		});
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function isInside(root: string, file: string): boolean {
	const rel = path.relative(root, file);
	return (
		!!rel &&
		rel !== ".." &&
		!rel.startsWith(`..${path.sep}`) &&
		!path.isAbsolute(rel)
	);
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
	notesDir: string | null,
): Promise<PreviewMeta> {
	const fps = target.fps ?? 24;
	const durationMs =
		target.durationMs ?? (await target.computeDuration?.()) ?? 5000;
	return {
		session,
		notesDir,
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
