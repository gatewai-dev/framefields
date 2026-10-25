/**
 * CodeBlock: code that reads like an editor and moves like an explanation.
 * Syntax colours, typing, a focus band that walks the lines being
 * discussed, and diffs where kept lines glide to their new places while
 * removed lines fold away and new ones arrive.
 */
import {
	type AnimatableProp,
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
	type TextSpan,
} from "@framefields/compositions/program";
import { z } from "zod";
import { appFrame } from "../app-frame/index.js";
import { withAlpha } from "../core/color.js";
import { bind, defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { ascending, Track } from "../core/keys.js";
import { type Theme, themeFrames } from "../core/theme.js";
import { typingFrames } from "../core/typing.js";
import { diffLines, expandTabs, focusSet } from "./plan.js";
import {
	CODE_LANGS,
	type Token,
	type TokenKind,
	tokenize,
} from "./tokenize.js";

export {
	CODE_LANGS,
	type CodeLang,
	type Token,
	type TokenKind,
} from "./tokenize.js";

export interface CodeBlockCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Every typed character (`typing`): for key sounds. */
	keystrokes: ReadonlyArray<{ frame: number; line: number }>;
	/** Each line's first frame on screen (1-based `line`). */
	lines: ReadonlyArray<{ frame: number; line: number }>;
	/** Each focus step. */
	focus: ReadonlyArray<{ frame: number; lines: number[] }>;
	/** The diff, start to settle. */
	diff: ReadonlyArray<{ frame: number; end: number }>;
}

/** Token colours from theme tokens, then `theme.syntax` on top. */
function palette(theme: Theme): Record<TokenKind, string> {
	const c = theme.color;
	const light = theme.mode === "light";
	return {
		plain: c.ink,
		keyword: c.accent2,
		string: c.positive,
		// The highlight yellow and a bright teal wash out on light grounds.
		number: light ? "#a65a00" : c.highlight,
		comment: c.muted,
		function: c.accent,
		type: light ? "#0e7c91" : "#4cc9e0",
		property: c.ink,
		punctuation: c.muted,
		operator: c.muted,
		...theme.syntax,
	};
}

function tokenSchema() {
	return z.array(
		z.array(
			z
				.object({
					text: z.string(),
					kind: z
						.enum([
							"plain",
							"keyword",
							"string",
							"number",
							"comment",
							"function",
							"type",
							"property",
							"punctuation",
							"operator",
						])
						.optional(),
					color: z.string().optional(),
				})
				.strict(),
		),
	);
}

export const codeBlock = /* @__PURE__ */ defineComponent({
	name: "CodeBlock",
	props: () => ({
		code: z.string(),
		lang: z.enum(CODE_LANGS).default("ts"),
		/** Your own highlighter's output, one token list per line (overrides `lang`). */
		tokens: tokenSchema().optional(),
		typing: z
			.union([
				z.boolean(),
				z
					.object({
						cps: z.number().positive().optional(),
						at: z.number().int().min(0).optional(),
					})
					.strict(),
			])
			.default(false),
		/** 1-based lines, as a list or `{ from, to }`; `[]` clears. */
		focus: z
			.array(
				z
					.object({
						at: z.number().int().min(0),
						lines: z.union([
							z.array(z.number().int().positive()),
							z
								.object({
									from: z.number().int().positive(),
									to: z.number().int().positive(),
								})
								.strict(),
						]),
					})
					.strict(),
			)
			.default([]),
		diff: z
			.object({
				to: z.string(),
				at: z.number().int().min(0),
				duration: z.number().int().positive().optional(),
			})
			.strict()
			.optional(),
		lineNumbers: z.boolean().default(true),
		tabSize: z.number().int().positive().default(2),
		/** Wrap in an AppFrame window (with a title such as the file name). */
		frame: z
			.union([z.boolean(), z.object({ title: z.string().optional() }).strict()])
			.default(false),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const fs = props.fontSize ?? 24 * s;
		const fontFamily = props.fontFamily ?? theme.font.mono;
		const LINE_HEIGHT = 1.5;
		const m = host.measure("M", {
			fontFamily,
			fontSize: fs,
			lineHeight: LINE_HEIGHT,
		});
		const adv = m.width;
		const lh = m.lineHeight;
		const colors = palette(theme);

		const before = expandTabs(props.code, props.tabSize).split("\n");
		const after = props.diff
			? expandTabs(props.diff.to, props.tabSize).split("\n")
			: null;
		const tokensOf = (lines: string[], own?: Token[][]) =>
			own ?? tokenize(lines.join("\n"), props.lang);
		const beforeTokens = tokensOf(
			before,
			props.tokens as Token[][] | undefined,
		);
		const afterTokens = after ? tokensOf(after) : null;

		// Fixed size up front: the widest line and the most lines, before and after.
		const rows = Math.max(before.length, after?.length ?? 0);
		const cols = Math.max(
			1,
			...before.map((l) => l.length),
			...(after ?? []).map((l) => l.length),
		);
		const pad = fs;
		const gutter = props.lineNumbers ? (String(rows).length + 2) * adv : 0;
		const W = pad * 2 + gutter + cols * adv;
		const H = pad * 2 + rows * lh;
		const rowY = (i: number) => pad + i * lh;
		const textX = pad + gutter;

		const spans = (line: Token[]): TextSpan[] =>
			line.map((t) => ({
				text: t.text,
				fill: t.color ?? colors[t.kind ?? "plain"],
			}));
		const lineNode = (id: string, tokens: Token[], text: string, row: number) =>
			host.text(text || " ", {
				id: ctx.partId(id),
				position: "absolute",
				x: textX,
				y: rowY(row),
				fontFamily,
				fontSize: fs,
				lineHeight: LINE_HEIGHT,
				fill: colors.plain,
				...(text && { spans: spans(tokens) }),
			});
		const numberNode = (id: string, n: number, row: number) =>
			host.text(String(n), {
				id: ctx.partId(id),
				position: "absolute",
				x: pad,
				y: rowY(row),
				width: gutter - adv * 1.5,
				align: "end",
				fontFamily,
				fontSize: fs,
				lineHeight: LINE_HEIGHT,
				fill: theme.color.muted,
			});

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const rowsLayer: LayoutNode[] = [];
		const washes: LayoutNode[] = [];
		const opacity = new Map<LayoutNode, Track>();
		const fade = (node: LayoutNode, initial = 1) => {
			let t = opacity.get(node);
			if (!t) {
				t = new Track(initial);
				opacity.set(node, t);
			}
			return t;
		};
		const animations = new Map<LayoutNode, LayerAnimation>();
		const animOf = (node: LayoutNode) => {
			let a = animations.get(node);
			if (!a) {
				a = LayerAnimation.create();
				animations.set(node, a);
			}
			return a;
		};

		const beforeNodes = before.map((text, i) =>
			lineNode(`line-${i}`, beforeTokens[i] ?? [], text, i),
		);
		const beforeNumbers = props.lineNumbers
			? before.map((_, i) => numberNode(`number-${i}`, i + 1, i))
			: [];
		rowsLayer.push(...beforeNumbers, ...beforeNodes);

		// ── Typing ────────────────────────────────────────────────────────
		const keystrokes: Array<{ frame: number; line: number }> = [];
		const lineCues: Array<{ frame: number; line: number }> = before.map(
			(_, i) => ({ frame: 0, line: i + 1 }),
		);
		let end = 0;
		if (props.typing !== false) {
			const o = props.typing === true ? {} : props.typing;
			const r = ctx.rng("typing");
			let t = o.at ?? 0;
			const caretKeys: { x: KeyframeTuple[]; y: KeyframeTuple[] } = {
				x: [],
				y: [],
			};
			before.forEach((text, i) => {
				const indent = text.length - text.trimStart().length;
				const node = beforeNodes[i] as Animatable<LayoutNode>;
				const number = beforeNumbers[i];
				lineCues[i] = { frame: Math.round(t), line: i + 1 };
				if (number) fade(number, 0).to(Math.round(t), Math.round(t), 1);
				caretKeys.x.push([Math.round(t), textX + indent * adv, "hold"]);
				caretKeys.y.push([Math.round(t), rowY(i), "hold"]);
				// Indentation appears with the line (editors auto-indent).
				const typed = text.slice(indent);
				const frames = typed
					? typingFrames(typed, o.cps ?? 28, fps, r, Math.round(t))
					: [];
				const count = (c: number) =>
					text.length > 1 && c <= 1 ? c / text.length : c;
				const keys: KeyframeTuple[] = [[0, 0]];
				if (indent > 0 || !typed)
					keys.push([
						Math.round(t),
						count(Math.max(indent, typed ? indent : 1)),
						"hold",
					]);
				frames.forEach((f, k) => {
					keys.push([f, count(indent + k + 1), "hold"]);
					keystrokes.push({ frame: f, line: i + 1 });
					caretKeys.x.push([f, textX + (indent + k + 1) * adv, "hold"]);
					caretKeys.y.push([f, rowY(i), "hold"]);
				});
				animOf(node).keys("text" as AnimatableProp, ascending(keys));
				t = (frames[frames.length - 1] ?? t) + Math.round(fps * 0.18);
			});
			end = Math.round(t);
			const caret = host.box({
				id: ctx.partId("caret"),
				position: "absolute",
				x: textX,
				y: rowY(0),
				width: Math.max(2, fs * 0.09),
				height: lh,
				background: theme.color.accent,
			});
			const half = Math.max(1, Math.round(fps * 0.5));
			const blink: KeyframeTuple[] = [[0, 1]];
			for (
				let f = end + half, on = false;
				f < end + half * 6;
				f += half, on = !on
			)
				blink.push([f, on ? 1 : 0, "hold"]);
			blink.push([end + half * 6, 0, "hold"]);
			caret.animate(
				LayerAnimation.create()
					.keys("x", ascending(caretKeys.x))
					.keys("y", ascending(caretKeys.y))
					.keys("opacity", blink),
			);
			parts.caret = caret;
			rowsLayer.push(caret);
		}

		// ── Diff ──────────────────────────────────────────────────────────
		const diffCue: Array<{ frame: number; end: number }> = [];
		let afterNodes: LayoutNode[] = beforeNodes;
		if (props.diff && after && afterTokens) {
			const T = props.diff.at;
			const D =
				props.diff.duration ??
				Math.round(themeFrames(theme, "slow", fps) * 1.2);
			const move = theme.motion.ease.move;
			const plan = diffLines(before, after);
			afterNodes = new Array<LayoutNode>(after.length);
			const wash = (
				id: string,
				row: number,
				color: string,
				from: number,
				to: number,
			) => {
				const box = host.box({
					id: ctx.partId(id),
					position: "absolute",
					x: pad * 0.4,
					y: rowY(row),
					width: W - pad * 0.8,
					height: lh,
					background: withAlpha(color, 0.22),
					borderRadius: theme.radius.sm,
				});
				fade(box, 0)
					.to(from, from + 4, 1)
					.to(to - 10, to, 0, "power2.in");
				washes.push(box);
			};
			for (const [i, j] of plan.kept) {
				const node = beforeNodes[i] as Animatable<LayoutNode>;
				let moving: LayoutNode = node;
				if ((before[i] as string) !== (after[j] as string)) {
					// Re-indented: the new text takes over as it starts to move.
					const next = lineNode(
						`line-${i}-to-${j}`,
						afterTokens[j] ?? [],
						after[j] as string,
						i,
					);
					fade(next, 0).to(T, T, 1);
					fade(node).to(T, T, 0);
					rowsLayer.push(next);
					moving = next;
				}
				if (i !== j)
					animOf(moving).keys("y", [
						[T, rowY(i)],
						[T + D, rowY(j), move],
					]);
				afterNodes[j] = moving;
			}
			for (const i of plan.removed) {
				const node = beforeNodes[i] as LayoutNode;
				fade(node).to(T, T + Math.round(D * 0.38), 0, "power2.in");
				animOf(node).keys("x", [
					[T, textX],
					[T + Math.round(D * 0.38), textX - fs * 0.6, "power2.in"],
				]);
				wash(
					`wash-removed-${i}`,
					i,
					theme.color.negative,
					T,
					T + Math.round(D * 0.6),
				);
			}
			for (const j of plan.added) {
				const node = lineNode(
					`added-${j}`,
					afterTokens[j] ?? [],
					after[j] as string,
					j,
				);
				const from = T + Math.round(D * 0.48);
				fade(node, 0).to(from, T + D, 1);
				animOf(node).keys("x", [
					[from, textX + fs * 0.8],
					[T + D, textX, theme.motion.ease.enter],
				]);
				wash(
					`wash-added-${j}`,
					j,
					theme.color.positive,
					from,
					T + D + Math.round(fps * 0.8),
				);
				rowsLayer.push(node);
				afterNodes[j] = node;
			}
			if (props.lineNumbers) {
				for (const n of beforeNumbers) fade(n).to(T, T + 6, 0);
				after.forEach((_, j) => {
					const n = numberNode(`number-after-${j}`, j + 1, j);
					fade(n, 0).to(T + Math.round(D * 0.5), T + D, 1);
					rowsLayer.push(n);
				});
			}
			diffCue.push({ frame: T, end: T + D });
			end = Math.max(end, T + D + Math.round(fps * 0.8));
		}

		// ── Focus ─────────────────────────────────────────────────────────
		const focusCues: Array<{ frame: number; lines: number[] }> = [];
		const band = host.box({
			id: ctx.partId("band"),
			position: "absolute",
			x: pad * 0.4,
			y: rowY(0),
			width: W - pad * 0.8,
			height: lh,
			background: withAlpha(theme.color.accent, 0.14),
			borderRadius: theme.radius.sm,
		});
		const bandY = new Track(rowY(0));
		const bandH = new Track(lh);
		const bandOn = new Track(0);
		const glide = Math.max(4, themeFrames(theme, "base", fps) / 2);
		for (const step of [...props.focus].sort((a, b) => a.at - b.at)) {
			const afterDiff = props.diff !== undefined && step.at >= props.diff.at;
			const nodes = afterDiff ? afterNodes : beforeNodes;
			const set = focusSet(step.lines, nodes.length);
			const f = step.at;
			nodes.forEach((node, i) => {
				fade(node).to(f, f + glide, set.size === 0 || set.has(i) ? 1 : 0.32);
			});
			if (set.size > 0) {
				const lo = Math.min(...set);
				const hi = Math.max(...set);
				bandY.to(f, f + glide, rowY(lo) - lh * 0.1, theme.motion.ease.move);
				bandH.to(
					f,
					f + glide,
					(hi - lo + 1) * lh + lh * 0.2,
					theme.motion.ease.move,
				);
				bandOn.to(f, f + glide, 1);
			} else bandOn.to(f, f + glide, 0);
			focusCues.push({ frame: f, lines: [...set].map((i) => i + 1) });
			end = Math.max(end, f + glide);
		}
		band.animate(
			LayerAnimation.create()
				.keys("y", bandY.keys())
				.keys("height", bandH.keys())
				.keys("opacity", bandOn.keys()),
		);
		parts.band = band;

		for (const [node, track] of opacity)
			animOf(node).keys("opacity", track.keys());
		for (const [node, anim] of animations)
			(node as Animatable<LayoutNode>).animate(anim);

		const inner = host.box({
			id: ctx.partId("code"),
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			overflow: "hidden",
			...(props.frame === false && {
				background: theme.color.surface,
				borderRadius: theme.radius.lg,
			}),
			children: [band, ...washes, ...rowsLayer],
		});
		parts.code = inner;

		let root: LayoutNode = inner;
		let height = H;
		if (props.frame !== false) {
			const o = props.frame === true ? {} : props.frame;
			const bar = 46 * s;
			const frameNode = bind(
				host,
				appFrame,
			)({
				id: ctx.partId("window"),
				kind: "window",
				width: W,
				height: H + bar,
				content: [inner],
				contentBackground: theme.color.surface,
				enter: false,
				theme,
				...(o.title !== undefined && { title: o.title }),
			});
			parts.window = frameNode;
			root = frameNode;
			height = H + bar;
		}

		return {
			children: [root],
			width: W,
			height,
			duration: Math.max(1, end),
			openEnded: true,
			cues: {
				keystrokes,
				lines: lineCues,
				focus: focusCues,
				diff: diffCue,
			} as CodeBlockCues,
			parts,
		};
	},
});
