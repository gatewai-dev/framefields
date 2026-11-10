/**
 * The framefields style library: looks, formats, genres, media and the presets
 * that combine them. Text only (no GPU, no rendering), so apps can show the
 * library and build briefs without loading the engine.
 *
 * ```ts
 * import { combineStyles, presetMix, styleLibrary } from "framefields/styles";
 *
 * const teaser = styleLibrary.presets.find((p) => p.id === "launch-teaser");
 * const brief = combineStyles({ ...presetMix(teaser), format: "vertical" });
 * ```
 *
 * The source is the `framefields-styles` agent skill; `catalog.json` is
 * generated from it (`pnpm run sync:style-library`).
 */
import catalog from "./catalog.json" with { type: "json" };
import {
	combineResolved,
	mixClashes,
	type ResolvedMix,
	resolveMix,
	type StyleClash,
} from "./combine.js";
import type { StyleLibrary, StyleMix } from "./types.js";

export { presetMix, type ResolvedMix, type StyleClash } from "./combine.js";
export type * from "./types.js";

/** Every look, format, genre, medium and preset. */
export const styleLibrary = catalog as StyleLibrary;

/** Looks a mix's ids up; null when one is unknown to this version of the library. */
export function resolveStyleMix(mix: StyleMix): ResolvedMix | null {
	return resolveMix(styleLibrary, mix);
}

/**
 * The mix as one brief for an agent (or a person), parts in precedence order.
 * Throws when an id is unknown; use {@link resolveStyleMix} to check first.
 */
export function combineStyles(mix: StyleMix): string {
	const resolved = resolveMix(styleLibrary, mix);
	if (!resolved) throw new Error(`Unknown style in ${JSON.stringify(mix)}`);
	return combineResolved(resolved);
}

/** Pairs in the mix that pull against each other: hints, never blocks. */
export function styleClashes(mix: StyleMix): StyleClash[] {
	const resolved = resolveMix(styleLibrary, mix);
	return resolved ? mixClashes(resolved) : [];
}
