/**
 * TextReveal: headlines and body copy that animate in (and out) by
 * character, word or line. One timing model, many looks. Glyph styles run on
 * the GPU through baked per-unit schedules, so a paragraph stays one text
 * node and its final frame is exactly the static text.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
	type TextNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Rect } from "../core/draw.js";
import { evaluateEase } from "../core/ease.js";
import {
	constantExpression,
	type GlyphAnimator,
	type GlyphProps,
	type GlyphUnit,
	glyphAnimator,
	rendererChars,
	scheduleExpression,
	stepExpression,
	type UnitSchedule,
} from "../core/glyphs.js";
import type { Animatable } from "../core/host.js";
import { round as roundTo } from "../core/keys.js";
import {
	findRange,
	lineShift,
	type MeasureOptions,
	type Metrics,
	rangeRects,
} from "../core/text.js";
import { type Theme, themeFrames } from "../core/theme.js";
import { scaleFrames } from "../core/timing.js";
import { typingFrames } from "../core/typing.js";
import {
	burstStarts,
	indexedStarts,
	scrambleSet,
	unitStarts,
	unitsOf,
} from "./plan.js";

export const REVEAL_STYLES = [
	"rise",
	"blur",
	"mask",
	"slam",
	"scatter",
	"scramble",
	"type",
	"stream",
	"wipe",
	"flip",
] as const;
export type RevealStyle = (typeof REVEAL_STYLES)[number];

/** Styles that can also play out (`exitStyle`). */
export const EXIT_STYLES = [
	"rise",
	"blur",
	"mask",
	"scatter",
	"type",
	"stream",
	"wipe",
	"flip",
] as const;
export type ExitStyle = (typeof EXIT_STYLES)[number];

const ORDERS = ["forward", "reverse", "center", "edges", "random"] as const;

interface StyleDefaults {
	by: GlyphUnit;
	/** Frames between units at 30 fps. */
	stagger: number;
	speed: keyof Theme["motion"]["speed"];
	/** Multiplier on the speed token. */
	length: number;
	ease: string;
}

const STYLE: Record<RevealStyle, StyleDefaults> = {
	rise: {
		by: "word",
		stagger: 3,
		speed: "base",
		length: 1.4,
		ease: "expo.out",
	},
	blur: {
		by: "char",
		stagger: 1.2,
		speed: "slow",
		length: 1,
		ease: "power3.out",
	},
	mask: {
		by: "line",
		stagger: 5,
		speed: "base",
		length: 1.5,
		ease: "expo.out",
	},
	slam: { by: "word", stagger: 7, speed: "fast", length: 1, ease: "power3.in" },
	scatter: {
		by: "char",
		stagger: 0.8,
		speed: "slow",
		length: 1.2,
		ease: "expo.out",
	},
	scramble: {
		by: "char",
		stagger: 1.5,
		speed: "base",
		length: 1,
		ease: "none",
	},
	type: { by: "char", stagger: 0, speed: "fast", length: 1, ease: "none" },
	stream: {
		by: "word",
		stagger: 6,
		speed: "slow",
		length: 1,
		ease: "power2.out",
	},
	wipe: {
		by: "line",
		stagger: 0,
		speed: "slow",
		length: 1.4,
		ease: "power2.inOut",
	},
	flip: {
		by: "char",
		stagger: 1.5,
		speed: "base",
		length: 1.2,
		ease: "back.out(1.4)",
	},
};

/** What each glyph style pushes at full weight (font-size units, degrees). */
function glyphFrom(style: RevealStyle, fs: number, exit: boolean): GlyphProps {
	switch (style) {
		case "rise":
			return { y: (exit ? -0.32 : 0.42) * fs, opacity: 0 };
		case "blur":
			return { blur: 0.16 * fs, scale: 1.18, opacity: 0 };
		case "flip":
			return { rotationX: exit ? -90 : 90, opacity: 0 };
		default:
			return { opacity: 0 };
	}
}

export interface TextRevealCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Per unit: starts moving (`frame`) and comes to rest (`settled`). */
	units: ReadonlyArray<{
		frame: number;
		settled: number;
		index: number;
		text: string;
	}>;
	/** The whole text is at rest. */
	revealed: ReadonlyArray<{ frame: number }>;
	/** The exit starts (empty without `exitStyle`). */
	exitStart: ReadonlyArray<{ frame: number }>;
	/** Each typed character (`type`) or arriving word (`stream`): for key sounds. */
	keystrokes: ReadonlyArray<{ frame: number; index: number }>;
}

export interface TextRevealApi {
	/**
	 * Rects (parent coordinates) that a match covers, one per line: hand
	 * them to `Annotate` or a camera. Without `match`, the whole text.
	 */
	rects(match?: string | RegExp, nth?: number): Rect[];
}

type TextProps = Partial<
	Pick<
		TextNode,
		| "fontFamily"
		| "fontSize"
		| "fontWeight"
		| "fill"
		| "align"
		| "lineHeight"
		| "letterSpacing"
		| "direction"
		| "width"
	>
>;

const ALIGN = { start: "left", center: "center", end: "right" } as const;

export const textReveal = /* @__PURE__ */ defineComponent({
	name: "TextReveal",
	props: () => ({
		text: z.string().min(1),
		style: z.enum(REVEAL_STYLES).default("rise"),
		/** Unit of animation. Default per style. */
		by: z.enum(["char", "word", "line"]).optional(),
		/** Frames between units. Default per style. */
		stagger: z.number().min(0).optional(),
		order: z.enum(ORDERS).default("forward"),
		/** Frames one unit's move takes. Default per style, from the theme. */
		unitDuration: z.number().int().positive().optional(),
		ease: z.string().optional(),
		/** Play out after `hold`, unit by unit. */
		exitStyle: z.union([z.enum(EXIT_STYLES), z.literal(false)]).default(false),
		/** Typing speed for `type`, characters a second. */
		cps: z.number().positive().default(24),
		/** Caret for `type` and `stream`. */
		caret: z.boolean().default(true),
		/** Words or patterns drawn in the theme's accent. */
		emphasis: z.array(z.union([z.string(), z.instanceof(RegExp)])).default([]),
		accent: z.string().optional(),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
		fontWeight: z.union([z.number(), z.string()]).optional(),
		fill: z.string().optional(),
		align: z.enum(["start", "center", "end"]).default("start"),
		lineHeight: z.number().positive().optional(),
		letterSpacing: z.number().optional(),
		direction: z.enum(["ltr", "rtl", "auto"]).optional(),
	}),
	defaults: { enter: false, exit: false, hold: 30 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const text = props.text;
		const fs = props.fontSize ?? 96 * theme.scale;
		const fontFamily = props.fontFamily ?? theme.font.display;
		const registered = host.fonts();
		if (registered.length > 0 && !registered.includes(fontFamily)) {
			throw new Error(
				`TextReveal: font "${fontFamily}" is not registered. Registered: ${registered.join(", ")}.`,
			);
		}
		const wrap = ctx.requested.width;
		const textProps: TextProps = {
			fontFamily,
			fontSize: fs,
			fill: props.fill ?? theme.color.ink,
			align: props.align,
			...(props.fontWeight !== undefined && { fontWeight: props.fontWeight }),
			...(props.lineHeight !== undefined && { lineHeight: props.lineHeight }),
			...(props.letterSpacing !== undefined && {
				letterSpacing: props.letterSpacing,
			}),
			...(props.direction !== undefined && { direction: props.direction }),
			...(wrap !== undefined && { width: wrap }),
		};
		const measureOptions: MeasureOptions = {
			fontFamily,
			fontSize: fs,
			fontWeight: props.fontWeight,
			letterSpacing: props.letterSpacing,
			lineHeight: props.lineHeight,
			width: wrap,
			align: ALIGN[props.align],
			direction: props.direction,
		};
		const m = host.measure(text, measureOptions);
		const W = wrap ?? m.width;
		const H = m.height;

		const style = STYLE[props.style];
		const by: GlyphUnit = props.by ?? style.by;
		// Stagger stays fractional: units may start between frames.
		const perFps = (v: number) => (v * fps) / 30;
		const stagger = perFps(props.stagger ?? style.stagger);
		const duration =
			props.unitDuration ??
			Math.max(
				1,
				Math.round(themeFrames(theme, style.speed, fps) * style.length),
			);
		const ease = props.ease ?? style.ease;

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const animators: GlyphAnimator[] = [];
		const keystrokes: Array<{ frame: number; index: number }> = [];
		let unitCues: TextRevealCues["units"] = [];
		let revealed = 0;

		// Emphasis is static colour, first in the stack so streaming ink mixes over it.
		const emphasised = emphasisWeights(text, props.emphasis);
		if (emphasised) {
			animators.push(
				glyphAnimator(
					"emphasis",
					constantExpression("char", rendererChars(text, emphasised)),
					{
						fillColor: props.accent ?? theme.color.accent,
					},
				),
			);
		}

		const units = unitsOf(text, by, m);
		const schedule = (starts: number[], dur = duration, e = ease) => ({
			starts: indexedStarts(text, by, units, starts),
			duration: dur,
			ease: e,
		});
		const cuesFor = (starts: number[], dur: number) =>
			units.map((u, i) => ({
				frame: Math.round(starts[i] ?? 0),
				settled: Math.round((starts[i] ?? 0) + dur),
				index: u.index,
				text: u.text,
			}));

		const textNode = host.text(text, {
			...textProps,
			id: ctx.partId("text"),
			position: "absolute",
			x: 0,
			y: 0,
		});
		parts.text = textNode;
		// What carries the glyphs: the text node, or a wrapper around it (null when lines are split).
		let main: LayoutNode | null = textNode;
		let lines: MaskLine[] = [];
		let sweep: ReturnType<typeof wipeMatte> | null = null;

		// ── Enter ────────────────────────────────────────────────────────
		switch (props.style) {
			case "rise":
			case "blur":
			case "flip": {
				const starts = unitStarts(units.length, stagger, props.order, ctx.seed);
				animators.push(
					glyphAnimator(
						"enter",
						scheduleExpression(by, schedule(starts), "enter"),
						glyphFrom(props.style, fs, false),
					),
				);
				unitCues = cuesFor(starts, duration);
				break;
			}
			case "slam": {
				// Each unit is its own node so it scales around its own centre;
				// the paragraph takes over the frame the last one lands.
				const starts = unitStarts(units.length, stagger, props.order, ctx.seed);
				unitCues = cuesFor(starts, duration);
				const { width: _w, align: _a, ...unitProps } = textProps;
				const pieces = units.map((u, i) => {
					const rect = rangeRects(m, u.start, u.end, measureOptions)[0];
					const s = starts[i] ?? 0;
					const accented =
						emphasised?.slice(u.start, u.end).every((v) => v === 1) ?? false;
					const piece = host.text(u.text, {
						...unitProps,
						...(accented && { fill: props.accent ?? theme.color.accent }),
						id: ctx.partId(`unit-${i}`),
						position: "absolute",
						x: rect?.x ?? 0,
						y: rect?.y ?? 0,
					});
					piece.animate(
						LayerAnimation.create()
							.keys("scale", [
								[s, 2.4],
								[s + duration, 1, ease],
							])
							.keys("opacity", [
								[s, 0],
								[s + Math.max(1, Math.round(duration * 0.45)), 1],
							]),
					);
					return piece;
				});
				const landed = Math.max(0, ...unitCues.map((u) => u.settled));
				// Words land from 2.4×: neither box may clip them on the way in.
				const group = host.box({
					id: ctx.partId("units"),
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					overflow: "visible",
					children: pieces,
				});
				group.animate(
					LayerAnimation.keys("opacity", [
						[0, 1],
						[landed, 0, "hold"],
					]),
				);
				textNode.animate(
					LayerAnimation.keys("opacity", [
						[0, 0],
						[landed, 1, "hold"],
					]),
				);
				// A short landing shake as each unit hits.
				const shake = host.box({
					id: ctx.partId("shake"),
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					overflow: "visible",
					children: [group, textNode],
				});
				shake.animate(...slamShake(unitCues, fs, ctx.rng("slam")));
				parts.units = group;
				parts.shake = shake;
				main = shake;
				break;
			}
			case "scatter": {
				const starts = unitStarts(units.length, stagger, props.order, ctx.seed);
				const sched = schedule(starts);
				const per = (key: string) => {
					const q = ctx.rng(key);
					return rendererChars(
						text,
						Array.from({ length: text.length }, () => q.spread(1)),
					);
				};
				const rx = per("scatter-x");
				const ry = per("scatter-y");
				const rr = per("scatter-r");
				animators.push(
					glyphAnimator("enter-x", scheduleExpression(by, sched, "enter", rx), {
						x: 1.1 * fs,
					}),
					glyphAnimator("enter-y", scheduleExpression(by, sched, "enter", ry), {
						y: 0.9 * fs,
					}),
					glyphAnimator("enter-r", scheduleExpression(by, sched, "enter", rr), {
						rotation: 120,
					}),
					glyphAnimator("enter", scheduleExpression(by, sched, "enter"), {
						opacity: 0,
						blur: 0.06 * fs,
					}),
				);
				unitCues = cuesFor(starts, duration);
				break;
			}
			case "stream": {
				const words = unitsOf(text, "word", m);
				const step = scaleFrames(1, fps);
				const starts = burstStarts(
					words.length,
					perFps(props.stagger ?? style.stagger),
					step,
					ctx.rng("stream"),
				);
				const fade = Math.max(2, themeFrames(theme, "fast", fps));
				const ink = props.unitDuration ?? themeFrames(theme, "slow", fps);
				animators.push(
					glyphAnimator(
						"enter",
						scheduleExpression(
							"word",
							{ starts, duration: fade, ease: "power2.out" },
							"enter",
						),
						{ opacity: 0, y: 0.08 * fs },
					),
					glyphAnimator(
						"ink",
						scheduleExpression(
							"word",
							{ starts, duration: ink, ease: "sine.inOut" },
							"enter",
						),
						{ fillColor: theme.color.muted },
					),
				);
				unitCues = words.map((w, i) => ({
					frame: starts[i] ?? 0,
					settled: (starts[i] ?? 0) + ink,
					index: w.index,
					text: w.text,
				}));
				words.forEach((w, i) => {
					keystrokes.push({ frame: starts[i] ?? 0, index: w.index });
				});
				if (props.caret) {
					const ends = words.map((w) => w.end);
					const caret = buildCaret(ctx, m, measureOptions, fs, {
						at: starts,
						counts: ends,
						until: (starts[starts.length - 1] ?? 0) + ink,
						shape: "block",
					});
					children.push(caret);
					parts.caret = caret;
				}
				break;
			}
			case "type": {
				// Each glyph switches on at its keystroke inside the full layout,
				// so centred or wrapped lines never reflow while typing.
				const frames = typingFrames(text, props.cps, fps, ctx.rng("type"));
				animators.push(
					glyphAnimator(
						"enter",
						stepExpression("char", rendererChars(text, frames)),
						{ opacity: 0 },
					),
				);
				frames.forEach((f, i) => {
					if (!/\s/.test(text[i] ?? ""))
						keystrokes.push({ frame: f, index: i });
				});
				unitCues = keystrokes.map((k) => ({
					frame: k.frame,
					settled: k.frame,
					index: k.index,
					text: text[k.index] ?? "",
				}));
				revealed = (frames[frames.length - 1] ?? 0) + 1;
				if (props.caret) {
					const caret = buildCaret(ctx, m, measureOptions, fs, {
						at: frames,
						counts: frames.map((_, i) => i + 1),
						until: revealed + ctx.hold,
						shape: "bar",
					});
					children.push(caret);
					parts.caret = caret;
				}
				break;
			}
			case "mask": {
				lines = maskLines(ctx, text, m, measureOptions, textProps, fs);
				const starts = unitStarts(lines.length, stagger, props.order, ctx.seed);
				lines.forEach((line, i) => {
					const s = starts[i] ?? 0;
					line.text.animate(
						LayerAnimation.keys("y", [
							[s, line.restY + line.travel],
							[s + duration, line.restY, ease],
						]),
					);
					children.push(line.clip);
					parts[`line-${i}`] = line.clip;
				});
				unitCues = lines.map((l, i) => ({
					frame: Math.round(starts[i] ?? 0),
					settled: Math.round((starts[i] ?? 0) + duration),
					index: i,
					text: l.content,
				}));
				main = null;
				break;
			}
			case "wipe": {
				const w = wipeMatte(ctx, W, H, fs, "hidden");
				sweep = w;
				w.matte.animate(
					LayerAnimation.keys("x", [
						[0, w.hidden],
						[duration, w.shown, ease],
					]),
				);
				host.matte(textNode, w.matte);
				parts.matte = w.matte;
				// The front trails a little blur over the glyphs it is uncovering.
				const xs = rendererChars(text, glyphCenters(text, m, measureOptions));
				const front = Array.from({ length: duration + 1 }, (_, f) =>
					w.front(
						w.hidden + (w.shown - w.hidden) * evaluateEase(ease, f / duration),
					),
				);
				animators.push(
					glyphAnimator(
						"wipe-blur",
						`((X,T)=>{const f=clamp(frame,0,${duration});const k=floor(f);const front=T[k]+((T[k+1]??T[k])-T[k])*(f-k);return clamp(1-(front-(X[textIndex]??0))/${round(w.feather)},0,1);})(${list(xs)},${list(front)})`,
						{ blur: 0.12 * fs },
					),
				);
				unitCues = [{ frame: 0, settled: duration, index: 0, text }];
				break;
			}
			case "scramble": {
				const result = scramble(ctx, text, m, measureOptions, textProps, {
					stagger,
					cycle: duration,
					order: props.order,
				});
				children.push(result.reels);
				parts.reels = result.reels;
				// The real text takes over the moment the last glyph locks.
				textNode.animate(
					LayerAnimation.keys("opacity", [
						[0, 0],
						[result.done, 1, "hold"],
					]),
				);
				unitCues = result.cues;
				break;
			}
		}

		if (unitCues.length > 0 && props.style !== "type")
			revealed = Math.max(...unitCues.map((u) => u.settled));
		// The text is at rest only once the last landing shake dies out.
		if (props.style === "slam") revealed += SHAKE.length - 1;

		// ── Exit ─────────────────────────────────────────────────────────
		let afterHold = 0;
		const exitStart = revealed + ctx.hold;
		if (props.exitStyle !== false) {
			const out = props.exitStyle;
			const outStyle = STYLE[out];
			const outBy: GlyphUnit = props.by ?? outStyle.by;
			const outUnits = unitsOf(text, outBy, m);
			const outStagger = perFps((props.stagger ?? outStyle.stagger) * 0.5);
			const outDur = Math.max(
				1,
				Math.round(
					themeFrames(theme, outStyle.speed, fps) * outStyle.length * 0.75,
				),
			);
			const outEase = theme.motion.ease.exit;
			const starts = unitStarts(
				outUnits.length,
				outStagger,
				props.order,
				ctx.seed,
				exitStart,
			);
			const sched: UnitSchedule = {
				starts: indexedStarts(text, outBy, outUnits, starts),
				duration: outDur,
				ease: outEase,
			};
			afterHold = Math.round(Math.max(...starts) - exitStart + outDur);
			switch (out) {
				case "rise":
				case "blur":
				case "flip":
				case "scatter":
				case "stream":
					animators.push(
						glyphAnimator(
							"exit",
							scheduleExpression(outBy, sched, "exit"),
							out === "scatter"
								? { y: -0.6 * fs, opacity: 0, blur: 0.06 * fs }
								: glyphFrom(out, fs, true),
						),
					);
					break;
				case "type": {
					// Backspace, twice as fast as typing: the last glyph goes first.
					const per = Math.max(1, Math.round(fps / (props.cps * 2)));
					const gone = Array.from(
						{ length: text.length },
						(_, c) => exitStart + per * (text.length - c),
					);
					animators.push(
						glyphAnimator(
							"exit",
							`(1-${stepExpression("char", rendererChars(text, gone))})`,
							{ opacity: 0 },
						),
					);
					afterHold = per * text.length + 1;
					break;
				}
				case "wipe": {
					if (!sweep) {
						sweep = wipeMatte(ctx, W, H, fs, "shown");
						host.matte(textNode, sweep.matte);
						parts.matte = sweep.matte;
					}
					sweep.matte.animate(
						LayerAnimation.keys("x", [
							[exitStart, sweep.shown],
							[exitStart + outDur, sweep.gone, outEase],
						]),
					);
					afterHold = outDur;
					break;
				}
				case "mask": {
					if (lines.length === 0)
						throw new Error(
							'TextReveal: exitStyle "mask" needs style "mask" (it splits the lines).',
						);
					const outStarts = unitStarts(
						lines.length,
						outStagger,
						props.order,
						ctx.seed,
						exitStart,
					);
					lines.forEach((line, i) => {
						const s = outStarts[i] ?? exitStart;
						line.text.animate(
							LayerAnimation.keys("y", [
								[s, line.restY],
								[s + outDur, line.restY - line.travel, outEase],
							]),
						);
					});
					afterHold = Math.round(Math.max(...outStarts) - exitStart + outDur);
					break;
				}
			}
		}

		if (animators.length > 0)
			(textNode as unknown as { animators: GlyphAnimator[] }).animators =
				animators;
		if (main) children.unshift(main);

		return {
			children,
			width: W,
			height: H,
			duration: Math.max(1, revealed),
			openEnded: true,
			afterHold,
			cues: {
				units: unitCues,
				revealed: [{ frame: revealed }],
				exitStart: props.exitStyle === false ? [] : [{ frame: exitStart }],
				keystrokes,
			} as TextRevealCues,
			parts,
			api: (placement): TextRevealApi => ({
				rects(match, nth = 0) {
					const range: [number, number] | null =
						match === undefined
							? [0, text.length]
							: findRange(text, match, nth);
					if (!range)
						throw new Error(
							`TextReveal.rects: "${String(match)}" not found in "${text}".`,
						);
					return rangeRects(m, range[0], range[1], measureOptions).map((q) => ({
						...q,
						x: q.x + placement.x,
						y: q.y + placement.y,
					}));
				},
			}),
		};
	},
});

// ── Helpers ──────────────────────────────────────────────────────────

const round = (v: number) => roundTo(v, 4);
const list = (values: readonly number[]) => `[${values.map(round).join(",")}]`;

/** 1 for characters inside an emphasis match, else 0 (null when nothing matches). */
function emphasisWeights(
	text: string,
	patterns: ReadonlyArray<string | RegExp>,
): number[] | null {
	if (patterns.length === 0) return null;
	const w = new Array<number>(text.length).fill(0);
	for (const p of patterns) {
		for (let nth = 0; ; nth++) {
			const range = findRange(text, p, nth);
			if (!range || range[1] <= range[0]) break;
			for (let i = range[0]; i < range[1]; i++) w[i] = 1;
		}
	}
	return w.some((v) => v > 0) ? w : null;
}

/** Landing shake, per frame after a unit lands (× 0.045 em). */
const SHAKE = [0, 1, -0.55, 0.3, -0.12, 0];

function slamShake(
	units: ReadonlyArray<{ settled: number }>,
	fs: number,
	r: { spread(n: number): number },
): LayerAnimation[] {
	const end = Math.max(0, ...units.map((u) => u.settled)) + 8;
	const xs = new Array<number>(end + 1).fill(0);
	const ys = new Array<number>(end + 1).fill(0);
	const a = 0.045 * fs;
	const profile = SHAKE;
	for (const u of units) {
		const dx = r.spread(1);
		profile.forEach((p, k) => {
			const f = u.settled + k;
			if (f <= end) {
				xs[f] = (xs[f] ?? 0) + a * p * dx;
				ys[f] = (ys[f] ?? 0) + a * p * 0.6;
			}
		});
	}
	return [
		// Tight tolerance: the text must come to rest exactly where it belongs.
		LayerAnimation.keys("x", bakeSamples(xs, 0, { tolerance: 0.005 })),
		LayerAnimation.keys("y", bakeSamples(ys, 0, { tolerance: 0.005 })),
	];
}

interface Ctx {
	host: import("../core/host.js").Host;
	theme: Theme;
	fps: number;
	seed: number;
	partId(part: string): string;
	rng(key: string | number): import("../core/rng.js").Rng;
}

/** Where the caret sits after `count` characters: x, and the line's top. */
function caretAt(
	count: number,
	m: Metrics,
	options: MeasureOptions,
): [number, number] {
	let last: Metrics["glyphs"][number] | undefined;
	for (const g of m.glyphs)
		if (g.index < count && (!last || g.index > last.index)) last = g;
	if (!last) return [lineShift(m, 0, options), 0];
	const shift = lineShift(m, last.line, options);
	return [
		shift + last.x + last.width - (options.letterSpacing ?? 0),
		last.line * m.lineHeight,
	];
}

function buildCaret(
	ctx: Ctx,
	m: Metrics,
	options: MeasureOptions,
	fs: number,
	o: {
		at: readonly number[];
		counts: readonly number[];
		until: number;
		shape: "bar" | "block";
	},
): Animatable<LayoutNode> {
	const w = o.shape === "bar" ? Math.max(2, 0.06 * fs) : 0.42 * fs;
	const h = o.shape === "bar" ? 1.05 * fs : 0.42 * fs;
	const dy =
		o.shape === "bar" ? (m.lineHeight - h) / 2 : m.lineHeight * 0.52 - h / 2;
	const gap = o.shape === "bar" ? 0.04 * fs : 0.18 * fs;
	const [x0, y0] = caretAt(0, m, options);
	const xs: KeyframeTuple[] = [[0, x0 + (o.shape === "bar" ? 0 : -w)]];
	const ys: KeyframeTuple[] = [[0, y0 + dy]];
	o.at.forEach((f, i) => {
		const [x, y] = caretAt(o.counts[i] ?? 0, m, options);
		xs.push([f, x + gap, "hold"]);
		ys.push([f, y + dy, "hold"]);
	});
	const caret = ctx.host.box({
		id: ctx.partId("caret"),
		position: "absolute",
		x: x0,
		y: y0 + dy,
		width: w,
		height: h,
		background: ctx.theme.color.accent,
		borderRadius: o.shape === "bar" ? w / 2 : w * 0.18,
	});
	// Solid while text arrives, then a few blinks, then gone.
	const last = o.at[o.at.length - 1] ?? 0;
	const half = Math.max(1, Math.round(ctx.fps * 0.5));
	const blink: KeyframeTuple[] = [[0, 1]];
	let on = false;
	for (let f = last + half; f < o.until; f += half, on = !on)
		blink.push([f, on ? 1 : 0, "hold"]);
	blink.push([Math.max(last + 1, o.until), 0, "hold"]);
	caret.animate(
		LayerAnimation.create().keys("x", xs).keys("y", ys).keys("opacity", blink),
	);
	return caret;
}

/** Centre x of every character (spaces included), wrapped and aligned. */
function glyphCenters(
	text: string,
	m: Metrics,
	options: MeasureOptions,
): number[] {
	const xs = new Array<number>(text.length).fill(0);
	for (const g of m.glyphs)
		xs[g.index] = lineShift(m, g.line, options) + g.x + g.width / 2;
	return xs;
}

/**
 * A soft-edged matte for `wipe`: transparent → opaque → opaque → transparent,
 * `feather` px ramps. `hidden` / `shown` / `gone` are its x for each phase.
 */
function wipeMatte(
	ctx: Ctx,
	W: number,
	H: number,
	fs: number,
	initial: "hidden" | "shown",
) {
	const feather = Math.max(24, 0.9 * fs);
	const pad = fs * 0.5;
	const total = W + feather * 2;
	const a = ((feather / total) * 100).toFixed(3);
	const b = (((feather + W) / total) * 100).toFixed(3);
	const hidden = -total;
	const shown = -feather;
	const matte = ctx.host.box({
		id: ctx.partId("matte"),
		position: "absolute",
		x: initial === "hidden" ? hidden : shown,
		y: -pad,
		width: total,
		height: H + pad * 2,
		background: `linear-gradient(90deg, rgba(255,255,255,0) 0%, #ffffff ${a}%, #ffffff ${b}%, rgba(255,255,255,0) 100%)`,
	});
	return {
		matte,
		feather,
		total,
		hidden,
		shown,
		gone: W + feather,
		/** Where visibility reaches zero, for a matte at `x`. */
		front: (x: number) => x + total,
	};
}

interface MaskLine {
	clip: Animatable<LayoutNode>;
	text: Animatable<TextNode>;
	content: string;
	restY: number;
	travel: number;
}

/** One clipped text node per measured line, each at its wrapped position. */
function maskLines(
	ctx: Ctx,
	text: string,
	m: Metrics,
	options: MeasureOptions,
	textProps: TextProps,
	fs: number,
): MaskLine[] {
	const pad = Math.round(fs * 0.18);
	const { width: _w, align: _a, ...lineProps } = textProps;
	return unitsOf(text, "line", m).map((u, i) => {
		const first = m.glyphs.find(
			(g) => g.index >= u.start && !/\s/.test(g.char),
		);
		const x = lineShift(m, i, options) + (first?.x ?? 0);
		const content = text.slice(u.start, u.end).trim();
		const lineText = ctx.host.text(content, {
			...lineProps,
			id: ctx.partId(`line-${i}-text`),
			position: "absolute",
			x,
			y: pad,
		});
		const clip = ctx.host.box({
			id: ctx.partId(`line-${i}`),
			position: "absolute",
			x: 0,
			y: i * m.lineHeight - pad,
			width: Math.max(m.width, options.width ?? 0) + fs,
			height: m.lineHeight + pad * 2,
			overflow: "hidden",
			children: [lineText],
		});
		return {
			clip,
			text: lineText,
			content,
			restY: pad,
			travel: m.lineHeight + pad,
		};
	});
}

/**
 * Scramble: each character is a clipped vertical reel of seeded glyphs that
 * steps every couple of frames and lands on the real glyph. Reels are as
 * wide as the real glyph's advance, so the line never jitters.
 */
function scramble(
	ctx: Ctx,
	text: string,
	m: Metrics,
	options: MeasureOptions,
	textProps: TextProps,
	o: { stagger: number; cycle: number; order: (typeof ORDERS)[number] },
) {
	const units = unitsOf(text, "char", m);
	const starts = unitStarts(units.length, o.stagger, o.order, ctx.seed);
	const step = Math.max(1, scaleFrames(2, ctx.fps));
	const { width: _w, align: _a, letterSpacing: _l, ...glyphProps } = textProps;
	const reels: LayoutNode[] = [];
	const cues: Array<{
		frame: number;
		settled: number;
		index: number;
		text: string;
	}> = [];
	let done = 0;
	units.forEach((u, i) => {
		const g = m.glyphs.find((q) => q.index === u.start);
		if (!g) return;
		const appear = Math.round((starts[i] ?? 0) * 0.5);
		const lock = Math.round((starts[i] ?? 0) + o.cycle);
		const r = ctx.rng(`scramble:${u.start}`);
		const set = scrambleSet(u.text);
		const count = Math.max(1, Math.floor((lock - appear) / step));
		const glyphs = Array.from({ length: count }, () => r.pick([...set]));
		glyphs.push(u.text);
		const advance = g.width - (options.letterSpacing ?? 0);
		const reel = ctx.host.text(glyphs.join("\n"), {
			...glyphProps,
			id: ctx.partId(`reel-${u.start}`),
			position: "absolute",
			x: 0,
			y: 0,
			width: advance,
			align: "center",
		});
		const ys: KeyframeTuple[] = [[0, 0]];
		for (let k = 1; k < count; k++)
			ys.push([appear + k * step, -k * m.lineHeight, "hold"]);
		ys.push([lock, -count * m.lineHeight, "hold"]);
		reel.animate(
			LayerAnimation.create()
				.keys("y", ys)
				.keys("opacity", [
					[appear, 0],
					[appear + 3, 1],
				]),
		);
		reels.push(
			ctx.host.box({
				id: ctx.partId(`cell-${u.start}`),
				position: "absolute",
				x: lineShift(m, g.line, options) + g.x,
				y: g.line * m.lineHeight,
				width: advance,
				height: m.lineHeight,
				overflow: "hidden",
				children: [reel],
			}),
		);
		cues.push({ frame: appear, settled: lock, index: u.index, text: u.text });
		done = Math.max(done, lock);
	});
	const group = ctx.host.box({
		id: ctx.partId("reels"),
		position: "absolute",
		x: 0,
		y: 0,
		width: m.width,
		height: m.height,
		children: reels,
	});
	group.animate(
		LayerAnimation.keys("opacity", [
			[0, 1],
			[done, 0, "hold"],
		]),
	);
	return { reels: group, cues, done };
}
