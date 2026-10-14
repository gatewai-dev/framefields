/**
 * Runs the entry loader in a real Node process (vitest's VM can't do native
 * dynamic imports through loader hooks). Usage:
 *   tsx test/load-harness.ts <workspace> <entry> <jobToken> [export]
 * Prints one JSON line describing the outcome.
 */
import * as worker from "framefields";
import { RenderError } from "../src/errors.js";
import { installEngineAlias } from "../src/render/engine-alias.js";
import { buildPlan, importEntry } from "../src/render/load.js";
import { openSandbox } from "../src/render/sandbox.js";

const [ws, entry, token, exportName] = process.argv.slice(2);
installEngineAlias([ws]);

const report = (value: unknown) => {
	process.stdout.write(`${JSON.stringify(value)}\n`);
};

const sandbox = openSandbox({ cwd: ws, argv1: entry, env: {} });
try {
	const { mod, dispose } = await importEntry(ws, entry, token);
	const out: Record<string, unknown> = {
		ok: true,
		exports: Object.keys(mod).sort(),
		v: mod.v,
		sameComposition:
			mod.Ctor === undefined ? undefined : mod.Ctor === worker.Composition,
	};
	if (exportName) {
		const plan = await buildPlan(mod, exportName, undefined, undefined);
		out.plan = plan.map((o) => ({
			name: o.name,
			isWorkerComposition: o.target instanceof worker.Composition,
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
