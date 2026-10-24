/**
 * TitleCard: kicker, headline, rule and sub-line in designed layouts, on
 * one timeline. The text parts are `TextReveal`s (the headline in any reveal
 * style), the rule draws, and the whole card can play out.
 */
import {
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bind, defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { themeFrames } from "../core/theme.js";
import {
	EXIT_STYLES,
	REVEAL_STYLES,
	textReveal,
} from "../text-reveal/index.js";

export const TITLE_LAYOUTS = ["center", "left", "stack", "split"] as const;
export type TitleLayout = (typeof TITLE_LAYOUTS)[number];

export interface TitleCardCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** The headline is at rest. */
	revealed: ReadonlyArray<{ frame: number }>;
	/** Every part is at rest. */
	settled: ReadonlyArray<{ frame: number }>;
	/** The card starts to play out (empty without `exitStyle`). */
	exitStart: ReadonlyArray<{ frame: number }>;
}

export const titleCard = /* @__PURE__ */ defineComponent({
	name: "TitleCard",
	props: () => ({
		title: z.string().min(1),
		kicker: z.string().optional(),
		subtitle: z.string().optional(),
		layout: z.enum(TITLE_LAYOUTS).default("center"),
		/** The headline's reveal style. */
		reveal: z.enum(REVEAL_STYLES).default("rise"),
		emphasis: z.array(z.union([z.string(), z.instanceof(RegExp)])).default([]),
		rule: z.boolean().default(true),
		exitStyle: z.union([z.enum(EXIT_STYLES), z.literal(false)]).default(false),
		titleSize: z.number().positive().optional(),
		fontFamily: z.string().optional(),
	}),
	defaults: { enter: false, exit: false, hold: 45 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const W = ctx.requested.width ?? 1600 * s;
		const size = props.titleSize ?? 120 * s;
		const kickerSize = Math.max(16 * s, size * 0.22);
		const subSize = Math.max(20 * s, size * 0.34);
		const fontFamily = props.fontFamily ?? theme.font.display;
		const reveal = bind(host, textReveal);
		const fast = themeFrames(theme, "fast", fps);
		const base = themeFrames(theme, "base", fps);
		const layout = props.layout;
		const centered = layout === "center";
		const align = centered ? "center" : "start";

		// Columns: split puts the headline left, the rest right of a rule.
		const bar = layout === "stack" ? Math.max(4 * s, size * 0.06) : 0;
		const barGap = layout === "stack" ? size * 0.32 : 0;
		const titleW = layout === "split" ? W * 0.56 : W - bar - barGap;
		const sideX = W * 0.62;
		const sideW = W - sideX;
		const left = bar + barGap;

		const measure = (
			text: string,
			fontSize: number,
			width: number,
			weight?: number,
		) =>
			host.measure(text, {
				fontFamily,
				fontSize,
				fontWeight: weight,
				width,
				align: centered ? "center" : "left",
			});
		const titleM = measure(props.title, size, titleW, 700);
		const kickerText = props.kicker?.toUpperCase();
		// Measured with its tracking, so a centred kicker is really centred.
		const kickerM = kickerText
			? host.measure(kickerText, {
					fontFamily,
					fontSize: kickerSize,
					fontWeight: 600,
					letterSpacing: kickerSize * 0.16,
				})
			: null;
		const subM = props.subtitle
			? measure(
					props.subtitle,
					subSize,
					layout === "split" ? sideW : centered ? W * 0.8 : titleW,
				)
			: null;

		const gap = size * 0.28;
		const ruleW =
			layout === "split" ? Math.max(2, 3 * s) : Math.min(W * 0.12, 160 * s);
		const ruleH = layout === "split" ? 0 : Math.max(3, 4 * s);
		const ruleGap = props.rule && layout !== "split" ? gap : 0;

		// ── Vertical layout ───────────────────────────────────────────────
		let y = 0;
		const place: Record<
			"kicker" | "title" | "rule" | "subtitle",
			{ x: number; y: number }
		> = {
			kicker: { x: 0, y: 0 },
			title: { x: 0, y: 0 },
			rule: { x: 0, y: 0 },
			subtitle: { x: 0, y: 0 },
		};
		let height: number;
		if (layout === "split") {
			place.title = { x: 0, y: 0 };
			const side =
				(kickerM ? kickerM.height + gap * 0.6 : 0) + (subM?.height ?? 0);
			const top = Math.max(0, (titleM.height - side) / 2);
			place.kicker = { x: sideX, y: top };
			place.subtitle = {
				x: sideX,
				y: top + (kickerM ? kickerM.height + gap * 0.6 : 0),
			};
			place.rule = { x: W * 0.59, y: 0 };
			height = Math.max(titleM.height, side);
		} else {
			if (kickerM) {
				place.kicker = { x: centered ? (W - kickerM.width) / 2 : left, y };
				y += kickerM.height + gap * 0.5;
			}
			place.title = { x: centered ? 0 : left, y };
			y += titleM.height;
			if (props.rule) {
				y += ruleGap * 0.6;
				place.rule = { x: centered ? (W - ruleW) / 2 : left, y };
				y += ruleH + ruleGap * 0.6;
			} else y += gap * 0.5;
			if (subM) {
				place.subtitle = { x: centered ? W * 0.1 : left, y };
				y += subM.height;
			}
			height = y;
		}

		// ── Timeline ──────────────────────────────────────────────────────
		const children: LayoutNode[] = [];
		const parts: Record<string, Animatable<LayoutNode>> = {};
		const titleAt = kickerText ? Math.round(fast * 1.2) : 0;
		const title = reveal({
			id: ctx.partId("title"),
			text: props.title,
			style: props.reveal,
			at: titleAt,
			...place.title,
			width: titleW,
			align,
			fontFamily,
			fontSize: size,
			fontWeight: 700,
			emphasis: props.emphasis,
			theme,
			seed: ctx.seed,
			fps,
		});
		const revealed = title.cues.revealed[0]?.frame ?? titleAt;
		const followAt = Math.max(titleAt, revealed - Math.round(base * 0.6));

		let settled = revealed;
		const fadeable: Array<Animatable<LayoutNode>> = [];
		if (kickerText && kickerM) {
			const kicker = reveal({
				id: ctx.partId("kicker"),
				text: kickerText,
				style: "track",
				...place.kicker,
				fontFamily,
				fontSize: kickerSize,
				fontWeight: 600,
				letterSpacing: kickerSize * 0.16,
				fill: theme.color.accent,
				theme,
				fps,
			});
			children.push(kicker);
			parts.kicker = kicker;
			fadeable.push(kicker);
			settled = Math.max(settled, kicker.cues.revealed[0]?.frame ?? 0);
		}
		children.push(title);
		parts.title = title;

		if (props.rule) {
			const draw = Math.round(base * 1.3);
			const rule = host.box({
				id: ctx.partId("rule"),
				position: "absolute",
				...place.rule,
				width: layout === "split" ? ruleW : 0,
				height: layout === "split" ? 0 : ruleH,
				background: theme.color.accent,
				borderRadius: ruleH / 2,
			});
			const along = layout === "split" ? "height" : "width";
			const full = layout === "split" ? height : ruleW;
			rule.animate(
				LayerAnimation.keys(along, [
					[followAt, 0],
					[followAt + draw, full, theme.motion.ease.enter],
				]),
			);
			// Centred rules grow from the middle.
			if (centered)
				rule.animate(
					LayerAnimation.keys("x", [
						[followAt, W / 2],
						[followAt + draw, place.rule.x, theme.motion.ease.enter],
					]),
				);
			children.push(rule);
			parts.rule = rule;
			fadeable.push(rule);
			settled = Math.max(settled, followAt + draw);
		}
		if (layout === "stack") {
			const draw = Math.round(base * 1.5);
			const accentBar = host.box({
				id: ctx.partId("bar"),
				position: "absolute",
				x: 0,
				y: 0,
				width: bar,
				height: 0,
				background: theme.color.accent,
				borderRadius: bar / 2,
			});
			accentBar.animate(
				LayerAnimation.keys("height", [
					[0, 0],
					[draw, height, theme.motion.ease.enter],
				]),
			);
			children.push(accentBar);
			parts.bar = accentBar;
			fadeable.push(accentBar);
			settled = Math.max(settled, draw);
		}
		if (props.subtitle && subM) {
			const sub = reveal({
				id: ctx.partId("subtitle"),
				text: props.subtitle,
				style: "rise",
				by: "line",
				at: followAt + Math.round(fast * 0.5),
				...place.subtitle,
				width: layout === "split" ? sideW : centered ? W * 0.8 : titleW,
				align,
				fontFamily,
				fontSize: subSize,
				fill: theme.color.muted,
				theme,
				fps,
			});
			children.push(sub);
			parts.subtitle = sub;
			fadeable.push(sub);
			settled = Math.max(settled, sub.cues.revealed[0]?.frame ?? 0);
		}

		// ── Exit ──────────────────────────────────────────────────────────
		let afterHold = 0;
		const exitStart = settled + ctx.hold;
		if (props.exitStyle !== false) {
			// Rebuild the headline with its exit lined up to the card's.
			const leaving = reveal({
				id: ctx.partId("title"),
				text: props.title,
				style: props.reveal,
				exitStyle: props.exitStyle,
				hold: exitStart - revealed,
				at: titleAt,
				...place.title,
				width: titleW,
				align,
				fontFamily,
				fontSize: size,
				fontWeight: 700,
				emphasis: props.emphasis,
				theme,
				seed: ctx.seed,
				fps,
			});
			children[children.indexOf(title)] = leaving;
			parts.title = leaving;
			afterHold = Math.max(1, leaving.span.end - exitStart);
			const out = Math.min(afterHold, Math.round(base * 0.8));
			for (const node of fadeable)
				node.animate(
					LayerAnimation.keys("opacity", [
						[exitStart, 1],
						[exitStart + out, 0, theme.motion.ease.exit],
					]),
				);
		}

		return {
			children,
			width: W,
			height,
			duration: settled,
			openEnded: true,
			afterHold,
			cues: {
				revealed: [{ frame: revealed }],
				settled: [{ frame: settled }],
				exitStart: props.exitStyle === false ? [] : [{ frame: exitStart }],
			} as TitleCardCues,
			parts,
		};
	},
});
