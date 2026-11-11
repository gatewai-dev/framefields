/**
 * Blueprint: a three-step diagram builds on a navy grid. Boxes appear, the
 * connectors draw on, the step under discussion turns amber and the rest
 * dim. A step marker and one line of code keep the viewer oriented.
 */
import { Color, Layer, LayerAnimation, type LayoutNode } from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { at, full } from "../place.js";

const look = lookTokens("blueprint");
const [NAVY, PANEL, LINE, FLOW, FOCUS] = look.palette;
const MONO = look.fonts.mono ?? look.fonts.body;
const EASE = "power2.inOut";

/** The grid: minor lines every 24 px, major every 120 px, as two paths. */
function grid(w: number, h: number, u: number): LayoutNode[] {
	const lines = (step: number) => {
		let d = "";
		for (let x = 0; x <= w; x += step) d += `M${x.toFixed(1)} 0 V${h} `;
		for (let y = 0; y <= h; y += step) d += `M0 ${y.toFixed(1)} H${w} `;
		return d;
	};
	const path = (id: string, step: number, color: string) =>
		Layer.shape("path", {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: w,
			height: h,
			d: lines(step),
			fillType: "none",
			strokeColor: color,
			strokeWidth: 1,
			strokeLineCap: "butt",
		});
	return [
		path("b-grid-minor", 24 * u, PANEL),
		path("b-grid-major", 120 * u, Color.mix(PANEL, LINE, 0.12)),
	];
}

interface Step {
	id: string;
	label: string;
	title: string;
	x: number;
	y: number;
}

function node(
	s: Step,
	i: number,
	w: number,
	h: number,
	u: number,
	focus: boolean,
): LayoutNode {
	const at0 = 6 + i * 10;
	return at(`b-${s.id}`, s.x, s.y, w, h, {
		children: [
			Layer.text(s.label, {
				id: `b-${s.id}-label`,
				position: "absolute",
				x: 0,
				y: -40 * u,
				fontFamily: MONO,
				fontSize: 20 * u,
				letterSpacing: 2 * u,
				fill: focus ? FOCUS : FLOW,
			}),
			Layer.flex({
				id: `b-${s.id}-box`,
				position: "absolute",
				x: 0,
				y: 0,
				width: w,
				height: h,
				justify: "center",
				align: "center",
				background: PANEL,
				borderColor: focus ? FOCUS : LINE,
				borderWidth: (focus ? 3 : 1.5) * u,
				borderRadius: 6 * u,
				children: [
					Layer.text(s.title, {
						id: `b-${s.id}-title`,
						fontFamily: look.fonts.body,
						fontSize: 34 * u,
						fontWeight: 600,
						fill: LINE,
					}),
				],
			}),
		],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[at0, 0],
				[at0 + 10, 1, EASE],
				...(focus
					? []
					: ([
							[52, 1],
							[64, 0.38, EASE],
						] as [number, number, string?][])),
			])
			.keys("y", [
				[at0, s.y + 16 * u],
				[at0 + 12, s.y, EASE],
			]),
	);
}

/** A connector from (x0, y0) to (x1, y1), drawn on, with its arrowhead. */
function connector(
	id: string,
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	u: number,
	start: number,
): LayoutNode[] {
	const horizontal = Math.abs(x1 - x0) > Math.abs(y1 - y0);
	const left = Math.min(x0, x1);
	const top = Math.min(y0, y1);
	const w = Math.max(1, Math.abs(x1 - x0));
	const h = Math.max(1, Math.abs(y1 - y0));
	const a = 12 * u;
	// The head in its own 2a box, its tip on (x1, y1).
	const head = horizontal
		? `M0 0 L${a} ${a} L0 ${a * 2}`
		: `M0 0 L${a} ${a} L${a * 2} 0`;
	return [
		Layer.shape("path", {
			id,
			position: "absolute",
			x: left,
			y: top,
			width: w,
			height: h,
			d: `M${x0 - left} ${y0 - top} L${x1 - left} ${y1 - top}`,
			fillType: "none",
			strokeColor: FLOW,
			strokeWidth: 3 * u,
			trimEnd: 0,
		}).animate(
			LayerAnimation.create().keys("trimEnd", [
				[start, 0],
				[start + 14, 1, EASE],
			]),
		),
		Layer.shape("path", {
			id: `${id}-head`,
			position: "absolute",
			x: x1 - a,
			y: y1 - a,
			width: horizontal ? a : a * 2,
			height: horizontal ? a * 2 : a,
			d: head,
			fillType: "none",
			strokeColor: FLOW,
			strokeWidth: 3 * u,
			opacity: 0,
		}).animate(
			LayerAnimation.create().keys("opacity", [
				[start + 12, 0],
				[start + 15, 1],
			]),
		),
	];
}

function layout(c: Crop) {
	const { u, tall } = c;
	const e = edges(c, 96 * u);
	const w = (tall ? 520 : c.id === "1:1" ? 260 : 340) * u;
	const h = (tall ? 150 : 130) * u;
	const titles = [
		["01 · INPUT", "Prompt"],
		["02 · ENGINE", "Composition"],
		["03 · OUTPUT", "Frames"],
	];
	const midY = (e.top + e.bottom) / 2;
	const steps: Step[] = titles.map(([label, title], i) =>
		tall
			? {
					id: `s${i}`,
					label,
					title,
					x: (c.width - w) / 2,
					y: midY - h / 2 + (i - 1) * (h + 170 * u),
				}
			: {
					id: `s${i}`,
					label,
					title,
					x: e.left + i * ((e.right - e.left - w) / 2),
					y: midY - h / 2 - 20 * u,
				},
	);
	return { e, w, h, steps };
}

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const { e, w, h, steps } = layout(c);
	const gap = 14 * u;
	const links = steps.slice(1).flatMap((s, i) => {
		const p = steps[i];
		return tall
			? connector(
					`b-link-${i}`,
					p.x + w / 2,
					p.y + h + gap,
					s.x + w / 2,
					s.y - 52 * u,
					u,
					26 + i * 12,
				)
			: connector(
					`b-link-${i}`,
					p.x + w + gap,
					p.y + h / 2,
					s.x - gap,
					s.y + h / 2,
					u,
					26 + i * 12,
				);
	});
	const code = "film.renderFrame({ frame: 45 })";
	return [
		full(
			"b-root",
			W,
			H,
			[
				...grid(W, H, u),
				Layer.text("How a frame is made", {
					id: "b-title",
					position: "absolute",
					x: e.left,
					y: e.top,
					fontFamily: look.fonts.display,
					fontSize: 52 * u,
					fontWeight: 600,
					fill: LINE,
				}),
				Layer.text("2 / 4", {
					id: "b-step",
					position: "absolute",
					x: e.right - 90 * u,
					y: e.top + 14 * u,
					fontFamily: MONO,
					fontSize: 26 * u,
					fill: FOCUS,
				}),
				...links,
				...steps.map((s, i) => node(s, i, w, h, u, i === 1)),
				at(
					"b-code",
					tall ? (W - 640 * u) / 2 : e.left,
					e.bottom - 76 * u,
					640 * u,
					76 * u,
					{
						background: Color.alpha(PANEL, 0.9),
						borderColor: Color.mix(PANEL, LINE, 0.2),
						borderWidth: 1.5 * u,
						borderRadius: 6 * u,
						children: [
							Layer.text(code, {
								id: "b-code-text",
								position: "absolute",
								x: 24 * u,
								y: 22 * u,
								fontFamily: MONO,
								fontSize: 26 * u,
								fill: FLOW,
							}),
						],
					},
				).animate(LayerAnimation.create().fadeIn(56, 68, EASE)),
			],
			NAVY,
		),
	];
}

export const blueprint: Reference = {
	look: "blueprint",
	alt: "A diagram on a navy grid: Prompt, Composition and Frames boxes joined by blue arrows, Composition outlined in amber, a line of code below",
	frames: 90,
	hero: 80,
	build,
};
