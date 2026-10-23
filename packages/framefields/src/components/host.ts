/**
 * The host framefields injects into `@framefields/components`: the `Layer`
 * factories, real font measurement and stable ids. `Layer` is read inside
 * each call, never at module load, so importing this file has no effects.
 */
import type { Host } from "@framefields/components";
import { FontManager } from "../fonts/index.js";
import { autoId } from "../ids.js";
import { Layer } from "../index.js";

export const host: Host = {
	box: (options) => Layer.box(options),
	flex: (options) => Layer.flex(options),
	text: (content, options) => Layer.text(content, options),
	shape: (type, options) => Layer.shape(type, options),
	measure: (text, options) => FontManager.measure(text, options),
	fonts: () => FontManager.getAll().map((f) => f.family),
	autoId,
};
