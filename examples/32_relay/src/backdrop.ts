/**
 * The wall behind everything: the warm gradient, with two soft glows (one
 * daylight, one a faint tint of the accent) drifting slowly across it, so
 * even a held frame breathes.
 */
import { Color, Layer, LayerAnimation, type LayoutNode } from "framefields";
import { ACCENT, H, W, WALL, WALL_LIGHT } from "./theme.js";

function glow(
	color: string,
	o: { x: number; y: number; size: number; seed: number },
): LayoutNode {
	return Layer.shape("circle", {
		position: "absolute",
		x: o.x - o.size / 2,
		y: o.y - o.size / 2,
		width: o.size,
		height: o.size,
		fill: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
	}).animate(
		LayerAnimation.create()
			.wiggle("x", { frequency: 0.12, amplitude: 160, seed: o.seed })
			.wiggle("y", { frequency: 0.1, amplitude: 90, seed: o.seed + 1 }),
	);
}

export function backdrop(): LayoutNode {
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		overflow: "hidden",
		background: `radial-gradient(ellipse at 50% 30%, ${WALL_LIGHT} 0%, ${WALL} 75%)`,
		children: [
			glow(Color.alpha("#ffffff", 0.75), {
				x: W * 0.28,
				y: H * 0.2,
				size: 1500,
				seed: 11,
			}),
			glow(Color.alpha(ACCENT, 0.09), {
				x: W * 0.78,
				y: H * 0.85,
				size: 1400,
				seed: 29,
			}),
		],
	});
}
