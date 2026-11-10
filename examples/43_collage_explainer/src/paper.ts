/**
 * The collage's pieces: paper cards that land with a small settle, photos
 * printed in fine halftone, newspaper clippings with a torn edge, the
 * highlighter that sweeps as words are spoken, and the rust marks.
 */
import {
	FontManager,
	HalftoneScreen,
	Layer,
	LayerAnimation,
	LayerStyle,
	type LayoutNode,
} from "framefields";
import {
	GROUND,
	H,
	INK,
	MARKER,
	MONO,
	PAPER,
	RUST,
	SANS,
	W,
} from "./direction.js";

export function box(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	extra: Parameters<typeof Layer.box>[0] = {},
) {
	return Layer.box({ id, position: "absolute", x, y, width, height, ...extra });
}

/** A scene's ground: the warm paper, full frame. */
export const ground = (id: string, children: LayoutNode[]) =>
	box(id, 0, 0, W, H, { background: GROUND, overflow: "hidden", children });

const shadow = () =>
	new LayerStyle({
		dropShadow: {
			enabled: true,
			color: "#2a2116",
			opacity: 0.35,
			angle: 110,
			distance: 10,
			size: 22,
		},
	});

/**
 * Lands at `at`: drops in from below with a turn, then settles at
 * `rotation`. A negative `at` means it's already in place.
 */
const land = (y: number, rotation: number, at: number) =>
	at < 0
		? LayerAnimation.create()
		: LayerAnimation.create()
				.keys("y", [
					[at, y + 70],
					[at + 16, y, "power3.out"],
				])
				.keys("rotation", [
					[at, rotation + 5],
					[at + 16, rotation, "power3.out"],
				])
				.keys("opacity", [
					[at, 0],
					[at + 4, 1],
				]);

/** A slow push for the whole scene: nothing in this look is ever still. */
export const push = (frames: number, to = 1.05) =>
	LayerAnimation.create().keys("scale", [
		[0, 1],
		[frames, to, "sine.inOut"],
	]);

/** A photo on a paper mount, printed in fine dots, landing at `at`. */
export function photoCard(o: {
	id: string;
	src: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotation: number;
	at: number;
	frames: number;
}): LayoutNode {
	const border = 18;
	const photo = Layer.image(o.src, {
		id: `${o.id}-img`,
		position: "absolute",
		x: 0,
		y: 0,
		width: o.w,
		height: o.h,
		fit: "cover",
	})
		.withEffect(
			new HalftoneScreen({
				mode: "Monochrome",
				dotShape: "Circle",
				frequency: Math.round(o.w / 3.2),
				angle: 45,
				dotColor: INK,
				paperColor: PAPER,
				opacity: 0.5,
			}),
		)
		.animate(push(o.frames, 1.08));
	return box(o.id, o.x, o.y, o.w + border * 2, o.h + border * 2, {
		background: PAPER,
		rotation: o.rotation,
		children: [
			box(`${o.id}-in`, border, border, o.w, o.h, {
				overflow: "hidden",
				children: [photo],
			}),
		],
	})
		.withEffect(shadow())
		.animate(land(o.y, o.rotation, o.at));
}

/** A ragged edge, as if torn: a path across `w`, `depth` deep. */
function torn(w: number, depth: number, seed: number): string {
	let d = `M0 0 L${w} 0`;
	const steps = Math.max(8, Math.round(w / 18));
	for (let i = steps; i >= 0; i--) {
		const r = Math.abs((Math.sin(i * 12.9898 + seed) * 43758.5453) % 1);
		d += ` L${((i / steps) * w).toFixed(1)} ${(depth * (0.35 + 0.65 * r)).toFixed(1)}`;
	}
	return `${d} Z`;
}

export interface Mark {
	/** Which line of the headline, and which words in it. */
	line: number;
	from: string;
	to?: string;
	/** Scene frame the mark starts. */
	at: number;
}

/**
 * A newspaper clipping: kicker, headline lines, and grey body lines. The
 * highlighter sweeps the words in `highlight` when they're spoken; the rust
 * pen circles `circle`.
 */
export function clipping(o: {
	id: string;
	x: number;
	y: number;
	w: number;
	kicker: string;
	lines: string[];
	size: number;
	rotation: number;
	at: number;
	highlight?: Mark;
	circle?: Mark;
	body?: number;
}): LayoutNode {
	const pad = 40;
	const font = { fontFamily: SANS, fontSize: o.size, fontWeight: 800 } as const;
	const lh = Math.round(o.size * 1.08);
	const headY = pad + 52;
	const span = (m: Mark) => {
		const line = o.lines[m.line] ?? "";
		const start = line.indexOf(m.from);
		const end = m.to ? line.indexOf(m.to) + m.to.length : start + m.from.length;
		const x = pad + FontManager.measure(line.slice(0, start), font).width;
		return {
			x,
			w: FontManager.measure(line.slice(start, end), font).width,
			y: headY + lh * m.line,
		};
	};
	const bodyY = headY + lh * o.lines.length + 30;
	const bodyLines = o.body ?? 3;
	const h = bodyY + bodyLines * 30 + pad;
	const children: LayoutNode[] = [
		box(`${o.id}-paper`, 0, 0, o.w, h, { background: PAPER }),
	];
	children.push(
		Layer.shape("path", {
			id: `${o.id}-torn`,
			position: "absolute",
			x: 0,
			y: h,
			width: o.w,
			height: 16,
			d: torn(o.w, 16, o.w),
			fill: PAPER,
		}),
		Layer.text(o.kicker, {
			id: `${o.id}-kicker`,
			position: "absolute",
			x: pad,
			y: pad,
			fontFamily: MONO,
			fontSize: 20,
			letterSpacing: 2,
			fill: "#7a7264",
		}),
	);
	if (o.highlight) {
		const s = span(o.highlight);
		children.push(
			box(`${o.id}-marker`, s.x - 8, s.y + 6, 0, lh - 8, {
				background: MARKER,
				opacity: 0.9,
			}).animate(
				LayerAnimation.create().keys("width", [
					[o.highlight.at, 0],
					[o.highlight.at + 14, s.w + 16, "power2.inOut"],
				]),
			),
		);
	}
	o.lines.forEach((text, i) => {
		children.push(
			Layer.text(text, {
				id: `${o.id}-head-${i}`,
				position: "absolute",
				x: pad,
				y: headY + lh * i,
				...font,
				lineHeight: 1.08,
				fill: INK,
			}),
		);
	});
	if (o.circle) {
		const s = span(o.circle);
		children.push(
			Layer.shape("ellipse", {
				id: `${o.id}-circle`,
				position: "absolute",
				x: s.x - 14,
				y: s.y - 4,
				width: s.w + 40,
				height: lh + 12,
				fillType: "none",
				strokeColor: RUST,
				strokeWidth: 6,
				trimEnd: 0,
				rotation: -4,
			}).animate(
				LayerAnimation.create().keys("trimEnd", [
					[o.circle.at, 0],
					[o.circle.at + 16, 1, "power2.out"],
				]),
			),
		);
	}
	for (let i = 0; i < bodyLines; i++)
		children.push(
			box(
				`${o.id}-body-${i}`,
				pad,
				bodyY + i * 30,
				(o.w - pad * 2) * [1, 0.94, 0.7, 0.86][i % 4],
				12,
				{ background: "#b7ae9c" },
			),
		);
	return box(o.id, o.x, o.y, o.w, h, { rotation: o.rotation, children })
		.withEffect(shadow())
		.animate(land(o.y, o.rotation, o.at));
}

/** A short label on a scrap of paper, in the margin: sources, dates, figures. */
export function label(o: {
	id: string;
	text: string;
	x: number;
	y: number;
	size?: number;
	at: number;
	rotation?: number;
	mono?: boolean;
}): LayoutNode {
	const size = o.size ?? 30;
	const font = {
		fontFamily: o.mono ? MONO : SANS,
		fontSize: size,
		fontWeight: o.mono ? 400 : 800,
	} as const;
	const w = FontManager.measure(o.text, font).width + 36;
	const rotation = o.rotation ?? -2;
	return box(o.id, o.x, o.y, w, size * 1.6, {
		background: PAPER,
		rotation,
		children: [
			Layer.text(o.text, {
				id: `${o.id}-t`,
				position: "absolute",
				x: 18,
				y: size * 0.3,
				...font,
				fill: INK,
			}),
		],
	})
		.withEffect(shadow())
		.animate(land(o.y, rotation, o.at));
}

/** The film's last line: what it is, honestly. */
export const footnote = (id: string, at: number) =>
	Layer.text(
		"An invented story, for illustration. Pictures generated with AI.",
		{
			id,
			position: "absolute",
			x: 96,
			y: H - 96,
			fontFamily: MONO,
			fontSize: 20,
			fill: INK,
			opacity: 0,
		},
	).animate(
		LayerAnimation.create().keys("opacity", [
			[at, 0],
			[at + 12, 0.75],
		]),
	);
