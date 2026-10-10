import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { MANIFEST_FILE, MANIFEST_SCHEMA_URL } from "framefields/project";
import { LOCKFILE, LOCKFILE_SCHEMA } from "../assets.js";
import type { Wrap } from "../cli.js";
import { addCommand } from "../context.js";
import { CliError, usageError } from "../errors.js";
import * as git from "../git/index.js";
import { VERSION } from "../version.js";

const TEMPLATES_REPO = "https://github.com/gatewai-dev/framefields.git";

const FILM = `import { Composition, Layer, LayerAnimation } from "framefields";

const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION = 3 * FPS; // frames

/** The film: \`ff preview\` shows it, \`ff render --local\` exports it. */
export async function buildFilm(): Promise<Composition> {
	const film = new Composition({
		width: W,
		height: H,
		fps: FPS,
		durationMs: (DURATION / FPS) * 1000,
		backgroundColor: "#0E0D0C",
	});

	const size = 360;
	film.add(
		Layer.shape("ellipse", {
			id: "disc",
			position: "absolute",
			x: (W - size) / 2,
			y: (H - size) / 2,
			width: size,
			height: size,
			fillColor: "#EEE9E0",
		}).animate(
			LayerAnimation.create()
				.fadeIn(0, 20, "power2.out")
				.fromTo("y", (H - size) / 2 + 80, (H - size) / 2, { start: 0, end: 30, ease: "expo.out" }),
		),
	);

	return film;
}
`;

const TSCONFIG = {
	compilerOptions: {
		module: "NodeNext",
		moduleResolution: "NodeNext",
		target: "ES2022",
		strict: true,
		skipLibCheck: true,
		noEmit: true,
		types: ["node"],
	},
	include: ["src/**/*"],
};

const GITIGNORE = [
	"node_modules/",
	"output/",
	".framefields/",
	`# External assets live in Framefields Cloud; ${LOCKFILE} tracks them (ff asset sync).`,
	"assets/",
];

/** Install-script approvals framefields needs (skia-canvas's native binary) and the rest it doesn't. */
const SCRIPT_POLICY = {
	allowScripts: {
		"skia-canvas": true,
		sharp: false,
		webgpu: false,
		"onnxruntime-node": false,
		"node-av": false,
		esbuild: false,
	},
	pnpm: {
		onlyBuiltDependencies: ["skia-canvas"],
		ignoredBuiltDependencies: [
			"sharp",
			"webgpu",
			"onnxruntime-node",
			"node-av",
			"esbuild",
		],
	},
	trustedDependencies: ["skia-canvas"],
};

type Json = Record<string, unknown>;

const toSlug = (dir: string) =>
	dir.replace(/^\d+_/, "").replace(/_/g, "-").toLowerCase();

export function register(program: Command, wrap: Wrap) {
	program
		.command("init")
		.description(
			`Scaffold a project: src/film.ts, ${MANIFEST_FILE}, ${LOCKFILE}, .gitignore, package.json`,
		)
		.argument("[dir]", "directory (default: the current one)")
		.option(
			"-t, --template <slug>",
			"start from an example, e.g. data-story (from github.com/gatewai-dev/framefields/examples)",
		)
		.option("--name <name>", "package name (default: the directory name)")
		.action(
			wrap(
				async (
					ctx,
					dir: string | undefined,
					opts: { template?: string; name?: string },
				) => {
					const target = path.resolve(ctx.cwd, dir ?? ".");
					fs.mkdirSync(target, { recursive: true });
					const name = (opts.name ?? path.basename(target))
						.toLowerCase()
						.replace(/[^a-z0-9._-]+/g, "-");
					const written: string[] = [];
					const skipped: string[] = [];
					const write = (rel: string, content: string) => {
						const file = path.join(target, rel);
						if (fs.existsSync(file)) {
							skipped.push(rel);
							return;
						}
						fs.mkdirSync(path.dirname(file), { recursive: true });
						fs.writeFileSync(file, content);
						written.push(rel);
					};

					let title = "Film";
					if (opts.template) {
						const source = await fetchTemplate(ctx.env, opts.template, (t) =>
							ctx.out.info(t),
						);
						try {
							title = copyTemplate(source.dir, target, written, skipped);
						} finally {
							source.cleanup();
						}
					} else {
						write("src/film.ts", FILM);
						write("tsconfig.json", `${JSON.stringify(TSCONFIG, null, "\t")}\n`);
					}

					// Templates may bring their own manifest.
					if (
						!(opts.template && fs.existsSync(path.join(target, MANIFEST_FILE)))
					)
						write(
							MANIFEST_FILE,
							`${JSON.stringify(
								{
									$schema: MANIFEST_SCHEMA_URL,
									version: 1,
									compositions: {
										film: {
											entry: "src/film.ts",
											export: "buildFilm",
											title,
											default: true,
										},
									},
								},
								null,
								"\t",
							)}\n`,
						);
					write(
						LOCKFILE,
						`${JSON.stringify({ $schema: LOCKFILE_SCHEMA, version: 1, assets: {} }, null, "\t")}\n`,
					);
					fs.mkdirSync(path.join(target, "assets"), { recursive: true });
					mergeGitignore(target, written);
					mergePackageJson(target, name, written);
					if (!(await git.isRepo(target))) {
						const r = await git.git(["init", "--quiet", "-b", "main"], {
							cwd: target,
						});
						if (r.code === 0) written.push(".git/");
					}

					const packageManager = addCommand(target).split(" ")[0];
					const rel = path.relative(ctx.cwd, target) || ".";
					ctx.out.result({ directory: rel, files: written, skipped }, () => {
						for (const f of written) ctx.out.line(`  + ${f}`);
						for (const f of skipped) ctx.out.line(`  = ${f} (exists, kept)`);
						ctx.out.line();
						ctx.out.line("next:");
						if (rel !== ".") ctx.out.line(`  cd ${rel}`);
						ctx.out.line(`  ${packageManager} install`);
						ctx.out.line("  ff preview");
					});
				},
			),
		);
}

function mergeGitignore(target: string, written: string[]) {
	const file = path.join(target, ".gitignore");
	const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
	const lines = new Set(existing.split("\n").map((l) => l.trim()));
	const missing = GITIGNORE.filter((l) => !lines.has(l));
	if (missing.length === 0) return;
	fs.writeFileSync(
		file,
		`${existing}${existing && !existing.endsWith("\n") ? "\n" : ""}${missing.join("\n")}\n`,
	);
	written.push(".gitignore");
}

/** Creates package.json, or merges what framefields needs into an existing one. */
function mergePackageJson(target: string, name: string, written: string[]) {
	const file = path.join(target, "package.json");
	const exists = fs.existsSync(file);
	const pkg: Json = exists
		? (JSON.parse(fs.readFileSync(file, "utf8")) as Json)
		: { name, private: true, version: "0.1.0" };
	pkg.type ??= "module";
	if (pkg.type !== "module")
		throw new CliError(
			`${file} has "type": "${pkg.type}"; framefields projects are ES modules`,
		);
	const scripts = (pkg.scripts ?? {}) as Record<string, string>;
	scripts.preview ??= "ff preview";
	scripts.check ??= "ff check";
	scripts.render ??= "ff render --local";
	pkg.scripts = scripts;
	const deps = (pkg.dependencies ?? {}) as Record<string, string>;
	deps.framefields =
		deps.framefields && deps.framefields !== "workspace:*"
			? deps.framefields
			: `^${VERSION}`;
	pkg.dependencies = deps;
	const dev = (pkg.devDependencies ?? {}) as Record<string, string>;
	for (const k of Object.keys(dev))
		if (dev[k]?.startsWith("workspace:")) delete dev[k];
	dev["@framefields/cli"] ??= `^${VERSION}`;
	dev.typescript ??= "^5.8.3";
	dev["@types/node"] ??= "^24.1.0";
	pkg.devDependencies = dev;
	pkg.allowScripts = {
		...SCRIPT_POLICY.allowScripts,
		...(pkg.allowScripts as Json),
	};
	const pnpm = (pkg.pnpm ?? {}) as Json;
	pnpm.onlyBuiltDependencies ??= SCRIPT_POLICY.pnpm.onlyBuiltDependencies;
	pnpm.ignoredBuiltDependencies ??= SCRIPT_POLICY.pnpm.ignoredBuiltDependencies;
	pkg.pnpm = pnpm;
	pkg.trustedDependencies ??= SCRIPT_POLICY.trustedDependencies;
	fs.writeFileSync(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	written.push(exists ? "package.json (merged)" : "package.json");
}

/**
 * The examples directory: `FF_TEMPLATES_DIR` (a local checkout's examples/),
 * else a shallow, sparse clone of the framefields repository.
 */
async function fetchTemplate(
	env: Record<string, string | undefined>,
	slug: string,
	info: (t: string) => void,
) {
	let examples: string;
	let cleanup = () => {};
	if (env.FF_TEMPLATES_DIR) examples = path.resolve(env.FF_TEMPLATES_DIR);
	else {
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-template-"));
		cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
		const repo = env.FF_TEMPLATES_REPO ?? TEMPLATES_REPO;
		info(`fetching templates from ${repo}`);
		try {
			await git.gitOk(
				[
					"clone",
					"--quiet",
					"--depth",
					"1",
					"--filter=blob:none",
					"--sparse",
					repo,
					tmp,
				],
				{ cwd: os.tmpdir() },
			);
			await git.gitOk(["sparse-checkout", "set", "examples"], { cwd: tmp });
		} catch (err) {
			cleanup();
			throw err;
		}
		examples = path.join(tmp, "examples");
	}
	const dirs = fs.existsSync(examples)
		? fs
				.readdirSync(examples, { withFileTypes: true })
				.filter((d) => d.isDirectory() && /^\d+_/.test(d.name))
				.map((d) => d.name)
		: [];
	const match = dirs.find(
		(d) => d === slug || toSlug(d) === slug.toLowerCase(),
	);
	if (!match) {
		cleanup();
		throw usageError(
			`unknown template '${slug}'`,
			`templates: ${dirs.map(toSlug).join(", ") || "(none found)"}`,
		);
	}
	return { dir: path.join(examples, match), cleanup };
}

const SKIP = new Set([
	"node_modules",
	"output",
	"scratch",
	"dist",
	".turbo",
	"CHANGELOG.md",
	"tsconfig.dev.json",
	".framefields",
]);

/** Copies an example, turning its monorepo wiring into a standalone project. Returns its title. */
function copyTemplate(
	from: string,
	to: string,
	written: string[],
	skipped: string[],
): string {
	const copy = (src: string, rel: string) => {
		for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
			if (SKIP.has(entry.name)) continue;
			const s = path.join(src, entry.name);
			const r = rel ? `${rel}/${entry.name}` : entry.name;
			const d = path.join(to, r);
			// Follow symlinks: a linked folder (shared fonts, say) is copied as files.
			const stat = fs.statSync(s, { throwIfNoEntry: false });
			if (!stat) continue;
			if (stat.isDirectory()) {
				copy(s, r);
				continue;
			}
			if (r === "package.json") continue; // merged below
			if (fs.existsSync(d)) {
				skipped.push(r);
				continue;
			}
			fs.mkdirSync(path.dirname(d), { recursive: true });
			if (r === "tsconfig.json")
				fs.writeFileSync(d, `${JSON.stringify(TSCONFIG, null, "\t")}\n`);
			else fs.copyFileSync(s, d);
			written.push(r);
		}
	};
	copy(from, "");
	const src = path.join(from, "package.json");
	const dest = path.join(to, "package.json");
	if (fs.existsSync(src) && !fs.existsSync(dest)) {
		const pkg = JSON.parse(fs.readFileSync(src, "utf8")) as Json;
		const scripts = (pkg.scripts ?? {}) as Record<string, string>;
		for (const [k, v] of Object.entries(scripts))
			if (/tsconfig\.dev|--conditions/.test(v)) delete scripts[k];
		const { name: _n, version: _v, ...rest } = pkg;
		fs.writeFileSync(
			dest,
			JSON.stringify({
				name: path.basename(to),
				version: "0.1.0",
				...rest,
				scripts,
			}),
		);
	}
	const readme = path.join(from, "README.md");
	const heading = fs.existsSync(readme)
		? /^#\s+(.+)$/m.exec(fs.readFileSync(readme, "utf8"))?.[1]
		: undefined;
	return (
		heading?.trim().slice(0, 120) ||
		toSlug(path.basename(from))
			.replace(/-/g, " ")
			.replace(/^\w/, (c) => c.toUpperCase())
	);
}
