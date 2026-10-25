/**
 * Component metadata: the discovery surface for docs and coding agents.
 * Each component's `meta.ts` default-exports one; `scripts/build-meta.ts`
 * collects them into `components.json`.
 */

export interface ComponentMeta {
	/** PascalCase export name. */
	name: string;
	/** One sentence: what it is and when to use it. */
	summary: string;
	tags: readonly string[];
	/** Named parts `customize` and `part()` expose (besides `root`, `stage`). */
	parts: readonly string[];
	/** Cue names on `node.cues`. */
	cues: readonly string[];
	/** A minimal, runnable call. */
	example: string;
	/** Spec milestone that introduced it. */
	since: string;
	/**
	 * Fonts it draws with beyond the theme's families. `framefields add`
	 * installs each one into the project (pinned, hash-checked) and registers
	 * it in the generated `fonts.ts`.
	 */
	fonts?: readonly FontNeed[];
}

/** Fonts `framefields add` knows how to install, by role. */
export type FontRole = "emoji" | "sans" | "mono";

export interface FontNeed {
	font: FontRole;
	/** Why, shown when `add` installs it. */
	why: string;
}

export function defineMeta(meta: ComponentMeta): ComponentMeta {
	if (!/^[A-Z][A-Za-z0-9]+$/.test(meta.name)) {
		throw new Error(`Component name must be PascalCase: "${meta.name}"`);
	}
	if (meta.summary.length > 200) {
		throw new Error(
			`${meta.name}: summary must be one sentence (≤ 200 chars).`,
		);
	}
	return meta;
}
