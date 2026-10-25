/**
 * `framefields add`: copy components' source into a project, the way a
 * shadcn-style registry does. The code becomes the project's own; it
 * imports only `framefields` and `framefields/components` (the toolkit),
 * plus any component it builds on, which is installed alongside it.
 *
 * Where they go is remembered in `framefields.json` at the project root.
 * Components that draw with fonts beyond the theme's (emoji) get them
 * installed too, plus a generated `fonts.ts` that registers them.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { readConfig, writeConfig } from "./config.js";
import {
	type Fetch,
	type FontInstall,
	type FontSpec,
	type FontsModule,
	installFont,
	writeFontsModule,
} from "./fonts.js";
import type { Registry, RegistryItem } from "./registry.js";

export { CONFIG_FILE, type ProjectConfig, readConfig } from "./config.js";

export interface AddOptions {
	cwd: string;
	registry: Registry;
	/** Components directory; saved to `framefields.json` if there is none yet. */
	dir?: string;
	/** Replace files that differ from the registry's. */
	overwrite?: boolean;
	/** Install the fonts components ask for (default true). */
	fonts?: boolean;
	/** Folder for downloaded fonts. Default `assets/fonts`. */
	fontsDir?: string;
	/** For tests; default the global `fetch`. */
	fetch?: Fetch;
	/** For tests; default the built-in font catalog. */
	fontCatalog?: Record<string, FontSpec>;
	/** Called before a font download starts. */
	onDownload?: (spec: FontSpec) => void;
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
	/** Fonts the components asked for, and what happened to each. */
	fonts: Array<FontInstall & { why: string; by: string }>;
	/** Fonts asked for but not installed (`fonts: false`), with why. */
	fontsSkipped: Array<{ role: string; why: string; by: string }>;
	/** The generated `fonts.ts`, when any font is installed. */
	fontsModule?: FontsModule;
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
		fonts: [],
		fontsSkipped: [],
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
		writeConfig(cwd, { components: relative(cwd, dir) || "." });
		report.configWritten = true;
	}

	// One install per font, credited to the first component that asks.
	const needs = new Map<string, { why: string; by: string }>();
	for (const item of order)
		for (const f of item.fonts ?? [])
			if (!needs.has(f.font)) needs.set(f.font, { why: f.why, by: item.name });
	for (const [role, need] of needs) {
		if (options.fonts === false) {
			report.fontsSkipped.push({ role, ...need });
			continue;
		}
		const done = await installFont(role, {
			cwd,
			dir: options.fontsDir,
			overwrite: options.overwrite,
			fetch: options.fetch,
			catalog: options.fontCatalog,
			onDownload: options.onDownload,
		});
		report.fonts.push({ ...done, ...need });
	}
	if (report.fonts.length > 0 || readConfig(cwd).config.fonts)
		report.fontsModule = writeFontsModule(cwd, dir, options.fontCatalog);
	return report;
}
