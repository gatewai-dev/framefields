/**
 * The handful of primitives every Relay screen is built from: text in the
 * two weights, line icons, initials avatars, raised surfaces and the shared
 * motions (rise, fade, press).
 */
import {
	type AnimatableNode,
	Layer,
	LayerAnimation,
	LayerStyle,
	type LayoutNode,
} from "framefields";
import { transformPathData } from "framefields/components";
import {
	INK,
	MUTED,
	REGULAR,
	SANS,
	SEMIBOLD,
	SHADOW,
	SUBTLE,
	sec,
} from "../theme.js";

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export const centre = (r: Rect): [number, number] => [
	r.x + r.width / 2,
	r.y + r.height / 2,
];

/** `r` moved by (dx, dy). */
export const offset = (r: Rect, dx: number, dy: number): Rect => ({
	...r,
	x: r.x + dx,
	y: r.y + dy,
});

export interface TextOptions {
	x: number;
	y: number;
	size: number;
	color?: string;
	strong?: boolean;
	width?: number;
	align?: "start" | "center" | "end";
	lineHeight?: number;
	id?: string;
}

/** Text in one of the film's two weights. */
export function text(value: string, o: TextOptions) {
	return Layer.text(value, {
		...(o.id && { id: o.id }),
		position: "absolute",
		x: o.x,
		y: o.y,
		...(o.width !== undefined && { width: o.width }),
		...(o.align && { align: o.align }),
		...(o.lineHeight !== undefined && { lineHeight: o.lineHeight }),
		fontFamily: SANS,
		fontSize: o.size,
		fontWeight: o.strong ? SEMIBOLD : REGULAR,
		fill: o.color ?? INK,
	});
}

/** Line icons on a 24-unit grid. */
const ICONS = {
	inbox:
		"M3 13 L7.5 13 L9.5 16 L14.5 16 L16.5 13 L21 13 M3 13 L6 5 L18 5 L21 13 L21 19 L3 19 Z",
	tasks: "M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z M8 12.5 L11 15.5 L16.5 9.5",
	calendar:
		"M4 6 L20 6 L20 20 L4 20 Z M4 10.5 L20 10.5 M8.5 3 L8.5 7 M15.5 3 L15.5 7",
	search: "M4 11 A7 7 0 1 0 18 11 A7 7 0 1 0 4 11 Z M16 16 L21 21",
	plus: "M12 5 L12 19 M5 12 L19 12",
	chevron: "M7 10 L12 15 L17 10",
	close: "M6 6 L18 18 M18 6 L6 18",
	reply: "M9.5 14.5 L4 9 L9.5 3.5 M4 9 L14 9 A6 6 0 0 1 20 15 L20 20",
	quote:
		"M14 7 L17 7 A5 5 0 0 1 17 17 L14 17 M10 17 L7 17 A5 5 0 0 1 7 7 L10 7 M8.5 12 L15.5 12",
	checklist:
		"M3.5 7 L5.5 9 L9 5 M12.5 7 L20.5 7 M3.5 15 L5.5 17 L9 13 M12.5 15 L20.5 15",
	user: "M8 8 A4 4 0 1 0 16 8 A4 4 0 1 0 8 8 Z M4 20.5 C4.5 16.5 8 14.5 12 14.5 C16 14.5 19.5 16.5 20 20.5",
	folder: "M3 6.5 L9.5 6.5 L11.5 9 L21 9 L21 19 L3 19 Z",
	status: "M3 12 A9 9 0 1 0 21 12 A9 9 0 1 0 3 12 Z M12 7 L12 12 L15.5 14",
	tick: "M5 12.5 L10 17 L19 7.5",
} as const;

export type IconName = keyof typeof ICONS;

export function icon(
	name: IconName,
	o: { x: number; y: number; size?: number; color?: string; weight?: number },
) {
	const size = o.size ?? 18;
	const k = size / 24;
	return Layer.shape("path", {
		position: "absolute",
		x: o.x,
		y: o.y,
		width: size,
		height: size,
		d: transformPathData(ICONS[name], k),
		fillType: "none",
		strokeColor: o.color ?? MUTED,
		strokeWidth: (o.weight ?? 1.8) * k,
		strokeLineCap: "round",
		strokeLineJoin: "round",
	});
}

/** A filled dot: a fully rounded box, drawn at screen resolution under any zoom. */
export function dot(o: { x: number; y: number; size: number; color: string }) {
	return Layer.box({
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.size,
		height: o.size,
		borderRadius: o.size / 2,
		background: o.color,
	});
}

export interface Person {
	name: string;
	initials: string;
	/** Avatar ground: warm neutrals, so the accent stays the only color. */
	tone: string;
}

export function avatar(p: Person, o: { x: number; y: number; size: number }) {
	return Layer.box({
		overflow: "hidden",
		position: "absolute",
		x: o.x,
		y: o.y,
		width: o.size,
		height: o.size,
		borderRadius: o.size / 2,
		background: p.tone,
		children: [
			text(p.initials, {
				x: 0,
				y: o.size * 0.29,
				width: o.size,
				align: "center",
				size: o.size * 0.38,
				strong: true,
				color: INK,
			}),
		],
	});
}

/** How far a surface floats: a soft shadow straight down. */
const ELEVATION = {
	card: { opacity: 0.08, distance: 2, size: 8 },
	popover: { opacity: 0.16, distance: 10, size: 28 },
	modal: { opacity: 0.22, distance: 24, size: 64 },
} as const;

export function raise<T extends AnimatableNode>(
	node: T,
	level: keyof typeof ELEVATION,
): T {
	const e = ELEVATION[level];
	node.withEffect(
		new LayerStyle({
			dropShadow: {
				enabled: true,
				color: SHADOW,
				opacity: e.opacity,
				angle: 90,
				distance: e.distance,
				size: e.size,
			},
		}),
	);
	return node;
}

/** A 1 px rule. */
export function rule(
	x: number,
	y: number,
	length: number,
	o: { vertical?: boolean; color?: string } = {},
): LayoutNode {
	return Layer.box({
		position: "absolute",
		x,
		y,
		width: o.vertical ? 1 : length,
		height: o.vertical ? length : 1,
		background: o.color ?? SUBTLE,
	});
}

export const EASE = "expo.out";

/** Fade from `from` to `to` over `duration`, starting at `at`. */
export function fade(at: number, duration = sec(0.3), from = 0, to = 1) {
	return LayerAnimation.keys("opacity", [
		[0, from],
		[at, from, "hold"],
		[at + duration, to, "power2.out"],
	]);
}

/** Rise into place at `y`, fading in, from `at`. */
export function rise(
	y: number,
	at: number,
	distance = 12,
	duration = sec(0.5),
) {
	return LayerAnimation.create()
		.keys("opacity", [
			[0, 0],
			[at, 0, "hold"],
			[at + duration, 1, "power2.out"],
		])
		.keys("y", [
			[0, y + distance],
			[at, y + distance, "hold"],
			[at + duration, y, EASE],
		]);
}

/** Visible from `at` (in) to `out`, fading both ways. */
export function shown(at: number, out: number, duration = sec(0.2)) {
	return LayerAnimation.keys("opacity", [
		[0, 0],
		[at, 0, "hold"],
		[at + duration, 1, "power2.out"],
		[out, 1, "hold"],
		[out + duration, 0, "power2.in"],
	]);
}

/** Shown only from `from` up to `to`: a hard cut in and out, for a surface handed between views. */
export function during(from: number, to: number) {
	return LayerAnimation.keys("opacity", [
		[0, 0],
		[from - 1, 0, "hold"],
		[from, 1, "hold"],
		[to, 1, "hold"],
		[to + 1, 0, "hold"],
	]);
}

/** `r` scaled by `k` about its centre. */
export const shrink = (r: Rect, k: number): Rect => ({
	x: r.x + (r.width * (1 - k)) / 2,
	y: r.y + (r.height * (1 - k)) / 2,
	width: r.width * k,
	height: r.height * k,
});

export interface Reshape {
	from: Rect;
	to: Rect;
	/** Corner radius at each end. */
	radius: [number, number];
	at: number;
	until: number;
	ease?: string;
}

/** Carries a box from one rect (and corner radius) to another. */
export function reshape(m: Reshape) {
	const ease = m.ease ?? "power3.inOut";
	const track = (
		prop: "x" | "y" | "width" | "height" | "borderRadius",
		a: number,
		b: number,
	) =>
		LayerAnimation.keys(prop, [
			[0, a],
			[m.at, a, "hold"],
			[m.until, b, ease],
		]);
	return LayerAnimation.merge(
		track("x", m.from.x, m.to.x),
		track("y", m.from.y, m.to.y),
		track("width", m.from.width, m.to.width),
		track("height", m.from.height, m.to.height),
		track("borderRadius", m.radius[0], m.radius[1]),
	);
}

/** A press: shrink while the button is down, spring back on release. */
export function press(down: number, up: number) {
	return LayerAnimation.keys("scale", [
		[0, 1],
		[down, 1, "hold"],
		[down + 3, 0.96, "power2.out"],
		[up, 0.96, "hold"],
		[up + sec(0.3), 1, "back.out(2.2)"],
	]);
}
