/**
 * AppFrame: window chrome around any content (a recording, a mock UI, a
 * still): a desktop window, a browser with a URL bar, a terminal, or a bare
 * rounded frame. It is also the coordinate system for what points at the
 * content: `frame.at(x, y)` maps content pixels to the parent's.
 */
import {
	type AnimatableProp,
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import type { Vec2 } from "../core/path.js";
import { contrastRatio } from "../core/theme.js";

const KINDS = ["window", "browser", "terminal", "minimal"] as const;
export type AppFrameKind = (typeof KINDS)[number];

export interface AppFrameCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The URL finished typing (browser with `url.typeAt`). */
	urlTyped: ReadonlyArray<{ frame: number }>;
	/** The load bar finished. */
	loaded: ReadonlyArray<{ frame: number }>;
}

export interface AppFrameApi {
	/** The content area in the parent's coordinates. */
	readonly contentRect: { x: number; y: number; width: number; height: number };
	/** Content-local (x, y) → the parent's coordinates. */
	at(x: number, y: number): Vec2;
	/** Add layers to the content area (after creation, e.g. once cues are known). */
	fill(...nodes: LayoutNode[]): AppFrameApi;
}

/** Chrome palettes, tuned to sit with real app UIs. */
const PALETTES = {
	dark: {
		chrome: "#1b1c20",
		field: "#26272c",
		line: "#2e3036",
		edge: "#3a3c44",
		text: "#e8e8ec",
		muted: "#8d8f99",
		content: "#111215",
	},
	light: {
		chrome: "#f2f2f4",
		field: "#ffffff",
		line: "#e1e1e6",
		edge: "#d4d4da",
		text: "#1c1c1f",
		muted: "#7d7e87",
		content: "#ffffff",
	},
} as const;

const LIGHTS = ["#ff5f57", "#febc2e", "#28c840"] as const;

export const appFrame = /* @__PURE__ */ defineComponent({
	name: "AppFrame",
	props: () => ({
		kind: z.enum(KINDS).default("window"),
		/** What the frame shows: layers (laid out in content pixels) or a media path. */
		content: z
			.custom<LayoutNode | LayoutNode[] | string>(
				(v) =>
					typeof v === "string" ||
					Array.isArray(v) ||
					(typeof v === "object" && v !== null),
				{ message: "Expected a layer, an array of layers, or a media path" },
			)
			.optional(),
		/** How media content fits the content area. */
		fit: z.enum(["cover", "contain", "fill"]).default("cover"),
		title: z.string().optional(),
		/** Browser address. `typeAt` (local frame) types it in and plays a load bar. */
		url: z
			.union([
				z.string(),
				z
					.object({
						text: z.string(),
						typeAt: z.number().int().min(0).optional(),
						/** Characters per second while typing. */
						cps: z.number().positive().default(22),
					})
					.strict(),
			])
			.optional(),
		/** Browser tabs; the first is active. */
		tabs: z.array(z.string()).optional(),
		/** Chrome colors. Default: follows the theme background. */
		appearance: z.enum(["dark", "light"]).optional(),
		/** Content-area background. Default: the appearance's. */
		contentBackground: z.string().optional(),
		/** Shadow depth, 0 (flat) to 3 (floating). */
		elevation: z.number().int().min(0).max(3).default(2),
		/** Corner radius in px. Default 14 × theme.scale. */
		radius: z.number().min(0).optional(),
		/** Present the frame at a 3D angle. */
		tilt: z
			.union([
				z.literal(false),
				z
					.object({
						rotateX: z.number().default(8),
						rotateY: z.number().default(-12),
					})
					.strict(),
			])
			.default(false),
	}),
	defaults: { enter: "rise" },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const width = ctx.requested.width ?? 1440 * s;
		const height = ctx.requested.height ?? 900 * s;
		const dark =
			props.appearance === "dark" ||
			(props.appearance === undefined &&
				(contrastRatio(theme.color.bg, "#000000") ?? 1) < 4);
		const pal = dark ? PALETTES.dark : PALETTES.light;
		const radius = props.radius ?? 14 * s;
		const hasTabs = props.kind === "browser" && (props.tabs?.length ?? 0) > 0;
		const barH =
			props.kind === "minimal"
				? 0
				: props.kind === "browser"
					? (hasTabs ? 92 : 56) * s
					: props.kind === "terminal"
						? 40 * s
						: 46 * s;

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const cues = {
			urlTyped: [] as Array<{ frame: number }>,
			loaded: [] as Array<{ frame: number }>,
		};
		const font = theme.font.body;

		// Content is laid out from the bar down, in content pixels.
		const build = (W: number, H: number) => {
			const bar: LayoutNode[] = [];
			const lightsY = (hasTabs ? 46 * s : barH) / 2;
			if (props.kind !== "minimal") {
				LIGHTS.forEach((color, i) => {
					bar.push(
						host.shape("circle", {
							id: ctx.partId(`light-${i}`),
							position: "absolute",
							x: 20 * s + i * 20 * s,
							y: lightsY - 6 * s,
							width: 12 * s,
							height: 12 * s,
							fillColor: color,
						}),
					);
				});
			}

			if (props.kind === "browser") {
				const rowY = hasTabs ? 46 * s : 0;
				const rowH = hasTabs ? barH - 46 * s : barH;
				if (hasTabs)
					bar.push(
						...tabStrip(ctx, props.tabs ?? [], {
							x: 92 * s,
							H: 46 * s,
							s,
							pal,
							font,
							W,
						}),
					);
				// Back / forward.
				const navX = hasTabs ? 20 * s : 92 * s;
				[0, 1].forEach((i) => {
					const cx = navX + i * 30 * s + 8 * s;
					const cy = rowY + rowH / 2;
					const dir = i === 0 ? -1 : 1;
					bar.push(
						host.shape("path", {
							id: ctx.partId(`nav-${i}`),
							position: "absolute",
							x: 0,
							y: 0,
							width: W,
							height: barH,
							d: `M${cx - dir * 3 * s} ${cy - 6 * s} L${cx + dir * 3 * s} ${cy} L${cx - dir * 3 * s} ${cy + 6 * s}`,
							fillType: "none",
							fillColor: pal.muted,
							strokeColor: i === 0 ? pal.muted : pal.edge,
							strokeWidth: 1.8 * s,
							strokeLineCap: "round",
							strokeLineJoin: "round",
						}),
					);
				});
				if (props.url !== undefined) {
					bar.push(
						...urlField(ctx, props.url, {
							W,
							rowY,
							rowH,
							s,
							pal,
							font,
							fps,
							cues,
							accent: theme.color.accent,
							parts,
						}),
					);
				}
			} else if (props.title) {
				bar.push(
					host.text(props.title, {
						id: ctx.partId("title"),
						position: "absolute",
						x: 0,
						y: barH / 2 - 9 * s,
						width: W,
						align: "center",
						fontFamily: props.kind === "terminal" ? theme.font.mono : font,
						fontSize: 13 * s,
						fontWeight: 500,
						fill: pal.muted,
					}),
				);
			}

			const contentChildren: LayoutNode[] =
				props.content === undefined
					? []
					: typeof props.content === "string"
						? [
								host.media(props.content, {
									id: ctx.partId("media"),
									position: "absolute",
									x: 0,
									y: 0,
									width: W,
									height: H - barH,
									fit: props.fit,
								}),
							]
						: Array.isArray(props.content)
							? props.content
							: [props.content];
			const content = host.box({
				id: ctx.partId("content"),
				position: "absolute",
				x: 0,
				y: barH,
				width: W,
				height: H - barH,
				background:
					props.contentBackground ??
					(props.kind === "terminal" ? "#0c0c0e" : pal.content),
				overflow: "hidden",
				children: contentChildren,
			});
			const chrome = host.box({
				id: ctx.partId("chrome"),
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				background: props.kind === "terminal" ? "#16161a" : pal.chrome,
				borderRadius: radius,
				borderColor: pal.edge,
				borderWidth: 1,
				strokeAlign: "inside",
				overflow: "hidden",
				children: [
					...(barH > 0
						? [
								host.box({
									id: ctx.partId("bar"),
									position: "absolute",
									x: 0,
									y: 0,
									width: W,
									height: barH,
									children: bar,
								}),
								host.box({
									id: ctx.partId("divider"),
									position: "absolute",
									x: 0,
									y: barH - 1,
									width: W,
									height: 1,
									background: pal.line,
								}),
							]
						: []),
					content,
				],
			});
			const children: LayoutNode[] = [];
			if (props.elevation > 0) {
				const e = props.elevation;
				// The shadow lives on its own plate: the chrome clips its content.
				const plate = host.box({
					id: ctx.partId("shadow"),
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					background: pal.chrome,
					borderRadius: radius,
				});
				host.style(plate, {
					dropShadow: {
						color: "#000000",
						opacity: [0, 0.3, 0.45, 0.6][e],
						angle: 90,
						distance: [0, 8, 22, 40][e],
						size: [0, 22, 48, 80][e],
						spread: 0,
					},
				});
				children.push(plate);
				parts.shadow = plate;
			}
			children.push(chrome);
			Object.assign(parts, { chrome, content });
			return { children, content };
		};

		return {
			width,
			height,
			duration: null,
			cues: cues as AppFrameCues,
			parts,
			children: props.tilt
				? [
						// The presentation angle: a perspective box round the whole frame.
						host.box({
							id: ctx.partId("tilt"),
							position: "absolute",
							x: 0,
							y: 0,
							width,
							height,
							perspective: 1800 * s,
							rotateX: props.tilt.rotateX,
							rotateY: props.tilt.rotateY,
							children: build(width, height).children,
						}),
					]
				: build(width, height).children,
			api: (placement): AppFrameApi => {
				const content = parts.content as Animatable<LayoutNode> & {
					children?: LayoutNode[];
				};
				const rect = {
					x: placement.x,
					y: placement.y + barH,
					width: placement.width,
					height: placement.height - barH,
				};
				const api: AppFrameApi = {
					contentRect: rect,
					at: (x, y) => [rect.x + x, rect.y + y],
					fill: (...nodes) => {
						content.children = [...(content.children ?? []), ...nodes];
						return api;
					},
				};
				return api;
			},
		};
	},
});

function tabStrip(
	ctx: Parameters<typeof appFrame.build>[0],
	tabs: string[],
	o: {
		x: number;
		H: number;
		s: number;
		pal: (typeof PALETTES)["dark" | "light"];
		font: string;
		W: number;
	},
): LayoutNode[] {
	const { host } = ctx;
	const out: LayoutNode[] = [];
	let x = o.x;
	tabs.forEach((label, i) => {
		const active = i === 0;
		const fontSize = 12.5 * o.s;
		const m = host.measure(label, {
			fontFamily: o.font,
			fontSize,
			fontWeight: 500,
		});
		const w = Math.min(240 * o.s, Math.max(120 * o.s, m.width + 40 * o.s));
		out.push(
			host.box({
				id: ctx.partId(`tab-${i}`),
				position: "absolute",
				x,
				y: 8 * o.s,
				width: w,
				height: o.H - 8 * o.s,
				background: active ? o.pal.field : "transparent",
				borderRadius: 9 * o.s,
				children: [
					host.text(label, {
						id: ctx.partId(`tab-${i}-text`),
						position: "absolute",
						x: 14 * o.s,
						y: (o.H - 8 * o.s) / 2 - fontSize * 0.62,
						width: w - 28 * o.s,
						fontFamily: o.font,
						fontSize,
						fontWeight: 500,
						fill: active ? o.pal.text : o.pal.muted,
					}),
				],
			}),
		);
		x += w + 4 * o.s;
	});
	return out;
}

function urlField(
	ctx: Parameters<typeof appFrame.build>[0],
	url: string | { text: string; typeAt?: number; cps: number },
	o: {
		W: number;
		rowY: number;
		rowH: number;
		s: number;
		pal: (typeof PALETTES)["dark" | "light"];
		font: string;
		fps: number;
		cues: {
			urlTyped: Array<{ frame: number }>;
			loaded: Array<{ frame: number }>;
		};
		accent: string;
		parts: Record<string, Animatable<LayoutNode>>;
	},
): LayoutNode[] {
	const { host } = ctx;
	const text = typeof url === "string" ? url : url.text;
	const fieldW = Math.min(620 * o.s, o.W * 0.46);
	const fieldH = 32 * o.s;
	const fieldX = (o.W - fieldW) / 2;
	const fieldY = o.rowY + (o.rowH - fieldH) / 2;
	const fontSize = 13.5 * o.s;
	const m = host.measure(text, { fontFamily: o.font, fontSize });
	const lockW = 14 * o.s;
	const textX = (fieldW - m.width - lockW) / 2 + lockW;
	const out: LayoutNode[] = [];

	const label = host.text(text, {
		id: ctx.partId("url"),
		position: "absolute",
		x: textX,
		y: fieldH / 2 - m.lineHeight / 2,
		fontFamily: o.font,
		fontSize,
		fill: o.pal.text,
	});
	// A small padlock: shackle + body.
	const lx = textX - lockW;
	const ly = fieldH / 2;
	const lock = host.shape("path", {
		id: ctx.partId("lock"),
		position: "absolute",
		x: 0,
		y: 0,
		width: fieldW,
		height: fieldH,
		d: `M${lx + 2.2 * o.s} ${ly - 1 * o.s} L${lx + 2.2 * o.s} ${ly - 3.4 * o.s} C${lx + 2.2 * o.s} ${ly - 6.4 * o.s} ${lx + 7.8 * o.s} ${ly - 6.4 * o.s} ${lx + 7.8 * o.s} ${ly - 3.4 * o.s} L${lx + 7.8 * o.s} ${ly - 1 * o.s}`,
		fillType: "none",
		fillColor: o.pal.muted,
		strokeColor: o.pal.muted,
		strokeWidth: 1.4 * o.s,
		strokeLineCap: "round",
	});
	const lockBody = host.box({
		id: ctx.partId("lock-body"),
		position: "absolute",
		x: lx + 0.6 * o.s,
		y: ly - 1.4 * o.s,
		width: 8.8 * o.s,
		height: 6.6 * o.s,
		background: o.pal.muted,
		borderRadius: 1.6 * o.s,
	});
	const fieldChildren: LayoutNode[] = [lock, lockBody, label];
	o.parts.url = label;

	if (typeof url === "object" && url.typeAt !== undefined) {
		const perChar = Math.max(1, Math.round(o.fps / url.cps));
		const start = url.typeAt;
		// The text track is a reveal amount: ≤ 1 is a fraction, > 1 a count.
		const keys: KeyframeTuple[] = [[0, 0]];
		for (let i = 1; i <= text.length; i++) {
			keys.push([start + i * perChar, i === 1 ? 1 / text.length : i, "hold"]);
		}
		label.animate(LayerAnimation.keys("text" as AnimatableProp, keys));
		const typed = start + text.length * perChar;
		// Caret follows the last typed glyph, then blinks a few times.
		const caretKeys: KeyframeTuple[] = [[0, textX]];
		for (let i = 1; i <= text.length; i++)
			caretKeys.push([start + i * perChar, textX + m.caretX(i), "hold"]);
		const caret = host.box({
			id: ctx.partId("caret"),
			position: "absolute",
			x: textX,
			y: fieldH / 2 - fontSize * 0.7,
			width: 1.6 * o.s,
			height: fontSize * 1.4,
			background: o.accent,
		});
		const blink: KeyframeTuple[] = [
			[0, 0],
			[start, 1, "hold"],
		];
		const half = Math.round(o.fps * 0.5);
		for (
			let f = typed + half, on = false;
			f < typed + half * 6;
			f += half, on = !on
		)
			blink.push([f, on ? 1 : 0, "hold"]);
		blink.push([typed + half * 6, 0, "hold"]);
		caret.animate(
			LayerAnimation.keys("x", caretKeys),
			LayerAnimation.keys("opacity", blink),
		);
		fieldChildren.push(caret);
		o.parts.caret = caret;
		o.cues.urlTyped.push({ frame: typed });

		// Load bar along the bottom of the toolbar after "enter".
		const loadStart = typed + Math.round(o.fps * 0.15);
		const loadEnd = loadStart + Math.round(o.fps * 0.9);
		const bar = host.box({
			id: ctx.partId("load"),
			position: "absolute",
			x: 0,
			y: o.rowY + o.rowH - 2 * o.s,
			width: 0,
			height: 2 * o.s,
			background: o.accent,
		});
		bar.animate(
			LayerAnimation.keys("width", [
				[0, 0],
				[loadStart, 0, "hold"],
				[loadStart + Math.round(o.fps * 0.35), o.W * 0.62, "power2.out"],
				[loadEnd, o.W, "power3.inOut"],
			]),
			LayerAnimation.keys("opacity", [
				[0, 0],
				[loadStart, 1, "hold"],
				[loadEnd, 1],
				[loadEnd + Math.round(o.fps * 0.3), 0, "power2.out"],
			]),
		);
		out.push(bar);
		o.parts.load = bar;
		o.cues.loaded.push({ frame: loadEnd });
	}

	const field = host.box({
		id: ctx.partId("url-field"),
		position: "absolute",
		x: fieldX,
		y: fieldY,
		width: fieldW,
		height: fieldH,
		background: o.pal.field,
		borderRadius: 9 * o.s,
		overflow: "hidden",
		children: fieldChildren,
	});
	o.parts["url-field"] = field;
	out.unshift(field);
	return out;
}
