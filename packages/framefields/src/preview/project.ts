/**
 * The composition module of a project, loaded in Node: for the preview
 * server (size, timing, soundtrack) and the web bundle builder.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { VirtualMediaData } from "@framefields/core";

/** What the server needs from the composition: its size, timing and soundtrack. */
export interface PreviewTarget {
	toVirtualMedia?(): VirtualMediaData;
	toVirtualMediaAsync?(): Promise<VirtualMediaData>;
	computeDuration?(): Promise<number>;
	prepareMediaTime?(): Promise<void>;
	fps?: number;
	durationMs?: number;
	width?: number;
	height?: number;
}

export async function loadTarget(
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
export function repoRoot(dir: string): string {
	let project: string | undefined;
	for (let d = dir; ; d = path.dirname(d)) {
		if (fs.existsSync(path.join(d, ".git"))) return d;
		if (!project && fs.existsSync(path.join(d, "package.json"))) project = d;
		if (path.dirname(d) === d) return project ?? dir;
	}
}
