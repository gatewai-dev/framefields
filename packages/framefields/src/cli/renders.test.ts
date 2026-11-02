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
import type { CloudRenderOptions, CloudRenderStatus } from "../cloud/index.js";
import { withNamedRender } from "../cloud/index.js";
import { pickRender, runCloudRender } from "./cloud.js";
import {
	CONFIG_FILE,
	parseRenders,
	readConfig,
	writeConfig,
} from "./config.js";

let cwd: string;

beforeEach(() => {
	cwd = mkdtempSync(join(tmpdir(), "ff-renders-"));
	mkdirSync(join(cwd, "src"));
	writeFileSync(join(cwd, "src/film.ts"), "export const buildFilm = 1;\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const manifest = (value: unknown) =>
	writeFileSync(join(cwd, CONFIG_FILE), JSON.stringify(value));

describe("framefields.json renders", () => {
	it("reads renders without a components folder, which stays unsaved", () => {
		manifest({ renders: { film: { entry: "src/film.ts", workers: "auto" } } });
		expect(readConfig(cwd)).toEqual({
			config: {
				components: "src/components",
				renders: { film: { entry: "src/film.ts", workers: "auto" } },
			},
			saved: false,
		});
	});

	it("keeps renders and unknown keys when the config is rewritten", () => {
		manifest({
			$schema: "x",
			renders: { film: { entry: "src/film.ts" } },
		});
		const { config } = readConfig(cwd);
		writeConfig(cwd, { ...config, components: "src/parts" });
		expect(JSON.parse(readFileSync(join(cwd, CONFIG_FILE), "utf8"))).toEqual({
			$schema: "x",
			components: "src/parts",
			renders: { film: { entry: "src/film.ts" } },
		});
	});

	it("names the render and field at fault", () => {
		expect(() => parseRenders({ film: {} })).toThrow(
			'framefields.json: renders.film needs "entry"',
		);
		expect(() => parseRenders({ film: { entry: "../x.ts" } })).toThrow(
			'renders.film needs "entry"',
		);
		expect(() => parseRenders({ film: { entry: "a.ts", workers: 0 } })).toThrow(
			'renders.film "workers" must be "auto"',
		);
		expect(() =>
			parseRenders({ film: { entry: "a.ts", export: "build film" } }),
		).toThrow('"export" must be a JavaScript identifier');
		expect(() => parseRenders({ "bad name": { entry: "a.ts" } })).toThrow(
			"invalid name",
		);
		expect(() => parseRenders([])).toThrow('"renders" must map names');
	});
});

describe("picking a render", () => {
	it("takes a name, a module path, or the only named render", () => {
		manifest({ renders: { film: { entry: "src/film.ts" } } });
		expect(pickRender("film", cwd)).toEqual({ name: "film" });
		expect(pickRender("src/film.ts", cwd)).toEqual({ entry: "src/film.ts" });
		expect(pickRender(undefined, cwd)).toEqual({ name: "film" });
	});

	it("asks for a name when there are several, and lists them for a typo", () => {
		manifest({
			renders: {
				film: { entry: "src/film.ts" },
				teaser: { entry: "src/film.ts", export: "teaser" },
			},
		});
		expect(pickRender(undefined, cwd)).toEqual({
			error: "Name the render: film, teaser. `framefields renders` lists them.",
		});
		expect(pickRender("flim", cwd)).toEqual({
			error:
				'"flim" is neither a render in framefields.json (film, teaser) nor a file.',
		});
	});

	it("fills the request from the named render; options override it", () => {
		manifest({
			renders: {
				teaser: {
					title: "Teaser",
					entry: "src/film.ts",
					export: "buildTeaser",
					workers: "auto",
					codec: "vp9",
				},
			},
		});
		expect(withNamedRender(cwd, { render: "teaser", codec: "h264" })).toEqual({
			render: "teaser",
			name: "teaser",
			title: "Teaser",
			entry: "src/film.ts",
			export: "buildTeaser",
			workers: "auto",
			codec: "h264",
			args: undefined,
			select: undefined,
			maxWorkers: undefined,
			quality: undefined,
		});
		expect(() => withNamedRender(cwd, { render: "nope" })).toThrow(
			'No render named "nope" in framefields.json. Renders: teaser.',
		);
	});

	it("renders a named render from the CLI with its output and hint", async () => {
		manifest({
			renders: {
				film: { entry: "src/film.ts", output: "out/launch.mp4" },
			},
		});
		const calls: CloudRenderOptions[] = [];
		const lines: string[] = [];
		const planned: CloudRenderStatus = {
			id: "r1",
			status: "planned",
			workers: 2,
			progress: { frames: 0, totalFrames: null, etaSec: null },
			costUsd: 0,
			gpuSeconds: 0,
		};
		const code = await runCloudRender(
			{ plan: true, cwd },
			(l) => lines.push(l),
			async (o) => {
				calls.push(o);
				return planned;
			},
		);
		expect(code).toBe(0);
		expect(calls[0]).toMatchObject({
			cwd,
			render: "film",
			workers: "auto",
			dryRun: true,
		});
		expect(lines.at(-1)).toBe(
			"Render it: framefields render film --cloud --workers auto",
		);
	});
});
