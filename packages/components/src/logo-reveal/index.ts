/**
 * LogoReveal: the end-card lockup. A mark (image, SVG or path data) and a
 * wordmark arrive as one move, then a light sweeps across the name. Path
 * marks can draw themselves on; names can be extruded in 3D.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { springKeys } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import { drawOnKeys } from "../core/draw.js";
import {
	glyphAnimator,
	rendererChars,
	scheduleExpression,
} from "../core/glyphs.js";
import type { Animatable } from "../core/host.js";
import { transformPathData } from "../core/path.js";
import { themeFrames } from "../core/theme.js";

export const LOGO_STYLES = ["slide", "pop", "draw", "rise"] as const;
export type LogoStyle = (typeof LOGO_STYLES)[number];
export const LOGO_LAYOUTS = ["row", "stack"] as const;
export type LogoLayout = (typeof LOGO_LAYOUTS)[number];

export interface LogoRevealCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The mark lands. */
	hit: ReadonlyArray<{ frame: number }>;
	/** The lockup is complete. */
	revealed: ReadonlyArray<{ frame: number }>;
	/** The glint starts (empty without `glint`). */
	glint: ReadonlyArray<{ frame: number }>;
}

const POP = { stiffness: 260, damping: 14 };
const SWING = { stiffness: 120, damping: 14 };

export const logoReveal = /* @__PURE__ */ defineComponent({
	name: "LogoReveal",
	props: () => ({
		/** An image / SVG file, or path data in its own viewBox. */
		mark: z
			.union([
				z.string().min(1),
				z
					.object({
						d: z.string().min(1),
						viewBox: z.tuple([z.number().positive(), z.number().positive()]),
						color: z.string().optional(),
					})
					.strict(),
			])
			.optional(),
		name: z.string().min(1).optional(),
		tagline: z.string().min(1).optional(),
		layout: z.enum(LOGO_LAYOUTS).default("row"),
		style: z.enum(LOGO_STYLES).default("slide"),
		glint: z.boolean().default(true),
		/** Above 0, the name is extruded text this deep (px). */
		depth: z.number().min(0).default(0),
		material: z.enum(["lit", "chrome", "glass"]).default("lit"),
		markSize: z.number().positive().optional(),
		nameSize: z.number().positive().optional(),
		gap: z.number().min(0).optional(),
		color: z.string().optional(),
		accent: z.string().optional(),
		fontFamily: z.string().optional(),
		fontWeight: z.number().int().min(100).max(900).default(800),
	}),
	defaults: { enter: false, exit: false, hold: 60 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		if (!props.mark && !props.name)
			throw new Error("LogoReveal: give a `mark`, a `name`, or both.");
		const s = theme.scale;
		const base = themeFrames(theme, "base", fps);
		const ease = theme.motion.ease.move;
		const accent = props.accent ?? theme.color.accent;
		const ink = props.color ?? theme.color.ink;
		const fontFamily = props.fontFamily ?? theme.font.display;
		const ns = props.nameSize ?? 120 * s;
		const m = props.mark ? (props.markSize ?? 150 * s) : 0;
		const gap = props.mark && props.name ? (props.gap ?? ns * 0.32) : 0;
		const stack = props.layout === "stack";
		const solid = props.depth > 0;
		const pathMark = typeof props.mark === "object" ? props.mark : null;
		// Image marks can't draw on: they pop.
		const style: LogoStyle =
			props.style === "draw" && !pathMark ? "pop" : props.style;

		// ── Geometry ─────────────────────────────────────────────────────
		const nameM = props.name
			? host.measure(props.name, {
					fontFamily,
					fontSize: ns,
					fontWeight: props.fontWeight,
				})
			: { width: 0, height: 0 };
		const tagSize = Math.max(18 * s, ns * 0.26);
		const tagM = props.tagline
			? host.measure(props.tagline, {
					fontFamily: theme.font.body,
					fontSize: tagSize,
				})
			: { width: 0, height: 0 };
		const tagGap = props.tagline ? ns * 0.12 : 0;
		const textW = Math.max(nameM.width, tagM.width);
		const textH = nameM.height + tagGap + tagM.height;
		const W = stack ? Math.max(m, textW) : m + gap + textW;
		const H = stack ? m + gap + textH : Math.max(m, textH);
		const markAt = stack ? { x: (W - m) / 2, y: 0 } : { x: 0, y: (H - m) / 2 };
		const nameAt = stack
			? { x: (W - nameM.width) / 2, y: m + gap }
			: { x: m + gap, y: (H - textH) / 2 };
		const tagAt = stack
			? { x: (W - tagM.width) / 2, y: nameAt.y + nameM.height + tagGap }
			: { x: nameAt.x, y: nameAt.y + nameM.height + tagGap };

		// ── Timeline ─────────────────────────────────────────────────────
		const drawFrames = Math.round(base * 2.2);
		const glide = Math.round(base * 1.5);
		const glideAt = style === "slide" ? Math.round(base * 1.1) : 0;
		const hit = !props.mark
			? 0
			: style === "draw"
				? drawFrames
				: style === "rise"
					? base
					: Math.round(base * 0.75);
		const nameStart = !props.mark
			? 0
			: style === "slide"
				? glideAt
				: style === "draw"
					? Math.round(drawFrames * 0.6)
					: style === "rise"
						? Math.round(base * 0.35)
						: Math.round(base * 0.55);
		const chars = props.name?.length ?? 0;
		const stagger = Math.max(1, Math.round(fps / 30) * 1.5);
		const letters = style === "pop" || style === "draw";
		const nameDone = !props.name
			? hit
			: solid
				? nameStart + base * 2
				: style === "slide"
					? glideAt + glide
					: letters
						? nameStart + Math.round(stagger * Math.max(0, chars - 1)) + base
						: nameStart + base;
		const tagStart = Math.max(nameStart, nameDone - Math.round(base * 0.4));
		const revealed = Math.max(
			hit,
			nameDone,
			props.tagline ? tagStart + base : 0,
		);
		const glintAt = revealed + Math.round(base * 0.3);
		const glintFrames = Math.round(base * 1.8);
		const glints = props.glint && props.name && !solid;
		const end = glints ? glintAt + glintFrames : revealed;

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		// Drawn last: the name wipes out from behind it.
		let markNode: LayoutNode | undefined;

		// ── Mark ─────────────────────────────────────────────────────────
		if (props.mark) {
			const markColor = pathMark?.color ?? accent;
			const markKids: LayoutNode[] = [];
			if (pathMark) {
				const [vw, vh] = pathMark.viewBox;
				const k = m / Math.max(vw, vh);
				const d = transformPathData(
					pathMark.d,
					k,
					(m - vw * k) / 2,
					(m - vh * k) / 2,
				);
				const fill = host.shape("path", {
					id: ctx.partId("mark-fill"),
					position: "absolute",
					x: 0,
					y: 0,
					width: m,
					height: m,
					d,
					fillType: "solid",
					fillColor: markColor,
				});
				parts["mark-fill"] = fill;
				if (style === "draw") {
					const outline = host.shape("path", {
						id: ctx.partId("mark-outline"),
						position: "absolute",
						x: 0,
						y: 0,
						width: m,
						height: m,
						d,
						fillType: "none",
						strokeColor: markColor,
						strokeWidth: Math.max(2, 3 * s),
						strokeLineCap: "round",
						strokeLineJoin: "round",
					});
					outline.animate(
						LayerAnimation.create()
							.keys("trimEnd", drawOnKeys(0, drawFrames, "power2.inOut"))
							.keys("opacity", [
								[drawFrames, 1],
								[drawFrames + base, 0, "power2.out"],
							]),
					);
					fill.animate(
						LayerAnimation.keys("opacity", [
							[Math.round(drawFrames * 0.7), 0],
							[drawFrames, 1, "power2.out"],
						]),
					);
					markKids.push(fill, outline);
					parts["mark-outline"] = outline;
				} else markKids.push(fill);
			} else {
				const image = host.media(props.mark as string, {
					id: ctx.partId("mark-image"),
					position: "absolute",
					x: 0,
					y: 0,
					width: m,
					height: m,
					fit: "contain",
				});
				markKids.push(image);
				parts["mark-image"] = image;
			}
			const centred = stack
				? { x: markAt.x, y: (H - m) / 2 }
				: { x: (W - m) / 2, y: markAt.y };
			const slide = style === "slide" && !!props.name;
			const mark = host.box({
				id: ctx.partId("mark"),
				position: "absolute",
				x: slide ? centred.x : markAt.x,
				y: slide ? centred.y : markAt.y,
				width: m,
				height: m,
				children: markKids,
			});
			const anim = LayerAnimation.create();
			const scale: KeyframeTuple[] = [];
			if (style === "slide" || style === "pop")
				scale.push(...(springKeys(0, 0, 1, fps, POP) as KeyframeTuple[]));
			if (glints) {
				// A small bump as the light passes.
				if (scale.length === 0) scale.push([0, 1]);
				scale.push(
					[glintAt, 1],
					[glintAt + Math.round(base * 0.4), 1.06, "power2.out"],
					[glintAt + Math.round(base * 1.2), 1, "power2.inOut"],
				);
			}
			if (scale.length > 0) anim.keys("scale", scale);
			if (slide) {
				anim.keys(stack ? "y" : "x", [
					[glideAt, stack ? centred.y : centred.x],
					[glideAt + glide, stack ? markAt.y : markAt.x, ease],
				]);
			}
			if (style === "rise") {
				anim.keys("opacity", [
					[0, 0],
					[Math.round(base * 0.6), 1, "power2.out"],
				]);
			}
			mark.animate(anim);
			parts.mark = mark;
			if (style === "rise") {
				// Rises through its own clip.
				mark.y = m;
				mark.x = 0;
				mark.animate(
					LayerAnimation.keys("y", [
						[0, m],
						[base, 0, theme.motion.ease.enter],
					]),
				);
				const clip = host.box({
					id: ctx.partId("mark-clip"),
					position: "absolute",
					x: markAt.x,
					y: markAt.y,
					width: m,
					height: m,
					overflow: "hidden",
					children: [mark],
				});
				parts["mark-clip"] = clip;
				markNode = clip;
			} else markNode = mark;
		}

		// ── Name ─────────────────────────────────────────────────────────
		if (props.name) {
			if (solid) {
				const chrome = props.material === "chrome";
				const name = host.extrudedText({
					id: ctx.partId("name"),
					text: props.name,
					// 3D nodes ignore 2D parents' offsets: place it in the root's parent.
					x: ctx.requested.x + nameAt.x + nameM.width / 2,
					y: ctx.requested.y + nameAt.y + nameM.height / 2,
					depth: props.depth,
					fontFamily,
					fontSize: ns,
					fontWeight: props.fontWeight,
					fill: chrome ? "#e8ecf2" : ink,
					bevelColor: chrome ? "#9aa3ad" : accent,
					material: props.material === "glass" ? "glass" : "lit",
					...(chrome && { metallic: 1, roughness: 0.18, shininess: 96 }),
				});
				name.animate(
					LayerAnimation.create()
						.keys(
							"rotateY",
							springKeys(nameStart, -70, 0, fps, SWING) as KeyframeTuple[],
						)
						.keys("opacity", [
							[nameStart, 0],
							[nameStart + Math.round(base * 0.5), 1, "power2.out"],
						]),
				);
				parts.name = name;
				children.push(name);
			} else {
				const animators =
					letters || glints
						? [
								...(letters
									? [
											glyphAnimator(
												"rise",
												scheduleExpression(
													"char",
													{
														starts: rendererChars(
															props.name,
															Array.from({ length: chars }, (_, i) =>
																Math.round(i * stagger),
															),
														),
														duration: base,
														ease: theme.motion.ease.enter,
													},
													"enter",
												),
												{ y: ns * 0.35, opacity: 0 },
											),
										]
									: []),
								...(glints
									? [
											glyphAnimator(
												"glint",
												glintExpression(
													props.name,
													glintAt - nameStart,
													glintFrames,
												),
												{ fillColor: "#ffffff" },
											),
										]
									: []),
							]
						: undefined;
				const wipe = style === "slide" && !!props.mark;
				const text = host.text(props.name, {
					id: ctx.partId("name"),
					position: "absolute",
					x: wipe ? (stack ? 0 : -nameM.width - gap) : 0,
					y: wipe && stack ? -nameM.height : 0,
					fontFamily,
					fontSize: ns,
					fontWeight: props.fontWeight,
					fill: ink,
					...(animators && { animators: animators as never }),
					startFrame: nameStart,
				});
				if (wipe)
					text.animate(
						LayerAnimation.keys(stack ? "y" : "x", [
							[0, stack ? -nameM.height : -nameM.width - gap],
							[glide, 0, ease],
						]),
					);
				else if (style === "rise" || (!props.mark && style === "slide"))
					text.animate(
						LayerAnimation.keys("y", [
							[0, nameM.height],
							[base, 0, theme.motion.ease.enter],
						]),
					);
				// The name sits in a clip: it wipes out from behind the mark or rises.
				const clip = host.box({
					id: ctx.partId("name-clip"),
					position: "absolute",
					x: nameAt.x,
					y: nameAt.y,
					width: nameM.width,
					height: nameM.height,
					...(!letters && { overflow: "hidden" as const }),
					children: [text],
				});
				parts.name = text;
				parts["name-clip"] = clip;
				children.push(clip);
			}
		}

		// ── Tagline ──────────────────────────────────────────────────────
		if (props.tagline) {
			const tag = host.text(props.tagline, {
				id: ctx.partId("tagline"),
				position: "absolute",
				x: tagAt.x,
				y: tagAt.y,
				fontFamily: theme.font.body,
				fontSize: tagSize,
				fill: theme.color.muted,
			});
			tag.animate(
				LayerAnimation.create()
					.keys("opacity", [
						[tagStart, 0],
						[tagStart + base, 1, "power2.out"],
					])
					.keys("y", [
						[tagStart, tagAt.y + 12 * s],
						[tagStart + base, tagAt.y, theme.motion.ease.enter],
					]),
			);
			parts.tagline = tag;
			children.push(tag);
		}
		if (markNode) children.push(markNode);

		return {
			children,
			width: W,
			height: H,
			duration: end,
			openEnded: true,
			cues: {
				hit: props.mark ? [{ frame: hit }] : [],
				revealed: [{ frame: revealed }],
				glint: glints ? [{ frame: glintAt }] : [],
			} as LogoRevealCues,
			parts,
		};
	},
});

/**
 * A soft band of light crossing the name left to right: each character
 * peaks as the band passes its position (frame is the name's local frame).
 */
function glintExpression(text: string, start: number, frames: number): string {
	const n = Math.max(1, text.length - 1);
	const peaks = rendererChars(
		text,
		Array.from(
			{ length: text.length },
			(_, i) => Math.round((start + (i / n) * frames * 0.7) * 100) / 100,
		),
	);
	const width = Math.max(2, frames * 0.18);
	return `((P)=>{const d=abs(frame-(P[textIndex]??-999));return d<${width}?(1-d/${width})*0.85:0;})([${peaks.join(",")}])`;
}
