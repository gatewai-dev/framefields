import fs from "node:fs/promises";
import path from "node:path";
import type { Composition } from "framefields";
import {
	buildComposition,
	isFileReference,
	type Project,
	type ResolvedComposition,
	resolveComposition,
} from "framefields/project";
import { type Context, type Engine, fromProjectError } from "./context.js";

export interface Loaded {
	project: Project;
	engine: Engine;
	target: ResolvedComposition;
	composition: Composition;
	/** Frames in the composition (at least 1). */
	frameCount: number;
}

export function resolveTarget(
	project: Project,
	ref?: string,
): ResolvedComposition {
	try {
		return resolveComposition(project, ref);
	} catch (err) {
		throw fromProjectError(err);
	}
}

/** Builds a composition with the project's engine, ready to render. */
export async function loadComposition(
	ctx: Context,
	ref?: string,
): Promise<Loaded> {
	const project = await ctx.project();
	const target = resolveTarget(project, ref);
	const engine = await ctx.engine(project);
	ctx.out.info(`building ${target.id} (${target.entry}#${target.export})`);
	let composition: Composition;
	try {
		composition = await buildComposition(project, ref);
	} catch (err) {
		throw fromProjectError(err);
	}
	const durationMs =
		composition.durationMs ?? (await composition.computeDuration());
	composition.durationMs = durationMs;
	const frameCount = Math.max(
		1,
		Math.round((durationMs / 1000) * composition.fps),
	);
	return { project, engine, target, composition, frameCount };
}

/** True when `ref` names a composition of the project (an id or a file reference). */
export function isCompositionRef(project: Project, ref: string): boolean {
	return isFileReference(ref) || project.compositions.some((c) => c.id === ref);
}

export async function outputDir(
	project: Project,
	...parts: string[]
): Promise<string> {
	const dir = path.join(project.root, project.output, ...parts);
	await fs.mkdir(dir, { recursive: true });
	return dir;
}
