/**
 * Opening registries for `framefields add`: the components shipped in this
 * package's dist, a local folder, one served over http(s), and the library
 * on framefields.dev. The format is in `library/registry.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	chainRegistries,
	checkItem,
	openHttpRegistry,
	parseItemName,
	type Registry,
	type RegistryItem,
	UnknownItemError,
} from "../library/registry.js";
import { LIBRARY_URL } from "../library/types.js";

export type {
	Registry,
	RegistryEntry,
	RegistryItem,
} from "../library/registry.js";

/** The registry shipped next to this module in dist (`dist/registry`). */
export function bundledRegistryPath(): string {
	return fileURLToPath(new URL("./registry/", import.meta.url));
}

/** `source`: a folder or an http(s) URL. Default: the bundled registry. */
export function openRegistry(source?: string, cwd = process.cwd()): Registry {
	const from =
		source ?? process.env.FRAMEFIELDS_REGISTRY ?? bundledRegistryPath();
	if (/^https?:\/\//.test(from)) return openHttpRegistry(from);
	const dir = resolve(cwd, from);
	const read = <T>(file: string): T | undefined => {
		const path = join(dir, file);
		return existsSync(path)
			? (JSON.parse(readFileSync(path, "utf8")) as T)
			: undefined;
	};
	return {
		source: dir,
		index: async () => {
			const index = read<RegistryItem[]>("index.json");
			if (!index) throw new Error(`No index.json in registry ${dir}`);
			return index;
		},
		item: async (spec) => {
			parseItemName(spec);
			const item = read<RegistryItem>(`${spec}.json`);
			if (!item) throw new UnknownItemError(spec);
			// Media URLs here must be absolute: a folder has no URL to resolve against.
			return checkItem(item, spec);
		},
	};
}

/** The library: framefields.dev, or `FRAMEFIELDS_LIBRARY` (a URL or folder). */
export function openLibraryRegistry(cwd = process.cwd()): Registry {
	return openRegistry(process.env.FRAMEFIELDS_LIBRARY ?? LIBRARY_URL, cwd);
}

/**
 * What `framefields add` reads without `--registry`: this package's own
 * components first (they match its version and work offline), then the
 * library for everything else.
 */
export function defaultRegistry(cwd = process.cwd()): Registry {
	if (process.env.FRAMEFIELDS_REGISTRY) return openRegistry(undefined, cwd);
	return chainRegistries(
		openRegistry(undefined, cwd),
		openLibraryRegistry(cwd),
	);
}
