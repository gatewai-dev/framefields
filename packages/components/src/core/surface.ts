/**
 * Surfaces: the look shared by plates, cards, toasts and bubbles. A surface
 * sits at an elevation from the theme (a soft shadow, plus a lit top edge on
 * dark themes) and can carry a faint top-to-bottom sheen.
 */
import type { LayoutNode } from "@framefields/compositions/program";
import { mix } from "./color.js";
import type { Animatable, Host, LayerStyleConfig } from "./host.js";
import type { Theme } from "./theme.js";

export type ElevationLevel = keyof Theme["elevation"];

/** Layer styles for `level`: a drop shadow and, when the theme asks, a top-edge highlight. */
export function elevationStyle(
	theme: Theme,
	level: ElevationLevel,
): LayerStyleConfig {
	const e = theme.elevation[level];
	const s = theme.scale;
	return {
		...(e.opacity > 0 && {
			dropShadow: {
				color: theme.color.shadow,
				opacity: e.opacity,
				angle: 90,
				distance: e.distance * s,
				size: e.size * s,
			},
		}),
		...(e.edge > 0 && {
			innerShadow: {
				color: "#ffffff",
				opacity: e.edge,
				angle: 270,
				distance: Math.max(1, s),
				size: 0,
				blendMode: "normal",
			},
		}),
	};
}

/** Put `node` at `level` (or leave it flat for `false`); returns it. */
export function elevate<T extends Animatable<LayoutNode>>(
	host: Host,
	node: T,
	theme: Theme,
	level: ElevationLevel | false,
): T {
	if (level === false) return node;
	const style = elevationStyle(theme, level);
	return Object.keys(style).length > 0 ? host.style(node, style) : node;
}

/**
 * A background for a surface of `color`: a vertical sheen a few percent
 * lighter at the top on dark themes (light themes stay flat, where a
 * lighter top reads as a glare). Non-hex / non-rgb colors pass through.
 */
export function surfaceFill(color: string, theme: Theme, sheen = 0.05): string {
	if (theme.mode === "light" || sheen <= 0) return color;
	const top = mix(color, "#ffffff", sheen);
	return top === color
		? color
		: `linear-gradient(180deg, ${top} 0%, ${color} 100%)`;
}
