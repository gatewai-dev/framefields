/**
 * `framefields/components`: the toolkit components are built from. The
 * components themselves are not in the package: `npx framefields add <name>`
 * copies their source into your project, where it imports this toolkit
 * (timing, paths, strokes, targets, baking, themes) and `bindComponent`.
 *
 * Named exports with no top-level calls, so bundlers keep only what a
 * project's components use.
 */

import type {
	BaseProps,
	ComponentDefinition,
	ComponentExtras,
	Cues,
} from "@framefields/components/toolkit";
import { bind } from "@framefields/components/toolkit";
import type { BoxNode } from "@framefields/compositions/program";
import type { z } from "zod";
import type { AnimatableNode } from "../index.js";
import { host } from "./host.js";

/** A component's root: a normal framefields box layer plus cues, span and parts. */
export type ComponentNode<C extends Cues = Cues> = AnimatableNode<BoxNode> &
	ComponentExtras<C>;

/**
 * Bind a component definition to framefields, producing its factory. Every
 * installed component ends with one of these; use it for your own
 * components built with `defineComponent` too.
 */
export function bindComponent<
	S extends z.ZodRawShape,
	C extends Cues,
	E extends object = object,
>(
	definition: ComponentDefinition<S, C, E>,
): (props: z.input<z.ZodObject<S>> & BaseProps) => ComponentNode<C> & E {
	return bind(host, definition) as never;
}

export * from "@framefields/components/toolkit";
/** framefields' own zod, so component schemas share its instance. */
export { z } from "zod";
export { analyzeAudio } from "./audio.js";
