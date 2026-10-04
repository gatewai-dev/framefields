import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	audioRegistry,
	type NodeRendererPlugin,
	registerWebGPURenderer,
} from "@gitframes/node-sdk";
import { rendererLogger } from "@gitframes/server-utils";
import { BUILTIN_NODE_RENDERERS } from "./generated/node-renderers.js";
import {
	loadNodeManifests,
	type NodeManifest,
	type NodeRendererExports,
} from "./node-manifest.js";

let __filename = "";
let __dirname = "";

if (typeof process !== "undefined" && !!process.versions?.node) {
	__filename = fileURLToPath(import.meta.url);
	__dirname = path.dirname(__filename);
}

/** Locates the workspace `nodes/` directory by climbing up from this file. */
export function findNodesDir(startDir: string = __dirname): string | null {
	let nodesDir = path.resolve(startDir, "../../../nodes");
	let currentDir = startDir;

	while (true) {
		if (fs.existsSync(nodesDir)) {
			const hasValidNode = fs
				.readdirSync(nodesDir)
				.some(
					(d) =>
						d.startsWith("node-") &&
						fs.existsSync(path.join(nodesDir, d, "package.json")),
				);
			if (hasValidNode) return nodesDir;
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
		nodesDir = path.resolve(currentDir, "nodes");
	}
}

/**
 * Picks the renderer entry file: development source in dev/vitest, otherwise
 * the bundled dist, falling back to source when dist has not been built.
 */
function resolveRendererEntry(
	nodePath: string,
	rendererExports: NodeRendererExports,
): string | undefined {
	const exists = (rel: string | undefined): rel is string =>
		!!rel && fs.existsSync(path.join(nodePath, rel));

	const isDev =
		process.env.NODE_ENV !== "production" || Boolean(process.env.VITEST);

	if (isDev && exists(rendererExports.development)) {
		return rendererExports.development;
	}
	const bundled = rendererExports.import || rendererExports.default;
	if (exists(bundled)) return bundled;
	if (exists(rendererExports.development)) return rendererExports.development;
	return undefined;
}

async function registerNode(manifest: NodeManifest): Promise<void> {
	if (!manifest.rendererExports) return;
	const entry = resolveRendererEntry(manifest.path, manifest.rendererExports);
	if (!entry) return;

	const mod = await import(pathToFileURL(path.join(manifest.path, entry)).href);
	// The op comes from package.json only (`gitframes.type` + `gitframes.aliases`).
	registerPlugin([manifest.type, ...manifest.aliases], mod?.default);
}

function registerPlugin(
	ops: readonly string[],
	rendererPlugin: NodeRendererPlugin | undefined,
): void {
	if (!rendererPlugin) return;
	if (rendererPlugin.WebGPURenderer) {
		for (const op of ops) {
			registerWebGPURenderer(op, rendererPlugin.WebGPURenderer);
		}
	}
	if (rendererPlugin.audioProcessor) {
		for (const op of ops) {
			audioRegistry.register(op, rendererPlugin.audioProcessor);
		}
	}
}

/**
 * Registers the renderers bundled with this package. They are imported by
 * package name, so they resolve from `node_modules` (or the published bundle)
 * and never depend on a `nodes/` directory on disk.
 */
async function registerBuiltinNodeRenderers(): Promise<void> {
	const failed: string[] = [];
	await Promise.all(
		BUILTIN_NODE_RENDERERS.map(async ({ packageName, ops, load }) => {
			try {
				registerPlugin(ops, (await load()).default);
			} catch (err) {
				failed.push(packageName);
				console.error(
					`[HeadlessWebGPURenderer] Failed to load renderer ${packageName}:`,
					err,
				);
			}
		}),
	);
	if (failed.length === BUILTIN_NODE_RENDERERS.length) {
		// Every op would fall through to an empty frame. Fail loudly instead.
		throw new Error(
			"[HeadlessWebGPURenderer] No built-in node renderers could be loaded.",
		);
	}
}

/**
 * Registers the built-in node renderers, then any extra nodes found in the
 * directory named by `GITFRAMES_NODES_DIR` (local node development). A node in
 * that directory overrides the built-in renderer for the same op.
 */
export async function discoverAndRegisterNodeRenderers(): Promise<void> {
	if (typeof process === "undefined" || !process.versions?.node) {
		return;
	}

	await registerBuiltinNodeRenderers();

	const extraDir = process.env.GITFRAMES_NODES_DIR;
	if (!extraDir) return;

	const nodesDir = path.resolve(extraDir);
	if (!fs.existsSync(nodesDir)) {
		console.warn(
			`[HeadlessWebGPURenderer] GITFRAMES_NODES_DIR does not exist: ${nodesDir}`,
		);
		return;
	}

	rendererLogger.debug(
		`[HeadlessWebGPURenderer] Discovering node renderers in: ${nodesDir}`,
	);

	// Throws when any node lacks a valid `gitframes` block or two nodes claim
	// the same op. A misdeclared op must fail loudly rather than render nothing.
	const manifests = loadNodeManifests(nodesDir);

	for (const manifest of manifests) {
		if (!manifest.enabled) continue;
		try {
			await registerNode(manifest);
		} catch (err) {
			console.error(
				`[HeadlessWebGPURenderer] Failed to discover renderer for node ${manifest.dir}:`,
				err,
			);
		}
	}
}
