/**
 * The registry format `framefields add` reads, shared by the components
 * shipped in this package and the library on framefields.dev: `index.json`
 * (the entries) plus `<name>.json` per item (entry, meta, files, media).
 * Names may have a kind folder (`music/neon-drive`) and a version
 * (`music/neon-drive@2`, read from `music/neon-drive@2.json`).
 */
import type {
	LibraryAnalysis,
	LibraryAsset,
	LibraryFacets,
	LibraryKind,
	LibraryLicense,
	LibraryPreview,
} from "./types.js";

export interface RegistryEntry {
	/** What `framefields add` takes: `logo-reveal`, `music/neon-drive`. */
	name: string;
	/** The factory or constant the item exports: `LogoReveal`, `neonDrive`. */
	title: string;
	/** What people see it called (`Neon drive`); default `title`. */
	label?: string;
	summary: string;
	tags: readonly string[];
	example: string;
	/** Other items it imports, installed with it. */
	registryDependencies: string[];
	/** Default `component`. */
	kind?: LibraryKind;
	/** Bumped whenever the item's content changes; `name@version` pins one. */
	version?: number;
	license?: LibraryLicense;
	preview?: LibraryPreview;
	facets?: LibraryFacets;
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
	/** Media pinned into `framefields.json` and downloaded on install. */
	assets?: LibraryAsset[];
	analysis?: LibraryAnalysis;
}

export interface Registry {
	/** Where it was read from, for messages and relative media URLs. */
	source: string;
	index(): Promise<RegistryEntry[]>;
	/** Throws {@link UnknownItemError} when the registry has no such item. */
	item(name: string): Promise<RegistryItem>;
}

/** The registry has no item by that name (or version). */
export class UnknownItemError extends Error {
	override name = "UnknownItemError";
	constructor(readonly item: string) {
		super(
			`Unknown item "${item}". Run \`framefields list\` for components, \`framefields library\` for the library.`,
		);
	}
}

const ITEM_NAME = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)?(@[1-9]\d*)?$/;

/** `music/neon-drive@2` is valid; anything that could escape a folder is not. */
export function isItemName(name: string): boolean {
	return name.length <= 128 && ITEM_NAME.test(name);
}

/** `music/neon-drive@2` → `{ name: "music/neon-drive", version: 2 }`. */
export function parseItemName(spec: string): {
	name: string;
	version?: number;
} {
	if (!isItemName(spec)) throw new UnknownItemError(spec);
	const at = spec.indexOf("@");
	return at < 0
		? { name: spec }
		: { name: spec.slice(0, at), version: Number(spec.slice(at + 1)) };
}

/** A relative POSIX path that stays inside the folder it's joined to. */
export function isContainedPath(path: string): boolean {
	return (
		path.length > 0 &&
		path.length <= 1024 &&
		!path.startsWith("/") &&
		!path.includes("\\") &&
		!path.includes("\0") &&
		!path
			.split("/")
			.some((part) => part === "" || part === "." || part === "..")
	);
}

/**
 * Checks what an item would write before anything is written: a registry
 * served over http must not be able to place files outside the project.
 */
export function checkItem(item: RegistryItem, asked: string): RegistryItem {
	const bad = (what: string) =>
		new Error(`Registry item "${asked}" has an invalid ${what}.`);
	if (!isItemName(item.name)) throw bad(`name "${item.name}"`);
	for (const d of item.registryDependencies)
		if (!isItemName(d)) throw bad(`dependency "${d}"`);
	for (const f of item.files)
		if (!isContainedPath(f.path) || typeof f.content !== "string")
			throw bad(`file path "${f.path}"`);
	for (const a of item.assets ?? [])
		if (
			!isContainedPath(a.path) ||
			!/^[0-9a-f]{64}$/.test(a.sha256) ||
			!Number.isSafeInteger(a.size) ||
			a.size < 0 ||
			typeof a.url !== "string"
		)
			throw bad(`asset "${a.path}"`);
	return item;
}

/** A registry served over http(s): the library, or any mirror of it. */
export function openHttpRegistry(
	url: string,
	fetchImpl: typeof fetch = fetch,
): Registry {
	const base = url.endsWith("/") ? url : `${url}/`;
	const get = async <T>(file: string, name?: string): Promise<T> => {
		const at = new URL(file, base);
		const res = await fetchImpl(at);
		if (res.status === 404 && name) throw new UnknownItemError(name);
		if (!res.ok) throw new Error(`${at}: ${res.status} ${res.statusText}`);
		return (await res.json()) as T;
	};
	return {
		source: base,
		index: () => get("index.json"),
		item: async (spec) => {
			parseItemName(spec);
			const item = checkItem(
				await get<RegistryItem>(`${spec}.json`, spec),
				spec,
			);
			return resolveAssetUrls(item, base);
		},
	};
}

/** Makes an item's media URLs absolute against the registry they came from. */
export function resolveAssetUrls(
	item: RegistryItem,
	base: string,
): RegistryItem {
	if (!item.assets) return item;
	return {
		...item,
		assets: item.assets.map((a) => ({ ...a, url: new URL(a.url, base).href })),
	};
}

/**
 * Looks items up in each registry in turn: the first that has one wins.
 * Later registries are only asked (and only fetched) for names the earlier
 * ones lack, so adding a bundled component never touches the network.
 */
export function chainRegistries(...registries: Registry[]): Registry {
	if (registries.length === 1 && registries[0]) return registries[0];
	return {
		source: registries.map((r) => r.source).join(" + "),
		index: async () => {
			const seen = new Set<string>();
			const out: RegistryEntry[] = [];
			for (const r of registries)
				for (const e of await r.index())
					if (!seen.has(e.name)) {
						seen.add(e.name);
						out.push(e);
					}
			return out;
		},
		item: async (name) => {
			for (const r of registries) {
				try {
					return await r.item(name);
				} catch (err) {
					if (!(err instanceof UnknownItemError)) throw err;
				}
			}
			throw new UnknownItemError(name);
		},
	};
}
