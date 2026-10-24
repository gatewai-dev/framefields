/**
 * LowerThird: the name-and-role bar of interviews and talks. Plates are
 * measured to their text, placed in the safe area's bottom corner, slide in
 * through their own box, and leave on their own after `hold`.
 *
 * Coordinates are the frame's: the root covers the video (default
 * 1920 × 1080 × theme scale, or the given width / height) from 0, 0.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Rect } from "../core/draw.js";
import type { Animatable } from "../core/host.js";
import { themeFrames } from "../core/theme.js";

export const LOWER_THIRD_LAYOUTS = ["bar", "stacked", "tag", "line"] as const;
export type LowerThirdLayout = (typeof LOWER_THIRD_LAYOUTS)[number];

export interface LowerThirdCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Fully on screen. */
	in: ReadonlyArray<{ frame: number }>;
	/** Starts to leave (empty with `stay`). */
	out: ReadonlyArray<{ frame: number }>;
}

function safeArea(
	W: number,
	H: number,
	area: "portrait" | "landscape" | Rect | undefined,
): Rect {
	if (area && typeof area === "object") return area;
	const portrait = area ? area === "portrait" : H > W;
	return portrait
		? { x: W * 0.08, y: H * 0.1, width: W * 0.84, height: H * 0.66 }
		: { x: W * 0.06, y: H * 0.08, width: W * 0.88, height: H * 0.82 };
}

export const lowerThird = /* @__PURE__ */ defineComponent({
	name: "LowerThird",
	props: () => ({
		name: z.string().min(1),
		role: z.string().optional(),
		layout: z.enum(LOWER_THIRD_LAYOUTS).default("bar"),
		side: z.enum(["left", "right"]).default("left"),
		safeArea: z
			.union([
				z.enum(["portrait", "landscape"]),
				z.object({
					x: z.number(),
					y: z.number(),
					width: z.number(),
					height: z.number(),
				}),
			])
			.optional(),
		/** Stay on screen instead of leaving after `hold`. */
		stay: z.boolean().default(false),
		accent: z.string().optional(),
		plate: z.string().optional(),
		nameSize: z.number().positive().optional(),
		fontFamily: z.string().optional(),
	}),
	defaults: { enter: false, exit: false, hold: 90 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1920 * s;
		const H = ctx.requested.height ?? 1080 * s;
		const safe = safeArea(W, H, props.safeArea);
		const fontFamily = props.fontFamily ?? theme.font.display;
		const nameSize = props.nameSize ?? 44 * s;
		const roleSize = nameSize * 0.62;
		const accent = props.accent ?? theme.color.accent;
		const plateColor = props.plate ?? theme.color.surface;
		const right = props.side === "right";
		const base = themeFrames(theme, "base", fps);
		const fast = themeFrames(theme, "fast", fps);
		const enter = theme.motion.ease.enter;

		const nameM = host.measure(props.name, {
			fontFamily,
			fontSize: nameSize,
			fontWeight: 700,
		});
		const roleM = props.role
			? host.measure(props.role, {
					fontFamily,
					fontSize: roleSize,
					fontWeight: 500,
				})
			: null;
		const padX = nameSize * 0.55;
		const padY = nameSize * 0.36;
		const children: LayoutNode[] = [];
		const parts: Record<string, Animatable<LayoutNode>> = {};
		/** Keys per node and prop, merged into one track each at the end. */
		const tracks = new Map<
			Animatable<LayoutNode>,
			Map<string, KeyframeTuple[]>
		>();
		const key = (
			node: Animatable<LayoutNode>,
			prop: string,
			keys: KeyframeTuple[],
		) => {
			const byProp = tracks.get(node) ?? new Map<string, KeyframeTuple[]>();
			tracks.set(node, byProp);
			byProp.set(prop, [...(byProp.get(prop) ?? []), ...keys]);
		};

		const text = (
			id: string,
			content: string,
			size: number,
			weight: number,
			fill: string,
			x: number,
			y: number,
		) =>
			host.text(content, {
				id: ctx.partId(id),
				position: "absolute",
				x,
				y,
				fontFamily,
				fontSize: size,
				fontWeight: weight,
				fill,
			});

		/**
		 * A plate that slides in through its own box: the background travels
		 * in from the side, its text rises a beat later. Returns the timing.
		 */
		const plate = (
			id: string,
			rect: Rect,
			background: string,
			radius: number,
			content: Array<Animatable<LayoutNode>>,
			at: number,
		) => {
			const fill = host.box({
				id: ctx.partId(`${id}-fill`),
				position: "absolute",
				x: 0,
				y: 0,
				width: rect.width,
				height: rect.height,
				background,
				borderRadius: radius,
			});
			const travel = rect.width * (right ? 1 : -1);
			const slide = Math.round(base * 1.1);
			key(fill, "x", [
				[at, travel],
				[at + slide, 0, enter],
			]);
			const textAt = at + Math.round(fast * 0.7);
			for (const node of content) {
				const y0 = (node as unknown as { y: number }).y;
				key(node, "y", [
					[textAt, y0 + rect.height * 0.5],
					[textAt + base, y0, enter],
				]);
				key(node, "opacity", [
					[textAt, 0],
					[textAt + Math.round(base * 0.6), 1, "power2.out"],
				]);
			}
			const clip = host.box({
				id: ctx.partId(id),
				position: "absolute",
				...rect,
				overflow: "hidden",
				borderRadius: radius,
				children: [fill, ...content],
			});
			children.push(clip);
			parts[id] = clip;
			return {
				clip,
				fill,
				content,
				travel,
				settled: Math.max(at + slide, textAt + base),
			};
		};

		// ── Layouts ───────────────────────────────────────────────────────
		const bottom = safe.y + safe.height;
		const xFor = (width: number) =>
			right ? safe.x + safe.width - width : safe.x;
		const plates: Array<ReturnType<typeof plate>> = [];
		let accentLine: Animatable<LayoutNode> | null = null;
		const lineW = Math.max(3, nameSize * 0.09);

		switch (props.layout) {
			case "bar": {
				const edge = Math.max(4, nameSize * 0.14);
				const innerW = Math.max(nameM.width, roleM?.width ?? 0);
				const h = padY * 2 + nameM.height + (roleM ? roleM.height * 0.95 : 0);
				const w = innerW + padX * 2 + edge;
				const rect = { x: xFor(w), y: bottom - h, width: w, height: h };
				const tx = right ? padX : padX + edge;
				const content = [
					text("name", props.name, nameSize, 700, theme.color.ink, tx, padY),
				];
				if (props.role && roleM)
					content.push(
						text(
							"role",
							props.role,
							roleSize,
							500,
							theme.color.muted,
							tx,
							padY + nameM.height * 0.95,
						),
					);
				const p = plate("plate", rect, plateColor, theme.radius.sm, content, 0);
				const strip = host.box({
					id: ctx.partId("edge"),
					position: "absolute",
					x: right ? rect.x + rect.width - edge : rect.x,
					y: rect.y + rect.height,
					width: edge,
					height: 0,
					background: accent,
					borderRadius: theme.radius.sm,
				});
				const grow = Math.round(base * 0.8);
				key(strip, "height", [
					[0, 0],
					[grow, rect.height, enter],
				]);
				key(strip, "y", [
					[0, rect.y + rect.height],
					[grow, rect.y, enter],
				]);
				children.push(strip);
				parts.edge = strip;
				plates.push(p);
				break;
			}
			case "stacked": {
				const nameW = nameM.width + padX * 2;
				const nameH = nameM.height + padY * 2;
				const roleH = roleM ? roleM.height + padY * 1.2 : 0;
				const roleW = roleM ? roleM.width + padX * 1.6 : 0;
				const inset = nameSize * 0.4;
				const total = nameH + (roleM ? roleH * 0.9 : 0);
				const top = bottom - total;
				plates.push(
					plate(
						"name-plate",
						{ x: xFor(nameW), y: top, width: nameW, height: nameH },
						plateColor,
						theme.radius.sm,
						[
							text(
								"name",
								props.name,
								nameSize,
								700,
								theme.color.ink,
								padX,
								padY,
							),
						],
						0,
					),
				);
				if (props.role && roleM)
					plates.push(
						plate(
							"role-plate",
							{
								x: right ? xFor(roleW) - inset : xFor(roleW) + inset,
								y: top + nameH - roleH * 0.1,
								width: roleW,
								height: roleH,
							},
							accent,
							theme.radius.sm,
							[
								text(
									"role",
									props.role,
									roleSize,
									600,
									theme.color.bg,
									padX * 0.8,
									padY * 0.6,
								),
							],
							Math.round(fast * 0.8),
						),
					);
				break;
			}
			case "tag": {
				// One line, one node: bold name, a dot, the role a size down.
				const sep = "  ·  ";
				const sepW = props.role
					? host.measure(sep, { fontFamily, fontSize: roleSize }).width
					: 0;
				const h = nameM.height + padY * 1.4;
				const w = nameM.width + (roleM ? sepW + roleM.width : 0) + h;
				const line = host.text(
					props.role ? `${props.name}${sep}${props.role}` : props.name,
					{
						id: ctx.partId("name"),
						position: "absolute",
						x: h / 2,
						y: padY * 0.7,
						fontFamily,
						fontSize: nameSize,
						fill: theme.color.ink,
						spans: [
							{ text: props.name, fontWeight: 700, fill: theme.color.ink },
							...(props.role
								? [
										{
											text: `${sep}${props.role}`,
											fontSize: roleSize,
											fontWeight: 500,
											fill: theme.color.muted,
										},
									]
								: []),
						],
					},
				);
				plates.push(
					plate(
						"tag",
						{ x: xFor(w), y: bottom - h, width: w, height: h },
						plateColor,
						theme.radius.pill,
						[line],
						0,
					),
				);
				break;
			}
			case "line": {
				const innerW = Math.max(nameM.width, roleM?.width ?? 0);
				const h = nameM.height + (roleM ? roleM.height : 0);
				const gap = nameSize * 0.4;
				const w = innerW + gap + lineW;
				const x = xFor(w);
				const lineX = right ? x + w - lineW : x;
				const tx = right ? 0 : lineW + gap;
				accentLine = host.box({
					id: ctx.partId("line"),
					position: "absolute",
					x: lineX,
					y: bottom,
					width: lineW,
					height: 0,
					background: accent,
					borderRadius: lineW / 2,
				});
				const grow = Math.round(base * 1.1);
				key(accentLine, "height", [
					[0, 0],
					[grow, h, enter],
				]);
				key(accentLine, "y", [
					[0, bottom],
					[grow, bottom - h, enter],
				]);
				children.push(accentLine);
				parts.line = accentLine;
				const content = [
					text("name", props.name, nameSize, 700, theme.color.ink, tx, 0),
				];
				if (props.role && roleM)
					content.push(
						text(
							"role",
							props.role,
							roleSize,
							500,
							theme.color.muted,
							tx,
							nameM.height,
						),
					);
				// No plate: the text rises through a clear box.
				plates.push(
					plate(
						"text",
						{ x, y: bottom - h, width: w, height: h },
						"rgba(0,0,0,0)",
						0,
						content,
						Math.round(fast * 0.6),
					),
				);
				break;
			}
		}

		const settled = Math.max(...plates.map((p) => p.settled));
		// ── Out: text first, then the plates slide back the way they came ──
		let afterHold = 0;
		const outAt = settled + ctx.hold;
		if (!props.stay) {
			const fadeOut = Math.round(fast * 0.9);
			const slide = Math.round(base * 0.9);
			plates.forEach((p, k) => {
				const at = outAt + k * Math.round(fast * 0.4);
				for (const node of p.content)
					key(node, "opacity", [
						[at, 1],
						[at + fadeOut, 0, "power2.in"],
					]);
				key(p.fill, "x", [
					[at + fadeOut - 2, 0],
					[at + fadeOut - 2 + slide, p.travel, theme.motion.ease.exit],
				]);
				afterHold = Math.max(afterHold, at + fadeOut - 2 + slide - outAt);
			});
			for (const node of [accentLine, parts.edge])
				if (node)
					key(node, "opacity", [
						[outAt, 1],
						[outAt + afterHold, 0, "power2.in"],
					]);
		}
		for (const [node, byProp] of tracks) {
			const a = LayerAnimation.create();
			for (const [prop, keys] of byProp)
				a.keys(
					prop as "x",
					[...keys].sort((x, y) => x[0] - y[0]),
				);
			node.animate(a);
		}

		return {
			children,
			width: W,
			height: H,
			duration: settled,
			openEnded: props.stay,
			afterHold,
			origin: [0, 0],
			cues: {
				in: [{ frame: settled }],
				out: props.stay ? [] : [{ frame: outAt }],
			} as LowerThirdCues,
			parts,
		};
	},
});
