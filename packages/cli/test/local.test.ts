/** Golden output and exit codes for project commands that don't render. */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTmp, ff, tmpdir, writeFiles } from "./helpers.js";

afterEach(cleanupTmp);

const MANIFEST = {
	version: 1,
	compositions: {
		showcase: {
			entry: "src/audio.ts",
			export: "buildShowcase",
			title: "Audio showcase",
			default: true,
		},
		"step-1": {
			entry: "src/audio.ts",
			export: "buildStep1",
			title: "Initial audio",
			group: "Steps",
		},
		"step-2": { entry: "src/audio.ts", export: "buildStep2", group: "Steps" },
	},
};

function project(manifest: unknown = MANIFEST) {
	const root = tmpdir();
	writeFiles(root, {
		"package.json": "{}",
		"framefields.json":
			typeof manifest === "string" ? manifest : JSON.stringify(manifest),
		"src/nested/.keep": "",
	});
	return root;
}

describe("ff ls", () => {
	it("prints a table", async () => {
		const r = await ff(["ls"], { cwd: path.join(project(), "src", "nested") });
		expect(r.code).toBe(0);
		expect(r.stdout).toBe(
			[
				"ID        TITLE           GROUP  ENTRY                       DEFAULT",
				"showcase  Audio showcase         src/audio.ts#buildShowcase  yes",
				"step-1    Initial audio   Steps  src/audio.ts#buildStep1",
				"step-2    Step 2          Steps  src/audio.ts#buildStep2",
				"",
			].join("\n"),
		);
	});

	it("--json emits the Project", async () => {
		const root = project();
		const r = await ff(["ls", "--json"], { cwd: root });
		expect(r.code).toBe(0);
		expect(r.json()).toMatchObject({
			root,
			source: "manifest",
			defaultId: "showcase",
			output: "output",
			assets: { directory: "assets", exclude: ["**/.DS_Store"] },
		});
		expect(r.json<{ compositions: unknown[] }>().compositions).toHaveLength(3);
	});

	it("-C runs elsewhere; a bare package gets the implicit film", async () => {
		const root = tmpdir();
		writeFiles(root, { "package.json": "{}", "src/film.ts": "" });
		const r = await ff(["-C", root, "ls", "--json"], { cwd: "/" });
		expect(r.json()).toMatchObject({ source: "default", defaultId: "film" });
		expect(r.stderr).toContain("no framefields.json");
	});
});

describe("exit codes and errors (§7)", () => {
	it("4 when there is no project", async () => {
		const r = await ff(["ls"], { cwd: tmpdir() });
		expect(r.code).toBe(4);
		expect(r.stderr).toMatch(
			/^error: no framefields project found in .+\n {2}hint: ff init\n$/,
		);
		expect(r.stdout).toBe("");
	});

	it("4 for an invalid manifest, with the file in the hint", async () => {
		const root = project({
			version: 1,
			compositions: { Bad: { entry: "a.ts" } },
		});
		const r = await ff(["ls"], { cwd: root });
		expect(r.code).toBe(4);
		expect(r.stderr).toContain("framefields.json at compositions.Bad");
		expect(r.stderr).toContain(
			`hint: fix ${path.join(root, "framefields.json")}`,
		);
		expect((await ff(["ls"], { cwd: project("{ nope") })).code).toBe(4);
	});

	it("2 for an unknown composition, matching the spec's example", async () => {
		const r = await ff(["frames", "step-9", "0"], { cwd: project() });
		expect(r.code).toBe(2);
		expect(r.stderr).toBe(
			"error: unknown composition 'step-9'\n  hint: compositions in framefields.json: showcase, step-1, step-2 (ff ls)\n",
		);
	});

	it("2 for unknown flags and commands", async () => {
		expect((await ff(["ls", "--bogus"], { cwd: project() })).code).toBe(2);
		expect((await ff(["nope"], { cwd: project() })).code).toBe(2);
		expect((await ff(["frames"], { cwd: project() })).code).toBe(2);
		expect((await ff(["grid", "--count", "0"], { cwd: project() })).code).toBe(
			2,
		);
	});

	it("--json errors are one JSON value on stdout", async () => {
		const r = await ff(["frames", "step-9", "0", "--json"], { cwd: project() });
		expect(r.code).toBe(2);
		expect(r.json()).toEqual({
			error: {
				code: "usage",
				message: "unknown composition 'step-9'",
				hint: "compositions in framefields.json: showcase, step-1, step-2 (ff ls)",
			},
		});
	});

	it("4 when framefields isn't installed in the project", async () => {
		const root = tmpdir();
		writeFiles(root, {
			"package.json": "{}",
			"pnpm-lock.yaml": "",
			"src/film.ts": "",
		});
		const r = await ff(["frames", "0"], { cwd: root });
		expect(r.code).toBe(4);
		expect(r.stderr).toContain(`framefields is not installed in ${root}`);
		expect(r.stderr).toContain("hint: run: pnpm add framefields");
	});

	it("0 for --help and --version", async () => {
		const help = await ff(["--help"], { cwd: "/" });
		expect(help.code).toBe(0);
		expect(help.stdout).toContain("Usage: ff");
		const version = await ff(["--version"], { cwd: "/" });
		expect(version.code).toBe(0);
		expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/);
	});
});

describe("ff config", () => {
	it("sets, gets and unsets per-user settings", async () => {
		const env = { FF_CONFIG_DIR: tmpdir() };
		expect(
			(
				await ff(["config", "set", "host", "http://localhost:8787"], {
					cwd: "/",
					env,
				})
			).code,
		).toBe(0);
		expect(
			(await ff(["config", "get", "host"], { cwd: "/", env })).stdout,
		).toBe("http://localhost:8787\n");
		expect(
			(await ff(["config", "get", "host", "--json"], { cwd: "/", env })).json(),
		).toEqual({ host: "http://localhost:8787" });
		expect((await ff(["config", "set", "host"], { cwd: "/", env })).code).toBe(
			0,
		);
		expect(
			(await ff(["config", "get", "host"], { cwd: "/", env })).stdout,
		).toBe("");
		expect(
			(await ff(["config", "get", "colour"], { cwd: "/", env })).code,
		).toBe(2);
		expect(
			(await ff(["config", "set", "prompt", "maybe"], { cwd: "/", env })).code,
		).toBe(2);
	});
});

describe("ff init", () => {
	it("scaffolds a project ff can read, and keeps existing files", async () => {
		const root = tmpdir();
		writeFiles(root, { ".gitignore": "dist/\n" });
		const r = await ff(["init", "film-project", "--json"], { cwd: root });
		expect(r.code).toBe(0);
		const dir = path.join(root, "film-project");
		for (const f of [
			"src/film.ts",
			"framefields.json",
			"framefields.assets.json",
			"tsconfig.json",
			"package.json",
			".gitignore",
		]) {
			expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
		}
		const pkg = JSON.parse(
			fs.readFileSync(path.join(dir, "package.json"), "utf8"),
		);
		expect(pkg).toMatchObject({
			name: "film-project",
			type: "module",
			scripts: { preview: "ff preview" },
		});
		expect(pkg.dependencies.framefields).toMatch(/^\^\d/);
		expect(fs.readFileSync(path.join(dir, ".gitignore"), "utf8")).toContain(
			"output/",
		);
		expect((await ff(["ls", "--json"], { cwd: dir })).json()).toMatchObject({
			source: "manifest",
			defaultId: "film",
		});

		const again = await ff(["init", "film-project", "--json"], { cwd: root });
		expect(again.json<{ skipped: string[] }>().skipped).toContain(
			"src/film.ts",
		);
	});

	it("copies a template from examples/ and makes it standalone", async () => {
		const examples = path.resolve(import.meta.dirname, "../../../examples");
		const root = tmpdir();
		const r = await ff(
			["init", "audio", "--template", "audio-capabilities", "--json"],
			{
				cwd: root,
				env: { FF_TEMPLATES_DIR: examples },
			},
		);
		expect(r.code).toBe(0);
		const dir = path.join(root, "audio");
		const pkg = JSON.parse(
			fs.readFileSync(path.join(dir, "package.json"), "utf8"),
		);
		expect(JSON.stringify(pkg)).not.toContain("workspace:");
		expect(fs.existsSync(path.join(dir, "node_modules"))).toBe(false);
		expect(
			(await ff(["ls", "--json"], { cwd: dir })).json<{
				compositions: unknown[];
			}>().compositions,
		).toHaveLength(8);

		const unknown = await ff(["init", "x", "--template", "nope"], {
			cwd: root,
			env: { FF_TEMPLATES_DIR: examples },
		});
		expect(unknown.code).toBe(2);
		expect(unknown.stderr).toContain("data-story");
	});
});
