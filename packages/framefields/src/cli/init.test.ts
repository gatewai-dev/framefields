import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "./config.js";
import type { Fetch, FontSpec } from "./fonts.js";
import {
	detectPackageManager,
	type InitOptions,
	init,
	packageName,
	type Runner,
} from "./init.js";
import { FILM_TS, GITATTRIBUTES, RENDER_TS, THEME_TS } from "./templates.js";

const bytes = (t: string) => new TextEncoder().encode(t);
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
/** A fake catalog entry plus the files a fake server serves for it. */
function fake(role: string, register: FontSpec["register"]) {
	const font = bytes(`${role} font`);
	const license = bytes(`${role} license`);
	const spec: FontSpec = {
		label: role,
		file: `${role}.ttf`,
		font: {
			url: `https://f.test/${role}.ttf`,
			sha256: hash(font),
			bytes: font.length,
		},
		license: {
			url: `https://f.test/${role}.txt`,
			sha256: hash(license),
			bytes: license.length,
			id: "OFL-1.1",
			file: `${role}-OFL.txt`,
		},
		register,
	};
	return {
		spec,
		files: { [spec.font.url]: font, [spec.license.url]: license },
	};
}
const sans = fake("sans", { family: "Inter" });
const mono = fake("mono", { family: "JetBrains Mono" });
const emoji = fake("emoji", { emoji: true });
const catalog = { sans: sans.spec, mono: mono.spec, emoji: emoji.spec };
const served: Record<string, Uint8Array> = {
	...sans.files,
	...mono.files,
	...emoji.files,
};
const fetchFake: Fetch = async (url) => ({
	ok: url in served,
	status: url in served ? 200 : 404,
	statusText: "",
	arrayBuffer: async () =>
		(served[url] ?? new Uint8Array()).slice().buffer as ArrayBuffer,
});

/** A runner that records commands; `git rev-parse` says "not a repo". */
function runner(codes: Partial<Record<string, number>> = {}) {
	const calls: string[] = [];
	const run: Runner = async (command, args) => {
		const line = [command, ...args].join(" ");
		calls.push(line);
		return codes[line] ?? (line.startsWith("git rev-parse") ? 128 : 0);
	};
	return { run, calls };
}

let cwd: string;
beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "framefields-init-test-"));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const opts = (extra: Partial<InitOptions> = {}): InitOptions => ({
	cwd,
	framefieldsVersion: "2.6.0",
	fetch: fetchFake,
	fontCatalog: catalog,
	run: runner().run,
	...extra,
});
const read = (path: string) => readFileSync(join(cwd, path), "utf8");
const json = (path: string) => JSON.parse(read(path));

describe("framefields init", () => {
	it("scaffolds a project that installs and renders as the setup skill says", async () => {
		const { run, calls } = runner();
		const report = await init(
			opts({
				dir: "My Film",
				run,
				userAgent: "pnpm/10.13.1 npm/? node/v22.12.0",
			}),
		);
		const root = (p: string) => join("My Film", p);
		expect(report.name).toBe("my-film");
		expect(report.packageManager).toBe("pnpm");
		const pkg = json(root("package.json"));
		expect(pkg).toMatchObject({
			name: "my-film",
			private: true,
			type: "module",
			packageManager: "pnpm@10.13.1",
			dependencies: { framefields: "^2.6.0" },
			allowScripts: { "skia-canvas": true, sharp: false },
			pnpm: { onlyBuiltDependencies: ["skia-canvas"] },
			trustedDependencies: ["skia-canvas"],
		});
		expect(Object.keys(pkg.scripts)).toEqual([
			"typecheck",
			"check",
			"check:render",
			"frames",
			"grid",
			"preview",
			"render",
		]);
		expect(Object.keys(pkg.devDependencies).sort()).toEqual([
			"@types/node",
			"tsx",
			"typescript",
		]);
		expect(read(root("src/film.ts"))).toBe(FILM_TS);
		expect(existsSync(join(cwd, root("assets/footage/.gitkeep")))).toBe(true);
		expect(read(root(".gitattributes"))).toContain(GITATTRIBUTES[0]);
		expect(read(root(".gitignore"))).toContain("output/");
		// The AI gateway key is optional: an example file, never a prompt.
		expect(read(root(".env.example"))).toMatch(/^FRAMEFIELDS_API_KEY=$/m);
		expect(read(root(".gitignore"))).toContain(".env\n");
		expect(read(root("src/render.ts"))).toContain("process.loadEnvFile(ENV)");
		expect(read(root("README.md"))).toContain("pnpm frames -- 0 30 60");
		// The themes' fonts, recorded and registered where theme.ts imports them.
		expect(report.fonts.map((f) => [f.role, f.path, f.status])).toEqual([
			["sans", "assets/fonts/sans.ttf", "installed"],
			["mono", "assets/fonts/mono.ttf", "installed"],
		]);
		expect(readConfig(join(cwd, "My Film")).config).toEqual({
			components: "src/components",
			fonts: { sans: "assets/fonts/sans.ttf", mono: "assets/fonts/mono.ttf" },
		});
		const fontsTs = read(root("src/components/fonts.ts"));
		expect(fontsTs).toContain('family: "Inter",');
		expect(fontsTs).toContain('source: asset("../../assets/fonts/sans.ttf"),');
		expect(read(root("src/theme.ts"))).toContain(
			'from "./components/fonts.js"',
		);
		expect(calls).toEqual([
			"git rev-parse --is-inside-work-tree",
			"git init -q",
			"git lfs version",
		]);
		expect(report.git).toBe("initialized");
		expect(report.installed).toBe(false);
	});

	it("merges into an existing project without replacing anything", async () => {
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({
				name: "existing",
				scripts: { render: "node mine.js", test: "vitest" },
				dependencies: { framefields: "^2.0.0" },
				devDependencies: { tsx: "^4.0.0" },
				pnpm: { onlyBuiltDependencies: ["esbuild"] },
			}),
		);
		mkdirSync(join(cwd, "src"));
		writeFileSync(join(cwd, "src/film.ts"), "// mine\n");
		writeFileSync(join(cwd, ".gitignore"), "dist/\noutput/");
		const report = await init(opts({ fonts: false }));
		const pkg = json("package.json");
		expect(pkg.type).toBe("module");
		expect(pkg.scripts).toMatchObject({
			render: "node mine.js",
			test: "vitest",
			frames: "tsx src/render.ts frames",
		});
		expect(pkg.dependencies.framefields).toBe("^2.0.0");
		expect(pkg.devDependencies).toMatchObject({
			tsx: "^4.0.0",
			typescript: "^5.8.3",
		});
		expect(pkg.pnpm.onlyBuiltDependencies).toEqual(["esbuild", "skia-canvas"]);
		expect(read("src/film.ts")).toBe("// mine\n");
		expect(read(".gitignore")).toBe(
			"dist/\noutput/\nnode_modules/\nscratch/\n.DS_Store\n.env\n",
		);
		expect(report.merged).toEqual(["package.json", ".gitignore"]);
		expect(report.unchanged).toContain("src/film.ts");
		expect(report.fonts).toEqual([]);
		// theme.ts imports fonts.ts, so it exists even with no fonts.
		expect(read("src/components/fonts.ts")).toContain(
			"export async function registerFonts",
		);

		const again = await init(opts({ fonts: false }));
		expect(again.written).toEqual([]);
		expect(again.merged).toEqual([]);
	});

	it("refuses CommonJS packages", async () => {
		writeFileSync(
			join(cwd, "package.json"),
			JSON.stringify({ type: "commonjs" }),
		);
		await expect(init(opts())).rejects.toThrow(/"type": "module"/);
	});

	it("adds emoji on request, skips git when asked, and installs with the chosen manager", async () => {
		const { run, calls } = runner();
		const report = await init(
			opts({
				run,
				emoji: true,
				git: false,
				install: true,
				packageManager: "bun",
			}),
		);
		expect(report.fonts.map((f) => f.role)).toEqual(["sans", "mono", "emoji"]);
		expect(calls).toEqual(["bun install"]);
		expect(report.installed).toBe(true);
		expect(json("package.json").packageManager).toBeUndefined();
		expect(report.runScript("frames")).toBe("bun run frames");
	});

	it("reports an existing repository and a failed install", async () => {
		const { run } = runner({
			"git rev-parse --is-inside-work-tree": 0,
			"git lfs version": 1,
			"npm install": 1,
		});
		await expect(init(opts({ run, install: true }))).rejects.toThrow(
			/`npm install` failed .*files are written/,
		);
		const report = await init(
			opts({
				run: runner({
					"git rev-parse --is-inside-work-tree": 0,
					"git lfs version": 1,
				}).run,
			}),
		);
		expect(report.git).toBe("existing");
		expect(report.lfs).toBe(false);
	});
});

describe("helpers", () => {
	it("detects the package manager from its user agent", () => {
		expect(
			detectPackageManager("npm/11.4.2 node/v22.12.0 darwin arm64"),
		).toEqual({
			name: "npm",
			version: "11.4.2",
		});
		expect(detectPackageManager("yarn/4.9.1 npm/? node/v22")?.name).toBe(
			"yarn",
		);
		expect(detectPackageManager(undefined)).toBeNull();
	});

	it("makes folder names npm-safe", () => {
		expect(packageName("My Film!")).toBe("my-film");
		expect(packageName("__")).toBe("framefields-film");
	});
});

describe("templates", () => {
	it.each([
		["theme.ts", THEME_TS],
		["film.ts", FILM_TS],
		["render.ts", RENDER_TS],
	])("%s is valid TypeScript", (file, source) => {
		const out = ts.transpileModule(source, {
			fileName: file,
			reportDiagnostics: true,
			compilerOptions: {
				module: ts.ModuleKind.NodeNext,
				target: ts.ScriptTarget.ES2022,
			},
		});
		expect(
			out.diagnostics?.map((d) =>
				ts.flattenDiagnosticMessageText(d.messageText, "\n"),
			),
		).toEqual([]);
	});
});
