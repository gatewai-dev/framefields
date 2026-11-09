/**
 * `buildWebBundle`: a static folder with the engine, the composition's code
 * and the files it reads, under paths relative to the project, so nothing
 * names the machine that built it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bundleWebProject } from "../preview/bundle.js";
import { buildWebBundle } from "./build.js";
import type { WebBundleManifest } from "./types.js";

/** A project folder: a package.json root, an entry, and the files it reads. */
function project(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ff-webbundle-"));
	fs.writeFileSync(path.join(dir, "package.json"), '{ "name": "film" }');
	fs.mkdirSync(path.join(dir, "src"));
	fs.mkdirSync(path.join(dir, "media"));
	fs.mkdirSync(path.join(dir, "data"));
	fs.writeFileSync(path.join(dir, "media", "logo.png"), "png bytes");
	fs.writeFileSync(path.join(dir, "media", "unused.png"), "not read");
	fs.writeFileSync(path.join(dir, "data", "cues.json"), "[1, 2, 3]");
	// A stand-in composition: a tree naming a file by a path built from
	// import.meta.url, as compositions name their assets.
	fs.writeFileSync(
		path.join(dir, "src", "film.ts"),
		`import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
export function buildFilm() {
	const logo = path.resolve(HERE, "../media/logo.png");
	const tree = {
		metadata: { width: 64, height: 36, fps: 10, durationMs: 2000 },
		operation: { op: "Composition", dataType: "Video" },
		children: [{ operation: { op: "image", src: logo }, children: [] }],
	};
	return { fps: 10, toVirtualMedia: () => tree };
}
`,
	);
	return dir;
}

describe("buildWebBundle", () => {
	it("ships the engine, the composition and the files it names, by project path", async () => {
		const dir = project();
		const outDir = path.join(dir, "out");
		const result = await buildWebBundle({
			entry: path.join(dir, "src", "film.ts"),
			export: "buildFilm",
			outDir,
			include: [path.join(dir, "data")],
		});
		const manifest = JSON.parse(
			fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"),
		) as WebBundleManifest;
		expect(manifest).toMatchObject({
			format: 1,
			export: "buildFilm",
			width: 64,
			height: 36,
			fps: 10,
			frameCount: 20,
			durationMs: 2000,
		});
		expect(result.manifest).toEqual(manifest);
		// Named by the tree or included; the unused file stays out.
		expect(Object.keys(manifest.files).sort()).toEqual([
			"/data/cues.json",
			"/media/logo.png",
		]);
		const logo = manifest.files["/media/logo.png"];
		expect(logo).toMatchObject({ url: "files/media/logo.png", size: 9 });
		expect(fs.readFileSync(path.join(outDir, logo.url), "utf8")).toBe(
			"png bytes",
		);
		expect(result.warnings).toEqual([]);

		for (const file of ["index.html", "project.mjs", "engine/web.mjs"])
			expect(fs.existsSync(path.join(outDir, file)), file).toBe(true);
		const code = fs.readFileSync(path.join(outDir, "project.mjs"), "utf8");
		// The machine's folders appear nowhere: files have project paths.
		expect(code).not.toContain(dir);
		expect(code).toContain("file:///src/film.ts");
		expect(code).toMatch(/as composition|composition/);
	}, 120_000);

	it("replaces an earlier bundle but never a folder of other files", async () => {
		const dir = project();
		const entry = path.join(dir, "src", "film.ts");
		const outDir = path.join(dir, "out");
		await buildWebBundle({ entry, export: "buildFilm", outDir });
		const first = JSON.parse(
			fs.readFileSync(path.join(outDir, "manifest.json"), "utf8"),
		) as WebBundleManifest;
		fs.writeFileSync(path.join(dir, "media", "logo.png"), "new bytes");
		const second = await buildWebBundle({ entry, export: "buildFilm", outDir });
		// The id follows the content, so a resumed export never mixes them.
		expect(second.manifest.id).not.toBe(first.id);

		await expect(
			buildWebBundle({
				entry,
				export: "buildFilm",
				outDir: path.join(dir, "src"),
			}),
		).rejects.toThrow(/not empty/);
		expect(fs.existsSync(entry)).toBe(true);
	}, 120_000);
});

describe("bundleWebProject", () => {
	it("imports framefields and Node shims from the bundle's engine", async () => {
		const dir = project();
		const entry = path.join(dir, "src", "uses-engine.ts");
		fs.writeFileSync(
			entry,
			`import { readFileSync } from "node:fs";
import { Composition } from "framefields";
export default () => [Composition, readFileSync];
`,
		);
		const { code } = await bundleWebProject({
			entry,
			exportName: "default",
			root: dir,
			engineDir: "engine",
		});
		expect(code).toContain("./engine/framefields.mjs");
		expect(code).toContain("./engine/shims/fs.mjs");
	});
});
