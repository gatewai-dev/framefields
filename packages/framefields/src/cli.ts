#!/usr/bin/env node
/**
 * The `framefields` command.
 *
 *   npx framefields add <name...>   copy components into this project
 *   npx framefields list            the components you can add
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { parseArgs } from "node:util";
import { add } from "./cli/add.js";
import { openRegistry } from "./cli/registry.js";

const HELP = `Usage: framefields <command> [options]

Commands:
  add <name...>   Copy components' source into this project (and the
                  components they build on). The code is yours to edit.
  list            List the components you can add.

Options for add:
  --all             Add every component.
  --dir <path>      Components directory (default: from framefields.json,
                    else src/components or components). Saved the first time.
  --overwrite       Replace files you have changed.

Options for both:
  --registry <src>  A registry folder or http(s) URL instead of the one
                    shipped with this version of framefields.
  -h, --help        Show this help.

Example:
  npx framefields add mouse-pointer focus-zoom
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			all: { type: "boolean" },
			dir: { type: "string" },
			overwrite: { type: "boolean" },
			registry: { type: "string" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, ...names] = positionals;
	if (values.help || !command) {
		process.stdout.write(HELP);
		return command || values.help ? 0 : 1;
	}
	const cwd = process.cwd();
	const registry = openRegistry(values.registry, cwd);

	if (command === "list") {
		const index = await registry.index();
		const width = Math.max(...index.map((e) => e.name.length));
		for (const e of index)
			process.stdout.write(`${e.name.padEnd(width)}  ${e.summary}\n`);
		return 0;
	}
	if (command !== "add") {
		process.stderr.write(`Unknown command "${command}".\n\n${HELP}`);
		return 1;
	}

	const wanted = values.all
		? (await registry.index()).map((e) => e.name)
		: names;
	if (wanted.length === 0) {
		process.stderr.write(
			"Name the components to add, e.g. `framefields add mouse-pointer`.\nRun `framefields list` to see them all.\n",
		);
		return 1;
	}
	const report = await add(wanted, {
		cwd,
		registry,
		dir: values.dir,
		overwrite: values.overwrite,
	});
	const log = (line: string) => process.stdout.write(`${line}\n`);
	for (const f of report.written) log(`  wrote      ${f}`);
	for (const f of report.unchanged) log(`  unchanged  ${f}`);
	for (const f of report.skipped)
		log(`  skipped    ${f} (yours differs; --overwrite replaces it)`);
	if (report.configWritten) log("  wrote      framefields.json");
	const extra = report.components.filter((c) => !wanted.includes(c.name));
	if (extra.length > 0)
		log(`\nWith what they build on: ${extra.map((c) => c.name).join(", ")}.`);
	warnIfMissingFramefields(cwd, log);
	const first = report.components.find((c) => wanted.includes(c.name));
	if (first)
		log(
			`\nimport { ${first.title} } from "./${first.name}/index.js"; // from ${relative(cwd, report.dir) || "."}`,
		);
	return 0;
}

/** Installed components import `framefields`; say so if the project lacks it. */
function warnIfMissingFramefields(cwd: string, log: (s: string) => void) {
	try {
		const pkg = JSON.parse(readFileSync(`${cwd}/package.json`, "utf8")) as {
			dependencies?: Record<string, string>;
			devDependencies?: Record<string, string>;
		};
		if (!pkg.dependencies?.framefields && !pkg.devDependencies?.framefields)
			log(
				"\nThese components import `framefields`: add it with `npm i framefields`.",
			);
	} catch {
		// No package.json: nothing to check.
	}
}

main(process.argv.slice(2)).then(
	(code) => process.exit(code),
	(error: unknown) => {
		process.stderr.write(
			`framefields: ${error instanceof Error ? error.message : String(error)}\n`,
		);
		process.exit(1);
	},
);
