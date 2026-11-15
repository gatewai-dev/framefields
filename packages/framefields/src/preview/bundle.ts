/**
 * The preview page runs the project's composition code and renders it with
 * WebGPU. Two bundles make that work:
 *
 *  - The engine (`buildEngine`): framefields and its browser player, built once
 *    for the browser. Published packages ship it in `dist/preview-engine`;
 *    running from source, it is built on first use.
 *  - The project (`bundleProject`): only the user's own files, built on each
 *    preview. Its `framefields` imports point at the engine's files, so the
 *    composition and the player share one engine (signals, clock, caches).
 *
 * The page around them (`buildPage`) is its own small bundle: the Lit UI in
 * `ui/`, shipped prebuilt in `dist/preview-page`, or built on first use.
 *
 * Node APIs that compositions use at build time are shimmed: `path`, `url`,
 * `os`, `import.meta.url` (each file keeps its own `file://` URL), and `fs`
 * reads, which fetch the file from the preview server. Absolute file paths
 * double as URLs there, so assets referenced by path load unchanged.
 * Node-only packages become stubs that throw when used.
 */
import fs from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { BuildOptions, PluginBuild } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Spelled in two parts so this file survives its own rewrite.
const META_URL = ["import", "meta", "url"].join(".");
const require = createRequire(import.meta.url);

/** URL prefix the server serves the engine's files under. */
export const ENGINE_URL = "/@framefields/engine";

/** URL prefix the server serves the page's script and styles under. */
export const PAGE_URL = "/@framefields/ui";

/** Public entry points a composition may import, and their sources. */
const ENTRIES: Record<string, string> = {
	framefields: "index.ts",
	"framefields/effects": "effects/index.ts",
	"framefields/audio": "audio/index.ts",
	"framefields/signals": "signals/index.ts",
	"framefields/fonts": "fonts/index.ts",
	// Installed components import their toolkit from here (`framefields add`).
	"framefields/components": "components/index.ts",
};

/** Node built-ins with a browser version (shim file names); others are stubbed. */
const SHIMS: Record<string, string> = {
	path: "path",
	"path/posix": "path",
	url: "url",
	os: "os",
	fs: "fs",
	"fs/promises": "fs-promises",
	module: "module",
};

/** Packages that only work in Node; the browser never needs them to draw. */
const NODE_ONLY = new Set([
	"sharp",
	"skia-canvas",
	"node-av",
	"onnxruntime-node",
	"@resvg/resvg-js",
	"@napi-rs/webcodecs",
	"@mediabunny/server",
	"@mediabunny/mp3-encoder",
	"webgpu",
	"pino",
	"pino-pretty",
	"dotenv",
	"esbuild",
	"@framefields/renderer",
	"framefields/renderer",
	"framefields/preview",
]);

// Reported as an ES module so named imports (`import { homedir } from "os"`)
// read through the proxy instead of being copied off it.
const STUB = `
const stub = () => new Proxy(function () {}, {
	get: (_t, k) => (k === "__esModule" ? true : k === Symbol.toPrimitive ? () => "" : stub()),
	apply: () => stub(),
	construct: () => stub(),
});
module.exports = stub();
`;

/**
 * Builds framefields for the browser into `outDir`: one module per public entry,
 * the player and the shims, with shared code split into chunks (node renderers
 * load only when a composition uses them).
 */
export async function buildEngine(outDir: string): Promise<void> {
	const { build } = await import("esbuild");
	const src = path.resolve(HERE, "..");
	const shims = path.join(HERE, "shims");
	const entryPoints: Record<string, string> = {
		player: path.join(HERE, "player.ts"),
	};
	for (const [spec, file] of Object.entries(ENTRIES)) {
		entryPoints[engineName(spec)] = path.join(src, file);
	}
	for (const name of new Set(Object.values(SHIMS))) {
		entryPoints[`shims/${name}`] = path.join(shims, `${name}.ts`);
	}

	await fs.promises.rm(outDir, { recursive: true, force: true });
	await build({
		...BROWSER,
		entryPoints,
		outdir: outDir,
		outExtension: { ".js": ".mjs" },
		splitting: true,
		minify: true,
		conditions: ["development", "browser", "import"],
		define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
		inject: [path.join(shims, "process.ts")],
		plugins: [
			{
				name: "framefields-engine",
				setup(b) {
					b.onResolve({ filter: /^framefields-preview:renderers$/ }, () => ({
						path: builtinRenderersModule(),
					}));
					resolveNode(b, (name) => ({ path: path.join(shims, `${name}.ts`) }));
				},
			},
		],
	});
}

export interface ProjectBundle {
	code: string;
	/** The project's source files, to watch for changes. */
	inputs: string[];
}

/** Bundles the module that builds the composition, and what it imports. */
export async function bundleProject(options: {
	/** Module that exports the composition factory. */
	entry: string;
	/** Name of the export; a function returning a Composition (or one itself). */
	exportName: string;
	/** Where cached vision models are, and where onnxruntime-web loads from. */
	modelsDir: string;
	ortBase: string;
}): Promise<ProjectBundle> {
	const { build } = await import("esbuild");
	const entry = path.resolve(options.entry);
	const fromEngine = (file: string) => ({
		path: `${ENGINE_URL}/${file}.mjs`,
		external: true,
	});
	const settings = { modelsDir: options.modelsDir, ortBase: options.ortBase };

	const result = await build({
		...BROWSER,
		entryPoints: ["framefields-preview:entry"],
		write: false,
		metafile: true,
		sourcemap: "inline",
		plugins: [
			{
				name: "framefields-project",
				setup(b) {
					b.onResolve({ filter: /^framefields-preview:entry$/ }, () => ({
						path: "entry",
						namespace: "framefields-preview",
					}));
					b.onLoad({ filter: /.*/, namespace: "framefields-preview" }, () => ({
						contents: [
							`import { startAudioMixer, startPlayer } from ${JSON.stringify(`${ENGINE_URL}/player.mjs`)};`,
							`import * as mod from ${JSON.stringify(entry)};`,
							// The page loads it as the player; a worker it starts, as the soundtrack's mixer.
							`if (typeof document === "undefined") startAudioMixer(mod, ${JSON.stringify(options.exportName)});`,
							`else startPlayer(mod, ${JSON.stringify(options.exportName)}, ${JSON.stringify(settings)});`,
						].join("\n"),
						resolveDir: path.dirname(entry),
						loader: "js",
					}));
					b.onResolve({ filter: /^\/@framefields\/engine\// }, (args) => ({
						path: args.path,
						external: true,
					}));
					b.onResolve({ filter: /^framefields(\/|$)/ }, (args) =>
						ENTRIES[args.path] ? fromEngine(engineName(args.path)) : undefined,
					);
					resolveNode(b, (name) => fromEngine(`shims/${name}`));
					rewriteMetaUrl(b);
				},
			},
		],
	});

	const inputs = Object.keys(result.metafile?.inputs ?? {})
		.filter((p) => !p.includes(":") && !p.includes("node_modules"))
		.map((p) => path.resolve(p));
	return { code: result.outputFiles[0].text, inputs };
}

/**
 * Builds the preview page into `outDir`: `index.html`, and `main.js` and
 * `main.css` from the UI's sources (Lit included; nothing else of the page
 * reaches a project's code). `dev` keeps it readable, with a source map.
 */
export async function buildPage(
	outDir: string,
	{ dev = false }: { dev?: boolean } = {},
): Promise<void> {
	const { build } = await import("esbuild");
	const ui = path.join(HERE, "ui");
	await fs.promises.rm(outDir, { recursive: true, force: true });
	await build({
		...BROWSER,
		entryPoints: { main: path.join(ui, "main.ts") },
		outdir: outDir,
		minify: !dev,
		sourcemap: dev ? "inline" : false,
		// Lit's production build: its development one warns in the console.
		conditions: ["browser", "import"],
		// Types the page shares with the server are erased; nothing of Node may remain.
		plugins: [
			{
				name: "framefields-page",
				setup(b) {
					b.onResolve({ filter: /^(node:|@framefields\/)/ }, (args) => ({
						errors: [
							{
								text: `the preview page may not import ${args.path} (from ${args.importer})`,
							},
						],
					}));
				},
			},
		],
	});
	await fs.promises.copyFile(
		path.join(ui, "index.html"),
		path.join(outDir, "index.html"),
	);
}

/**
 * A prebuilt folder shipped beside a compiled bundle (`dist/<name>`), if
 * there is one. The bundle lands either at the package's dist root or beside
 * dist/preview, depending on how the bundler splits it, so both are checked.
 */
function prebuiltDir(here: string, name: string, marker: string) {
	return [here, path.join(here, "..")]
		.map((base) => path.join(base, name))
		.find((dir) => fs.existsSync(path.join(dir, marker)));
}

/** The prebuilt engine shipped beside a compiled bundle, if there is one. */
export function prebuiltEngineDir(here: string): string | undefined {
	return prebuiltDir(here, "preview-engine", "player.mjs");
}

const builds = new Map<string, Promise<string>>();

/**
 * `name` prebuilt in the package's dist or, running from source (where HERE
 * is src/preview, so the lookup misses), built once per process into a
 * temporary folder, so edits show without a package build.
 */
function prebuiltOrBuild(
	prebuilt: string | undefined,
	name: string,
	build: (dir: string) => Promise<void>,
): Promise<string> {
	if (prebuilt) return Promise.resolve(prebuilt);
	let pending = builds.get(name);
	if (!pending) {
		const dir = path.join(os.tmpdir(), `framefields-${name}-${process.pid}`);
		pending = build(dir).then(() => dir);
		builds.set(name, pending);
		pending.catch(() => builds.delete(name));
	}
	return pending;
}

/** The browser engine to serve. */
export function engineDir(): Promise<string> {
	return prebuiltOrBuild(
		prebuiltEngineDir(HERE),
		"preview-engine",
		buildEngine,
	);
}

/** The preview page to serve. */
export function pageDir(): Promise<string> {
	return prebuiltOrBuild(
		prebuiltDir(HERE, "preview-page", "main.js"),
		"preview-page",
		(dir) => buildPage(dir, { dev: true }),
	);
}

/** Where vision models are cached, as `@framefields/vision` resolves it. */
export function visionModelsDir(): string {
	return process.env.FRAMEFIELDS_MODELS_DIR
		? path.resolve(process.env.FRAMEFIELDS_MODELS_DIR)
		: path.join(os.homedir(), ".cache", "framefields", "models");
}

const ORT_WEB_VERSION = "1.30.0";

/**
 * onnxruntime-web, for vision effects: the project's own install when it has
 * one (served from disk), otherwise a pinned CDN build. Loaded only when a
 * vision effect runs, so framefields doesn't ship its WebAssembly.
 */
export function onnxRuntimeWeb(fromDir: string): {
	base: string;
	dir?: string;
} {
	for (const from of [fromDir, HERE]) {
		try {
			const main = createRequire(path.join(from, "noop.js")).resolve(
				"onnxruntime-web",
			);
			const dir = path.dirname(main);
			return { base: `/@fs${dir}/`, dir };
		} catch {}
	}
	return {
		base: `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WEB_VERSION}/dist/`,
	};
}

// ── shared ──

const BROWSER: BuildOptions = {
	bundle: true,
	format: "esm",
	platform: "browser",
	target: "es2022",
	mainFields: ["browser", "module", "main"],
	logLevel: "silent",
};

function engineName(spec: string): string {
	return spec === "framefields"
		? "framefields"
		: spec.slice("framefields/".length);
}

/** Node built-ins to shims, the rest of Node to stubs. */
function resolveNode(
	b: PluginBuild,
	shim: (name: string) => { path: string; external?: boolean },
): void {
	b.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, (args) => {
		const name = args.path.replace(/^node:/, "");
		if (SHIMS[name]) return shim(SHIMS[name]);
		if (args.path.startsWith("node:") || isBuiltin(name))
			return { path: name, namespace: "framefields-stub" };
		return undefined;
	});
	b.onResolve({ filter: /.*/ }, (args) => {
		const pkg = packageName(args.path);
		if (pkg && (NODE_ONLY.has(pkg) || NODE_ONLY.has(args.path)))
			return { path: args.path, namespace: "framefields-stub" };
		return undefined;
	});
	b.onLoad({ filter: /.*/, namespace: "framefields-stub" }, () => ({
		contents: STUB,
		loader: "js",
	}));
}

/** Each project file keeps its own URL, as `fileURLToPath(import.meta.url)` expects. */
function rewriteMetaUrl(b: PluginBuild): void {
	b.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
		if (args.path.includes(`${path.sep}node_modules${path.sep}`))
			return undefined;
		const source = await fs.promises.readFile(args.path, "utf8");
		if (!source.includes(META_URL)) return undefined;
		return {
			contents: `const __framefieldsFileUrl = ${JSON.stringify(pathToFileURL(args.path).href)};\n${source.replaceAll(META_URL, "__framefieldsFileUrl")}`,
			loader: loaderFor(args.path),
		};
	});
}

/** The generated list of node renderers (needed only to build the engine). */
function builtinRenderersModule(): string {
	const dist = require.resolve("@framefields/renderer");
	const file = path.join(
		path.dirname(dist),
		"..",
		"src",
		"generated",
		"node-renderers.ts",
	);
	if (!fs.existsSync(file))
		throw new Error(`[framefields] node renderer list not found at ${file}`);
	return file;
}

function packageName(spec: string): string | undefined {
	if (spec.startsWith(".") || spec.startsWith("/")) return undefined;
	const parts = spec.split("/");
	return spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

function loaderFor(file: string): "ts" | "tsx" | "js" | "jsx" {
	if (file.endsWith(".tsx")) return "tsx";
	if (file.endsWith(".jsx")) return "jsx";
	return /\.[cm]?ts$/.test(file) ? "ts" : "js";
}
