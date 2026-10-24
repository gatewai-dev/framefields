/**
 * DeviceFrame: a phone, tablet or laptop around a screen. Content is
 * authored in the device's own points (a phone screen is 393 × 852) and
 * scaled into the screen, so a mock UI made at device size drops in
 * unchanged; `at(x, y)` maps those points to the parent's coordinates.
 */
import type { BoxNode, LayoutNode } from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Animatable, Host } from "../core/host.js";
import type { Vec2 } from "../core/path.js";

export const DEVICES = ["phone", "tablet", "laptop"] as const;
export type Device = (typeof DEVICES)[number];

export interface DeviceFrameApi {
	/** The screen in the parent's coordinates. */
	readonly screenRect: { x: number; y: number; width: number; height: number };
	/** Screen points → the parent's coordinates (ignores `tilt`). */
	at(x: number, y: number): Vec2;
	/** Add layers (in screen points) to the screen. */
	fill(...nodes: LayoutNode[]): DeviceFrameApi;
}

export interface DeviceFrameCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
}

const POINTS: Record<Device, [number, number]> = {
	phone: [393, 852],
	tablet: [820, 1180],
	laptop: [1440, 900],
};

/** Drop shadow per elevation: [opacity, distance, size] at scale 1. */
const SHADOWS = [
	[0, 0, 0],
	[0.3, 10, 26],
	[0.45, 26, 56],
	[0.6, 46, 90],
] as const;

const FINISHES = {
	graphite: { body: "#2c2e33", edge: "#55585f", button: "#3a3d43" },
	silver: { body: "#d8dade", edge: "#f2f3f5", button: "#c4c7cd" },
	midnight: { body: "#1b2130", edge: "#424a5c", button: "#262d3d" },
} as const;

export const deviceFrame = /* @__PURE__ */ defineComponent({
	name: "DeviceFrame",
	props: () => ({
		device: z.enum(DEVICES).default("phone"),
		orientation: z.enum(["portrait", "landscape"]).default("portrait"),
		/** Layers in screen points, or a media path that fills the screen. */
		content: z
			.custom<LayoutNode | LayoutNode[] | string>(
				(v) =>
					typeof v === "string" ||
					Array.isArray(v) ||
					(typeof v === "object" && v !== null),
				{ message: "Expected layers or a media path" },
			)
			.optional(),
		fit: z.enum(["cover", "contain", "fill"]).default("cover"),
		/** Screen size content is authored in. */
		points: z.tuple([z.number().positive(), z.number().positive()]).optional(),
		finish: z
			.union([z.enum(["graphite", "silver", "midnight"]), z.string()])
			.default("graphite"),
		island: z.boolean().default(true),
		statusBar: z
			.union([
				z.boolean(),
				z
					.object({
						time: z.string().optional(),
						/** Dark icons, for light screens. */
						dark: z.boolean().optional(),
					})
					.strict(),
			])
			.default(true),
		screen: z.string().default("#000000"),
		tilt: z
			.union([
				z.literal(false),
				z
					.object({
						rotateX: z.number().default(10),
						rotateY: z.number().default(-18),
					})
					.strict(),
			])
			.default(false),
		elevation: z.number().int().min(0).max(3).default(2),
	}),
	defaults: { enter: "rise" },
	build(ctx, props) {
		const { host, theme } = ctx;
		const s = theme.scale;
		const device = props.device;
		const laptop = device === "laptop";
		const landscape = !laptop && props.orientation === "landscape";
		const native = POINTS[device];
		const [pw, ph] =
			props.points ?? (landscape ? [native[1], native[0]] : native);

		// ── Proportions, in points ──────────────────────────────────────
		const short = Math.min(pw, ph);
		const bezel =
			device === "phone"
				? short * 0.045
				: device === "tablet"
					? short * 0.04
					: pw * 0.018;
		const rim = device === "laptop" ? pw * 0.004 : short * 0.012;
		const top = laptop ? bezel * 1.6 : bezel;
		const bodyWp = pw + bezel * 2 + rim * 2;
		const bodyHp = ph + top + bezel + rim * 2;
		const baseWp = laptop ? bodyWp * 1.14 : 0;
		const baseHp = laptop ? pw * 0.032 : 0;
		const buttonP = laptop ? 0 : short * 0.011;
		const totalWp = laptop ? baseWp : bodyWp + buttonP * 2;
		const totalHp = bodyHp + baseHp;

		// Points → px: from the size asked for (height for handhelds, width for laptops).
		const k = laptop
			? (ctx.requested.width ?? 1280 * s) / totalWp
			: (ctx.requested.height ?? 860 * s) / totalHp;
		const W = ctx.requested.width ?? totalWp * k;
		const H = ctx.requested.height ?? totalHp * k;
		const px = (v: number) => v * k;
		const bodyX = (W - bodyWp * k) / 2;
		const bodyY = 0;
		const screenX = bodyX + px(rim + bezel);
		const screenY = bodyY + px(rim + top);
		const screenW = px(pw);
		const screenH = px(ph);

		const named = FINISHES[props.finish as keyof typeof FINISHES];
		const finish = named ?? {
			body: props.finish,
			edge: props.finish,
			button: props.finish,
		};
		const bodyR = laptop
			? px(pw * 0.022)
			: px(short * (device === "phone" ? 0.14 : 0.075));
		const screenR = laptop
			? px(pw * 0.006)
			: Math.max(0, bodyR - px(rim + bezel));

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const kids: LayoutNode[] = [];
		const box = (name: string, o: Partial<BoxNode>) => {
			const node = host.box({
				id: ctx.partId(name),
				position: "absolute",
				...o,
			});
			parts[name] = node;
			return node;
		};

		// ── Shadow, buttons, body ───────────────────────────────────────
		if (props.elevation > 0) {
			const e = props.elevation;
			const plate = box("shadow", {
				x: bodyX,
				y: bodyY,
				width: px(bodyWp),
				height: px(bodyHp + baseHp),
				background: finish.body,
				borderRadius: bodyR,
			});
			const [opacity, distance, size] = SHADOWS[e] ?? SHADOWS[0];
			host.style(plate, {
				dropShadow: {
					color: "#000000",
					opacity,
					angle: 90,
					distance: distance * s,
					size: size * s,
					spread: 0,
				},
			});
			kids.push(plate);
		}
		if (!laptop) {
			// Side buttons stand just proud of the body.
			const bw = px(buttonP * 1.6);
			const along = landscape ? px(bodyWp) : px(bodyHp);
			const spec: Array<[side: -1 | 1, from: number, len: number]> =
				device === "phone"
					? [
							[-1, 0.17, 0.04],
							[-1, 0.24, 0.07],
							[-1, 0.33, 0.07],
							[1, 0.26, 0.11],
						]
					: [
							[1, 0.08, 0.05],
							[1, 0.15, 0.05],
						];
			const buttons = spec.map(([side, from, len], i) =>
				landscape
					? host.box({
							id: ctx.partId(`button-${i}`),
							position: "absolute",
							x: bodyX + from * along,
							y: side < 0 ? bodyY - bw / 2 : bodyY + px(bodyHp) - bw / 2,
							width: len * along,
							height: bw,
							background: finish.button,
							borderRadius: bw / 2,
						})
					: host.box({
							id: ctx.partId(`button-${i}`),
							position: "absolute",
							x: side < 0 ? bodyX - bw / 2 : bodyX + px(bodyWp) - bw / 2,
							y: bodyY + from * along,
							width: bw,
							height: len * along,
							background: finish.button,
							borderRadius: bw / 2,
						}),
			);
			const group = box("buttons", {
				x: 0,
				y: 0,
				width: W,
				height: H,
				children: buttons,
			});
			kids.push(group);
		}
		kids.push(
			box("body", {
				x: bodyX,
				y: bodyY,
				width: px(bodyWp),
				height: px(bodyHp),
				background: finish.body,
				borderRadius: bodyR,
				borderColor: finish.edge,
				borderWidth: Math.max(1, px(rim * 0.35)),
				strokeAlign: "inside",
			}),
			box("bezel", {
				x: bodyX + px(rim),
				y: bodyY + px(rim),
				width: px(bodyWp - rim * 2),
				height: px(bodyHp - rim * 2),
				background: "#050506",
				borderRadius: Math.max(0, bodyR - px(rim)),
			}),
		);

		// ── Screen: content in points, scaled in ────────────────────────
		const content: Animatable<LayoutNode> & { children?: LayoutNode[] } = box(
			"content",
			{
				x: 0,
				y: 0,
				width: pw,
				height: ph,
				scale: k,
				anchorX: 0,
				anchorY: 0,
				children:
					props.content === undefined
						? []
						: typeof props.content === "string"
							? [
									host.media(props.content, {
										id: ctx.partId("media"),
										position: "absolute",
										x: 0,
										y: 0,
										width: pw,
										height: ph,
										fit: props.fit,
									}),
								]
							: Array.isArray(props.content)
								? props.content
								: [props.content],
			},
		);
		const overlay: LayoutNode[] = [];
		const phone = device === "phone";
		if (phone && props.island && !landscape)
			overlay.push(
				box("island", {
					x: (pw - 124) / 2,
					y: 11,
					width: 124,
					height: 36,
					background: "#000000",
					borderRadius: 18,
				}),
			);
		if (props.statusBar !== false && !laptop) {
			const opts = typeof props.statusBar === "object" ? props.statusBar : {};
			overlay.push(
				statusBar(ctx, {
					width: pw,
					height: phone && !landscape ? 54 : 30,
					time: opts.time ?? "9:41",
					color: opts.dark ? "#000000" : "#ffffff",
					compact: !phone || landscape,
					font: theme.font.body,
				}),
			);
		}
		const status = overlay.length
			? box("overlay", {
					x: 0,
					y: 0,
					width: pw,
					height: ph,
					scale: k,
					anchorX: 0,
					anchorY: 0,
					children: overlay,
				})
			: undefined;
		kids.push(
			box("screen", {
				x: screenX,
				y: screenY,
				width: screenW,
				height: screenH,
				background: props.screen,
				borderRadius: screenR,
				overflow: "hidden",
				children: status ? [content, status] : [content],
			}),
		);
		if (laptop) {
			kids.push(
				box("base", {
					x: (W - px(baseWp)) / 2,
					y: bodyY + px(bodyHp) - px(baseHp * 0.1),
					width: px(baseWp),
					height: px(baseHp),
					background: finish.button,
					borderRadius: px(baseHp * 0.5),
					borderColor: finish.edge,
					borderWidth: Math.max(1, px(rim * 0.3)),
					strokeAlign: "inside",
					children: [
						host.box({
							id: ctx.partId("groove"),
							position: "absolute",
							x: px(baseWp * 0.42),
							y: 0,
							width: px(baseWp * 0.16),
							height: px(baseHp * 0.32),
							background: finish.body,
							borderRadius: px(baseHp * 0.16),
						}),
					],
				}),
			);
		}

		const tilted = props.tilt !== false;
		const stack = tilted
			? [
					box("tilt", {
						x: 0,
						y: 0,
						width: W,
						height: H,
						perspective: 1800 * s,
						rotateX: (props.tilt as { rotateX: number }).rotateX,
						rotateY: (props.tilt as { rotateY: number }).rotateY,
						children: kids,
					}),
				]
			: kids;
		return {
			children: stack,
			width: W,
			height: H,
			duration: null,
			cues: {} as DeviceFrameCues,
			parts,
			api: (placement): DeviceFrameApi => {
				const rect = {
					x: placement.x + screenX,
					y: placement.y + screenY,
					width: screenW,
					height: screenH,
				};
				const api: DeviceFrameApi = {
					screenRect: rect,
					at: (x, y) => [rect.x + x * k, rect.y + y * k],
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

/** Time, signal, Wi-Fi and battery, drawn from boxes and paths (no icon font). */
function statusBar(
	ctx: { host: Host; partId(p: string): string },
	o: {
		width: number;
		height: number;
		time: string;
		color: string;
		compact: boolean;
		font: string;
	},
): LayoutNode {
	const { host } = ctx;
	const mid = o.height / 2 + (o.compact ? 0 : 3);
	const kids: LayoutNode[] = [
		host.text(o.time, {
			id: ctx.partId("status-time"),
			position: "absolute",
			x: o.compact ? 20 : 48,
			y: mid - 10,
			fontFamily: o.font,
			fontSize: 16,
			fontWeight: 600,
			fill: o.color,
		}),
	];
	// From the right edge: battery, Wi-Fi, signal.
	const right = o.width - (o.compact ? 20 : 30);
	const bx = right - 27;
	kids.push(
		host.box({
			id: ctx.partId("status-battery"),
			position: "absolute",
			x: bx,
			y: mid - 6.5,
			width: 25,
			height: 13,
			borderRadius: 4,
			borderColor: o.color,
			borderWidth: 1.2,
			opacity: 0.95,
			children: [
				host.box({
					id: ctx.partId("status-charge"),
					position: "absolute",
					x: 2,
					y: 2,
					width: 18,
					height: 9,
					background: o.color,
					borderRadius: 2,
				}),
			],
		}),
		host.box({
			id: ctx.partId("status-nub"),
			position: "absolute",
			x: bx + 26,
			y: mid - 2.5,
			width: 1.6,
			height: 5,
			background: o.color,
			borderRadius: 1,
			opacity: 0.6,
		}),
	);
	// Wi-Fi: three arcs and a dot, as one stroked path.
	const wx = bx - 13;
	const wy = mid + 5;
	// A quarter arc as one quadratic: the control point sits r·√2 out.
	const arc = (r: number) => {
		const c = r * Math.SQRT1_2;
		const f = (v: number) => v.toFixed(2);
		return `M${f(wx - c)} ${f(wy - c)}Q${f(wx)} ${f(wy - r * Math.SQRT2)} ${f(wx + c)} ${f(wy - c)}`;
	};
	kids.push(
		host.shape("path", {
			id: ctx.partId("status-wifi"),
			position: "absolute",
			x: 0,
			y: 0,
			width: o.width,
			height: o.height,
			d: `${arc(11)}${arc(7)}${arc(3)}`,
			fillType: "none",
			strokeColor: o.color,
			strokeWidth: 2,
			strokeLineCap: "round",
		}),
	);
	// Signal: four rising bars.
	const sx = wx - 40;
	for (let i = 0; i < 4; i++)
		kids.push(
			host.box({
				id: ctx.partId(`status-signal-${i}`),
				position: "absolute",
				x: sx + i * 5,
				y: mid + 5 - (4 + i * 2.6),
				width: 3.4,
				height: 4 + i * 2.6,
				background: o.color,
				borderRadius: 1,
			}),
		);
	return host.box({
		id: ctx.partId("status"),
		position: "absolute",
		x: 0,
		y: 0,
		width: o.width,
		height: o.height,
		children: kids,
	});
}
