/**
 * Shared building blocks: the full-frame scene shell, the chapter HUD that names the API on
 * screen, keyframe shorthands, and small vector helpers.
 */
import fs from "node:fs";
import { Color, GradientMap, Layer, LayerAnimation } from "framefields";
import {
	COBALT,
	DISPLAY,
	FG,
	H,
	MONO,
	MUTED,
	NAVY,
	PAPER,
	SIGNAL,
	SKY,
	W,
} from "./theme.js";
import { CHAPTERS, chapter as chapterOf } from "./timeline.js";

// biome-ignore lint/suspicious/noExplicitAny: layout nodes are plain specs here.
export type Node = any;
export type Key = [number, number | string, string?];

export const keys = (prop: string, list: Key[]) =>
	LayerAnimation.keys(prop as never, list as never);

/** A full-frame, absolutely placed box. */
export function full(options: Record<string, unknown> = {}): Node {
	return Layer.box({
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		...options,
	} as never);
}

/** A chapter's root: full frame, solid background, children keyed from the chapter's frame 0. */
export function scene(
	id: string,
	background: string,
	children: Node[],
	extra: Record<string, unknown> = {},
): Node {
	return full({
		id: `scene-${id}`,
		background,
		overflow: "hidden",
		children,
		...extra,
	});
}

/** Where a chapter sits on the composition clock. */
export const at = (id: string) => chapterOf(id);

/**
 * The chapter tag, bottom left: index, name and the APIs on screen, in mono. It slides in a beat
 * after the chapter opens and leaves before it ends.
 */
export function hud(
	id: string,
	apis: string[],
	options: { dark?: boolean; light?: boolean; until?: number } = {},
): Node {
	const c = at(id);
	const index = CHAPTERS.findIndex((x) => x.id === id) + 1;
	// Navy on the light ground; white only over night panels (`light`).
	const fg = options.light ? PAPER : FG;
	const dim = options.light ? Color.alpha(PAPER, 0.7) : MUTED;
	const until = options.until ?? c.frames;
	return Layer.flex({
		id: `hud-${id}`,
		position: "absolute",
		x: 72,
		y: H - 132,
		width: W - 144,
		height: 72,
		dir: "row",
		align: "center",
		gap: 22,
		children: [
			Layer.text(String(index).padStart(2, "0"), {
				fontFamily: MONO,
				fontSize: 22,
				fill: dim,
				letterSpacing: 2,
			}),
			Layer.box({ width: 46, height: 2, background: fg }),
			Layer.text(c.title.toUpperCase(), {
				fontFamily: DISPLAY,
				fontWeight: 700,
				fontSize: 26,
				fill: fg,
				letterSpacing: 3,
			}),
			Layer.text(apis.join("  ·  "), {
				fontFamily: MONO,
				fontSize: 19,
				fill: dim,
			}),
		],
	} as never).animate(
		keys("opacity", [
			[0, 0],
			[12, 0],
			[24, 1, "power2.out"],
			[until - 14, 1],
			[until - 4, 0, "power2.in"],
		]),
		keys("x", [
			[12, 40],
			[30, 72, "expo.out"],
		]),
	);
}

/** Recolors third-party art into the brand blues (GradientMap, by luminance). */
export const brandTint = (opacity = 1) =>
	new GradientMap({
		stops: [
			{ position: 0, color: NAVY },
			{ position: 0.4, color: COBALT },
			{ position: 0.7, color: SIGNAL },
			{ position: 1, color: SKY },
		],
		opacity,
	});

/** Sets a layer's blend mode (for builders such as Layer.vfx that take no layout props). */
export function blend<T>(
	node: T,
	blendMode: string,
	extra: Record<string, unknown> = {},
): T {
	return Object.assign(node as object, { blendMode, ...extra }) as T;
}

/**
 * Emoji used inside rich-text spans: the renderer preloads emoji glyphs only from plain `text`,
 * so an invisible plain-text twin at the same sizes makes them load.
 */
export function preloadEmoji(chars: string, sizes: number[]): Node[] {
	return sizes.map((fontSize, i) =>
		Layer.text(chars, {
			id: `emoji-preload-${fontSize}-${i}-${chars.length}`,
			position: "absolute",
			x: 0,
			y: 0,
			fontSize,
			opacity: 0,
		}),
	);
}

/** Pop in: scale from `from` to 1 with an overshoot, fading up. */
export function popIn(delay = 0, length = 18, from = 0.4) {
	return LayerAnimation.merge(
		keys("scale", [
			[0, from],
			[delay, from],
			[delay + length, 1, "back.out(1.8)"],
		]),
		keys("opacity", [
			[0, 0],
			[delay, 0],
			[delay + 6, 1, "power1.out"],
		]),
	);
}

/** Fade out over `length` frames ending at `end`. */
export const fadeOut = (end: number, length = 10) =>
	keys("opacity", [
		[end - length, 1],
		[end, 0, "power2.in"],
	]);

// ── SVG → path data ─────────────────────────────────────────────────────────

const num = (s: string | undefined, d = 0) => (s === undefined ? d : Number(s));
const attr = (tag: string, name: string) =>
	tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

function circlePath(cx: number, cy: number, rx: number, ry = rx): string {
	return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

function rectPath(
	x: number,
	y: number,
	w: number,
	h: number,
	r: number,
): string {
	if (r <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
	return [
		`M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}`,
		`V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}`,
		`H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`,
		`V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
	].join("");
}

/**
 * A leading relative "m" is absolute within its own element but not once paths are joined, so
 * make it "M x y"; any further pairs of that moveto are relative line-tos and stay so via "l".
 */
function absoluteStart(d: string): string {
	const m = d.match(/^\s*m([^A-Za-z]*)/);
	if (!m) return d;
	const nums = m[1].match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? [];
	const rest = d.slice(m[0].length);
	const head = `M${nums[0]} ${nums[1]}`;
	return nums.length > 2
		? `${head}l${nums.slice(2).join(" ")}${rest}`
		: `${head}${rest}`;
}

/** Every drawable element of an icon SVG (Lucide's path/circle/rect/line/poly*) as one `d`. */
export function svgToPath(file: string): string {
	const svg = fs.readFileSync(file, "utf8");
	const parts: string[] = [];
	for (const [tag, name] of svg.matchAll(
		/<(path|circle|ellipse|rect|line|polyline|polygon)\b[^>]*>/g,
	)) {
		switch (name) {
			case "path":
				parts.push(absoluteStart(attr(tag, "d") ?? ""));
				break;
			case "circle":
				parts.push(
					circlePath(
						num(attr(tag, "cx")),
						num(attr(tag, "cy")),
						num(attr(tag, "r")),
					),
				);
				break;
			case "ellipse":
				parts.push(
					circlePath(
						num(attr(tag, "cx")),
						num(attr(tag, "cy")),
						num(attr(tag, "rx")),
						num(attr(tag, "ry")),
					),
				);
				break;
			case "rect":
				parts.push(
					rectPath(
						num(attr(tag, "x")),
						num(attr(tag, "y")),
						num(attr(tag, "width")),
						num(attr(tag, "height")),
						num(attr(tag, "rx")),
					),
				);
				break;
			case "line":
				parts.push(
					`M${attr(tag, "x1")} ${attr(tag, "y1")}L${attr(tag, "x2")} ${attr(tag, "y2")}`,
				);
				break;
			case "polyline":
			case "polygon": {
				const pts = (attr(tag, "points") ?? "")
					.trim()
					.split(/[\s,]+/)
					.map(Number);
				let d = "";
				for (let i = 0; i < pts.length; i += 2)
					d += `${i ? "L" : "M"}${pts[i]} ${pts[i + 1]}`;
				parts.push(name === "polygon" ? `${d}Z` : d);
				break;
			}
		}
	}
	return parts.join(" ");
}

/**
 * Scales SVG path data by `s` (arcs keep their rotation and flags). A path shape rasterizes at
 * its own box size, so an icon drawn at 24 units and enlarged with `scale` comes out soft; scale
 * the geometry instead and draw it at full size.
 */
export function scalePath(d: string, s: number): string {
	const out: string[] = [];
	for (const [, cmd, args] of d.matchAll(
		/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g,
	)) {
		const nums = (
			args.match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
		).map(Number);
		const scaled = nums.map((n, i) => {
			// Arc: rx ry rotation large-arc sweep x y — only rx, ry, x, y scale.
			if (cmd === "A" || cmd === "a")
				return [2, 3, 4].includes(i % 7) ? n : n * s;
			return n * s;
		});
		out.push(cmd + scaled.map((n) => +n.toFixed(3)).join(" "));
	}
	return out.join("");
}

/** A regular star centred in a `size` box. */
export function starPath(size: number, points = 5, inner = 0.45): string {
	const c = size / 2;
	let d = "";
	for (let i = 0; i < points * 2; i++) {
		const r = (i % 2 ? inner : 1) * c * 0.96;
		const a = (Math.PI * i) / points - Math.PI / 2;
		d += `${i ? "L" : "M"}${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
	}
	return `${d}Z`;
}

export const circleD = (size: number) =>
	circlePath(size / 2, size / 2, size * 0.46);

export function heartPath(size: number): string {
	const s = size / 100;
	const p = (x: number, y: number) =>
		`${(x * s).toFixed(2)} ${(y * s).toFixed(2)}`;
	return `M${p(50, 88)}C${p(20, 66)} ${p(4, 48)} ${p(4, 30)}C${p(4, 16)} ${p(15, 6)} ${p(28, 6)}C${p(38, 6)} ${p(46, 12)} ${p(50, 20)}C${p(54, 12)} ${p(62, 6)} ${p(72, 6)}C${p(85, 6)} ${p(96, 16)} ${p(96, 30)}C${p(96, 48)} ${p(80, 66)} ${p(50, 88)}Z`;
}

/** A soft blob from a few harmonics, for liquid shapes. */
export function blobPath(size: number, seed: number, wobble = 0.12): string {
	const c = size / 2;
	const n = 48;
	let d = "";
	for (let i = 0; i < n; i++) {
		const a = (i / n) * Math.PI * 2;
		const r =
			c *
			0.8 *
			(1 +
				wobble * Math.sin(3 * a + seed) +
				wobble * 0.6 * Math.cos(5 * a + seed * 1.7));
		d += `${i ? "L" : "M"}${(c + r * Math.cos(a)).toFixed(2)} ${(c + r * Math.sin(a)).toFixed(2)}`;
	}
	return `${d}Z`;
}
