/**
 * Collage: a newspaper clipping lands on warm paper, a highlighter sweeps
 * the key words, a rust mark circles one; a generated archival photo
 * pushes in beside it. Grain and a vignette over everything make one surface.
 */
import {
	FilmGrain,
	FontManager,
	HalftoneScreen,
	Layer,
	LayerAnimation,
	LayerStyle,
	type LayoutNode,
	Vignette,
} from "framefields";
import { type Crop, edges, lookTokens, type Reference } from "../frame.js";
import { generatedImage } from "../images.js";
import { at, full } from "../place.js";

const look = lookTokens("collage");
const [GROUND, PAPER, INK, MARKER, RUST] = look.palette;
const FRAMES = 90;

const shadow = (u: number) =>
	new LayerStyle({
		dropShadow: {
			enabled: true,
			color: "#2a2116",
			opacity: 0.35,
			angle: 110,
			distance: 10 * u,
			size: 22 * u,
		},
	});

/** A ragged bottom edge, as if torn: a path across `w`, `depth` deep. */
function tornEdge(w: number, depth: number, seed: number): string {
	let d = `M0 0 L${w} 0`;
	const steps = Math.max(8, Math.round(w / 18));
	for (let i = steps; i >= 0; i--) {
		const x = (i / steps) * w;
		const y =
			depth *
			(0.35 + 0.65 * Math.abs((Math.sin(i * 12.9898 + seed) * 43758.5453) % 1));
		d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
	}
	return `${d} Z`;
}

/**
 * The archival photo, generated from the look's own art direction (see
 * images.ts), printed in fine halftone dots so it sits in the paper.
 */
function photo(id: string, w: number, h: number, u: number): LayoutNode {
	return Layer.image(generatedImage("collage-archive"), {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: w,
		height: h,
		fit: "cover",
	}).withEffect(
		new HalftoneScreen({
			mode: "Monochrome",
			dotShape: "Circle",
			frequency: Math.round(w / (3.2 * u)),
			angle: 45,
			dotColor: INK,
			paperColor: PAPER,
			opacity: 0.55,
		}),
	);
}

interface Clip {
	x: number;
	y: number;
	w: number;
	size: number;
}

/** The clipping: kicker, headline in two lines, the second highlighted, a circled word, body lines. */
function clipping(c: Crop, k: Clip): LayoutNode {
	const { u } = c;
	const pad = 40 * u;
	const font = {
		fontFamily: look.fonts.display,
		fontSize: k.size,
		fontWeight: 800,
	} as const;
	const lines = ["The city that", "moved its river"];
	const lh = Math.round(k.size * 1.08);
	const second = FontManager.measure(lines[1], font);
	const river = FontManager.measure("river", font);
	const riverX = pad + second.width - river.width;
	const headY = pad + 52 * u;
	const bodyY = headY + lh * 2 + 30 * u;
	const bars = [1, 0.94, 0.98, 0.72].map((f, i) =>
		at(`c-body-${i}`, pad, bodyY + i * 30 * u, (k.w - pad * 2) * f, 12 * u, {
			background: "#b7ae9c",
		}),
	);
	const h = bodyY + 4 * 30 * u + pad;
	return at("c-clip", k.x, k.y, k.w, h, {
		rotation: 2,
		children: [
			at("c-paper", 0, 0, k.w, h, { background: PAPER }),
			Layer.shape("path", {
				id: "c-torn",
				position: "absolute",
				x: 0,
				y: h,
				width: k.w,
				height: 16 * u,
				d: tornEdge(k.w, 16 * u, 3),
				fill: PAPER,
			}),
			Layer.text("THE DAILY RECORD · MAY 1931", {
				id: "c-kicker",
				position: "absolute",
				x: pad,
				y: pad,
				fontFamily: look.fonts.mono ?? look.fonts.body,
				fontSize: 20 * u,
				letterSpacing: 2 * u,
				fill: "#7a7264",
			}),
			at("c-marker", pad - 8 * u, headY + lh + 8 * u, 0, lh - 10 * u, {
				background: MARKER,
				opacity: 0.9,
			}).animate(
				LayerAnimation.create().keys("width", [
					[30, 0],
					[52, second.width + 16 * u, "power2.inOut"],
				]),
			),
			...lines.map((text, i) =>
				Layer.text(text, {
					id: `c-head-${i}`,
					position: "absolute",
					x: pad,
					y: headY + lh * i,
					...font,
					lineHeight: 1.08,
					fill: INK,
				}),
			),
			Layer.shape("ellipse", {
				id: "c-circle",
				position: "absolute",
				x: riverX - 8 * u,
				y: headY + lh - 2 * u,
				width: river.width + 22 * u,
				height: lh + 14 * u,
				fillType: "none",
				strokeColor: RUST,
				strokeWidth: 6 * u,
				trimEnd: 0,
				rotation: -4,
			}).animate(
				LayerAnimation.create().keys("trimEnd", [
					[54, 0],
					[72, 1, "power2.out"],
				]),
			),
			...bars,
		],
	})
		.withEffect(shadow(u))
		.animate(
			LayerAnimation.create()
				.keys("y", [
					[0, k.y + 60 * u],
					[16, k.y, "power3.out"],
				])
				.keys("rotation", [
					[0, 6],
					[16, 2, "power3.out"],
				]),
		);
}

function build(c: Crop): LayoutNode[] {
	const { width: W, height: H, u, tall } = c;
	const e = edges(c, 80 * u);
	const span = e.right - e.left;
	// Wide: photo left, clipping right. Tall and square: photo above, clipping over its lower edge.
	const photoBox = tall
		? {
				x: e.left + 30 * u,
				y: (e.top + e.bottom) / 2 - 620 * u,
				w: span - 60 * u,
				h: (span - 60 * u) * 0.8,
			}
		: c.id === "1:1"
			? { x: e.left + 10 * u, y: e.top, w: span * 0.62, h: span * 0.5 }
			: {
					x: e.left + 20 * u,
					y: e.top + 70 * u,
					w: span * 0.48,
					h: span * 0.36,
				};
	const clip: Clip = tall
		? {
				x: e.left + 10 * u,
				y: photoBox.y + photoBox.h - 10 * u,
				w: span - 20 * u,
				size: 82 * u,
			}
		: c.id === "1:1"
			? {
					x: e.left + span * 0.22,
					y: e.top + span * 0.4,
					w: span * 0.78,
					size: 66 * u,
				}
			: {
					x: e.left + span * 0.5,
					y: e.top + 150 * u,
					w: span * 0.5,
					size: 72 * u,
				};
	const border = 18 * u;
	const card = at(
		"c-photo",
		photoBox.x,
		photoBox.y,
		photoBox.w + border * 2,
		photoBox.h + border * 2,
		{
			background: PAPER,
			rotation: -3,
			children: [
				at("c-photo-in", border, border, photoBox.w, photoBox.h, {
					overflow: "hidden",
					children: [photo("c-pic", photoBox.w, photoBox.h, u)],
				}),
			],
		},
	)
		.withEffect(shadow(u))
		.animate(
			LayerAnimation.create().keys("scale", [
				[0, 1],
				[FRAMES, 1.05, "sine.inOut"],
			]),
		);
	return [
		full(
			"c-root",
			W,
			H,
			[
				card,
				clipping(c, clip),
				Layer.text("Source: municipal archive", {
					id: "c-source",
					position: "absolute",
					x: e.left,
					y: e.bottom - 28 * u,
					fontFamily: look.fonts.mono ?? look.fonts.body,
					fontSize: 20 * u,
					fill: INK,
					opacity: 0.7,
				}),
			],
			GROUND,
		),
	];
}

export const collage: Reference = {
	look: "collage",
	frames: FRAMES,
	hero: 78,
	build,
	grade: (comp) => {
		comp.apply(new Vignette({ strength: 30, radius: 1.0, softness: 0.8 }));
		comp.apply(
			new FilmGrain({
				strength: 12,
				size: 1.4,
				monochrome: true,
				animated: true,
			}),
		);
	},
};
