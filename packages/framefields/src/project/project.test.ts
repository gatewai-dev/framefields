import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildComposition,
	humanize,
	loadProject,
	ProjectError,
	resolveComposition,
	resolveManifest,
} from "./index.js";

const dirs: string[] = [];
function tmp(files: Record<string, string>): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-project-"));
	dirs.push(dir);
	for (const [file, content] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
		fs.writeFileSync(path.join(dir, file), content);
	}
	return dir;
}
afterEach(() => {
	for (const d of dirs.splice(0))
		fs.rmSync(d, { recursive: true, force: true });
});

const manifest = (compositions: unknown, extra: object = {}) => ({
	version: 1,
	compositions,
	...extra,
});

function invalid(json: unknown): string {
	try {
		resolveManifest(json, "/p");
	} catch (err) {
		expect(err).toBeInstanceOf(ProjectError);
		expect((err as ProjectError).kind).toBe("invalid");
		return (err as Error).message;
	}
	throw new Error("expected the manifest to be rejected");
}

describe("resolveManifest (§3.1 rules)", () => {
	it("resolves defaults: export, title, group, description, assets, output", () => {
		const p = resolveManifest(
			manifest({ "step-1": { entry: "src/a.ts" } }),
			"/p",
		);
		expect(p).toEqual({
			root: "/p",
			source: "manifest",
			defaultId: "step-1",
			compositions: [
				{
					id: "step-1",
					entry: "src/a.ts",
					export: "default",
					title: "Step 1",
					description: null,
					group: null,
					default: true,
				},
			],
			assets: { directory: "assets", exclude: ["**/.DS_Store"] },
			output: "output",
		});
	});

	it("keeps insertion order and honours an explicit default", () => {
		const p = resolveManifest(
			manifest({
				b: { entry: "src/b.ts" },
				a: { entry: "src/a.ts", default: true, group: "Steps", title: "A!" },
			}),
			"/p",
		);
		expect(p.compositions.map((c) => c.id)).toEqual(["b", "a"]);
		expect(p.defaultId).toBe("a");
		expect(p.compositions.map((c) => c.default)).toEqual([false, true]);
		expect(p.compositions[1]).toMatchObject({ title: "A!", group: "Steps" });
	});

	it("version is optional and must be 1", () => {
		expect(() =>
			resolveManifest({ compositions: { a: { entry: "a.ts" } } }, "/p"),
		).not.toThrow();
		expect(
			invalid({ version: 2, compositions: { a: { entry: "a.ts" } } }),
		).toMatch(/version/);
	});

	it("requires at least one composition", () => {
		expect(invalid(manifest({}))).toMatch(/at least one/);
		expect(invalid({ version: 1 })).toMatch(/compositions/);
	});

	it("validates ids", () => {
		for (const id of ["Step1", "-a", "a_b", "a".repeat(64), ""]) {
			expect(invalid(manifest({ [id]: { entry: "a.ts" } }))).toMatch(
				/composition ids|compositions/,
			);
		}
		expect(() =>
			resolveManifest(manifest({ ["a".repeat(63)]: { entry: "a.ts" } }), "/p"),
		).not.toThrow();
	});

	it("validates entries", () => {
		expect(invalid(manifest({ a: { entry: "../x.ts" } }))).toMatch(/inside/);
		expect(invalid(manifest({ a: { entry: "/abs/x.ts" } }))).toMatch(/inside/);
		expect(invalid(manifest({ a: { entry: "src/x.json" } }))).toMatch(/\.ts/);
		for (const ext of ["ts", "tsx", "mts", "js", "mjs"]) {
			expect(() =>
				resolveManifest(manifest({ a: { entry: `src/x.${ext}` } }), "/p"),
			).not.toThrow();
		}
	});

	it("validates exports, lengths and the single default", () => {
		expect(
			invalid(manifest({ a: { entry: "a.ts", export: "not-ok" } })),
		).toMatch(/identifier/);
		expect(
			invalid(manifest({ a: { entry: "a.ts", title: "x".repeat(121) } })),
		).toMatch(/title/);
		expect(
			invalid(manifest({ a: { entry: "a.ts", description: "x".repeat(501) } })),
		).toMatch(/description/);
		expect(
			invalid(manifest({ a: { entry: "a.ts", group: "x".repeat(61) } })),
		).toMatch(/group/);
		expect(
			invalid(
				manifest({
					a: { entry: "a.ts", default: true },
					b: { entry: "b.ts", default: true },
				}),
			),
		).toMatch(/only one/);
	});

	it("preserves and ignores unknown keys", () => {
		const p = resolveManifest(
			manifest(
				{ a: { entry: "a.ts", posterFrame: 12 } },
				{ chapters: [], assets: { directory: "media", exclude: [], extra: 1 } },
			),
			"/p",
		);
		expect(p.assets).toEqual({ directory: "media", exclude: [] });
	});
});

describe("loadProject", () => {
	it("reads framefields.json from the nearest parent", async () => {
		const root = tmp({
			"framefields.json": JSON.stringify(
				manifest({ show: { entry: "src/show.ts", export: "build" } }),
			),
			"src/nested/x.txt": "",
		});
		const p = await loadProject(path.join(root, "src", "nested"));
		expect(p.root).toBe(root);
		expect(p.source).toBe("manifest");
		expect(p.defaultId).toBe("show");
	});

	it("falls back to the implicit film composition beside package.json", async () => {
		const root = tmp({ "package.json": "{}" });
		const p = await loadProject(root);
		expect(p.source).toBe("default");
		expect(p.compositions).toEqual([
			{
				id: "film",
				entry: "src/film.ts",
				export: "buildFilm",
				title: "Film",
				description: null,
				group: null,
				default: true,
			},
		]);
	});

	it("reports invalid JSON with the file path", async () => {
		const root = tmp({ "framefields.json": "{ nope" });
		const err = await loadProject(root).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(ProjectError);
		expect(err).toMatchObject({
			kind: "invalid",
			path: path.join(root, "framefields.json"),
		});
	});
});

describe("resolveComposition", () => {
	const project = resolveManifest(
		manifest({
			showcase: {
				entry: "src/audio.ts",
				export: "buildShowcase",
				default: true,
			},
			"step-1": { entry: "src/audio.ts", export: "buildStep1" },
		}),
		"/p",
	);

	it("resolves the default, ids and listed file refs", () => {
		expect(resolveComposition(project).id).toBe("showcase");
		expect(resolveComposition(project, "step-1").export).toBe("buildStep1");
		expect(resolveComposition(project, "src/audio.ts#buildStep1").id).toBe(
			"step-1",
		);
	});

	it("resolves ad-hoc file#export references", () => {
		expect(resolveComposition(project, "scratch/probe.ts#buildProbe")).toEqual({
			id: "probe-build-probe",
			entry: "scratch/probe.ts",
			export: "buildProbe",
			title: "scratch/probe.ts#buildProbe",
			description: null,
			group: null,
			default: false,
		});
		expect(resolveComposition(project, "./src/probe.ts")).toMatchObject({
			id: "probe",
			entry: "src/probe.ts",
			export: "default",
		});
	});

	it("rejects unknown ids with a hint listing the compositions", () => {
		try {
			resolveComposition(project, "step-9");
			expect.unreachable();
		} catch (err) {
			expect(err).toMatchObject({
				kind: "unknown-composition",
				message: "unknown composition 'step-9'",
				hint: "compositions in framefields.json: showcase, step-1 (ff ls)",
			});
		}
	});

	it("rejects refs outside the project or with bad exports", () => {
		expect(() => resolveComposition(project, "../x.ts")).toThrow(/outside/);
		expect(() => resolveComposition(project, "src/x.ts#not-ok")).toThrow(
			/identifier/,
		);
		expect(() => resolveComposition(project, "src/x.json#a")).toThrow(/\.ts/);
	});
});

describe("buildComposition", () => {
	const comp = `export function build() { return { toSpec() { return {}; }, renderFrame() {} }; }
export default async function () { return build(); }
export function notComp() { return 42; }
export function boom() { throw new Error("kaput"); }
`;

	it("imports the entry and calls the export", async () => {
		const root = tmp({
			"framefields.json": JSON.stringify(
				manifest({ a: { entry: "src/a.mjs", export: "build" } }),
			),
			"src/a.mjs": comp,
		});
		const project = await loadProject(root);
		const built = await buildComposition(project);
		expect(typeof built.toSpec).toBe("function");
		expect(typeof (await buildComposition(project, "src/a.mjs")).toSpec).toBe(
			"function",
		);
	});

	it("explains missing files, missing exports, throws and non-compositions", async () => {
		const root = tmp({
			"framefields.json": JSON.stringify(
				manifest({ a: { entry: "src/a.mjs", export: "build" } }),
			),
			"src/a.mjs": comp,
		});
		const project = await loadProject(root);
		await expect(buildComposition(project, "src/missing.mjs")).rejects.toThrow(
			/does not exist/,
		);
		await expect(buildComposition(project, "src/a.mjs#nope")).rejects.toThrow(
			/no export named 'nope'/,
		);
		await expect(buildComposition(project, "src/a.mjs#boom")).rejects.toThrow(
			/threw: kaput/,
		);
		await expect(
			buildComposition(project, "src/a.mjs#notComp"),
		).rejects.toThrow(/did not return a Composition/);
	});
});

it("humanize", () => {
	expect(humanize("step-1")).toBe("Step 1");
	expect(humanize("film")).toBe("Film");
});
