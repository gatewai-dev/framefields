#!/usr/bin/env node
/**
 * The `framefields` command.
 *
 *   npx framefields init [dir]           start a project (or add framefields to one)
 *   npx framefields add <name...>        copy components into this project
 *   npx framefields list                 the components you can add
 *   npx framefields fonts add <role...>  install fonts (emoji)
 *   npx framefields fonts list           the fonts you can install
 */
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type AddReport, add } from "./cli/add.js";
import { runCheck } from "./cli/check.js";
import { readConfig } from "./cli/config.js";
import {
	FONTS,
	type FontSpec,
	installFont,
	lfsHint,
	writeFontsModule,
} from "./cli/fonts.js";
import {
	type InitReport,
	init,
	ownVersion,
	PACKAGE_MANAGERS,
	type PackageManager,
	shownPath,
} from "./cli/init.js";
import { openRegistry } from "./cli/registry.js";
import { AI_DASHBOARD } from "./cli/templates.js";

const HELP = `Usage: framefields <command> [options]

Commands:
  api             JSON reference generated from timing, grid and check types.
  check <entry>   Build, validate and lint a composition; --render also writes a
                  representative frame and grid. --export defaults to buildFilm.
  init [dir]      Start a framefields project in dir (default: here), or add
                  framefields to the project there: package.json, tsconfig,
                  src/theme.ts, film.ts, render.ts, assets/, .gitignore,
                  LFS .gitattributes, and the themes' fonts. Never
                  overwrites; existing files only gain what they lack.
  add <name...>   Copy components' source into this project (and the
                  components they build on). The code is yours to edit.
  list            List the components you can add.
  fonts add <role...>
                  Install fonts (pinned, hash-checked, with their license)
                  and register them in the generated <components>/fonts.ts.
  fonts list      List the fonts you can install.

Options for check:
  --export <name>   Composition or builder export (default buildFilm).
  --render          Also verify the GPU and render a small frame/grid.
  --output <dir>    Inspection artifacts (default output/check).
  --timeout <ms>    Worker timeout in milliseconds (default 60000).
  --warnings-as-errors  Fail on lint warnings.
  --json            Machine-readable check, component list, or font list result.

Options for init:
  --name <name>     Package name (default: the folder's name).
  --pm <manager>    npm, pnpm, yarn or bun (default: the one running this).
  --install         Install dependencies afterwards.
  --emoji           Also install the color emoji font.
  --no-fonts        Skip Inter and JetBrains Mono.
  --no-git          Don't run \`git init\`.

Options for add:
  --all             Add every component.
  --dir <path>      Components directory (default: from framefields.json,
                    else src/components or components). Saved the first time.
  --overwrite       Replace files you have changed.
  --no-fonts        Don't install the fonts components ask for (emoji).

Options for add and fonts add:
  --fonts-dir <path>  Where downloaded fonts go (default assets/fonts).

Options for add and list:
  --registry <src>  A registry folder or http(s) URL instead of the one
                    shipped with this version of framefields.
  -h, --help        Show this help.

Examples:
  npx framefields init my-film --install
  npx framefields add mouse-pointer focus-zoom
  npx framefields fonts add emoji
`;

async function main(argv: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args: argv,
		allowPositionals: true,
		options: {
			all: { type: "boolean" },
			dir: { type: "string" },
			overwrite: { type: "boolean" },
			"no-fonts": { type: "boolean" },
			"fonts-dir": { type: "string" },
			name: { type: "string" },
			pm: { type: "string" },
			install: { type: "boolean" },
			emoji: { type: "boolean" },
			"no-git": { type: "boolean" },
			registry: { type: "string" },
			json: { type: "boolean" },
			export: { type: "string" },
			render: { type: "boolean" },
			output: { type: "string" },
			timeout: { type: "string" },
			"warnings-as-errors": { type: "boolean" },
			help: { type: "boolean", short: "h" },
		},
	});
	const [command, ...names] = positionals;
	if (values.help || !command) {
		process.stdout.write(HELP);
		return command || values.help ? 0 : 1;
	}
	const cwd = process.cwd();
	const log = (line: string) => process.stdout.write(`${line}\n`);
	if (command === "api") {
		const catalog = JSON.parse(
			readFileSync(
				fileURLToPath(
					new URL(
						import.meta.url.endsWith(".ts") ? "../dist/api.json" : "./api.json",
						import.meta.url,
					),
				),
				"utf8",
			),
		) as object;
		log(JSON.stringify({ ...catalog, sdkVersion: ownVersion() }));
		return 0;
	}
	if (command === "check") {
		if (names.length !== 1) {
			process.stderr.write(
				"Usage: framefields check <entry> [--export buildFilm] [--render] [--json]\n",
			);
			return 2;
		}
		const report = await runCheck({
			entry: names[0],
			exportName: values.export,
			render: values.render,
			outputDir: values.output,
			timeoutMs:
				values.timeout === undefined ? undefined : Number(values.timeout),
			warningsAsErrors: values["warnings-as-errors"],
		});
		if (values.json) log(JSON.stringify(report));
		else {
			log(`Check ${report.status}: ${report.entry} (${report.exportName})`);
			for (const d of report.diagnostics)
				log(
					`${d.severity} ${d.code}${d.path ? ` at ${d.path}` : ""}: ${d.message}`,
				);
			for (const file of report.artifacts) log(`Wrote ${file}`);
		}
		return report.status === "passed" ? 0 : 1;
	}
	if (command === "fonts") return fonts(names, cwd, values, log);
	if (command === "init") {
		if (names.length > 1) {
			process.stderr.write(
				"init takes one folder: `framefields init my-film`.\n",
			);
			return 1;
		}
		if (values.pm && !PACKAGE_MANAGERS.includes(values.pm as PackageManager)) {
			process.stderr.write(
				`--pm must be one of ${PACKAGE_MANAGERS.join(", ")}.\n`,
			);
			return 1;
		}
		const report = await init({
			cwd,
			dir: names[0],
			name: values.name,
			packageManager: values.pm as PackageManager | undefined,
			userAgent: process.env.npm_config_user_agent,
			fonts: !values["no-fonts"],
			emoji: values.emoji,
			git: !values["no-git"],
			install: values.install,
			onDownload,
		});
		logInit(report, cwd, log);
		return 0;
	}
	const registry = openRegistry(values.registry, cwd);

	if (command === "list") {
		const index = await registry.index();
		if (values.json) {
			log(
				JSON.stringify({
					schemaVersion: 1,
					sdkVersion: ownVersion(),
					components: await Promise.all(
						index.map(async (entry) => {
							const { files: _files, ...item } = await registry.item(
								entry.name,
							);
							return item;
						}),
					),
				}),
			);
			return 0;
		}
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
		fonts: !values["no-fonts"],
		fontsDir: values["fonts-dir"],
		onDownload,
	});
	for (const f of report.written) log(`  wrote      ${f}`);
	for (const f of report.unchanged) log(`  unchanged  ${f}`);
	for (const f of report.skipped)
		log(`  skipped    ${f} (yours differs; --overwrite replaces it)`);
	if (report.configWritten) log("  wrote      framefields.json");
	logFonts(report, cwd, log);
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

const onDownload = (spec: FontSpec) =>
	process.stdout.write(
		`  fetching   ${spec.file} (${(spec.font.bytes / 1e6).toFixed(1)} MB, ${spec.license.id})\n`,
	);

/** What `add` did about fonts, and how to use them. */
function logFonts(report: AddReport, cwd: string, log: (s: string) => void) {
	for (const f of report.fonts)
		log(
			`  ${f.status === "installed" ? "font      " : "font ok   "} ${f.path} (${f.role}, for ${f.by}: ${f.why})`,
		);
	for (const f of report.fontsSkipped)
		log(
			`  no font    ${f.role} for ${f.by} (--no-fonts): ${f.why} Install later with \`framefields fonts add ${f.role}\`.`,
		);
	if (report.fontsModule) logFontsModule(report.fontsModule, log);
	const installed = report.fonts.find((f) => f.status === "installed");
	const hint = installed && lfsHint(cwd, installed.path);
	if (hint) log(`\n${hint}`);
	if (report.fonts.some((f) => f.status !== "configured") && report.fontsModule)
		log(
			`\nRegister them once before rendering: \`await registerFonts()\` from ${report.fontsModule.path.replace(/\.ts$/, ".js")}.`,
		);
}

function logFontsModule(
	m: NonNullable<AddReport["fontsModule"]>,
	log: (s: string) => void,
) {
	if (m.status === "written") log(`  wrote      ${m.path}`);
	else if (m.status === "unchanged") log(`  unchanged  ${m.path}`);
	else
		log(
			`  skipped    ${m.path} (not generated by framefields). Register the fonts yourself:\n${m.calls.map((c) => `    ${c}`).join("\n")}`,
		);
}

/** `framefields fonts add <role...>` and `framefields fonts list`. */
async function fonts(
	[sub, ...roles]: string[],
	cwd: string,
	values: {
		overwrite?: boolean;
		"fonts-dir"?: string;
		dir?: string;
		json?: boolean;
	},
	log: (s: string) => void,
): Promise<number> {
	if (sub === "list") {
		const { config } = readConfig(cwd);
		if (values.json) {
			log(
				JSON.stringify({
					schemaVersion: 1,
					sdkVersion: ownVersion(),
					fonts: Object.entries(FONTS).map(([role, spec]) => ({
						role,
						...spec,
						configuredPath: config.fonts?.[role],
					})),
				}),
			);
			return 0;
		}
		for (const [role, spec] of Object.entries(FONTS))
			log(
				`${role.padEnd(6)}  ${spec.label}${config.fonts?.[role] ? `  (installed: ${config.fonts[role]})` : ""}`,
			);
		return 0;
	}
	if (sub !== "add" || roles.length === 0) {
		process.stderr.write(
			`Usage: framefields fonts add <role...>   (roles: ${Object.keys(FONTS).join(", ")})\n       framefields fonts list\n`,
		);
		return 1;
	}
	const unknown = roles.filter((r) => !FONTS[r]);
	if (unknown.length > 0) {
		process.stderr.write(
			`Unknown font ${unknown.map((r) => `"${r}"`).join(", ")}. Fonts framefields can install: ${Object.keys(FONTS).join(", ")}.\n`,
		);
		return 1;
	}
	const { config, saved } = readConfig(cwd);
	const installs = [];
	for (const role of roles)
		installs.push(
			await installFont(role, {
				cwd,
				dir: values["fonts-dir"],
				overwrite: values.overwrite,
				onDownload,
			}),
		);
	for (const f of installs)
		log(
			`  ${f.status === "installed" ? "font      " : "font ok   "} ${f.path} (${f.role})`,
		);
	if (!saved) log("  wrote      framefields.json");
	const module = writeFontsModule(
		cwd,
		resolve(cwd, values.dir ?? config.components),
	);
	logFontsModule(module, log);
	const installed = installs.find((f) => f.status === "installed");
	const hint = installed && lfsHint(cwd, installed.path);
	if (hint) log(`\n${hint}`);
	log(
		`\nRegister them once before rendering: \`await registerFonts()\` from ${module.path.replace(/\.ts$/, ".js")}.`,
	);
	return 0;
}

function logInit(report: InitReport, cwd: string, log: (s: string) => void) {
	const at = shownPath(cwd, report.root);
	for (const f of report.written) log(`  wrote      ${f}`);
	for (const f of report.merged)
		log(`  merged     ${f} (added what it lacked)`);
	for (const f of report.unchanged) log(`  unchanged  ${f}`);
	for (const f of report.fonts)
		log(
			`  ${f.status === "installed" ? "font      " : "font ok   "} ${f.path} (${f.role})`,
		);
	logFontsModule(report.fontsModule, log);
	if (report.git === "initialized")
		log("  git        initialized a repository");
	if (report.git === "unavailable")
		log("  git        not found: skipped `git init`");
	if (report.lfs === false)
		log(
			"\nGit LFS isn't installed. Footage and fonts are tracked with it: install it (https://git-lfs.com), then run `git lfs install` once.",
		);
	else if (report.lfs)
		log("\nRun `git lfs install` once on this machine if you haven't yet.");
	const steps = [
		...(at === "." ? [] : [`cd ${/\s/.test(at) ? JSON.stringify(at) : at}`]),
		...(report.installed ? [] : [`${report.packageManager} install`]),
		`${report.runScript("frames")} -- 0 30 60`,
	];
	log(
		`\n${report.name} is ready. Next:\n${steps.map((s) => `  ${s}`).join("\n")}`,
	);
	log(
		"\nThen edit src/film.ts, and run `npx framefields list` for ready-made components.",
	);
	log(
		`\nOptional: to generate images, video, music, voice and 3D with the framefields AI gateway, get a key at ${AI_DASHBOARD} and put it in .env as FRAMEFIELDS_API_KEY (see .env.example).`,
	);
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
