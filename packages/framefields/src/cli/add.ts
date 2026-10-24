/**
 * `framefields add`: copy components' source into a project, the way a
 * shadcn-style registry does. The code becomes the project's own; it
 * imports only `framefields` and `framefields/components` (the toolkit),
 * plus any component it builds on, which is installed alongside it.
 *
 * Where they go is remembered in `framefields.json` at the project root.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Registry, RegistryItem } from "./registry.js";

export const CONFIG_FILE = "framefields.json";

export interface ProjectConfig {
	/** Components directory, relative to the project root. */
	components: string;
}

/** The project's config, or the default it would get: `src/components` when there is a `src`. */
export function readConfig(cwd: string): {
	config: ProjectConfig;
	saved: boolean;
} {
	const file = join(cwd, CONFIG_FILE);
	if (existsSync(file)) {
		const config = JSON.parse(
			readFileSync(file, "utf8"),
		) as Partial<ProjectConfig>;
		if (typeof config.components !== "string")
			throw new Error(`${CONFIG_FILE}: "components" must be a directory path`);
		return { config: config as ProjectConfig, saved: true };
	}
	const components = existsSync(join(cwd, "src"))
		? "src/components"
		: "components";
	return { config: { components }, saved: false };
}

export interface AddOptions {
	cwd: string;
	registry: Registry;
	/** Components directory; saved to `framefields.json` if there is none yet. */
	dir?: string;
	/** Replace files that differ from the registry's. */
	overwrite?: boolean;
}

export interface AddReport {
	dir: string;
	/** Components in install order (dependencies first). */
	components: RegistryItem[];
	written: string[];
	unchanged: string[];
	/** Files left alone because they differ and `overwrite` is off. */
	skipped: string[];
	configWritten: boolean;
}

/** Resolve `names` (and what they import) and write their files. */
export async function add(
	names: string[],
	options: AddOptions,
): Promise<AddReport> {
	const { cwd, registry } = options;
	const index = await registry.index();
	const known = new Set(index.map((e) => e.name));
	for (const n of names)
		if (!known.has(n))
			throw new Error(
				`Unknown component "${n}". Run \`framefields list\` to see them all.`,
			);

	// Depth-first, dependencies before dependants.
	const order: RegistryItem[] = [];
	const seen = new Set<string>();
	const visit = async (name: string) => {
		if (seen.has(name)) return;
		seen.add(name);
		const item = await registry.item(name);
		for (const d of item.registryDependencies) await visit(d);
		order.push(item);
	};
	for (const n of names) await visit(n);

	const { config, saved } = readConfig(cwd);
	const rel = options.dir ?? config.components;
	const dir = resolve(cwd, rel);
	const report: AddReport = {
		dir,
		components: order,
		written: [],
		unchanged: [],
		skipped: [],
		configWritten: false,
	};
	for (const item of order) {
		for (const file of item.files) {
			const target = join(dir, file.path);
			const shown = relative(cwd, target);
			if (existsSync(target)) {
				if (readFileSync(target, "utf8") === file.content) {
					report.unchanged.push(shown);
					continue;
				}
				if (!options.overwrite) {
					report.skipped.push(shown);
					continue;
				}
			}
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, file.content);
			report.written.push(shown);
		}
	}
	if (!saved) {
		writeFileSync(
			join(cwd, CONFIG_FILE),
			`${JSON.stringify({ components: relative(cwd, dir) || "." }, null, "\t")}\n`,
		);
		report.configWritten = true;
	}
	return report;
}
