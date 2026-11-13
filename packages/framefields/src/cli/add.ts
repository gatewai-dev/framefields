/**
 * `framefields add`: copy components' source into a project, the way a
 * shadcn-style registry does. The code becomes the project's own; it
 * imports only `framefields` and `framefields/components` (the toolkit),
 * plus any component it builds on, which is installed alongside it.
 *
 * Where they go is remembered in `framefields.json` at the project root.
 * Components that draw with fonts beyond the theme's (emoji) get them
 * installed too, plus a generated `fonts.ts` that registers them.
 *
 * Library items (`framefields add music/neon-drive`) may also carry media:
 * each file is pinned by content in `framefields.json` under
 * `assets/library/`, downloaded verified, and kept out of git, so cloud
 * renders fetch the same bytes.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { downloadVerified } from "@framefields/storage";
import { LIBRARY_ASSETS_DIR } from "../library/types.js";
import { ignore, localState, megabytes, sortKeys } from "./assets.js";
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
	/** Download items' media now (default true); pinned either way. */
	media?: boolean;
	/** For tests; how media is downloaded. Default the global `fetch`. */
	fetchMedia?: typeof fetch;
	log?: (line: string) => void;
}

/** A media file an item installed. */
export interface MediaInstall {
	/** Project-relative path, pinned in `framefields.json`. */
	path: string;
	size: number;
	/**
	 * `downloaded` now, already `present`, only `pinned` (`media: false`), or
	 * `changed`: a different file is there, left alone unless `overwrite`.
	 */
	state: "downloaded" | "present" | "pinned" | "changed";
	by: string;
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
	/** Media the items pinned. */
	media: MediaInstall[];
}

/** Resolve `names` (and what they import) and write their files. */
export async function add(
	names: string[],
	options: AddOptions,
): Promise<AddReport> {
	const { cwd, registry } = options;
	// Depth-first, dependencies before dependants; every item is resolved
	// (and checked) before anything is written.
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
		media: [],
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
		writeConfig(cwd, { ...config, components: relative(cwd, dir) || "." });
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
	report.media = await installMedia(order, options);
	return report;
}

/** Pins every item's media in `framefields.json`, then downloads what's missing. */
async function installMedia(
	items: RegistryItem[],
	options: AddOptions,
): Promise<MediaInstall[]> {
	const { cwd } = options;
	const wanted = items.flatMap((item) =>
		(item.assets ?? []).map((asset) => ({
			asset,
			by: item.name,
			path: `${LIBRARY_ASSETS_DIR}/${asset.path}`,
		})),
	);
	if (wanted.length === 0) return [];
	for (const { asset, by } of wanted)
		if (!/^https?:\/\//.test(asset.url))
			throw new Error(
				`${by}: media ${asset.path} has no http(s) URL (${asset.url}).`,
			);
	const { config } = readConfig(cwd);
	const assets = { ...config.assets };
	for (const { asset, path } of wanted)
		assets[path] = { sha256: asset.sha256, size: asset.size, url: asset.url };
	writeConfig(cwd, { ...config, assets: sortKeys(assets) });
	ignore(
		cwd,
		wanted.map((w) => w.path),
	);

	const done: MediaInstall[] = [];
	for (const { asset, by, path } of wanted) {
		const base = { path, size: asset.size, by };
		if (options.media === false) {
			done.push({ ...base, state: "pinned" });
			continue;
		}
		const state = await localState(cwd, path, asset);
		if (state === "ok" || (state === "changed" && !options.overwrite)) {
			done.push({ ...base, state: state === "ok" ? "present" : "changed" });
			continue;
		}
		options.log?.(`Downloading ${path} (${megabytes(asset.size)})`);
		await downloadVerified(asset.url, join(cwd, path), asset, {
			fetch: options.fetchMedia,
		});
		done.push({ ...base, state: "downloaded" });
	}
	return done;
}
