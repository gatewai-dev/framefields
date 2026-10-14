import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Query parameter that scopes workspace source modules to one job. */
export const JOB_PARAM = "ff-job";

let roots: string[] = [];
let rootDirs: string[] = [];
let engineEntry: string | undefined;
let installed = false;

const isEngine = (s: string) =>
	s === "framefields" ||
	s.startsWith("framefields/") ||
	s.startsWith("@framefields/");
const inWorkspace = (url: string) => roots.some((r) => url.startsWith(r));
const isDependency = (url: string) => url.includes("/node_modules/");
/** Project source files that load as ESM even without "type": "module". */
const FORCE_ESM = /\.(ts|tsx|js|jsx)$/;

function jobOf(url: string | undefined): string | undefined {
	if (!url?.includes("?")) return undefined;
	try {
		return new URL(url).searchParams.get(JOB_PARAM) ?? undefined;
	} catch {
		return undefined;
	}
}

/** Routes framefields imports to the bound engine (see engine.ts). */
export function setEngineEntry(url: string): void {
	engineEntry = url;
}

/**
 * Installs the loader hooks once per process (PLAN.md §7, §8.1). Uses
 * synchronous in-thread hooks, which apply to both `import` and `require()`.
 *
 * - Once an engine is bound, `framefields` / `@framefields/*` imported from
 *   any workspace resolve from the bound engine's package (always its ESM
 *   build), so every project on the same version shares one GPU stack.
 * - Project source files (outside node_modules) inherit a per-job query, so
 *   a job never reuses source modules cached by a previous one, and load as
 *   ESM: in CommonJS mode tsx would transpile a second copy of the engine.
 * - Dependencies in node_modules load as they are and stay cached by path,
 *   shared with the engine. A dependency change restarts the worker instead
 *   (installer.ts).
 */
export function installEngineAlias(workspaceRoots: string[]): void {
	if (installed) return;
	installed = true;
	rootDirs = workspaceRoots.map((r) => path.resolve(r) + path.sep);
	roots = rootDirs.map((r) => pathToFileURL(r).href);

	registerHooks({
		resolve(specifier, context, next) {
			const parent = context.parentURL;
			if (engineEntry && isEngine(specifier) && parent && inWorkspace(parent)) {
				try {
					const conditions = (context.conditions ?? []).map((c) =>
						c === "require" ? "import" : c,
					);
					if (!conditions.includes("import")) conditions.push("import");
					return next(specifier, {
						...context,
						conditions,
						parentURL: engineEntry,
					});
				} catch {
					// Not part of the engine (e.g. a project-local @framefields/* package).
				}
			}
			const result = next(specifier, context);
			if (
				!result.url.startsWith("file:") ||
				!inWorkspace(result.url) ||
				isDependency(result.url)
			) {
				return result;
			}
			let { url, format } = result;
			if (format === "commonjs" && FORCE_ESM.test(new URL(url).pathname))
				format = "module";
			const job = jobOf(parent);
			if (job && !jobOf(url)) {
				const scoped = new URL(url);
				scoped.searchParams.set(JOB_PARAM, job);
				url = scoped.href;
			}
			return { ...result, url, format };
		},
	});
}

/**
 * Drops CommonJS project sources loaded from the workspaces (ES modules are
 * scoped by the job query instead). Called when a job ends.
 */
export function clearWorkspaceRequireCache(): void {
	const cache = createRequire(import.meta.url).cache;
	for (const key of Object.keys(cache)) {
		if (
			rootDirs.some((r) => key.startsWith(r)) &&
			!key.includes(`${path.sep}node_modules${path.sep}`)
		) {
			delete cache[key];
		}
	}
}
