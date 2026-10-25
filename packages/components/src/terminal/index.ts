/**
 * Terminal: a scripted shell session. Commands type with a human rhythm,
 * output streams in, spinners resolve to check marks, progress bars fill,
 * and the view scrolls by whole lines, all on cue. Wrapped in an `AppFrame`
 * terminal window by default.
 */
import {
	type KeyframeTuple,
	LayerAnimation,
	type LayoutNode,
	type TextSpan,
} from "@framefields/compositions/program";
import { z } from "zod";
import { appFrame } from "../app-frame/index.js";
import { bind, defineComponent } from "../core/contract.js";
import type { Animatable } from "../core/host.js";
import { ascending } from "../core/keys.js";
import { toPathData, type Vec2 } from "../core/path.js";
import type { Theme } from "../core/theme.js";
import { counter } from "../counter/index.js";
import {
	planTerminal,
	SCROLL_GLIDE,
	type Span,
	type Step,
	spansText,
} from "./plan.js";

export type { Step as TerminalStep } from "./plan.js";

export interface TerminalCues {
	[name: string]: ReadonlyArray<{ frame: number }>;
	/** Every typed character: for key sounds. */
	keystrokes: ReadonlyArray<{ frame: number; index: number; step: number }>;
	/** Enter, per command. */
	submits: ReadonlyArray<{ frame: number; step: number }>;
	/** Each output step, first line to last. */
	outputs: ReadonlyArray<{ frame: number; end: number; step: number }>;
	/** The script has finished. */
	done: ReadonlyArray<{ frame: number }>;
}

/** The 16-colour palette, from theme tokens where they exist. */
function palette(theme: Theme): Record<string, string> {
	const c = theme.color;
	return {
		black: "#1b1d23",
		red: c.negative,
		green: c.positive,
		yellow: c.highlight,
		blue: c.accent,
		magenta: c.accent2,
		cyan: "#4cc9e0",
		white: c.ink,
		gray: c.muted,
		dim: c.muted,
		accent: c.accent,
	};
}

function stepSchema() {
	const frames = z.number().int().positive();
	return z.union([
		z.object({ cmd: z.string(), prompt: z.string().optional() }).strict(),
		z.object({ output: z.union([z.string(), z.array(z.string())]) }).strict(),
		z
			.object({ spinner: z.string(), for: frames, done: z.string().optional() })
			.strict(),
		z.object({ progress: z.string(), for: frames }).strict(),
		z.object({ pause: frames }).strict(),
		z.object({ clear: z.literal(true) }).strict(),
	]);
}

export const terminal = /* @__PURE__ */ defineComponent({
	name: "Terminal",
	props: () => ({
		script: z.array(stepSchema()).min(1),
		prompt: z.string().default("$ "),
		/** Typing speed, characters a second (seeded ±30 % jitter). */
		cps: z.number().positive().default(18),
		/** Output lines a second, or `"instant"`. */
		outputRate: z
			.union([z.number().positive(), z.literal("instant")])
			.default(40),
		rows: z.number().int().positive().default(16),
		/** Columns. Default: the widest line, between 40 and 100. */
		cols: z.number().int().positive().optional(),
		/** `{green}ok{/}`-style colours (black red green yellow blue magenta cyan white gray dim accent, bold). */
		markup: z.boolean().default(true),
		/** Wrap in an AppFrame terminal window (`false` for the bare screen). */
		frame: z
			.union([
				z.boolean(),
				z
					.object({
						title: z.string().optional(),
						elevation: z.number().int().min(0).max(3).optional(),
					})
					.strict(),
			])
			.default(true),
		caret: z.enum(["block", "bar", "underline"]).default("block"),
		fontFamily: z.string().optional(),
		fontSize: z.number().positive().optional(),
	}),
	defaults: { enter: false, exit: false },
	build(ctx, props) {
		const { host, theme, fps } = ctx;
		const s = theme.scale;
		const fs = props.fontSize ?? 24 * s;
		const fontFamily = props.fontFamily ?? theme.font.mono;
		const colors = palette(theme);
		const LINE_HEIGHT = 1.5;
		const glyph = host.measure("M", {
			fontFamily,
			fontSize: fs,
			lineHeight: LINE_HEIGHT,
		});
		const adv = glyph.width;
		const lh = glyph.lineHeight;

		const plan = planTerminal(props.script as Step[], {
			prompt: props.prompt,
			cps: props.cps,
			outputRate: props.outputRate,
			rows: props.rows,
			fps,
			markup: props.markup,
			rng: ctx.rng("typing"),
		});
		const cols = props.cols ?? Math.min(100, Math.max(40, plan.widest + 2));
		const pad = fs * 0.9;
		const viewW = cols * adv + pad * 2;
		const viewH = props.rows * lh + pad * 2;

		const parts: Record<string, Animatable<LayoutNode>> = {};
		const content: LayoutNode[] = [];
		/** A node drawn from `from` until `until` (local frames). */
		const live = (from: number, until: number) => ({
			startFrame: from,
			...(Number.isFinite(until) && {
				durationFrames: Math.max(1, until - from),
			}),
		});
		const toSpans = (spans: readonly Span[]): TextSpan[] =>
			spans.map((sp) => ({
				text: sp.text,
				fill: sp.color
					? (colors[sp.color] ?? theme.color.ink)
					: theme.color.ink,
				...(sp.bold && { fontWeight: theme.weight.bold }),
			}));

		// ── Lines ─────────────────────────────────────────────────────────
		plan.lines.forEach((line, i) => {
			const node = host.text(spansText(line.spans), {
				id: ctx.partId(`line-${i}`),
				position: "absolute",
				x: (line.indent ?? 0) * adv,
				y: line.row * lh,
				fontFamily,
				fontSize: fs,
				lineHeight: LINE_HEIGHT,
				fill: theme.color.ink,
				spans: toSpans(line.spans),
				...live(line.appear, line.until),
			});
			if (line.typing) {
				const total = spansText(line.spans).length;
				// The text track is a reveal amount: ≤ 1 a fraction, > 1 a count.
				const count = (c: number) => (c <= 1 ? c / total : c);
				const shown = line.typing.prompt;
				const keys: KeyframeTuple[] = [[0, count(shown)]];
				line.typing.frames.forEach((f, k) => {
					keys.push([f - line.appear, count(shown + k + 1), "hold"]);
				});
				node.animate(LayerAnimation.keys("text" as never, keys));
			}
			content.push(node);
		});

		// ── Spinners, checks, progress ────────────────────────────────────
		const cell = (row: number, col: number) => ({ x: col * adv, y: row * lh });
		plan.spinners.forEach((sp, i) => {
			const r = fs * 0.32;
			const c: Vec2 = [adv / 2, lh / 2];
			const arc: Vec2[] = Array.from({ length: 25 }, (_, k) => {
				const a = (k / 24) * Math.PI * 1.5;
				return [c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r];
			});
			const spinner = host.shape("path", {
				id: ctx.partId(`spinner-${i}`),
				position: "absolute",
				...cell(sp.row, 0),
				width: adv,
				height: lh,
				d: toPathData(arc),
				fillType: "none",
				strokeColor: colors.accent,
				strokeWidth: fs * 0.1,
				strokeLineCap: "round",
				...live(sp.from, sp.to),
			});
			spinner.animate(
				LayerAnimation.keys("rotation", [
					[0, 0],
					[sp.to - sp.from, (360 * (sp.to - sp.from)) / (fps * 0.8), "none"],
				]),
			);
			content.push(spinner);
		});
		plan.checks.forEach((ck, i) => {
			const line = plan.lines.find(
				(l) => l.kind === "done" && l.row === ck.row && l.appear === ck.at,
			);
			const pts: Vec2[] = [
				[adv * 0.12, lh * 0.52],
				[adv * 0.4, lh * 0.72],
				[adv * 0.9, lh * 0.28],
			];
			const check = host.shape("path", {
				id: ctx.partId(`check-${i}`),
				position: "absolute",
				...cell(ck.row, 0),
				width: adv,
				height: lh,
				d: toPathData(pts),
				fillType: "none",
				strokeColor: colors.green,
				strokeWidth: fs * 0.12,
				strokeLineCap: "round",
				strokeLineJoin: "round",
				trimEnd: 0,
				...live(ck.at, line?.until ?? Number.POSITIVE_INFINITY),
			});
			check.animate(
				LayerAnimation.keys("trimEnd", [
					[0, 0],
					[Math.max(3, Math.round(fps * 0.2)), 1, "power2.out"],
				]),
			);
			content.push(check);
		});
		const makeCounter = bind(host, counter);
		plan.progress.forEach((pg, i) => {
			const line = plan.lines.find(
				(l) => l.kind === "progress" && l.row === pg.row,
			);
			const barCols = 24;
			const x0 = (pg.label.length + 1) * adv;
			const barW = barCols * adv;
			const barH = Math.max(4, lh * 0.32);
			const y = (lh - barH) / 2;
			const length = pg.to - pg.from;
			const fill = host.box({
				id: ctx.partId(`progress-${i}-fill`),
				position: "absolute",
				x: 0,
				y: 0,
				width: 0,
				height: barH,
				background: colors.accent,
				borderRadius: barH / 2,
			});
			fill.animate(
				LayerAnimation.keys("width", [
					[0, 0],
					[length, barW, "power1.inOut"],
				]),
			);
			const track = host.box({
				id: ctx.partId(`progress-${i}-track`),
				position: "absolute",
				x: x0,
				y,
				width: barW,
				height: barH,
				background: theme.color.line,
				borderRadius: barH / 2,
				overflow: "hidden",
				children: [fill],
			});
			const percent = makeCounter({
				id: ctx.partId(`progress-${i}-percent`),
				to: 100,
				suffix: "%",
				style: "count",
				countDuration: length,
				ease: "power1.inOut",
				digitStagger: 0,
				fontFamily,
				fontSize: fs,
				fill: theme.color.muted,
				x: x0 + barW + adv,
				y:
					(lh - host.measure("0", { fontFamily, fontSize: fs }).lineHeight) / 2,
				theme,
			});
			content.push(
				host.box({
					id: ctx.partId(`progress-${i}`),
					position: "absolute",
					...cell(pg.row, 0),
					width: viewW,
					height: lh,
					children: [track, percent],
					...live(pg.from, line?.until ?? Number.POSITIVE_INFINITY),
				}),
			);
		});

		// ── Caret ─────────────────────────────────────────────────────────
		const caretW = props.caret === "bar" ? Math.max(2, fs * 0.08) : adv;
		const caretH =
			props.caret === "underline" ? Math.max(2, fs * 0.1) : fs * 1.15;
		const caretDy = props.caret === "underline" ? lh * 0.82 : (lh - caretH) / 2;
		const xs: KeyframeTuple[] = [];
		const ys: KeyframeTuple[] = [];
		const on: KeyframeTuple[] = [];
		const half = Math.max(1, Math.round(fps * 0.5));
		plan.caret.forEach(([f, at], k) => {
			if (at) {
				xs.push([f, at.col * adv, "hold"]);
				ys.push([f, at.row * lh + caretDy, "hold"]);
			}
			on.push([f, at ? 1 : 0, "hold"]);
			// Idle with the caret up: blink until the next change.
			const next = plan.caret[k + 1]?.[0] ?? f + fps * 6;
			if (at)
				for (
					let b = f + half * 2, shown = false;
					b < next;
					b += half, shown = !shown
				)
					on.push([b, shown ? 1 : 0, "hold"]);
		});
		const caret = host.box({
			id: ctx.partId("caret"),
			position: "absolute",
			x: 0,
			y: 0,
			width: caretW,
			height: caretH,
			background: theme.color.ink,
			opacity: 0,
		});
		caret.animate(
			LayerAnimation.create()
				.keys("x", ascending(xs))
				.keys("y", ascending(ys))
				.keys("opacity", ascending(on)),
		);
		content.push(caret);
		parts.caret = caret;

		// ── Screen and scroll ─────────────────────────────────────────────
		// Whole lines at a time: glide on new output, snap on clear. A scroll
		// that arrives mid-glide retargets the glide instead of stacking.
		const scrollY = (top: number) => pad - top * lh;
		const scrollKeys: KeyframeTuple[] = [
			[0, scrollY(plan.scroll[0]?.[1] ?? 0)],
		];
		for (const [f, top, jump] of plan.scroll.slice(1)) {
			const last = scrollKeys[scrollKeys.length - 1] as KeyframeTuple;
			if (jump)
				scrollKeys.push([Math.max(f, last[0] + 1), scrollY(top), "hold"]);
			else if (last[0] > f && last[2] !== "hold") {
				scrollKeys[scrollKeys.length - 1] = [
					f + SCROLL_GLIDE,
					scrollY(top),
					last[2] as string,
				];
			} else {
				scrollKeys.push([Math.max(f, last[0] + 1), last[1]]);
				scrollKeys.push([
					Math.max(f, last[0] + 1) + SCROLL_GLIDE,
					scrollY(top),
					"power2.out",
				]);
			}
		}
		const lines = host.box({
			id: ctx.partId("lines"),
			position: "absolute",
			x: pad,
			y: pad,
			width: cols * adv,
			// Every row, not just a screenful: children outside a box are culled.
			height: (Math.max(0, ...plan.lines.map((l) => l.row)) + 1) * lh,
			children: content,
		});
		lines.animate(LayerAnimation.keys("y", ascending(scrollKeys)));
		const screen = host.box({
			id: ctx.partId("screen"),
			position: "absolute",
			x: 0,
			y: 0,
			width: viewW,
			height: viewH,
			overflow: "hidden",
			...(props.frame === false && {
				background: theme.color.surface,
				borderRadius: theme.radius.md,
			}),
			children: [lines],
		});
		parts.lines = lines;
		parts.screen = screen;

		let root: LayoutNode = screen;
		let width = viewW;
		let height = viewH;
		if (props.frame !== false) {
			const o = props.frame === true ? {} : props.frame;
			const bar = 40 * s;
			const frameNode = bind(
				host,
				appFrame,
			)({
				id: ctx.partId("window"),
				kind: "terminal",
				width: viewW,
				height: viewH + bar,
				content: [screen],
				contentBackground: theme.color.surface,
				enter: false,
				theme,
				...(o.title !== undefined && { title: o.title }),
				...(o.elevation !== undefined && { elevation: o.elevation }),
			});
			parts.window = frameNode;
			root = frameNode;
			height = viewH + bar;
			width = viewW;
		}

		return {
			children: [root],
			width,
			height,
			duration: plan.done + 1,
			openEnded: true,
			cues: {
				keystrokes: plan.keystrokes,
				submits: plan.submits,
				outputs: plan.outputs,
				done: [{ frame: plan.done }],
			} as TerminalCues,
			parts,
		};
	},
});
