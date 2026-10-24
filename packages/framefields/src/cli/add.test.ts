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
		).rejects.toThrow('Unknown component "nope"');
		expect(() => readFileSync(join(cwd, CONFIG_FILE))).toThrow();
	});
});
