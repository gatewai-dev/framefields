/**
 * The host framefields injects into `@framefields/components`: the `Layer`
 * factories, real font measurement and stable ids. `Layer` is read inside
 * each call, never at module load, so importing this file has no effects.
 */
import type { Host, LayerStyleConfig } from "@framefields/components";
import { LayerStyle } from "../effects/index.js";
import { FontManager } from "../fonts/index.js";
import { autoId } from "../ids.js";
import { type AnimatableNode, Layer } from "../index.js";

const IMAGE = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp)(\?.*)?$/i;

/** Every style the config names is switched on. */
function layerStyle(config: LayerStyleConfig): LayerStyle {
	const on = <T extends object>(s: T | undefined) =>
		s ? { ...s, enabled: true } : undefined;
	return new LayerStyle({
		...(config.dropShadow && { dropShadow: on(config.dropShadow) }),
		...(config.outerGlow && { outerGlow: on(config.outerGlow) }),
		...(config.innerShadow && { innerShadow: on(config.innerShadow) }),
		...(config.stroke && { stroke: on(config.stroke) }),
	} as ConstructorParameters<typeof LayerStyle>[0]);
}

export const host: Host = {
	box: (options) => Layer.box(options),
	flex: (options) => Layer.flex(options),
	text: (content, options) => Layer.text(content, options),
	shape: (type, options) => Layer.shape(type, options),
	measure: (text, options) => FontManager.measure(text, options),
	fonts: () => FontManager.getAll().map((f) => f.family),
	autoId,
	media: (source, options) =>
		IMAGE.test(source)
			? Layer.image(source, options)
			: Layer.video(source, { muted: true, ...options }),
	style: (node, config) => {
		(node as unknown as AnimatableNode).withEffect(layerStyle(config));
		return node;
	},
	cutout: (source, { mode = "person", ...options }) =>
		Layer.video(source, {
			muted: true,
			volume: 0,
			fit: "cover",
			...options,
		}).withVision({
			mode: "matte",
			enableSegmentation: true,
			// The larger model separates a subject (not just people) more cleanly.
			variant: mode === "subject" ? "m" : "s",
			confidence: 0.25,
			featherRadius: 0.04,
			keyBackground: true,
		}),
	matte: (node, matte) => {
		(node as unknown as AnimatableNode).withMatte(matte, "alpha");
		return node;
	},
};
