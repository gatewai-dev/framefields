/**
 * Relay's mark: a request (the dot) handed on (the arrow), white on the
 * accent. On the end card the dot appears and the arrow draws itself on.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { transformPathData } from "framefields/components";
import { ACCENT } from "../theme.js";
import { dot, fade } from "./kit.js";

/** Corner radius, as a share of the mark's size. */
export const MARK_RADIUS = 0.28;
const ARROW = "M10.5 12 L17.5 12 M14 8.5 L17.5 12 L14 15.5";

export function relayMark(o: {
	x: number;
	y: number;
	size: number;
	/** Draw the arrow on from this frame (local); drawn from the start otherwise. */
	drawAt?: number;
	id?: string;
}): LayoutNode {
	const k = o.size / 24;
	const arrow = Layer.shape("path", {
		position: "absolute",
		x: 0,
		y: 0,
		width: o.size,
		height: o.size,
		d: transformPathData(ARROW, k),
		fillType: "none",
		strokeColor: "#ffffff",
		strokeWidth: 2.4 * k,
		strokeLineCap: "round",
		strokeLineJoin: "round",
	});
	const request = dot({
		x: 5 * k,
		y: 9.6 * k,
		size: 4.8 * k,
		color: "#ffffff",
	});
	if (o.drawAt !== undefined) {
		request.animate(fade(o.drawAt - 4, 6));
		arrow.animate(
			LayerAnimation.keys("trimEnd", [
				[0, 0],
				[o.drawAt, 0, "hold"],
				[o.drawAt + 18, 1, "power3.inOut"],
			]),
		);
	}
	return Layer.box({
		...(o.id && { id: o.id }),
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.size,
		height: o.size,
		borderRadius: o.size * MARK_RADIUS,
		background: ACCENT,
		children: [request, arrow],
	});
}
