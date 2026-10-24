/**
 * The host framefields injects into `@framefields/components`: the `Layer`
 * factories, real font measurement and stable ids. `Layer` is read inside
 * each call, never at module load, so importing this file has no effects.
 */
import type { Host, LayerStyleConfig } from "@framefields/components";
import { frameArraySignal } from "@framefields/core";
import { FilmGrain, LayerStyle } from "../effects/index.js";
import { FontManager } from "../fonts/index.js";
import { autoId } from "../ids.js";
import { type AnimatableNode, Layer } from "../index.js";
import { Layer3D } from "../shapes3d.js";

const IMAGE = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp)(\?.*)?$/i;
const SVG = /\.svg(\?.*)?$/i;

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

/** A mid-grey SVG as a data URL: neutral under soft-light, so only its grain shows. */
function greySvg(width: number, height: number): string {
	const w = Math.max(16, Math.round(width));
	const h = Math.max(16, Math.round(height));
	return `data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#808080"/></svg>`,
	)}`;
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
		SVG.test(source)
			? Layer.svg(source, options)
			: IMAGE.test(source)
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
	particles: (options) => Layer.particles(options),
	// `Signal.fromArray` itself; the `Signal` namespace would pull every builder.
	signal: (values, fps) => frameArraySignal([...values], fps),
	grain: ({ id, x, y, width, height, strength, size }) =>
		Layer.svg(greySvg(width, height), {
			id,
			position: "absolute",
			x,
			y,
			width,
			height,
			fit: "fill",
			blendMode: "soft-light",
		}).withEffect(
			new FilmGrain({
				strength,
				...(size !== undefined && { size }),
				shadows: 1,
				midtones: 1,
				highlights: 1,
			}),
		),
	extrudedText: ({ fontWeight, ...options }) =>
		Layer3D.extrudedText({
			...options,
			...(fontWeight !== undefined && { fontWeight: String(fontWeight) }),
			align: "center",
			verticalAlign: "middle",
		} as Parameters<typeof Layer3D.extrudedText>[0]),
	matte: (node, matte, mode = "alpha") => {
		(node as unknown as AnimatableNode).withMatte(matte, mode);
		return node;
	},
};
