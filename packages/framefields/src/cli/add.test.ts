import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chainRegistries, openHttpRegistry } from "../library/registry.js";
import { add, CONFIG_FILE, readConfig } from "./add.js";
import { openRegistry, type RegistryItem } from "./registry.js";

const item = (
	name: string,
	files: Record<string, string>,
	registryDependencies: string[] = [],
): RegistryItem => ({
	name,
	title: name,
	summary: `${name} summary`,
	tags: [],
	example: "",
	parts: [],
	cues: [],
	registryDependencies,
	files: Object.entries(files).map(([path, content]) => ({ path, content })),
});

let tmp: string;
let cwd: string;
let registryDir: string;
beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "framefields-add-test-"));
	cwd = join(tmp, "project");
	registryDir = join(tmp, "registry");
	mkdirSync(cwd);
	mkdirSync(registryDir);
	const items = [
		item("counter", {
			"counter/index.ts": "counter\n",
			"counter/plan.ts": "plan\n",
		}),
		item("meter", { "meter/index.ts": "meter\n" }, ["counter"]),
		item("terminal", { "terminal/index.ts": "terminal\n" }, [
			"counter",
			"meter",
		]),
	];
	writeFileSync(join(registryDir, "index.json"), JSON.stringify(items));
	for (const i of items)
		writeFileSync(join(registryDir, `${i.name}.json`), JSON.stringify(i));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("framefields add", () => {
	it("installs dependencies first, once each, and remembers the folder", async () => {
		mkdirSync(join(cwd, "src"));
		const report = await add(["terminal", "meter"], {
			cwd,
			registry: openRegistry(registryDir),
		});
		expect(report.components.map((c) => c.name)).toEqual([
			"counter",
			"meter",
			"terminal",
		]);
		expect(report.written).toEqual([
			"src/components/counter/index.ts",
			"src/components/counter/plan.ts",
			"src/components/meter/index.ts",
			"src/components/terminal/index.ts",
		]);
		expect(
			readFileSync(join(cwd, "src/components/counter/plan.ts"), "utf8"),
		).toBe("plan\n");
		expect(report.configWritten).toBe(true);
		expect(readConfig(cwd)).toEqual({
			config: { components: "src/components" },
			saved: true,
		});
	});

	it("uses `components` without a src folder, and --dir once saved", async () => {
		expect(readConfig(cwd).config.components).toBe("components");
		await add(["counter"], {
			cwd,
			registry: openRegistry(registryDir),
			dir: "lib/fx",
		});
		expect(JSON.parse(readFileSync(join(cwd, CONFIG_FILE), "utf8"))).toEqual({
			components: "lib/fx",
		});
		const again = await add(["meter"], {
			cwd,
			registry: openRegistry(registryDir),
		});
		expect(again.written).toEqual(["lib/fx/meter/index.ts"]);
		expect(again.unchanged).toEqual([
			"lib/fx/counter/index.ts",
			"lib/fx/counter/plan.ts",
		]);
		expect(again.configWritten).toBe(false);
	});

	it("leaves edited files alone unless told to overwrite", async () => {
		const registry = openRegistry(registryDir);
		await add(["counter"], { cwd, registry });
		const file = join(cwd, "components/counter/index.ts");
		writeFileSync(file, "my edits\n");
		const kept = await add(["counter"], { cwd, registry });
		expect(kept.skipped).toEqual(["components/counter/index.ts"]);
		expect(readFileSync(file, "utf8")).toBe("my edits\n");
		const replaced = await add(["counter"], { cwd, registry, overwrite: true });
		expect(replaced.written).toEqual(["components/counter/index.ts"]);
		expect(readFileSync(file, "utf8")).toBe("counter\n");
	});

	it("rejects unknown names before writing anything", async () => {
		await expect(
			add(["counter", "nope"], { cwd, registry: openRegistry(registryDir) }),
		).rejects.toThrow('Unknown item "nope"');
		expect(() => readFileSync(join(cwd, CONFIG_FILE))).toThrow();
	});
});

describe("framefields add: library media", () => {
	const audio = Buffer.from("not really an mp3, but bytes all the same");
	const sha256 = createHash("sha256").update(audio).digest("hex");
	const track: RegistryItem = {
		...item("music/neon-drive", {
			"music/neon-drive.ts":
				'export const neonDrive = { src: "assets/library/music/neon-drive.mp3" };\n',
		}),
		title: "neonDrive",
		kind: "music",
		license: { id: "CC0-1.0", commercial: true },
		assets: [
			{
				path: "music/neon-drive.mp3",
				sha256,
				size: audio.length,
				url: `files/${sha256}.mp3`,
			},
		],
	};
	const library = "https://cdn.example.dev/library/";
	const served: Record<string, unknown> = {
		[`${library}index.json`]: [track],
		[`${library}music/neon-drive.json`]: track,
		[`${library}files/${sha256}.mp3`]: audio,
	};
	const requests: string[] = [];
	const fakeFetch = (async (input: string | URL) => {
		const url = String(input);
		requests.push(url);
		const body = served[url];
		if (body === undefined) return new Response("no", { status: 404 });
		return Buffer.isBuffer(body)
			? new Response(body)
			: new Response(JSON.stringify(body));
	}) as typeof fetch;

	beforeEach(() => {
		requests.length = 0;
	});

	it("copies the module, pins the media at its absolute URL, downloads it verified", async () => {
		const registry = chainRegistries(
			openRegistry(registryDir),
			openHttpRegistry(library, fakeFetch),
		);
		const report = await add(["music/neon-drive"], {
			cwd,
			registry,
			fetchMedia: fakeFetch,
		});
		expect(report.written).toEqual(["components/music/neon-drive.ts"]);
		expect(report.media).toEqual([
			{
				path: "assets/library/music/neon-drive.mp3",
				size: audio.length,
				state: "downloaded",
				by: "music/neon-drive",
			},
		]);
		expect(readConfig(cwd).config.assets).toEqual({
			"assets/library/music/neon-drive.mp3": {
				sha256,
				size: audio.length,
				url: `${library}files/${sha256}.mp3`,
			},
		});
		expect(
			readFileSync(join(cwd, "assets/library/music/neon-drive.mp3")),
		).toEqual(audio);
		expect(readFileSync(join(cwd, ".gitignore"), "utf8")).toContain(
			"/assets/library/music/neon-drive.mp3",
		);
		const again = await add(["music/neon-drive"], {
			cwd,
			registry,
			fetchMedia: fakeFetch,
		});
		expect(again.media[0]?.state).toBe("present");
	});

	it("asks the library only for names the bundled registry lacks", async () => {
		const registry = chainRegistries(
			openRegistry(registryDir),
			openHttpRegistry(library, fakeFetch),
		);
		await add(["counter"], { cwd, registry });
		expect(requests).toEqual([]);
	});

	it("pins without downloading when media is off", async () => {
		const report = await add(["music/neon-drive"], {
			cwd,
			registry: openHttpRegistry(library, fakeFetch),
			media: false,
		});
		expect(report.media[0]?.state).toBe("pinned");
		expect(readConfig(cwd).config.assets).toHaveProperty(
			"assets/library/music/neon-drive.mp3",
		);
		expect(requests).not.toContain(`${library}files/${sha256}.mp3`);
	});

	it("refuses media whose bytes don't match the pin", async () => {
		served[`${library}files/${sha256}.mp3`] = Buffer.from("tampered");
		try {
			await expect(
				add(["music/neon-drive"], {
					cwd,
					registry: openHttpRegistry(library, fakeFetch),
					fetchMedia: fakeFetch,
				}),
			).rejects.toThrow();
		} finally {
			served[`${library}files/${sha256}.mp3`] = audio;
		}
	});

	it("refuses items that would write outside the project", async () => {
		served[`${library}evil.json`] = {
			...item("evil", { "../../escape.ts": "x" }),
		};
		served[`${library}sneaky.json`] = {
			...item("sneaky", {}),
			assets: [{ path: "../../.bashrc", sha256, size: 1, url: "x" }],
		};
		const registry = openHttpRegistry(library, fakeFetch);
		await expect(add(["evil"], { cwd, registry })).rejects.toThrow(
			/invalid file path/,
		);
		await expect(add(["sneaky"], { cwd, registry })).rejects.toThrow(
			/invalid asset/,
		);
		await expect(add(["../etc/passwd"], { cwd, registry })).rejects.toThrow(
			/Unknown item/,
		);
	});
});
