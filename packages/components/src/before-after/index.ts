/**
 * BeforeAfter: two versions of one picture split by a moving divider. The
 * `before` side is clipped to the divider; both sides are laid out at the
 * full size, so they line up pixel for pixel. Give one clip twice, once
 * with an effect, to show what the effect does.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import { evaluateEase } from "../core/ease.js";
import type { Animatable } from "../core/host.js";
import { scaleFrames } from "../core/timing.js";

export interface BeforeAfterCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The divider's last move ends. */
	settled: ReadonlyArray<{ frame: number }>;
}

const side = () =>
	z.custom<LayoutNode | LayoutNode[] | string>(
		(v) =>
			typeof v === "string" ||
			Array.isArray(v) ||
			(typeof v === "object" && v !== null),
		{ message: "Expected layers or a media path for this side" },
	);

export const beforeAfter = /* @__PURE__ */ defineComponent({
	name: "BeforeAfter",
	props: () => ({
		before: side(),
		after: side(),
		/** Divider position 0–1, or keys `[frame, value, ease?]`. Default: a sweep. */
		split: z
			.union([
				z.number().min(0).max(1),
				z
					.array(
						z.union([
							z.tuple([z.number().int().min(0), z.number().min(0).max(1)]),
							z.tuple([
								z.number().int().min(0),
								z.number().min(0).max(1),
								z.string(),
							]),
						]),
					)
					.min(1),
			])
			.optional(),
		direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
		labels: z
			.union([z.tuple([z.string(), z.string()]), z.literal(false)])
			.default(["Before", "After"]),
		handle: z.boolean().default(true),
		fit: z.enum(["cover", "contain", "fill"]).default("cover"),
		color: z.string().default("#ffffff"),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1280 * s;
		const H = ctx.requested.height ?? 720 * s;
		const across = props.direction === "horizontal";
		const L = across ? W : H;
		const f = (n: number) => scaleFrames(n, fps);
		const keys: KeyframeTuple[] =
			typeof props.split === "number"
				? [[0, props.split]]
				: ((props.split as KeyframeTuple[] | undefined) ?? [
						[0, 0.5],
						[f(20), 0.5],
						[f(50), 0.15, "power2.inOut"],
						[f(100), 0.85, "power2.inOut"],
						[f(135), 0.5, "power2.inOut"],
					]);
		const sorted = [...keys].sort(
			(a, b) => (a[0] as number) - (b[0] as number),
		);
		const px = (k: KeyframeTuple[], by = 0): KeyframeTuple[] =>
			k.map(([fr, v, e]) =>
				e
					? [fr, round((v as number) * L + by), e]
					: [fr, round((v as number) * L + by)],
			) as KeyframeTuple[];
		const settled = sorted[sorted.length - 1]?.[0] as number;

		const fill = (name: string, content: LayoutNode | LayoutNode[] | string) =>
			typeof content === "string"
				? [
						host.media(content, {
							id: ctx.partId(`${name}-media`),
							position: "absolute",
							x: 0,
							y: 0,
							width: W,
							height: H,
							fit: props.fit,
						}),
					]
				: Array.isArray(content)
					? content
					: [content];

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const add = <T extends Animatable<LayoutNode>>(name: string, node: T) => {
			parts[name] = node;
			return node;
		};
		const after = add(
			"after",
			host.box({
				id: ctx.partId("after"),
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				overflow: "hidden",
				children: fill("after", props.after),
			}),
		);
		const start = (sorted[0]?.[1] as number) * L;
		const clip = add(
			"before-clip",
			host.box({
				id: ctx.partId("before-clip"),
				position: "absolute",
				x: 0,
				y: 0,
				width: across ? start : W,
				height: across ? H : start,
				overflow: "hidden",
				children: [
					add(
						"before",
						host.box({
							id: ctx.partId("before"),
							position: "absolute",
							x: 0,
							y: 0,
							width: W,
							height: H,
							children: fill("before", props.before),
						}),
					),
				],
			}),
		);
		if (sorted.length > 1)
			clip.animate(
				LayerAnimation.keys(across ? "width" : "height", px(sorted)),
			);
		const children: LayoutNode[] = [after, clip];

		// ── Divider and handle ───────────────────────────────────────────
		const thick = Math.max(2, 3 * s);
		const line = add(
			"divider",
			host.box({
				id: ctx.partId("divider"),
				position: "absolute",
				x: across ? start - thick / 2 : 0,
				y: across ? 0 : start - thick / 2,
				width: across ? thick : W,
				height: across ? H : thick,
				background: props.color,
			}),
		);
		host.style(line, {
			dropShadow: {
				color: "#000000",
				opacity: 0.35,
				angle: 90,
				distance: 0,
				size: 12 * s,
			},
		});
		if (sorted.length > 1)
			line.animate(
				LayerAnimation.keys(across ? "x" : "y", px(sorted, -thick / 2)),
			);
		children.push(line);
		if (props.handle) {
			const d = 52 * s;
			const c = d / 2;
			const a = d * 0.12;
			const chevrons = across
				? `M${c - a * 1.2} ${c - a}L${c - a * 2.2} ${c}L${c - a * 1.2} ${c + a}M${c + a * 1.2} ${c - a}L${c + a * 2.2} ${c}L${c + a * 1.2} ${c + a}`
				: `M${c - a} ${c - a * 1.2}L${c} ${c - a * 2.2}L${c + a} ${c - a * 1.2}M${c - a} ${c + a * 1.2}L${c} ${c + a * 2.2}L${c + a} ${c + a * 1.2}`;
			const grip = add(
				"handle",
				host.box({
					id: ctx.partId("handle"),
					position: "absolute",
					x: across ? start - c : W / 2 - c,
					y: across ? H / 2 - c : start - c,
					width: d,
					height: d,
					background: props.color,
					borderRadius: c,
					children: [
						host.shape("path", {
							id: ctx.partId("handle-arrows"),
							position: "absolute",
							x: 0,
							y: 0,
							width: d,
							height: d,
							d: chevrons,
							fillType: "none",
							strokeColor: "#111111",
							strokeWidth: Math.max(1.5, 2.4 * s),
							strokeLineCap: "round",
							strokeLineJoin: "round",
						}),
					],
				}),
			);
			host.style(grip, {
				dropShadow: {
					color: "#000000",
					opacity: 0.4,
					angle: 90,
					distance: 3 * s,
					size: 14 * s,
				},
			});
			if (sorted.length > 1)
				grip.animate(LayerAnimation.keys(across ? "x" : "y", px(sorted, -c)));
			children.push(grip);
		}

		// ── Labels: each fades as the divider covers it ─────────────────
		if (props.labels) {
			const fs = 22 * s;
			const pad = 14 * s;
			const margin = 24 * s;
			const length = Math.max(1, settled);
			const splitAt = (fr: number) => valueAt(sorted, fr) * L;
			props.labels.forEach((text, i) => {
				const m = host.measure(text, {
					fontFamily: theme.font.body,
					fontSize: fs,
					fontWeight: 600,
				});
				const w = m.width + pad * 2;
				const h = m.height + pad * 0.9;
				const x = across ? (i === 0 ? margin : W - margin - w) : margin;
				const y = across ? margin : i === 0 ? margin : H - margin - h;
				// How far the label's far edge is inside its own side.
				const visible = (fr: number) => {
					const at = splitAt(fr);
					const edge = across ? (i === 0 ? x + w : x) : i === 0 ? y + h : y;
					const inside = i === 0 ? at - edge : edge - at;
					return Math.max(0, Math.min(1, inside / (24 * s) + 1));
				};
				const pill = add(
					`label-${i}`,
					host.box({
						id: ctx.partId(`label-${i}`),
						position: "absolute",
						x,
						y,
						width: w,
						height: h,
						background: "rgba(0,0,0,0.55)",
						borderRadius: h / 2,
						opacity: visible(0),
						children: [
							host.text(text, {
								id: ctx.partId(`label-${i}-text`),
								position: "absolute",
								x: pad,
								y: pad * 0.45,
								fontFamily: theme.font.body,
								fontSize: fs,
								fontWeight: 600,
								fill: "#ffffff",
							}),
						],
					}),
				);
				if (sorted.length > 1)
					pill.animate(
						LayerAnimation.keys(
							"opacity",
							bakeSamples(
								Array.from({ length: length + 1 }, (_, fr) => visible(fr)),
								0,
								{ tolerance: 0.02 },
							),
						),
					);
				children.push(pill);
			});
		}

		return {
			children,
			width: W,
			height: H,
			duration: null,
			cues: { settled: [{ frame: settled }] } as BeforeAfterCues,
			parts,
		};
	},
});

const round = (v: number) => Math.round(v * 1000) / 1000;

/** The split keys' value at frame `f` (each segment eased by its end key). */
function valueAt(keys: readonly KeyframeTuple[], f: number): number {
	const first = keys[0] as KeyframeTuple;
	if (f <= (first[0] as number)) return first[1] as number;
	for (let i = 0; i < keys.length - 1; i++) {
		const [f0, v0] = keys[i] as KeyframeTuple;
		const [f1, v1, e] = keys[i + 1] as KeyframeTuple;
		if (f >= (f0 as number) && f <= (f1 as number)) {
			const t = evaluateEase(
				e as string | undefined,
				(f - (f0 as number)) / Math.max(1, (f1 as number) - (f0 as number)),
			);
			return (v0 as number) + ((v1 as number) - (v0 as number)) * t;
		}
	}
	return keys[keys.length - 1]?.[1] as number;
}
