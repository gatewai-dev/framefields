/**
 * `framefields/library`: the curated library on framefields.dev (templates,
 * components, shaders, VFX, music, SFX, backgrounds, HDRIs …). Browse it
 * with {@link openLibrary} and {@link searchLibrary}; install items with
 * `framefields add <name>`, which copies their code and pins their media.
 * No GPU and no Node-only modules: the desktop app's page uses it too.
 */
import { openHttpRegistry, type Registry } from "./registry.js";
import { LIBRARY_URL } from "./types.js";

export {
	chainRegistries,
	checkItem,
	isContainedPath,
	isItemName,
	openHttpRegistry,
	parseItemName,
	type Registry,
	type RegistryEntry,
	type RegistryItem,
	resolveAssetUrls,
	UnknownItemError,
} from "./registry.js";
export {
	countByKind,
	type LibraryQuery,
	matchesFacets,
	searchLibrary,
} from "./search.js";
export {
	CODE_KINDS,
	isLibraryKind,
	KIND_LABELS,
	LIBRARY_ASSETS_DIR,
	LIBRARY_KINDS,
	LIBRARY_URL,
	type LibraryAnalysis,
	type LibraryAsset,
	type LibraryFacets,
	type LibraryKind,
	type LibraryLicense,
	type LibraryPreview,
	libraryUrl,
} from "./types.js";

export interface OpenLibraryOptions {
	/** Default `LIBRARY_URL`. */
	url?: string;
	fetch?: typeof fetch;
}

/** The library on framefields.dev (or a mirror) as a registry. */
export function openLibrary(options: OpenLibraryOptions = {}): Registry {
	return openHttpRegistry(options.url ?? LIBRARY_URL, options.fetch);
}
