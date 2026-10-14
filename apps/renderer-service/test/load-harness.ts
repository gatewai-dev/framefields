/**
 * Runs the entry loader in a real Node process (vitest's VM can't do native
 * dynamic imports through loader hooks). Usage:
 *   tsx test/load-harness.ts <workspacesRoot> <workdir> <entry> <jobToken> [export] [bindFrom]
 * With bindFrom, the engine installed in that directory is bound first (as
 * the first job on a worker would, minus GPU init). Prints one JSON line.
 */
import path from "node:path";
import { RenderError } from "../src/errors.js";
import { locateEngine } from "../src/render/engine.js";
import {
	installEngineAlias,
	setEngineEntry,
} from "../src/render/engine-alias.js";
import { buildPlan, importEntry } from "../src/render/load.js";
import { openSandbox } from "../src/render/sandbox.js";

const [root, workdir, entry, token, exportName, bindFrom] =
	process.argv.slice(2);
installEngineAlias([root]);

const report = (value: unknown) => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};

let engine: { Composition?: unknown } | undefined;
if (bindFrom) {
	const found = locateEngine(bindFrom);
	setEngineEntry(found.entryUrl);
	engine = (await import(found.entryUrl)) as { Composition?: unknown };
}

const dir = path.join(root, workdir);
const sandbox = openSandbox({ cwd: dir, argv1: entry, env: {} });
try {
	const { mod, dispose } = await importEntry(dir, entry, token);
	const out: Record<string, unknown> = {
		ok: true,
		exports: Object.keys(mod).sort(),
		v: mod.v,
		sameComposition:
			mod.Ctor === undefined || !engine
				? undefined
				: mod.Ctor === engine.Composition,
	};
	if (exportName) {
		const plan = await buildPlan(mod, exportName, undefined, undefined);
		out.plan = plan.map((o) => ({
			name: o.name,
			isEngineComposition: engine
				? o.target instanceof (engine.Composition as new () => unknown)
				: undefined,
		}));
	}
	await dispose();
	report(out);
} catch (err) {
	report({
		ok: false,
		code: err instanceof RenderError ? err.code : undefined,
		message: err instanceof Error ? err.message : String(err),
	});
} finally {
	sandbox.restore();
}
