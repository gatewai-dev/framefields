/**
 * The collage kit: the desk, sheets of paper laid on it with a soft shadow,
 * strips torn from a roll, tape, rubber stamps and pins. Torn edges are
 * seeded, so a strip tears the same way on every render.
 */
import {
	Color,
	Layer,
	LayerAnimation,
	LayerStyle,
	type LayoutNode,
} from "framefields";
import { rng, toPathData, type Vec2 } from "framefields/components";
import {
	H,
	INK,
	MONO,
	PAPER,
	PAPER_DEEP,
	RED,
	SHADOW,
	SHEET,
	W,
} from "./theme.js";

type Node = ReturnType<typeof Layer.box>;

/** A soft contact shadow under paper: short, warm and a little to the right. */
export const paperShadow = (lift = 1) =>
	new LayerStyle({
		dropShadow: {
			enabled: true,
			color: SHADOW,
			opacity: 0.22 + 0.06 * lift,
			angle: 115,
			distance: 5 * lift,
			size: 14 * lift,
		},
	});

/**
 * Paper fibre as an SVG: fractal noise turned grey, for a soft-light pass
 * over the whole frame (grey is neutral there, so only the grain shows).
 */
function fibreSvg(seed: number, frequency: number, octaves: number): string {
	return `data:image/svg+xml;utf8,${encodeURIComponent(
		`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><filter id="f" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="${seed}"/><feColorMatrix type="matrix" values="0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 0 1"/></filter><rect width="${W}" height="${H}" filter="url(#f)"/></svg>`,
	)}`;
}

/** The texture over everything: fine fibre, and a slow mottle of thicker paper. */
export function paperTexture(): LayoutNode[] {
	const full = {
		position: "absolute" as const,
		x: 0,
		y: 0,
		width: W,
		height: H,
	};
	return [
		Layer.svg(fibreSvg(11, 0.7, 3), {
			id: "paper-fibre",
			...full,
			fit: "fill",
			blendMode: "soft-light",
			opacity: 0.55,
		}),
		Layer.svg(fibreSvg(23, 0.006, 4), {
			id: "paper-mottle",
			...full,
			fit: "fill",
			blendMode: "soft-light",
			opacity: 0.4,
		}),
	];
}

/** The desk: warm paper, a little darker toward the corners. */
export function desk(id: string): LayoutNode {
	return Layer.box({
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: `radial-gradient(ellipse at 50% 45%, ${PAPER} 0%, ${PAPER} 45%, ${PAPER_DEEP} 100%)`,
	});
}

export interface SheetOptions {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation?: number;
	color?: string;
	children?: LayoutNode[];
	lift?: number;
	/** Clip children to the sheet. */
	clip?: boolean;
}

/** A sheet of paper on the desk. */
export function sheet(o: SheetOptions): Node {
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width,
		height: o.height,
		rotation: o.rotation ?? 0,
		background: o.color ?? SHEET,
		...(o.clip !== false && { overflow: "hidden" as const }),
		children: o.children ?? [],
	}).withEffect(paperShadow(o.lift));
}

/**
 * The outline of a strip torn off a roll, `width` × `height`: the long edges
 * waver a little, the short ends are ragged.
 */
export function tornPath(width: number, height: number, seed: number): string {
	const r = rng(seed);
	const tear = Math.min(14, height * 0.14);
	const points: Vec2[] = [];
	const edge = (from: Vec2, to: Vec2, steps: number, jag: number) => {
		for (let i = 0; i < steps; i++) {
			const t = i / steps;
			const x = from[0] + (to[0] - from[0]) * t;
			const y = from[1] + (to[1] - from[1]) * t;
			const nx = to[1] - from[1];
			const ny = from[0] - to[0];
			const len = Math.hypot(nx, ny) || 1;
			const d = r.spread(jag);
			points.push([x + (nx / len) * d, y + (ny / len) * d]);
		}
	};
	edge([tear, 0], [width - tear, 0], Math.round(width / 60), 1.6);
	edge([width - tear, 0], [width - tear, height], Math.round(height / 7), tear);
	edge([width - tear, height], [tear, height], Math.round(width / 60), 1.6);
	edge([tear, height], [tear, 0], Math.round(height / 7), tear);
	return toPathData(points, true);
}

/** A torn strip of colored paper (a label, a highlight band, a title). */
export function strip(o: {
	id: string;
	x: number;
	y: number;
	width: number;
	height: number;
	color: string;
	seed: number;
	rotation?: number;
	children?: LayoutNode[];
}): Node {
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.width,
		height: o.height,
		rotation: o.rotation ?? 0,
		children: [
			Layer.shape("path", {
				id: `${o.id}-paper`,
				position: "absolute",
				x: 0,
				y: 0,
				width: o.width,
				height: o.height,
				d: tornPath(o.width, o.height, o.seed),
				fill: o.color,
			}).withEffect(paperShadow(0.7)),
			...(o.children ?? []),
		],
	});
}

/** A piece of masking tape across a corner. */
export function tape(o: {
	id: string;
	x: number;
	y: number;
	width?: number;
	rotation: number;
	seed: number;
}) {
	const width = o.width ?? 150;
	const height = 40;
	return Layer.shape("path", {
		id: o.id,
		position: "absolute",
		x: o.x - width / 2,
		y: o.y - height / 2,
		width,
		height,
		rotation: o.rotation,
		d: tornPath(width, height, o.seed),
		fill: Color.alpha("#efe3c2", 0.82),
	});
}

/** A rubber stamp: ink in a ruled box, slightly rotated, a little uneven. */
export function stamp(o: {
	id: string;
	text: string;
	x: number;
	y: number;
	rotation: number;
	color?: string;
	fontSize?: number;
}): Node {
	const color = o.color ?? RED;
	const size = o.fontSize ?? 30;
	const pad = size * 0.45;
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.x,
		y: o.y,
		rotation: o.rotation,
		padding: pad,
		borderColor: color,
		borderWidth: Math.max(3, size * 0.12),
		borderRadius: 6,
		opacity: 0.88,
		blendMode: "multiply",
		children: [
			Layer.text(o.text, {
				id: `${o.id}-text`,
				fontFamily: MONO,
				fontWeight: 800,
				fontSize: size,
				letterSpacing: size * 0.08,
				fill: color,
			}),
		],
	});
}

/** A stamp landing: pressed in from slightly larger, with a tiny settle. */
export const stampIn = (at: number) =>
	LayerAnimation.create()
		.keys("opacity", [
			[at, 0],
			[at + 2, 0.88],
		])
		.keys("scale", [
			[at, 1.35],
			[at + 5, 0.97, "power3.in"],
			[at + 10, 1, "power2.out"],
		]);

/** Paper laid down: dropped from a little above, landing with a small turn. */
export const layDown = (
	at: number,
	o: { y: number; rotation?: number; from?: number; frames?: number },
) => {
	const frames = o.frames ?? 16;
	const rotation = o.rotation ?? 0;
	return LayerAnimation.create()
		.keys("opacity", [
			[at, 0],
			[at + 4, 1],
		])
		.keys("y", [
			[at, o.y + (o.from ?? -40)],
			[at + frames, o.y, "expo.out"],
		])
		.keys("rotation", [
			[at, rotation - 3],
			[at + frames, rotation, "expo.out"],
		])
		.keys("scale", [
			[at, 1.06],
			[at + frames, 1, "expo.out"],
		]);
};

/** A map pin: a dot with a white ring, the color of what it marks. */
export function pin(o: {
	id: string;
	at: Vec2;
	color?: string;
	size?: number;
}): Node {
	const size = o.size ?? 22;
	return Layer.box({
		id: o.id,
		position: "absolute",
		x: o.at[0] - size / 2,
		y: o.at[1] - size / 2,
		width: size,
		height: size,
		children: [
			Layer.shape("circle", {
				id: `${o.id}-ring`,
				position: "absolute",
				x: 0,
				y: 0,
				width: size,
				height: size,
				fill: "#ffffff",
			}),
			Layer.shape("circle", {
				id: `${o.id}-dot`,
				position: "absolute",
				x: size * 0.2,
				y: size * 0.2,
				width: size * 0.6,
				height: size * 0.6,
				fill: o.color ?? INK,
			}),
		],
	}).withEffect(paperShadow(0.5));
}

/** Pops in from nothing with a small overshoot. */
export const popIn = (at: number, frames = 12) =>
	LayerAnimation.create()
		.keys("opacity", [
			[at, 0],
			[at + 3, 1],
		])
		.keys("scale", [
			[at, 0.2],
			[at + frames, 1, "back.out(2.2)"],
		]);

/** Fades and lifts in. */
export const riseIn = (at: number, y: number, frames = 14, distance = 24) =>
	LayerAnimation.create()
		.keys("opacity", [
			[at, 0],
			[at + Math.round(frames * 0.6), 1, "power2.out"],
		])
		.keys("y", [
			[at, y + distance],
			[at + frames, y, "expo.out"],
		]);

/** A slow push that never stops, so a held frame still breathes. */
export const drift = (frames: number, to = 1.045) =>
	LayerAnimation.keys("scale", [
		[0, 1],
		[frames, to, "sine.inOut"],
	]);
