/**
 * Reading a component registry: the one shipped in this package's dist, a
 * local folder, or one served over http(s). A registry is `index.json` (the
 * entries) plus `<name>.json` per component (entry, meta and files).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface RegistryEntry {
	/** What `framefields add` takes: `logo-reveal`. */
	name: string;
	/** The factory the component exports: `LogoReveal`. */
	title: string;
	summary: string;
	tags: readonly string[];
	example: string;
	/** Other components it imports, installed with it. */
	registryDependencies: string[];
}

export interface RegistryItem extends RegistryEntry {
	/** Generated from the component schema and JSDoc. */
	props?: ReadonlyArray<{
		name: string;
		type: string;
		required: boolean;
		default?: unknown;
		description?: string;
	}>;
	parts: readonly string[];
	cues: readonly string[];
	/** Fonts to install with it, by role (see `cli/fonts.ts`). */
	fonts?: ReadonlyArray<{ font: string; why: string }>;
	/** Paths relative to the components directory. */
	files: Array<{ path: string; content: string }>;
}

export interface Registry {
	/** Where it was read from, for messages. */
	source: string;
	index(): Promise<RegistryEntry[]>;
	item(name: string): Promise<RegistryItem>;
}

/** The registry shipped next to this module in dist (`dist/registry`). */
export function bundledRegistryPath(): string {
	return fileURLToPath(new URL("./registry/", import.meta.url));
}

/** `source`: a folder or an http(s) URL. Default: the bundled registry. */
export function openRegistry(source?: string, cwd = process.cwd()): Registry {
	const from =
		source ?? process.env.FRAMEFIELDS_REGISTRY ?? bundledRegistryPath();
	if (/^https?:\/\//.test(from)) {
		const base = from.endsWith("/") ? from : `${from}/`;
		const get = async <T>(file: string): Promise<T> => {
			const res = await fetch(new URL(file, base));
			if (!res.ok)
				throw new Error(
					`${new URL(file, base)}: ${res.status} ${res.statusText}`,
				);
			return (await res.json()) as T;
		};
		return {
			source: base,
			index: () => get("index.json"),
			item: (name) => get(`${name}.json`),
		};
	}
	const dir = resolve(cwd, from);
	const read = <T>(file: string): T => {
		const path = join(dir, file);
		if (!existsSync(path)) throw new Error(`No ${file} in registry ${dir}`);
		return JSON.parse(readFileSync(path, "utf8")) as T;
	};
	return {
		source: dir,
		index: async () => read("index.json"),
		item: async (name) => read(`${name}.json`),
	};
}
