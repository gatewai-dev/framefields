/**
 * Node arguments to run a CLI worker against the user's project: the
 * project's own tsx loader for a TypeScript entry (TypeScript belongs to the
 * consumer project; init's scaffold has it), and the worker script, from
 * source when the CLI runs from source.
 */
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function projectNodeArgs(
	entry: string,
	worker: "check-worker" | "local-worker",
): string[] | { error: string } {
	const source = import.meta.url.endsWith(".ts");
	const args = source ? ["--conditions=development"] : [];
	if (source || /\.[cm]?tsx?$/.test(entry)) {
		try {
			const require = createRequire(resolve("package.json"));
			args.push("--import", pathToFileURL(require.resolve("tsx")).href);
		} catch {
			return {
				error:
					"Install the project's tsx dev dependency to load a TypeScript entry.",
			};
		}
	}
	args.push(
		fileURLToPath(
			new URL(
				source ? `./${worker}.ts` : `./cli/${worker}.mjs`,
				import.meta.url,
			),
		),
	);
	return args;
}
