import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { audioRegistry, registerWebGPURenderer } from "@gitframes/node-sdk";
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
	const rendererPlugin = mod?.default;
	if (!rendererPlugin) return;

	// The op comes from package.json only (`gitframes.type` + `gitframes.aliases`).
	const ops = [manifest.type, ...manifest.aliases];
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

export async function discoverAndRegisterNodeRenderers(): Promise<void> {
	if (typeof process === "undefined" || !process.versions?.node) {
		return;
	}

	const nodesDir = findNodesDir();
	if (!nodesDir) {
		console.warn(
			"[HeadlessWebGPURenderer] Nodes directory not found or invalid.",
		);
		return;
	}

	console.log(
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
