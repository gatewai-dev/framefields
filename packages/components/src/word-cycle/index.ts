/**
 * WordCycle: one slot in a line cycles through words. The slot resizes to
 * each word's measured width and the rest of the line glides to fit, so
 * the sentence always reads as set type, never as a gap.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
} from "@framefields/compositions/program";
import { z } from "zod";
import { defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { themeFrames } from "../core/theme.js";

export const WORD_TRANSITIONS = ["roll", "fade", "slide", "type"] as const;
export type WordTransition = (typeof WORD_TRANSITIONS)[number];
export const WORD_SLOTS = ["plain", "pill", "underline"] as const;
export type WordSlot = (typeof WORD_SLOTS)[number];

export interface WordCycleCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Each new word starts arriving. */
	changes: ReadonlyArray<{ frame: number; index: number; word: string }>;
}

export const wordCycle = /* @__PURE__ */ defineComponent({
	name: "WordCycle",
	props: () => ({
		/** One line with one `{}` marking the slot. */
		text: z
			.string()
			.refine((t) => t.split("{}").length === 2 && !t.includes("\n"), {
				message: 'Expected one line with exactly one "{}" slot',
			}),
		words: z.array(z.string().min(1)).min(2),
		/** Frames each word stays. Default 1.6 seconds. */
		every: z.number().int().positive().optional(),
		/** Passes through `words`; the last word stays. */
		cycles: z.number().int().positive().default(1),
		transition: z.enum(WORD_TRANSITIONS).default("roll"),
		align: z.enum(["left", "center", "right"]).default("left"),
		slot: z.enum(WORD_SLOTS).default("plain"),
		color: z.string().optional(),
		slotColor: z.string().optional(),
		fontSize: z.number().positive().optional(),
		fontFamily: z.string().optional(),
		fontWeight: z.number().int().min(100).max(900).default(800),
	}),
	defaults: { enter: false, exit: false, hold: 30 },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const fs = props.fontSize ?? 96 * s;
		const fontFamily = props.fontFamily ?? theme.font.display;
		const ink = props.color ?? theme.color.ink;
		const accent = props.slotColor ?? theme.color.accent;
		const every = props.every ?? Math.round(fps * 1.6);
		const base = themeFrames(theme, "base", fps);
		const ease = theme.motion.ease.move;
		const pill = props.slot === "pill";

		// ── Measure ──────────────────────────────────────────────────────
		const font = { fontFamily, fontSize: fs, fontWeight: props.fontWeight };
		const measure = (t: string) => host.measure(t, font);
		const [rawBefore = "", rawAfter = ""] = props.text.split("{}");
		const before = rawBefore.trimEnd();
		const after = rawAfter.trimStart();
		// Spaces at the slot are measured, never trusted to a trailing space.
		const space = measure("a a").width - measure("aa").width;
		const lineH = measure("Ag").height;
		const gapB = rawBefore !== before && before ? space : 0;
		const gapA = rawAfter !== after && after ? space : 0;
		const wB = before ? measure(before).width : 0;
		const wA = after ? measure(after).width : 0;
		const pad = pill ? fs * 0.24 : 0;
		const widths = props.words.map((w) => measure(w).width);
		const slotW = (i: number) => (widths[i] as number) + pad * 2;
		const lineW = (i: number) => wB + gapB + slotW(i) + gapA + wA;
		const W = Math.max(...props.words.map((_, i) => lineW(i)));
		const H = lineH + (props.slot === "underline" ? fs * 0.14 : 0);
		const offset = (i: number) =>
			props.align === "left"
				? 0
				: props.align === "center"
					? (W - lineW(i)) / 2
					: W - lineW(i);

		// ── Timeline ─────────────────────────────────────────────────────
		const n = props.words.length;
		const shown = Array.from({ length: n * props.cycles }, (_, k) => k % n);
		const tr = Math.min(every - 1, props.transition === "type" ? 0 : base);
		// For `type`: each word deletes, then types (frames per character).
		const del = Math.max(1, Math.round(fps / 30));
		const typ = Math.max(1, Math.round((fps / 30) * 2));
		const changes = shown.slice(1).map((index, k) => ({
			frame: (k + 1) * every,
			index,
			word: props.words[index] as string,
		}));
		const lastChange = changes[changes.length - 1]?.frame ?? 0;
		const lastIndex = shown[shown.length - 1] as number;
		const settle =
			props.transition === "type"
				? lastChange +
					(props.words[shown[shown.length - 2] as number] as string).length *
						del +
					(props.words[lastIndex] as string).length * typ
				: lastChange + tr;

		// Slot geometry over time: [frame, slot width] steps, eased (or per char for `type`).
		const slotKeys: KeyframeTuple[] = [[0, slotW(0)]];
		const lineKeys: KeyframeTuple[] = [[0, offset(0)]];
		if (props.transition === "type") {
			let prev = 0;
			for (const c of changes) {
				const out = props.words[prev] as string;
				const inc = props.words[c.index] as string;
				const mo = measure(out);
				const mi = measure(inc);
				for (let k = 1; k <= out.length; k++) {
					const f = c.frame + k * del;
					const w = mo.caretX(out.length - k) + pad * 2;
					slotKeys.push([f, w, "hold"]);
				}
				const typeAt = c.frame + out.length * del;
				for (let k = 1; k <= inc.length; k++) {
					slotKeys.push([typeAt + k * typ, mi.caretX(k) + pad * 2, "hold"]);
				}
				// The line re-centres once, as the new word lands.
				lineKeys.push(
					[typeAt, offset(prev)],
					[typeAt + inc.length * typ, offset(c.index), ease],
				);
				prev = c.index;
			}
		} else {
			let prev = 0;
			for (const c of changes) {
				slotKeys.push(
					[c.frame, slotW(prev)],
					[c.frame + tr, slotW(c.index), ease],
				);
				lineKeys.push(
					[c.frame, offset(prev)],
					[c.frame + tr, offset(c.index), ease],
				);
				prev = c.index;
			}
		}
		const add = (keys: KeyframeTuple[], by: number): KeyframeTuple[] =>
			keys.map(([f, v, e]) =>
				e ? [f, round((v as number) + by), e] : [f, round((v as number) + by)],
			) as KeyframeTuple[];
		const sum = (a: KeyframeTuple[], b: KeyframeTuple[], by = 0) => {
			// After-text x = line offset + slot width (+ constants): key both tracks' frames.
			const frames = [...new Set([...a, ...b].map((k) => k[0] as number))].sort(
				(x, y) => x - y,
			);
			const at = (keys: KeyframeTuple[], f: number) => valueAt(keys, f);
			return frames.map((f) => {
				const k = [...a, ...b].find((key) => key[0] === f && key[2]);
				const v = round(at(a, f) + at(b, f) + by);
				return k ? ([f, v, k[2]] as KeyframeTuple) : ([f, v] as KeyframeTuple);
			});
		};

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const children: LayoutNode[] = [];
		const text = (name: string, content: string, x: number, fill: string) =>
			host.text(content, {
				id: ctx.partId(name),
				position: "absolute",
				x,
				y: 0,
				...font,
				fill,
			});
		const moving = props.align !== "left";

		if (before) {
			const node = text("before", before, offset(0), ink);
			if (moving) node.animate(LayerAnimation.keys("x", lineKeys));
			parts.before = node;
			children.push(node);
		}

		// Slot decoration: a pill behind, or an underline under, sized like the slot.
		const slotX = wB + gapB;
		if (props.slot !== "plain") {
			const deco = host.box({
				id: ctx.partId(pill ? "pill" : "underline"),
				position: "absolute",
				x: offset(0) + slotX,
				y: pill ? lineH * 0.06 : lineH + fs * 0.02,
				width: slotW(0),
				height: pill ? lineH * 0.9 : Math.max(3, fs * 0.07),
				background: accent,
				borderRadius: pill ? lineH * 0.45 : fs * 0.035,
			});
			deco.animate(
				LayerAnimation.create()
					.keys("x", add(lineKeys, slotX))
					.keys("width", slotKeys),
			);
			parts[pill ? "pill" : "underline"] = deco;
			children.push(deco);
		}

		// Words sit in a clip as wide as the slot, so a roll never shows outside it.
		const wordFill = pill ? theme.color.bg : accent;
		const wordNodes = props.words.map((word, i) => {
			const node = text(`word-${i}`, word, pad, wordFill);
			if (i !== 0) node.opacity = 0;
			const anim = LayerAnimation.create();
			const y: KeyframeTuple[] = [];
			const x: KeyframeTuple[] = [];
			const opacity: KeyframeTuple[] = [];
			const reveal: KeyframeTuple[] = [];
			const park = props.transition === "roll" ? lineH : 0;
			const visibleAt0 = i === 0;
			y.push([0, visibleAt0 ? 0 : park]);
			opacity.push([0, visibleAt0 ? 1 : 0]);
			if (props.transition === "type") reveal.push([0, visibleAt0 ? 1 : 0]);
			let prev = 0;
			for (const c of changes) {
				const f = c.frame;
				if (c.index === i) {
					// Arrives.
					if (props.transition === "roll") {
						y.push(
							[f - 1, park, "hold"],
							[f, park, "hold"],
							[f + tr, 0, theme.motion.ease.enter],
						);
						opacity.push([f, 1, "hold"]);
					} else if (props.transition === "fade") {
						y.push(
							[f, fs * 0.12, "hold"],
							[f + tr, 0, theme.motion.ease.enter],
						);
						opacity.push([f, 0, "hold"], [f + tr, 1, "power2.out"]);
					} else if (props.transition === "slide") {
						x.push(
							[f, pad + slotW(c.index), "hold"],
							[f + tr, pad, theme.motion.ease.enter],
						);
						opacity.push([f, 1, "hold"]);
					} else {
						const out = props.words[prev] as string;
						const typeAt = f + out.length * del;
						opacity.push([typeAt, 1, "hold"]);
						for (let k = 1; k <= word.length; k++)
							reveal.push([typeAt + k * typ, k / word.length, "hold"]);
					}
				} else if (prev === i) {
					// Leaves.
					if (props.transition === "roll") {
						y.push(
							[f, 0],
							[f + tr, -lineH, theme.motion.ease.exit],
							[f + tr + 1, park, "hold"],
						);
						opacity.push([f + tr, 1], [f + tr + 1, 0, "hold"]);
					} else if (props.transition === "fade") {
						y.push([f, 0], [f + tr, -fs * 0.12, theme.motion.ease.exit]);
						opacity.push([f, 1], [f + tr, 0, "power2.in"]);
					} else if (props.transition === "slide") {
						x.push(
							[f, pad],
							[
								f + tr,
								pad - (widths[i] as number) - pad * 2,
								theme.motion.ease.exit,
							],
						);
						opacity.push([f + tr, 1], [f + tr + 1, 0, "hold"]);
					} else {
						for (let k = 1; k <= word.length; k++)
							reveal.push([
								f + k * del,
								(word.length - k) / word.length,
								"hold",
							]);
						opacity.push([f + word.length * del, 0, "hold"]);
					}
				}
				prev = c.index;
			}
			if (y.length > 1) anim.keys("y", ascending(y));
			if (x.length > 0) anim.keys("x", ascending([[0, pad], ...x]));
			if (opacity.length > 1) anim.keys("opacity", ascending(opacity));
			if (reveal.length > 1) anim.keys("text", ascending(reveal));
			node.animate(anim);
			parts[`word-${i}`] = node;
			return node;
		});
		const clip = host.box({
			id: ctx.partId("slot"),
			position: "absolute",
			x: offset(0) + slotX,
			y: 0,
			width: slotW(0),
			height: H,
			overflow: "hidden",
			children: wordNodes,
		});
		clip.animate(
			LayerAnimation.create()
				.keys("x", add(lineKeys, slotX))
				.keys("width", slotKeys),
		);
		parts.slot = clip;
		children.push(clip);

		if (after) {
			const node = text(
				"after",
				after,
				offset(0) + slotX + slotW(0) + gapA,
				ink,
			);
			node.animate(
				LayerAnimation.keys("x", sum(lineKeys, slotKeys, slotX + gapA)),
			);
			parts.after = node;
			children.push(node);
		}

		return {
			children,
			width: W,
			height: H,
			duration: Math.max(1, settle),
			openEnded: true,
			cues: { changes } as WordCycleCues,
			parts,
		};
	},
});

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Later keys on a shared frame win; frames ascend. */
function ascending(keys: KeyframeTuple[]): KeyframeTuple[] {
	const byFrame = new Map<number, KeyframeTuple>();
	for (const k of keys) byFrame.set(k[0] as number, k);
	return [...byFrame.values()].sort(
		(a, b) => (a[0] as number) - (b[0] as number),
	);
}

/** A keyed track's value at `f` (linear between keys, `hold` steps). */
function valueAt(keys: readonly KeyframeTuple[], f: number): number {
	const first = keys[0] as KeyframeTuple;
	if (f <= (first[0] as number)) return first[1] as number;
	for (let i = 0; i < keys.length - 1; i++) {
		const [f0, v0] = keys[i] as KeyframeTuple;
		const [f1, v1, e] = keys[i + 1] as KeyframeTuple;
		if (f >= (f0 as number) && f <= (f1 as number)) {
			if (e === "hold") return f === f1 ? (v1 as number) : (v0 as number);
			const t = (f - (f0 as number)) / ((f1 as number) - (f0 as number));
			return (v0 as number) + ((v1 as number) - (v0 as number)) * t;
		}
	}
	return keys[keys.length - 1]?.[1] as number;
}
