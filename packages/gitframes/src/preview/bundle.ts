/**
 * The preview page runs the project's composition code and renders it with
 * WebGPU. Two bundles make that work:
 *
 *  - The engine (`buildEngine`): gitframes and its browser player, built once
 *    for the browser. Published packages ship it in `dist/preview-engine`;
 *    running from source, it is built on first use.
 *  - The project (`bundleProject`): only the user's own files, built on each
 *    preview. Its `gitframes` imports point at the engine's files, so the
 *    composition and the player share one engine (signals, clock, caches).
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
export const ENGINE_URL = "/@gitframes/engine";

/** Public entry points a composition may import, and their sources. */
const ENTRIES: Record<string, string> = {
	gitframes: "index.ts",
	"gitframes/effects": "effects/index.ts",
	"gitframes/audio": "audio/index.ts",
	"gitframes/signals": "signals/index.ts",
	"gitframes/fonts": "fonts/index.ts",
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
	"@gitframes/renderer",
	"@gitframes/server-utils",
	"gitframes/renderer",
	"gitframes/preview",
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
 * Builds gitframes for the browser into `outDir`: one module per public entry,
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
				name: "gitframes-engine",
				setup(b) {
					b.onResolve({ filter: /^gitframes-preview:renderers$/ }, () => ({
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
		entryPoints: ["gitframes-preview:entry"],
		write: false,
		metafile: true,
		sourcemap: "inline",
		plugins: [
			{
				name: "gitframes-project",
				setup(b) {
					b.onResolve({ filter: /^gitframes-preview:entry$/ }, () => ({
						path: "entry",
						namespace: "gitframes-preview",
					}));
					b.onLoad({ filter: /.*/, namespace: "gitframes-preview" }, () => ({
						contents: [
							`import { startPlayer } from ${JSON.stringify(`${ENGINE_URL}/player.mjs`)};`,
							`import * as mod from ${JSON.stringify(entry)};`,
							`startPlayer(mod, ${JSON.stringify(options.exportName)}, ${JSON.stringify(settings)});`,
						].join("\n"),
						resolveDir: path.dirname(entry),
						loader: "js",
					}));
					b.onResolve({ filter: /^\/@gitframes\/engine\// }, (args) => ({
						path: args.path,
						external: true,
					}));
					b.onResolve({ filter: /^gitframes(\/|$)/ }, (args) =>
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

let engineBuild: Promise<string> | undefined;

/**
 * The prebuilt engine shipped beside a compiled bundle, if there is one. The
 * bundle lands either at the package's dist root or beside dist/preview,
 * depending on how the bundler splits it, so both are checked.
 */
export function prebuiltEngineDir(here: string): string | undefined {
	return [here, path.join(here, "..")]
		.map((base) => path.join(base, "preview-engine"))
		.find((dir) => fs.existsSync(path.join(dir, "player.mjs")));
}

/**
 * The engine to serve: prebuilt in the package's dist, or, running from
 * source, built once per process (so engine edits show without a rebuild).
 */
export function engineDir(): Promise<string> {
	// From source HERE is src/preview, so this misses and the engine is built.
	const prebuilt = prebuiltEngineDir(HERE);
	if (prebuilt) {
		return Promise.resolve(prebuilt);
	}
	engineBuild ??= (async () => {
		const dir = path.join(
			os.tmpdir(),
			`gitframes-preview-engine-${process.pid}`,
		);
		await buildEngine(dir);
		return dir;
	})();
	engineBuild.catch(() => {
		engineBuild = undefined;
	});
	return engineBuild;
}

/** Where vision models are cached, as `@gitframes/vision` resolves it. */
export function visionModelsDir(): string {
	return process.env.GITFRAMES_MODELS_DIR
		? path.resolve(process.env.GITFRAMES_MODELS_DIR)
		: path.join(os.homedir(), ".cache", "gitframes", "models");
}

const ORT_WEB_VERSION = "1.30.0";

/**
 * onnxruntime-web, for vision effects: the project's own install when it has
 * one (served from disk), otherwise a pinned CDN build. Loaded only when a
 * vision effect runs, so gitframes doesn't ship its WebAssembly.
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
	return spec === "gitframes" ? "gitframes" : spec.slice("gitframes/".length);
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
			return { path: name, namespace: "gitframes-stub" };
		return undefined;
	});
	b.onResolve({ filter: /.*/ }, (args) => {
		const pkg = packageName(args.path);
		if (pkg && (NODE_ONLY.has(pkg) || NODE_ONLY.has(args.path)))
			return { path: args.path, namespace: "gitframes-stub" };
		return undefined;
	});
	b.onLoad({ filter: /.*/, namespace: "gitframes-stub" }, () => ({
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
			contents: `const __gitframesFileUrl = ${JSON.stringify(pathToFileURL(args.path).href)};\n${source.replaceAll(META_URL, "__gitframesFileUrl")}`,
			loader: loaderFor(args.path),
		};
	});
}

/** The generated list of node renderers (needed only to build the engine). */
function builtinRenderersModule(): string {
	const dist = require.resolve("@gitframes/renderer");
	const file = path.join(
		path.dirname(dist),
		"..",
		"src",
		"generated",
		"node-renderers.ts",
	);
	if (!fs.existsSync(file))
		throw new Error(`[gitframes] node renderer list not found at ${file}`);
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
