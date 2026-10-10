/**
 * Everything a command needs, built from the global flags: output, the
 * project, the project's engine, the cloud client and the linked repository.
 * Commands take a Context instead of touching process globals, so they run in
 * tests without a terminal.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProject, type Project, ProjectError } from "framefields/project";
import { CloudClient, type Repository } from "./cloud/client.js";
import {
	DEFAULT_HOST,
	type Env,
	hostKey,
	hostUrl,
	readConfig,
	tokenFor,
} from "./config.js";
import { CliError, usageError } from "./errors.js";
import * as git from "./git/index.js";
import type { Io } from "./output.js";
import { Output } from "./output.js";

export interface GlobalOptions {
	json?: boolean;
	yes?: boolean;
	directory?: string;
	host?: string;
	quiet?: boolean;
	verbose?: boolean;
	color?: boolean;
}

export interface Deps {
	io: Io;
	env: Env;
	cwd: string;
	fetch?: typeof fetch;
}

/** What `import("framefields")` from the project gives us; only what `ff` uses. */
export interface Engine {
	HeadlessMediaRenderer: new () => unknown;
	startPreview(
		source: unknown,
		options?: Record<string, unknown>,
	): Promise<{ url: string; closed: Promise<string>; close(): Promise<void> }>;
	CompositorProgramSchema?: {
		safeParse(value: unknown): {
			success: boolean;
			error?: { issues: { path: PropertyKey[]; message: string }[] };
		};
	};
}

export class Context {
	readonly out: Output;
	readonly io: Io;
	readonly env: Env;
	/** Where the command runs: `-C <dir>` or the working directory. */
	readonly cwd: string;
	readonly yes: boolean;
	private readonly flagHost?: string;
	readonly fetchImpl?: typeof fetch;
	private projectPromise?: Promise<Project>;
	private clientPromise?: Promise<CloudClient>;

	constructor(options: GlobalOptions, deps: Deps) {
		this.io = deps.io;
		this.env = deps.env;
		this.cwd = path.resolve(deps.cwd, options.directory ?? ".");
		if (options.directory && !fs.existsSync(this.cwd)) {
			throw usageError(`-C ${options.directory}: no such directory`);
		}
		this.yes = !!options.yes;
		this.flagHost = options.host;
		this.fetchImpl = deps.fetch;
		this.out = new Output(deps.io, {
			json: !!options.json,
			quiet: !!options.quiet,
			verbose: !!options.verbose,
			color:
				options.color !== false &&
				deps.io.colorSupported &&
				deps.env.NO_COLOR === undefined,
		});
	}

	/** Prompts are allowed: a terminal, no --yes, and not disabled in config. */
	async canPrompt(): Promise<boolean> {
		if (!this.io.isTTY || this.yes || this.out.json) return false;
		return (await readConfig(this.env)).prompt !== "disabled";
	}

	// ── Project ──

	project(): Promise<Project> {
		this.projectPromise ??= loadProject(this.cwd).catch((err: unknown) => {
			throw fromProjectError(err);
		});
		return this.projectPromise;
	}

	/** Path relative to the project root, for printing. */
	relative(project: Project, file: string): string {
		return path.relative(project.root, file).split(path.sep).join("/") || ".";
	}

	/**
	 * The `framefields` installed in the project (never a copy bundled with the
	 * CLI), with a TypeScript loader registered so entries import.
	 */
	async engine(project: Project): Promise<Engine> {
		const resolved = resolvePackage(project.root, "framefields");
		if (!resolved) {
			throw new CliError(`framefields is not installed in ${project.root}`, {
				code: "project",
				hint: `run: ${addCommand(project.root)} framefields`,
			});
		}
		await registerTypeScript();
		// Entries resolve assets and fonts against the project, like its own scripts.
		process.chdir(project.root);
		return (await import(pathToFileURL(resolved).href)) as Engine;
	}

	/** True when the project's engine reads framefields.json itself (`startPreview({ project })`). */
	engineHasProject(project: Project): boolean {
		return (
			resolvePackage(project.root, "framefields", "./project") !== undefined
		);
	}

	// ── Cloud ──

	/** --host, FF_HOST, the linked repo's host, `ff config set host`, the default. */
	async host(): Promise<string> {
		if (this.flagHost) return hostUrl(this.flagHost);
		if (this.env.FF_HOST) return hostUrl(this.env.FF_HOST);
		const linked = await git
			.configGet(this.cwd, "framefields.host")
			.catch(() => undefined);
		if (linked) return hostUrl(linked);
		const config = await readConfig(this.env);
		return hostUrl(config.host ?? DEFAULT_HOST);
	}

	client(): Promise<CloudClient> {
		this.clientPromise ??= (async () => {
			const host = await this.host();
			const token = await tokenFor(this.env, host);
			this.out.debug(
				`host ${host}${token ? ` (key from ${token.source === "env" ? "FF_TOKEN" : "hosts.json"})` : ""}`,
			);
			return new CloudClient(host, token?.token, this.fetchImpl);
		})();
		return this.clientPromise;
	}

	/** The git work tree for repo commands; errors outside one. */
	async gitRoot(): Promise<string> {
		const root = await git.topLevel(this.cwd);
		if (!root) {
			throw new CliError(`${this.cwd} is not a git repository`, {
				hint: "ff repo create (or ff clone <repo>)",
			});
		}
		return root;
	}

	/**
	 * Finds a repository by id or name; without one, the repository this
	 * directory is linked to (`git config framefields.repo`), falling back to
	 * matching `origin` against the organization's repositories and linking it.
	 */
	async repo(ref?: string): Promise<Repository> {
		const client = await this.client();
		if (ref) {
			if (/^repo_/.test(ref)) return client.getRepo(ref);
			const repos = await client.listRepos();
			const found = repos.find((r) => r.name === ref || r.id === ref);
			if (!found)
				throw new CliError(
					`no repository named '${ref}' in your organization`,
					{ hint: "ff repo list" },
				);
			return found;
		}
		const root = await this.gitRoot();
		const linked = await git.configGet(root, "framefields.repo");
		if (linked) return client.getRepo(linked);
		const origin = await git.remoteUrl(root);
		if (origin) {
			const wanted = git.normalizeRemote(origin);
			const match = (await client.listRepos()).filter(
				(r) => git.normalizeRemote(r.remoteUrl) === wanted,
			);
			if (match.length === 1 && match[0]) {
				await this.link(root, match[0]);
				this.out.info(
					`linked ${this.relativeCwd(root)} to ${match[0].name} (${match[0].id}) by its origin remote`,
				);
				return match[0];
			}
		}
		throw new CliError(
			"this directory is not linked to a Framefields Cloud repository",
			{
				hint: "ff repo create, or: git config framefields.repo <repo id> (ff repo list)",
			},
		);
	}

	/** Writes the link into local git config (never the manifest: it is portable). */
	async link(root: string, repo: Repository): Promise<void> {
		await git.configSet(root, "framefields.repo", repo.id);
		await git.configSet(root, "framefields.host", hostKey(await this.host()));
	}

	relativeCwd(dir: string): string {
		return path.relative(this.cwd, dir) || ".";
	}
}

/** The nearest `node_modules/<name>` above `from`, as Node would find it. */
export function findPackageDir(from: string, name: string): string | undefined {
	for (let dir = path.resolve(from); ; dir = path.dirname(dir)) {
		const candidate = path.join(dir, "node_modules", name);
		if (fs.existsSync(path.join(candidate, "package.json")))
			return fs.realpathSync(candidate);
		if (path.dirname(dir) === dir) return undefined;
	}
}

/**
 * The file an `import` of `name` (or `name/subpath`) from `from` loads: the
 * package's `exports` (import, then default), else `module`/`main`.
 */
export function resolvePackage(
	from: string,
	name: string,
	subpath = ".",
): string | undefined {
	const dir = findPackageDir(from, name);
	if (!dir) return undefined;
	const pkg = JSON.parse(
		fs.readFileSync(path.join(dir, "package.json"), "utf8"),
	) as {
		exports?: unknown;
		module?: string;
		main?: string;
	};
	const pick = (target: unknown): string | undefined => {
		if (typeof target === "string") return target;
		if (target && typeof target === "object") {
			for (const condition of ["import", "node", "default"]) {
				const found = pick((target as Record<string, unknown>)[condition]);
				if (found) return found;
			}
		}
		return undefined;
	};
	let target: string | undefined;
	if (pkg.exports !== undefined) {
		const exportsMap =
			typeof pkg.exports === "string" ||
			Object.keys(pkg.exports as object).every((k) => !k.startsWith("."))
				? { ".": pkg.exports }
				: (pkg.exports as Record<string, unknown>);
		target = pick(exportsMap[subpath]);
	} else if (subpath === ".") target = pkg.module ?? pkg.main ?? "index.js";
	else target = subpath;
	return target ? path.join(dir, target) : undefined;
}

let registered: Promise<void> | undefined;
/**
 * tsx's loaders, so `.ts` entries (and their `./x.js` imports) load as under
 * `tsx src/render.ts`: both the ESM and the CommonJS hooks, as the tsx CLI
 * installs them (CommonJS dependencies requiring ESM need the latter).
 */
function registerTypeScript(): Promise<void> {
	registered ??= Promise.all([
		import("tsx/esm/api"),
		import("tsx/cjs/api"),
	]).then(([esm, cjs]) => {
		// Node deprecates module.register(), which tsx uses; that's tsx's to change, not the user's.
		const quiet = process.noDeprecation;
		process.noDeprecation = true;
		try {
			cjs.register();
			esm.register();
		} finally {
			process.noDeprecation = quiet;
		}
	});
	return registered;
}

/** `pnpm add`, `yarn add`, `bun add` or `npm install`, by the project's lockfile. */
export function addCommand(root: string): string {
	for (let dir = root; ; dir = path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, "pnpm-lock.yaml"))) return "pnpm add";
		if (fs.existsSync(path.join(dir, "yarn.lock"))) return "yarn add";
		if (
			fs.existsSync(path.join(dir, "bun.lock")) ||
			fs.existsSync(path.join(dir, "bun.lockb"))
		)
			return "bun add";
		if (fs.existsSync(path.join(dir, "package-lock.json")))
			return "npm install";
		if (path.dirname(dir) === dir) return "npm install";
	}
}

/** Maps a framefields/project error to a CLI error: project problems exit 4, bad references 2. */
export function fromProjectError(err: unknown): unknown {
	if (!(err instanceof ProjectError)) return err;
	const code =
		err.kind === "unknown-composition"
			? "usage"
			: err.kind === "build"
				? "failed"
				: "project";
	return new CliError(err.message, {
		code,
		hint:
			err.hint ??
			(err.kind === "invalid" && err.path ? `fix ${err.path}` : undefined),
		cause: err,
	});
}
