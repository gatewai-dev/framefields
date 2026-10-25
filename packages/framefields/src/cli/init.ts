/**
 * `framefields init [dir]`: a new framefields project, or framefields added
 * to an existing one. Writes the layout the setup skill describes
 * (`package.json` with the install-script approvals framefields needs,
 * `tsconfig.json`, `src/theme.ts` / `film.ts` / `render.ts`, `assets/`,
 * LFS `.gitattributes`, `.gitignore`), installs the themes' fonts and keeps
 * them registered in `src/components/fonts.ts`.
 *
 * It never overwrites: files that exist are left alone, and `package.json`,
 * `.gitignore` and `.gitattributes` gain only what they're missing.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readConfig, writeConfig } from "./config.js";
import {
	type Fetch,
	type FontInstall,
	type FontSpec,
	type FontsModule,
	installFont,
	writeFontsModule,
} from "./fonts.js";
import {
	ENV_EXAMPLE,
	FILM_TS,
	GITATTRIBUTES,
	GITIGNORE,
	packageFields,
	RENDER_TS,
	readme,
	THEME_TS,
	TSCONFIG,
} from "./templates.js";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** Runs a command; resolves with its exit code (127 when it can't start). */
export type Runner = (
	command: string,
	args: string[],
	options: { cwd: string; quiet?: boolean },
) => Promise<number>;

export interface InitOptions {
	/** Where the command runs. */
	cwd: string;
	/** The project folder, relative to `cwd`. Default `.`. */
	dir?: string;
	/** Package name. Default: the folder's name, made npm-safe. */
	name?: string;
	/** Default: the one running the command (`npm_config_user_agent`), else npm. */
	packageManager?: PackageManager;
	/** `npm_config_user_agent`, for detecting the package manager and its version. */
	userAgent?: string;
	/** Install the themes' fonts, Inter and JetBrains Mono (default true). */
	fonts?: boolean;
	/** Also install the color emoji font. */
	emoji?: boolean;
	/** `git init` when the folder isn't in a repository yet (default true). */
	git?: boolean;
	/** Run the package manager's install afterwards (default false). */
	install?: boolean;
	/** framefields version for `dependencies`. Default: this package's. */
	framefieldsVersion?: string;
	/** For tests. */
	run?: Runner;
	fetch?: Fetch;
	fontCatalog?: Record<string, FontSpec>;
	onDownload?: (spec: FontSpec) => void;
}

export interface InitReport {
	/** The project folder (absolute). */
	root: string;
	name: string;
	packageManager: PackageManager;
	/** Paths relative to `root`. */
	written: string[];
	/** Existing files that gained missing entries. */
	merged: string[];
	/** Existing files left as they were. */
	unchanged: string[];
	fonts: FontInstall[];
	fontsModule: FontsModule;
	git: "initialized" | "existing" | "skipped" | "unavailable";
	/** Whether `git lfs` is available (null when Git was skipped). */
	lfs: boolean | null;
	installed: boolean;
	/** `npm run frames` / `pnpm frames` …, for next-step messages. */
	runScript(script: string): string;
}

/** The package manager in `npm_config_user_agent` (`pnpm/10.13.1 npm/? node/v22 …`). */
export function detectPackageManager(
	userAgent: string | undefined,
): { name: PackageManager; version?: string } | null {
	const m = userAgent?.match(/^(npm|pnpm|yarn|bun)\/(\d[\w.+-]*)/);
	if (!m) return null;
	return { name: m[1] as PackageManager, version: m[2] };
}

const runScriptFor = (pm: PackageManager) => (script: string) =>
	pm === "npm" || pm === "bun" ? `${pm} run ${script}` : `${pm} ${script}`;

/** `My Film!` → `my-film`. */
export function packageName(folder: string): string {
	const name = folder
		.toLowerCase()
		.replace(/[^a-z0-9._~-]+/g, "-")
		.replace(/^[-._]+|[-._]+$/g, "");
	return name || "framefields-film";
}

export async function init(options: InitOptions): Promise<InitReport> {
	const root = resolve(options.cwd, options.dir ?? ".");
	mkdirSync(root, { recursive: true });
	const detected = detectPackageManager(options.userAgent);
	const pm = options.packageManager ?? detected?.name ?? "npm";
	const pmVersion = detected?.name === pm ? detected.version : undefined;
	const run = options.run ?? spawnRunner;
	const report: InitReport = {
		root,
		name: "",
		packageManager: pm,
		written: [],
		merged: [],
		unchanged: [],
		fonts: [],
		fontsModule: { path: "", status: "unchanged", calls: [] },
		git: "skipped",
		lfs: null,
		installed: false,
		runScript: runScriptFor(pm),
	};
	const fields = packageFields({
		framefieldsVersion: options.framefieldsVersion ?? ownVersion(),
		...(pmVersion && { packageManager: `${pm}@${pmVersion}` }),
	});

	// package.json: written whole, or merged without replacing anything.
	const pkgPath = join(root, "package.json");
	if (existsSync(pkgPath)) {
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Record<
			string,
			unknown
		>;
		if (pkg.type === "commonjs")
			throw new Error(
				'package.json has "type": "commonjs". framefields projects are ES modules: set "type": "module" (and convert any require() files) first.',
			);
		report.name =
			typeof pkg.name === "string" ? pkg.name : packageName(basename(root));
		const merged = mergePackage(pkg, fields);
		record(report, "package.json", writeIfChanged(pkgPath, merged, pkg));
	} else {
		report.name = options.name ?? packageName(basename(root));
		writeJson(pkgPath, {
			name: report.name,
			version: "0.0.0",
			private: true,
			...fields,
		});
		report.written.push("package.json");
	}

	const files: Array<[string, string]> = [
		["tsconfig.json", TSCONFIG],
		["src/theme.ts", THEME_TS],
		["src/film.ts", FILM_TS],
		["src/render.ts", RENDER_TS],
		["assets/footage/.gitkeep", ""],
		[".env.example", ENV_EXAMPLE],
		["README.md", readme(report.name, report.runScript)],
	];
	for (const [path, content] of files) {
		const target = join(root, path);
		if (existsSync(target)) report.unchanged.push(path);
		else {
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, content);
			report.written.push(path);
		}
	}
	for (const [path, lines] of [
		[".gitignore", GITIGNORE],
		[".gitattributes", GITATTRIBUTES],
	] as const)
		record(report, path, appendLines(join(root, path), lines));

	// framefields.json, then fonts (recorded there) and their module.
	const { config, saved } = readConfig(root);
	if (!saved) {
		writeConfig(root, config);
		report.written.push("framefields.json");
	}
	const roles = [
		...(options.fonts === false ? [] : ["sans", "mono"]),
		...(options.emoji ? ["emoji"] : []),
	];
	for (const role of roles)
		report.fonts.push(
			await installFont(role, {
				cwd: root,
				fetch: options.fetch,
				catalog: options.fontCatalog,
				onDownload: options.onDownload,
			}),
		);
	// theme.ts imports it, so it's written even with no fonts installed.
	report.fontsModule = writeFontsModule(
		root,
		resolve(root, readConfig(root).config.components),
		options.fontCatalog,
	);

	if (options.git !== false) {
		const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], {
			cwd: root,
			quiet: true,
		});
		if (inside === 0) report.git = "existing";
		else if (
			(await run("git", ["init", "-q"], { cwd: root, quiet: true })) === 0
		)
			report.git = "initialized";
		else report.git = "unavailable";
		if (report.git !== "unavailable")
			report.lfs =
				(await run("git", ["lfs", "version"], { cwd: root, quiet: true })) ===
				0;
	}

	if (options.install) {
		const code = await run(pm, ["install"], { cwd: root });
		if (code !== 0)
			throw new Error(
				`\`${pm} install\` failed (exit ${code}). The project files are written; fix the error and run it again.`,
			);
		report.installed = true;
	}
	return report;
}

/** Add every field of `fields` the package lacks; existing values win. */
function mergePackage(
	pkg: Record<string, unknown>,
	fields: ReturnType<typeof packageFields>,
): Record<string, unknown> {
	const out: Record<string, unknown> = { ...pkg };
	const obj = (v: unknown) =>
		v && typeof v === "object" && !Array.isArray(v)
			? (v as Record<string, unknown>)
			: {};
	const union = (a: unknown, b: readonly string[]) => [
		...new Set([...(Array.isArray(a) ? (a as string[]) : []), ...b]),
	];
	out.type ??= fields.type;
	if (fields.packageManager) out.packageManager ??= fields.packageManager;
	for (const key of [
		"scripts",
		"dependencies",
		"devDependencies",
		"allowScripts",
	] as const) {
		const theirs = obj(pkg[key]);
		// A dependency listed in either block counts as present.
		const present =
			key === "dependencies" || key === "devDependencies"
				? { ...obj(pkg.dependencies), ...obj(pkg.devDependencies) }
				: theirs;
		const missing = Object.entries(fields[key]).filter(
			([k]) => !(k in present),
		);
		if (missing.length > 0)
			out[key] = { ...theirs, ...Object.fromEntries(missing) };
	}
	const pnpm = obj(pkg.pnpm);
	out.pnpm = {
		...pnpm,
		onlyBuiltDependencies: union(
			pnpm.onlyBuiltDependencies,
			fields.pnpm.onlyBuiltDependencies,
		),
		ignoredBuiltDependencies: union(
			pnpm.ignoredBuiltDependencies,
			fields.pnpm.ignoredBuiltDependencies,
		),
	};
	out.trustedDependencies = union(
		pkg.trustedDependencies,
		fields.trustedDependencies,
	);
	return out;
}

function writeJson(path: string, value: unknown) {
	writeFileSync(path, `${JSON.stringify(value, null, "\t")}\n`);
}

function writeIfChanged(
	path: string,
	next: Record<string, unknown>,
	prev: Record<string, unknown>,
): boolean {
	if (JSON.stringify(next) === JSON.stringify(prev)) return false;
	writeJson(path, next);
	return true;
}

/** Create `path` with `lines` ("written"), or append the ones it lacks (true if any). */
function appendLines(
	path: string,
	lines: readonly string[],
): "written" | boolean {
	if (!existsSync(path)) {
		writeFileSync(path, `${lines.join("\n")}\n`);
		return "written";
	}
	const text = readFileSync(path, "utf8");
	const have = new Set(text.split(/\r?\n/).map((l) => l.trim()));
	const missing = lines.filter((l) => !have.has(l));
	if (missing.length === 0) return false;
	writeFileSync(
		path,
		`${text}${text.endsWith("\n") || text === "" ? "" : "\n"}${missing.join("\n")}\n`,
	);
	return true;
}

/** File it under written (new), merged (changed) or unchanged. */
function record(report: InitReport, path: string, result: "written" | boolean) {
	if (result === "written") report.written.push(path);
	else if (result) report.merged.push(path);
	else report.unchanged.push(path);
}

/** This package's version, from the nearest `package.json` named framefields. */
function ownVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const file = join(dir, "package.json");
		if (existsSync(file)) {
			const pkg = JSON.parse(readFileSync(file, "utf8")) as {
				name?: string;
				version?: string;
			};
			if (pkg.name === "framefields" && pkg.version) return pkg.version;
		}
		const up = dirname(dir);
		if (up === dir) throw new Error("Can't find framefields' own package.json");
		dir = up;
	}
}

const spawnRunner: Runner = (command, args, { cwd, quiet }) =>
	new Promise((done) => {
		const child = spawn(command, args, {
			cwd,
			stdio: quiet ? "ignore" : "inherit",
			// Windows needs a shell to find npm.cmd / pnpm.cmd.
			shell: process.platform === "win32",
		});
		child.on("error", () => done(127));
		child.on("close", (code) => done(code ?? 1));
	});

/** Where the project is, as the user would `cd` to it. */
export function shownPath(cwd: string, root: string): string {
	return relative(cwd, root) || ".";
}
