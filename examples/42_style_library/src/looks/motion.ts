/**
 * Motion: three words of condensed type rise out of masks on the beat, an
 * orange block wipes in under the last one, a ring and a rule hold the
 * corners. Near-black, off-white, one accent.
 */
import { Color, Layer, LayerAnimation, type LayoutNode } from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { at, full } from "../place.js";

const look = lookTokens("motion");
const [INK, PAPER, ACCENT] = look.palette;
const EASE = "expo.out";
const BEAT = 12;

/** One line of type rising out of its own mask. */
function line(
	id: string,
	text: string,
	x: number,
	y: number,
	size: number,
	w: number,
	delay: number,
	fill = PAPER,
): LayoutNode {
	const h = Math.round(size * 0.92);
	return at(id, x, y, w, h, {
		overflow: "hidden",
		children: [
			at(`${id}-t`, 0, 0, w, h, {
				children: [
					Layer.text(text, {
						id: `${id}-text`,
						fontFamily: look.fonts.display,
						fontSize: size,
						fontWeight: 800,
						fontVariations: { wdth: 72 },
						letterSpacing: -0.03 * size,
						lineHeight: 0.92,
						fill,
					}),
				],
			}).animate(
				LayerAnimation.create().keys("y", [
					[delay, h],
					[delay + 14, 0, EASE],
				]),
			),
		],
	});
}

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const e = edges(c, 96 * u);
	const m = e.left;
	const size = (tall ? 300 : c.id === "1:1" ? 230 : 320) * u;
	const lh = Math.round(size * 0.92);
	const top = tall ? H * 0.3 : (H - lh * (c.id === "1:1" ? 3 : 2)) / 2 - 20 * u;
	const words =
		tall || c.id === "1:1" ? ["MAKE", "IT", "MOVE."] : ["MAKE IT", "MOVE."];
	const last = words.length - 1;
	const blockY = top + lh * last;
	const blockW = size * 2.75;
	const lines = words.map((w, i) =>
		line(
			`m-line-${i}`,
			w,
			m,
			top + lh * i,
			size,
			e.right - m,
			BEAT * (i + 1),
			i === last ? INK : PAPER,
		),
	);
	const ring = 120 * u;
	return [
		full(
			"m-root",
			W,
			H,
			[
				// The accent block wipes in under the last word, a beat before it rises.
				at("m-block", m - 24 * u, blockY - 6 * u, 0, lh + 12 * u, {
					background: ACCENT,
				}).animate(
					LayerAnimation.create().keys("width", [
						[BEAT * last + 4, 0],
						[BEAT * last + 18, blockW, EASE],
					]),
				),
				...lines,
				at("m-rule", m, e.bottom - 4 * u, 0, 4 * u, {
					background: PAPER,
				}).animate(
					LayerAnimation.create().keys("width", [
						[6, 0],
						[30, 320 * u, EASE],
					]),
				),
				Layer.text("Kinetic type, cut to the beat", {
					id: "m-caption",
					position: "absolute",
					x: m,
					y: e.bottom - 56 * u,
					fontFamily: look.fonts.body,
					fontSize: 30 * u,
					fontWeight: 500,
					fill: Color.mix(PAPER, INK, 0.45),
				}).animate(LayerAnimation.create().fadeIn(20, 34, "power2.out")),
				Layer.shape("circle", {
					id: "m-ring",
					position: "absolute",
					x: e.right - ring,
					y: e.top,
					width: ring,
					height: ring,
					fill: "transparent",
					strokeColor: PAPER,
					strokeWidth: 8 * u,
					trimEnd: 0,
				}).animate(
					LayerAnimation.create().keys("trimEnd", [
						[10, 0],
						[40, 1, "power3.out"],
					]),
				),
				at(
					"m-dot",
					e.right - ring / 2 - 14 * u,
					e.top + ring / 2 - 14 * u,
					28 * u,
					28 * u,
					{
						background: ACCENT,
						borderRadius: 14 * u,
					},
				).animate(
					LayerAnimation.create().keys("scale", [
						[36, 0],
						[46, 1, "back.out(2)"],
					]),
				),
			],
			INK,
		),
	];
}

export const motion: Reference = {
	look: "motion",
	alt: "Huge off-white condensed type reading MAKE IT, with MOVE. in black on an orange block, on near-black, a ring and a dot in the corner",
	frames: 90,
	hero: 62,
	build,
};
