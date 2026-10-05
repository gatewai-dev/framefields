/**
 * Bundles a project's composition module, the engine and the browser player
 * into one script, so the page runs the composition code itself and renders
 * with WebGPU. One bundle, so the user's code and the engine share the same
 * signal and clock instances.
 *
 * Node APIs that compositions commonly use at build time are shimmed: `path`,
 * `url`, `import.meta.url` (each file keeps its own `file://` URL), and the
 * synchronous `fs` reads, which fetch the file from the preview server.
 * Absolute file paths double as URLs on that server, so assets referenced by
 * path load unchanged. Node-only packages become stubs that throw when used.
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Plugin } from "esbuild";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Spelled in two parts so this file survives its own rewrite.
const META_URL = ["import", "meta", "url"].join(".");
const require = createRequire(import.meta.url);

/** Packages that only work in Node; the browser never needs them to draw. */
const NODE_ONLY = [
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
	"@gitframes/renderer",
	"esbuild",
	"@gitframes/server-utils",
];

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

const SHIMS: Record<string, string> = {
	path: "path.ts",
	"path/posix": "path.ts",
	url: "url.ts",
	os: "os.ts",
	fs: "fs.ts",
	"fs/promises": "fs-promises.ts",
};

export interface BundleResult {
	code: string;
	/** Source files the bundle was built from, to watch for changes. */
	inputs: string[];
}

export async function bundlePlayer(options: {
	/** Module that exports the composition factory. */
	entry: string;
	/** Name of the export; a function returning a Composition (or one itself). */
	exportName: string;
}): Promise<BundleResult> {
	const { build } = await import("esbuild");
	const entry = path.resolve(options.entry);
	const player = resolveOwn("player");
	const renderers = builtinRenderersModule();
	const shimDir = path.join(path.dirname(player), "shims");
	const vision = visionAssets();

	const plugin: Plugin = {
		name: "gitframes-preview",
		setup(b) {
			b.onResolve({ filter: /^gitframes-preview:entry$/ }, () => ({
				path: "entry",
				namespace: "gitframes-preview",
			}));
			b.onLoad({ filter: /.*/, namespace: "gitframes-preview" }, () => ({
				contents: [
					`import * as mod from ${JSON.stringify(entry)};`,
					`import { startPlayer } from ${JSON.stringify(player)};`,
					`import { BUILTIN_NODE_RENDERERS } from ${JSON.stringify(renderers)};`,
					`startPlayer(mod, ${JSON.stringify(options.exportName)}, {`,
					"	renderers: BUILTIN_NODE_RENDERERS,",
					// Vision nodes run on onnxruntime-web; its .wasm files come from the server.
					"	loadOrt: async () => {",
					'		const ort = await import("onnxruntime-web/webgpu");',
					`		ort.env.wasm.wasmPaths = ${JSON.stringify(`/@fs${vision.ortDir}/`)};`,
					'		ort.env.logLevel = "error";',
					"		return ort;",
					"	},",
					"});",
				].join("\n"),
				resolveDir: path.dirname(entry),
				loader: "ts",
			}));

			// onnxruntime-web is the vision package's (optional) dependency.
			b.onResolve({ filter: /^onnxruntime-web(\/|$)/ }, (args) => {
				if (args.pluginData?.fromVision) return undefined;
				return b.resolve(args.path, {
					kind: args.kind,
					resolveDir: vision.packageDir,
					pluginData: { fromVision: true },
				});
			});

			b.onResolve({ filter: /^(node:)?[a-z_/]+$/ }, (args) => {
				const name = args.path.replace(/^node:/, "");
				if (SHIMS[name]) return { path: resolveShim(shimDir, SHIMS[name]) };
				if (args.path.startsWith("node:") || isBuiltin(name))
					return { path: name, namespace: "gitframes-stub" };
				return undefined;
			});
			b.onResolve({ filter: /.*/ }, (args) => {
				const pkg = packageName(args.path);
				if (pkg && NODE_ONLY.includes(pkg))
					return { path: args.path, namespace: "gitframes-stub" };
				return undefined;
			});
			b.onLoad({ filter: /.*/, namespace: "gitframes-stub" }, () => ({
				contents: STUB,
				loader: "js",
			}));

			// Each file keeps its own URL, as `fileURLToPath(import.meta.url)`
			// expects: the expression becomes a constant declared per file.
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
		},
	};

	const result = await build({
		entryPoints: ["gitframes-preview:entry"],
		bundle: true,
		write: false,
		format: "esm",
		platform: "browser",
		target: "es2022",
		conditions: ["development", "browser", "import"],
		mainFields: ["browser", "module", "main"],
		metafile: true,
		sourcemap: "inline",
		logLevel: "silent",
		define: {
			"process.env.NODE_ENV": '"development"',
			// Cached models load from the server, which serves this folder.
			"process.env.GITFRAMES_MODELS_DIR": JSON.stringify(vision.modelsDir),
			global: "globalThis",
		},
		inject: [resolveShim(shimDir, "process.ts")],
		plugins: [plugin],
	});

	const inputs = Object.keys(result.metafile?.inputs ?? {})
		.filter((p) => !p.includes(":") && !p.includes("node_modules"))
		.map((p) => path.resolve(p));
	return { code: result.outputFiles[0].text, inputs };
}

function resolveOwn(name: string): string {
	// The player is bundled from source: next to this file in development,
	// and from the package's src/ when this runs from dist/.
	for (const dir of [HERE, path.join(HERE, "..", "src", "preview")]) {
		const file = path.join(dir, `${name}.ts`);
		if (fs.existsSync(file)) return file;
	}
	throw new Error(
		`[gitframes] The browser preview needs the gitframes sources (src/preview/${name}.ts), which this install does not include.`,
	);
}

/**
 * Where vision models are cached (as `@gitframes/vision` resolves it), and the
 * onnxruntime-web build that runs them in the browser.
 */
export function visionAssets(): {
	modelsDir: string;
	packageDir: string;
	ortDir: string;
} {
	const modelsDir = process.env.GITFRAMES_MODELS_DIR
		? path.resolve(process.env.GITFRAMES_MODELS_DIR)
		: path.join(os.homedir(), ".cache", "gitframes", "models");
	const packageDir = path.dirname(
		path.dirname(require.resolve("@gitframes/vision")),
	);
	let ortDir = "";
	try {
		ortDir = path.dirname(
			createRequire(path.join(packageDir, "package.json")).resolve(
				"onnxruntime-web",
			),
		);
	} catch {}
	return { modelsDir, packageDir, ortDir };
}

/** The generated list of node renderers, imported by package name. */
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

function resolveShim(dir: string, file: string): string {
	const ts = path.join(dir, file);
	if (fs.existsSync(ts)) return ts;
	return ts.replace(/\.ts$/, ".mjs");
}

function isBuiltin(name: string): boolean {
	try {
		return require("node:module").isBuiltin(name);
	} catch {
		return false;
	}
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
