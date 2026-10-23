/**
 * Counter: numbers that change in a way viewers trust. Every digit place is
 * a clipped reel that spins like an odometer (`roll`) or steps (`count`);
 * separators and affixes are laid out by the format, and the number slides
 * to stay aligned as places appear.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { bakeSamples } from "../core/bake.js";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import type { MeasureOptions } from "../core/text.js";
import { themeFrames } from "../core/theme.js";
import {
	type CounterFormat,
	milestones,
	numberLayout,
	placesOf,
	reelPositions,
	type ValueKey,
	valueAt,
} from "./plan.js";

export type { CounterFormat } from "./plan.js";

export interface CounterCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Every reel is at rest on the final value. */
	settled: ReadonlyArray<{ frame: number }>;
	/** Crossings of `milestoneEvery` (e.g. for tick sounds). */
	milestones: ReadonlyArray<{ frame: number; value: number }>;
}

/** A slot in the number: a digit reel, a separator, or a character column. */
interface Slot {
	width: number;
	/** Visible on each frame. */
	visible: boolean[];
	build(x: number): Animatable<LayoutNode>;
}

const MINUS = "−";
/** Frames a slot takes to fade, and the number to slide, when places change. */
const SETTLE = 6;

export const counter = /* @__PURE__ */ defineComponent({
	name: "Counter",
	props: () => ({
		from: z.number().default(0),
		to: z.number().optional(),
		/** Multi-step counts: `[frame, value, ease?]`, frames ascending. */
		values: z
			.array(
				z.union([
					z.tuple([z.number().int().min(0), z.number()]),
					z.tuple([z.number().int().min(0), z.number(), z.string()]),
				]),
			)
			.min(1)
			.optional(),
		/** `",d"`, `"$,.2f"`, `".1%"`, Intl options, or `(n) => string`. */
		format: z
			.union([
				z.string(),
				z.custom<(value: number) => string>((v) => typeof v === "function"),
				z.custom<Intl.NumberFormatOptions>(
					(v) => typeof v === "object" && v !== null,
				),
			])
			.default(",d"),
		locale: z.string().default("en-US"),
		prefix: z.string().default(""),
		suffix: z.string().default(""),
		/** Affix size relative to the digits (e.g. 0.6 for a small `%`). */
		affixScale: z.number().min(0.2).max(1).default(1),
		/** `roll`: odometer reels. `count`: digits step frame by frame. */
		style: z.enum(["roll", "count"]).default("roll"),
		/** Frames the count takes (`from` → `to`). Default: twice the theme's slow speed. */
		countDuration: z.number().int().positive().optional(),
		ease: z.string().optional(),
		/** Frames each higher place settles after the one below it (`roll`). */
		digitStagger: z.number().min(0).default(2),
		/** Vertical blur on fast reels (`roll`). */
		motionBlur: z.boolean().default(true),
		milestoneEvery: z.number().positive().optional(),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
		fontWeight: z.union([z.number(), z.string()]).optional(),
		fill: z.string().optional(),
		align: z.enum(["start", "center", "end"]).default("start"),
	}),
	defaults: { enter: false, exit: false, hold: 30 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const fs = props.fontSize ?? 120 * theme.scale;
		const fontFamily = props.fontFamily ?? theme.font.display;
		const ease = props.ease ?? theme.motion.ease.move;
		const roll = props.style === "roll";

		if (props.values === undefined && props.to === undefined)
			throw new Error("Counter: give `to` (or `values`).");
		const keys: ValueKey[] = props.values
			? props.values.map((v) => [...v] as unknown as ValueKey)
			: [
					[0, props.from],
					[
						props.countDuration ?? themeFrames(theme, "slow", fps) * 2,
						props.to as number,
					],
				];
		keys.forEach((k, i) => {
			const prev = keys[i - 1];
			if (prev && k[0] <= prev[0])
				throw new Error(
					`Counter: \`values\` frames must ascend (${prev[0]} then ${k[0]}).`,
				);
		});

		const text = (content: string, size: number, id: string, extra = {}) =>
			host.text(content, {
				id: ctx.partId(id),
				position: "absolute",
				fontFamily,
				fontSize: size,
				fill: props.fill ?? theme.color.ink,
				...(props.fontWeight !== undefined && { fontWeight: props.fontWeight }),
				...extra,
			});
		const measureWith = (s: string, size = fs) =>
			host.measure(s, {
				fontFamily,
				fontSize: size,
				fontWeight: props.fontWeight,
			} satisfies MeasureOptions);
		const lh = measureWith("0").lineHeight;

		const layout = numberLayout(props.format as CounterFormat, props.locale);
		const stagger = roll ? (props.digitStagger * fps) / 30 : 0;
		const lastKey = (keys[keys.length - 1] as ValueKey)[0];
		// Reels count in the last shown digit: 99.5 at two decimals is 9950.
		const scale = layout ? layout.scale * 10 ** layout.decimals : 1;
		const places = layout
			? Math.max(...keys.map((k) => placesOf(k[1] * scale, layout.decimals)))
			: 1;
		const settle = Math.round(lastKey + stagger * (places - 1));
		const values = Array.from({ length: settle + 1 }, (_, f) =>
			valueAt(keys, f, ease),
		);
		const scaled = values.map((v) => Math.round(v * scale));

		// ── Slots, right to left ──────────────────────────────────────────
		const slots: Slot[] = [];
		if (layout) {
			const cellW = Math.max(
				...[..."0123456789"].map((d) => measureWith(d).width),
			);
			const shows = (place: number) =>
				scaled.map(
					(n) =>
						place <= layout.decimals ||
						Math.floor(Math.abs(n) / 10 ** place) > 0,
				);
			for (let p = 0; p < places; p++) {
				if (p === layout.decimals && layout.decimals > 0) {
					const mark = layout.decimalMark;
					slots.push({
						width: measureWith(mark).width,
						visible: scaled.map(() => true),
						build: (x) => text(mark, fs, "decimal", { x, y: 0 }),
					});
				}
				const q = p - layout.decimals;
				if (layout.group && q > 0 && q % 3 === 0) {
					const sep = layout.group;
					slots.push({
						width: measureWith(sep).width,
						visible: shows(p),
						build: (x) => text(sep, fs, `group-${q}`, { x, y: 0 }),
					});
				}
				const place = p;
				slots.push({
					width: cellW,
					visible: shows(place),
					build: (x) =>
						digitCell(
							place,
							x,
							cellW,
							roll
								? reelPositions(keys, place, {
										scale,
										stagger,
										ease,
										length: settle,
									})
								: scaled.map((n) => Math.floor(Math.abs(n) / 10 ** place) % 10),
						),
				});
			}
		} else {
			// A formatter function: one column per character from the right.
			const format = props.format as (n: number) => string;
			const strings = values.map((v) => format(v));
			const columns = Math.max(...strings.map((s) => s.length));
			for (let c = 0; c < columns; c++) {
				const chars = strings.map((s) => s[s.length - 1 - c] ?? "");
				const rows = [...new Set(chars)];
				const width = Math.max(
					0,
					...rows.map((r) => (r ? measureWith(r).width : 0)),
				);
				const col = c;
				slots.push({
					width,
					visible: chars.map((ch) => ch !== ""),
					build: (x) => charCell(col, x, width, rows, chars),
				});
			}
		}

		function digitCell(
			place: number,
			x: number,
			width: number,
			positions: number[],
		): Animatable<LayoutNode> {
			const lo = Math.floor(Math.min(...positions));
			const hi = Math.ceil(Math.max(...positions));
			const rows = roll
				? Array.from(
						{ length: hi - lo + 1 },
						(_, k) => (((lo + k) % 10) + 10) % 10,
					)
				: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
			const base = roll ? lo : 0;
			const ys = positions.map((pos) => -(pos - base) * lh);
			const reel = text(rows.join("\n"), fs, `reel-${place}`, {
				x: 0,
				y: ys[0] ?? 0,
				width,
				align: "center",
				...(roll && props.motionBlur && { motionBlurShutter: 90 }),
			});
			reel.animate(
				LayerAnimation.keys(
					"y",
					roll ? bakeSamples(ys, 0, { tolerance: 0.2 }) : stepKeys(ys),
				),
			);
			return host.box({
				id: ctx.partId(`cell-${place}`),
				position: "absolute",
				x,
				y: 0,
				width,
				height: lh,
				overflow: "hidden",
				children: [reel],
			});
		}

		function charCell(
			column: number,
			x: number,
			width: number,
			rows: string[],
			chars: string[],
		): Animatable<LayoutNode> {
			const ys = chars.map((ch) => -rows.indexOf(ch) * lh);
			const reel = text(
				rows.map((r) => r || " ").join("\n"),
				fs,
				`reel-${column}`,
				{
					x: 0,
					y: ys[0] ?? 0,
					width,
					align: "center",
				},
			);
			reel.animate(LayerAnimation.keys("y", stepKeys(ys)));
			return host.box({
				id: ctx.partId(`cell-${column}`),
				position: "absolute",
				x,
				y: 0,
				width,
				height: lh,
				overflow: "hidden",
				children: [reel],
			});
		}

		// ── Layout over time ──────────────────────────────────────────────
		const affix = fs * props.affixScale;
		const affixLh = measureWith("0", affix).lineHeight;
		const affixY = (lh - affixLh) * 0.78;
		const prefix = (layout?.prefix ?? "") + props.prefix;
		const suffix = props.suffix + (layout?.suffix ?? "");
		const prefixW = prefix ? measureWith(prefix, affix).width : 0;
		const suffixW = suffix ? measureWith(suffix, affix).width : 0;
		const negative = scaled.map((n) => n < 0);
		const minusW = negative.some(Boolean) ? measureWith(MINUS).width : 0;

		const digitsW = slots.reduce((a, s) => a + s.width, 0);
		const W = prefixW + minusW + digitsW + suffixW;
		const shown = scaled.map((_, f) =>
			slots.reduce((a, s) => a + (s.visible[f] ? s.width : 0), 0),
		);
		const content = shown.map(
			(w, f) => prefixW + (negative[f] ? minusW : 0) + w + suffixW,
		);
		const af = props.align === "center" ? 0.5 : props.align === "end" ? 1 : 0;
		const left = content.map((c) => (W - c) * af);

		const parts: Record<string, Animatable<LayoutNode>> = {};
		let cursor = digitsW;
		const cells = slots.map((s, i) => {
			cursor -= s.width;
			const node = s.build(cursor);
			node.animate(LayerAnimation.keys("opacity", fadeKeys(s.visible)));
			parts[`slot-${i}`] = node;
			return node;
		});
		const digits = host.box({
			id: ctx.partId("digits"),
			position: "absolute",
			x: 0,
			y: 0,
			width: digitsW,
			height: lh,
			children: cells,
		});
		const digitsX = shown.map(
			(w, f) =>
				(left[f] as number) +
				prefixW +
				(negative[f] ? minusW : 0) +
				w -
				digitsW,
		);
		digits.animate(LayerAnimation.keys("x", slideKeys(digitsX)));
		parts.digits = digits;
		const children: LayoutNode[] = [digits];

		if (prefix) {
			const node = text(prefix, affix, "prefix", { x: 0, y: affixY });
			node.animate(LayerAnimation.keys("x", slideKeys(left)));
			parts.prefix = node;
			children.push(node);
		}
		if (minusW > 0) {
			const node = text(MINUS, fs, "minus", { x: 0, y: 0 });
			node.animate(
				LayerAnimation.create()
					.keys("x", slideKeys(left.map((l) => l + prefixW)))
					.keys("opacity", fadeKeys(negative)),
			);
			parts.minus = node;
			children.push(node);
		}
		if (suffix) {
			const node = text(suffix, affix, "suffix", { x: 0, y: affixY });
			node.animate(
				LayerAnimation.keys("x", slideKeys(digitsX.map((x) => x + digitsW))),
			);
			parts.suffix = node;
			children.push(node);
		}

		return {
			children,
			width: W,
			height: lh,
			duration: settle + 1,
			openEnded: true,
			cues: {
				settled: [{ frame: settle }],
				milestones:
					props.milestoneEvery === undefined
						? []
						: milestones(values, props.milestoneEvery),
			} as CounterCues,
			parts,
		};
	},
});

/** Hold keys at every change of a per-frame series. */
function stepKeys(series: readonly number[]): KeyframeTuple[] {
	const keys: KeyframeTuple[] = [[0, series[0] ?? 0]];
	for (let f = 1; f < series.length; f++)
		if (series[f] !== series[f - 1])
			keys.push([f, series[f] as number, "hold"]);
	return keys;
}

/** A per-frame target that changes in steps, eased over {@link SETTLE} frames. */
function slideKeys(series: readonly number[]): KeyframeTuple[] {
	const keys: KeyframeTuple[] = [[0, series[0] ?? 0]];
	for (let f = 1; f < series.length; f++) {
		const prev = series[f - 1] as number;
		const next = series[f] as number;
		if (Math.abs(next - prev) < 0.01) continue;
		const last = keys[keys.length - 1] as KeyframeTuple;
		if (f - 1 > last[0]) keys.push([f - 1, prev]);
		keys.push([f - 1 + SETTLE, next, "power2.out"]);
	}
	return dedupe(keys);
}

function fadeKeys(visible: readonly boolean[]): KeyframeTuple[] {
	return slideKeys(visible.map((v) => (v ? 1 : 0)));
}

/** Keys must ascend: a later change replaces anything it overlaps. */
function dedupe(keys: KeyframeTuple[]): KeyframeTuple[] {
	const out: KeyframeTuple[] = [];
	for (const k of keys) {
		while (out.length > 0 && (out[out.length - 1] as KeyframeTuple)[0] >= k[0])
			out.pop();
		out.push(k);
	}
	return out;
}
