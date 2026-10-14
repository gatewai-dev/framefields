import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { RenderError } from "../errors.js";
import { rendererLogger } from "../logger.js";
import {
	describeAdapter,
	type GpuAdapter,
	gpuStatus,
	verifyAdapter,
} from "../worker/gpu.js";
import { workerHealth } from "../worker/health.js";
import { setEngineEntry } from "./engine-alias.js";

/** The parts of a project's `framefields` module the worker uses. */
export interface EngineModule {
	HeadlessMediaRenderer: {
		new (): EngineRenderer;
		initialize(): Promise<void>;
	};
	Composition?: abstract new (...args: never[]) => unknown;
	Media?: abstract new (...args: never[]) => unknown;
	FontManager?: { clear(): void };
	/** Present in framefields versions built for long-lived workers. */
	resetRenderCaches?: () => void;
	/** The adapter the engine renders on (newer framefields versions). */
	describeGpu?: () => Promise<GpuAdapter>;
}

export interface EngineRenderer {
	renderLut(vm: never, frame?: number): Promise<string | Buffer>;
}

export interface BoundEngine {
	version: string;
	/** Real path of the framefields package directory. */
	dir: string;
	entryUrl: string;
	/** Workspace slot the engine was loaded from (kept by the janitor). */
	workspace: string;
	mod: EngineModule;
	/** Engine supports `signal`/`onProgress` and the per-job cache reset. */
	workerHooks: boolean;
}

let bound: BoundEngine | undefined;
/** Workspaces whose node_modules this process has loaded modules from. */
const loadedDeps = new Set<string>();

export function markDepsLoaded(workspace: string): void {
	loadedDeps.add(workspace);
}

/**
 * Dependencies stay cached by path for the life of the process, so a new
 * install in a workspace this process already loaded from can't take effect
 * without a restart.
 */
export function depsLoadedFrom(workspace: string): boolean {
	return loadedDeps.has(workspace);
}

export function boundEngine(): BoundEngine | undefined {
	return bound;
}

/** Finds the framefields the project installed, as seen from its workdir. */
export function locateEngine(workdir: string): {
	version: string;
	dir: string;
	entryUrl: string;
} {
	let entry: string;
	try {
		entry = createRequire(path.join(workdir, "package.json")).resolve(
			"framefields",
		);
	} catch {
		throw new RenderError(
			"ENGINE_NOT_FOUND",
			"The project does not have framefields installed.",
			{
				phase: "install",
				hint: 'Add "framefields" to the package.json dependencies (and commit the lockfile).',
			},
		);
	}
	for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
		const file = path.join(dir, "package.json");
		if (existsSync(file)) {
			const pkg = JSON.parse(readFileSync(file, "utf8")) as {
				name?: string;
				version?: string;
			};
			if (pkg.name === "framefields" && pkg.version) {
				return {
					version: pkg.version,
					dir: realpathSync(dir),
					entryUrl: pathToFileURL(realpathSync(entry)).href,
				};
			}
		}
		if (path.dirname(dir) === dir) {
			throw new RenderError(
				"ENGINE_NOT_FOUND",
				"Found framefields but not its package.json.",
				{ phase: "install" },
			);
		}
	}
}

/**
 * Returns the engine for this job (PLAN.md §7). The first job binds the
 * worker to its project's framefields version: loaded once, GPU initialised
 * once. Later jobs needing the same version share it, even from other repos.
 * A different version can't share the process (one GPU stack per process):
 * the job fails with retryable ENGINE_SWITCH and the worker recycles, so the
 * retry lands on a fresh worker.
 */
export async function bindEngine(
	workdir: string,
	workspace: string,
): Promise<BoundEngine> {
	const found = locateEngine(workdir);
	if (bound) {
		if (bound.version === found.version) return bound;
		workerHealth.requestRecycle(
			`engine switch ${bound.version} → ${found.version}`,
		);
		throw new RenderError(
			"ENGINE_SWITCH",
			`This worker runs framefields ${bound.version}; the project needs ${found.version}.`,
			{
				phase: "render",
				hint: "Retry: the worker restarts and loads the project's version.",
			},
		);
	}

	setEngineEntry(found.entryUrl);
	const mod = (await import(/* @vite-ignore */ found.entryUrl)) as EngineModule;
	if (typeof mod.HeadlessMediaRenderer?.initialize !== "function") {
		throw new RenderError(
			"ENGINE_NOT_FOUND",
			`framefields ${found.version} has no HeadlessMediaRenderer.`,
			{
				phase: "render",
			},
		);
	}
	try {
		await mod.HeadlessMediaRenderer.initialize();
	} catch (err) {
		workerHealth.requestRecycle("GPU initialisation failed");
		throw new RenderError(
			"GPU_UNAVAILABLE",
			err instanceof Error ? err.message : String(err),
			{
				phase: "render",
				cause: err,
			},
		);
	}
	// A GPU machine must not end up rendering on the CPU driver (gpu.ts).
	verifyAdapter(await describeAdapter(mod).catch(() => undefined));
	bound = {
		...found,
		workspace,
		mod,
		workerHooks: typeof mod.resetRenderCaches === "function",
	};
	rendererLogger.info(
		{
			version: found.version,
			workerHooks: bound.workerHooks,
			gpu: gpuStatus(),
		},
		"Bound framefields engine and initialised the GPU",
	);
	return bound;
}

/** Test hook: forget the bound engine. */
export function _resetEngineBinding(): void {
	bound = undefined;
	loadedDeps.clear();
}
