/**
 * Terminal planning, kept pure: run the script on a clock and record what
 * appears where and when. Nodes are built from this plan; tests read it.
 */
import type { Rng } from "../core/rng.js";
import { typingFrames } from "../core/typing.js";

export type Step =
	| { cmd: string; prompt?: string }
	| { output: string | string[] }
	| { spinner: string; for: number; done?: string }
	| { progress: string; for: number }
	| { pause: number }
	| { clear: true };

/** A run of text in one colour (a palette name) and weight. */
export interface Span {
	text: string;
	color?: string;
	bold?: boolean;
}

export interface PlannedLine {
	row: number;
	/** Frame the line appears. */
	appear: number;
	/** Frame it stops being drawn (scrolled out or cleared); Infinity if never. */
	until: number;
	spans: Span[];
	step: number;
	kind: "cmd" | "output" | "spinner" | "done" | "progress" | "prompt";
	/** Columns the text starts in (room for a spinner or check mark). */
	indent?: number;
	/** For commands: characters already shown (the prompt) and each keystroke's frame. */
	typing?: { prompt: number; frames: number[] };
}

export interface TerminalPlan {
	lines: PlannedLine[];
	/** Rotating spinners: row, from frame, to frame. */
	spinners: Array<{ row: number; from: number; to: number; step: number }>;
	/** Check marks drawn at `at` on `row`, before the text from column 2. */
	checks: Array<{ row: number; at: number; step: number }>;
	progress: Array<{
		row: number;
		from: number;
		to: number;
		label: string;
		step: number;
	}>;
	/** First visible row from each frame on; `jump` (a clear) snaps instead of gliding. */
	scroll: Array<[frame: number, top: number, jump?: boolean]>;
	/** Where the caret is, from each frame on (null = hidden). */
	caret: Array<[frame: number, at: { row: number; col: number } | null]>;
	keystrokes: Array<{ frame: number; index: number; step: number }>;
	submits: Array<{ frame: number; step: number }>;
	outputs: Array<{ frame: number; end: number; step: number }>;
	done: number;
	/** Longest line, in characters. */
	widest: number;
}

export interface PlanOptions {
	prompt: string;
	cps: number;
	/** Lines a second, or every output line at once. */
	outputRate: number | "instant";
	rows: number;
	fps: number;
	markup: boolean;
	rng: Rng;
}

const COLORS = new Set([
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"gray",
	"dim",
	"accent",
]);

/** `{green}ok{/} done` → spans. `{bold}` sets weight; unknown tags stay literal. */
export function parseMarkup(source: string, markup = true): Span[] {
	if (!markup) return [{ text: source }];
	const spans: Span[] = [];
	const stack: Array<{ color?: string; bold?: boolean }> = [{}];
	let buffer = "";
	const flush = () => {
		if (!buffer) return;
		const top = stack[stack.length - 1] ?? {};
		spans.push({ text: buffer, ...top });
		buffer = "";
	};
	const re = /\{(\/|[a-z]+)\}/g;
	let last = 0;
	for (const m of source.matchAll(re)) {
		const tag = m[1] as string;
		const index = m.index ?? 0;
		buffer += source.slice(last, index);
		last = index + m[0].length;
		if (tag === "/") {
			flush();
			if (stack.length > 1) stack.pop();
		} else if (tag === "bold" || COLORS.has(tag)) {
			flush();
			const top = stack[stack.length - 1] ?? {};
			stack.push(
				tag === "bold" ? { ...top, bold: true } : { ...top, color: tag },
			);
		} else buffer += m[0];
	}
	buffer += source.slice(last);
	flush();
	return spans;
}

export const spansText = (spans: readonly Span[]) =>
	spans.map((s) => s.text).join("");

/** Frames between Enter and the first line of output. */
const SUBMIT_BEAT = 0.3;
/** Frames the scroll takes to glide one or more lines. */
export const SCROLL_GLIDE = 4;
/** A check mark replaces these leading glyphs (fonts often lack them). */
const DONE_MARK = /^\s*[✔✓√]\s*/;

export function planTerminal(
	script: readonly Step[],
	o: PlanOptions,
): TerminalPlan {
	const plan: TerminalPlan = {
		lines: [],
		spinners: [],
		checks: [],
		progress: [],
		scroll: [[0, 0]],
		caret: [[0, null]],
		keystrokes: [],
		submits: [],
		outputs: [],
		done: 0,
		widest: 0,
	};
	let t = 0;
	let row = 0;
	let top = 0;
	let typed = 0;
	const perLine = o.outputRate === "instant" ? 0 : o.fps / o.outputRate;

	const show = (line: Omit<PlannedLine, "until" | "row">): PlannedLine => {
		if (row - top >= o.rows) {
			top = row - o.rows + 1;
			plan.scroll.push([line.appear, top]);
		}
		const planned = { ...line, row, until: Number.POSITIVE_INFINITY };
		plan.lines.push(planned);
		plan.widest = Math.max(
			plan.widest,
			spansText(line.spans).length + (line.indent ?? 0),
		);
		row++;
		return planned;
	};
	const caretAt = (frame: number, at: { row: number; col: number } | null) =>
		plan.caret.push([frame, at]);

	script.forEach((step, s) => {
		if ("cmd" in step) {
			const prompt = step.prompt ?? o.prompt;
			const line = show({
				appear: t,
				spans: [{ text: prompt, color: "accent" }, { text: step.cmd }],
				step: s,
				kind: "cmd",
			});
			const frames = typingFrames(
				step.cmd,
				o.cps,
				o.fps,
				o.rng,
				t + Math.round(o.fps * 0.25),
			);
			line.typing = { prompt: prompt.length, frames };
			caretAt(t, { row: line.row, col: prompt.length });
			frames.forEach((f, i) => {
				plan.keystrokes.push({ frame: f, index: typed++, step: s });
				caretAt(f, { row: line.row, col: prompt.length + i + 1 });
			});
			const submit =
				(frames[frames.length - 1] ?? t) + Math.round(o.fps * SUBMIT_BEAT);
			plan.submits.push({ frame: submit, step: s });
			caretAt(submit, null);
			t = submit + 1;
		} else if ("output" in step) {
			const lines = Array.isArray(step.output)
				? step.output
				: step.output.split("\n");
			const first = Math.round(t);
			let at = t;
			for (const text of lines) {
				show({
					appear: Math.round(at),
					spans: parseMarkup(text, o.markup),
					step: s,
					kind: "output",
				});
				at += perLine;
			}
			plan.outputs.push({
				frame: first,
				end: Math.round(Math.max(t, at - perLine)),
				step: s,
			});
			t = Math.round(at);
		} else if ("spinner" in step) {
			const from = Math.round(t);
			const to = from + step.for;
			const spinning = show({
				appear: from,
				spans: [{ text: step.spinner }],
				indent: 2,
				step: s,
				kind: "spinner",
			});
			spinning.until = to;
			plan.spinners.push({ row: spinning.row, from, to, step: s });
			row--;
			const doneText = (step.done ?? step.spinner).replace(DONE_MARK, "");
			show({
				appear: to,
				spans: parseMarkup(doneText, o.markup),
				indent: 2,
				step: s,
				kind: "done",
			});
			plan.checks.push({ row: spinning.row, at: to, step: s });
			t = to;
		} else if ("progress" in step) {
			const from = Math.round(t);
			const line = show({
				appear: from,
				spans: [{ text: step.progress }],
				step: s,
				kind: "progress",
			});
			plan.progress.push({
				row: line.row,
				from,
				to: from + step.for,
				label: step.progress,
				step: s,
			});
			plan.widest = Math.max(plan.widest, step.progress.length + 32);
			t = from + step.for;
		} else if ("pause" in step) {
			t += step.pause;
		} else {
			const at = Math.round(t);
			for (const line of plan.lines) line.until = Math.min(line.until, at);
			top = row;
			plan.scroll.push([at, top, true]);
		}
	});

	plan.done = Math.round(t);
	// A fresh prompt waits at the end.
	const last = show({
		appear: plan.done,
		spans: [{ text: o.prompt, color: "accent" }],
		step: script.length,
		kind: "prompt",
	});
	caretAt(plan.done, { row: last.row, col: o.prompt.length });

	// Lines stop drawing once scrolled out (after the glide), so only a
	// screenful of nodes is ever live.
	for (const line of plan.lines) {
		const gone = plan.scroll.find(([, top]) => top > line.row);
		if (gone) line.until = Math.min(line.until, gone[0] + SCROLL_GLIDE);
	}
	return plan;
}
