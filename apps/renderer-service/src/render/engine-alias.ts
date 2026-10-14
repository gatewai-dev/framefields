import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Query parameter that scopes workspace ES modules to one job. */
export const JOB_PARAM = "ff-job";

let roots: string[] = [];
let rootDirs: string[] = [];
let engineParent = "";
let installed = false;

const isEngine = (s: string) =>
	s === "framefields" ||
	s.startsWith("framefields/") ||
	s.startsWith("@framefields/");
const inWorkspace = (url: string) => roots.some((r) => url.startsWith(r));
/** Source files that become ESM even in a package without "type": "module". */
const FORCE_ESM = /\.(ts|tsx|js|jsx)$/;

function jobOf(url: string | undefined): string | undefined {
	if (!url?.includes("?")) return undefined;
	try {
		return new URL(url).searchParams.get(JOB_PARAM) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Installs the engine alias once per process (PLAN.md §7): imports and
 * requires of `framefields` / `@framefields/*` made from inside a workspace
 * resolve as if made by the worker's own framefields (ESM build), so repo
 * code shares the worker's single, already-initialised GPU stack. Workspace
 * ES modules also inherit a per-job query, so a job never reuses modules
 * cached by a previous one. Uses synchronous in-thread hooks, which apply to
 * both `import` and `require()`.
 */
export function installEngineAlias(workspaceRoots: string[]): void {
	if (installed) return;
	installed = true;
	rootDirs = workspaceRoots.map((r) => path.resolve(r) + path.sep);
	roots = rootDirs.map((r) => pathToFileURL(r).href);
	// framefields depends on every @framefields/* package, so resolving from
	// its entry finds them all.
	engineParent = import.meta.resolve("framefields");

	registerHooks({
		resolve(specifier, context, next) {
			const parent = context.parentURL;
			if (isEngine(specifier) && parent && inWorkspace(parent)) {
				try {
					// Always the ESM build, so require() and import share one instance.
					const conditions = (context.conditions ?? []).map((c) =>
						c === "require" ? "import" : c,
					);
					if (!conditions.includes("import")) conditions.push("import");
					return next(specifier, {
						...context,
						conditions,
						parentURL: engineParent,
					});
				} catch {
					// Not part of the engine (e.g. a project-local @framefields/* package).
				}
			}
			const result = next(specifier, context);
			if (!result.url.startsWith("file:") || !inWorkspace(result.url))
				return result;
			let { url, format } = result;
			// Repo code always runs as ESM. In CommonJS mode tsx would transpile
			// framefields' .mjs into a second, CJS copy of the engine.
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
 * Drops CommonJS modules loaded from the workspaces (ES modules are scoped by
 * the job query instead). Called when a job ends.
 */
export function clearWorkspaceRequireCache(): void {
	const cache = createRequire(import.meta.url).cache;
	for (const key of Object.keys(cache)) {
		if (rootDirs.some((r) => key.startsWith(r))) delete cache[key];
	}
}
