/**
 * The film's type: small labels in mono caps, quiet sentences in the sans,
 * and the rules and leaders that tie a label to what it names. Everything
 * fades in and out on the scene's own frames.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { H, INK, INK_SOFT, MONO, RULE, SANS, W } from "./theme.js";

/** Frames a label takes to arrive or leave. */
const FADE = 14;

interface Span {
	/** Scene-local frames the layer is shown from and until. */
	from: number;
	to: number;
}

/** Opacity up at `from` and down by `to`, rising a few pixels as it arrives. */
function appear(y: number, { from, to }: Span, rise = 10) {
	return LayerAnimation.create()
		.keys("opacity", [
			[0, 0],
			[from, 0, "hold"],
			[from + FADE, 1, "power2.out"],
			[to - FADE, 1, "hold"],
			[to, 0, "power2.in"],
		])
		.keys("y", [
			[0, y + rise],
			[from, y + rise, "hold"],
			[from + FADE + 6, y, "expo.out"],
		]);
}

interface TextOptions extends Span {
	id: string;
	x: number;
	y: number;
	width?: number;
	align?: "start" | "center" | "end";
	fill?: string;
	size?: number;
}

/** A small label in spaced mono caps. */
export function label(text: string, o: TextOptions): LayoutNode {
	return Layer.text(text.toUpperCase(), {
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width ?? 600,
		fontFamily: MONO,
		fontSize: o.size ?? 24,
		fontWeight: 500,
		letterSpacing: 3,
		fill: o.fill ?? INK_SOFT,
		align: o.align ?? "start",
		opacity: 0,
	}).animate(appear(o.y, o));
}

/** A sentence or a name in the sans. */
export function line(
	text: string,
	o: TextOptions & { weight?: number },
): LayoutNode {
	return Layer.text(text, {
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width ?? 900,
		fontFamily: SANS,
		fontSize: o.size ?? 44,
		fontWeight: o.weight ?? 500,
		lineHeight: 1.2,
		fill: o.fill ?? INK,
		align: o.align ?? "start",
		opacity: 0,
	}).animate(appear(o.y, o, 16));
}

/** A number or a unit in the mono. */
export function figure(text: string, o: TextOptions): LayoutNode {
	return Layer.text(text, {
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width ?? 900,
		fontFamily: MONO,
		fontSize: o.size ?? 40,
		fontWeight: 400,
		fill: o.fill ?? INK,
		align: o.align ?? "start",
		opacity: 0,
	}).animate(appear(o.y, o, 12));
}

/** A hairline from (x1, y1) to (x2, y2), drawn on at `from`, with a dot where it ends. */
export function leader(
	id: string,
	[x1, y1]: [number, number],
	[x2, y2]: [number, number],
	{ from, to }: Span,
	color = INK_SOFT,
): LayoutNode[] {
	const fade = LayerAnimation.create().keys("opacity", [
		[0, 0],
		[from, 0, "hold"],
		[from + 4, 1],
		[to - FADE, 1, "hold"],
		[to, 0, "power2.in"],
	]);
	return [
		Layer.shape("path", {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			d: `M ${x1} ${y1} L ${x2} ${y2}`,
			fillType: "none",
			strokeColor: color,
			strokeWidth: 1.5,
			trimStart: 0,
			trimEnd: 0,
			opacity: 0,
		})
			.animate(fade)
			.animate(
				LayerAnimation.create().keys("trimEnd", [
					[0, 0],
					[from, 0, "hold"],
					[from + 16, 1, "expo.out"],
				]),
			),
		Layer.shape("circle", {
			id: `${id}-dot`,
			position: "absolute",
			x: x2 - 4,
			y: y2 - 4,
			width: 8,
			height: 8,
			fill: color,
			opacity: 0,
		}).animate(
			LayerAnimation.create().keys("opacity", [
				[0, 0],
				[from + 12, 0, "hold"],
				[from + 18, 1],
				[to - FADE, 1, "hold"],
				[to, 0, "power2.in"],
			]),
		),
	];
}

/** A short horizontal rule. */
export function rule(
	id: string,
	x: number,
	y: number,
	width: number,
	span: Span,
	color = RULE,
): LayoutNode {
	return Layer.box({
		id,
		position: "absolute",
		x,
		y,
		width,
		height: 1.5,
		background: color,
		opacity: 0,
	}).animate(appear(y, span, 0));
}
