import { describe, expect, it } from "vitest";
import { rng } from "../core/rng.js";
import { parseMarkup, planTerminal, type Step } from "./plan.js";

const opts = {
	prompt: "$ ",
	cps: 18,
	outputRate: 40 as const,
	rows: 4,
	fps: 30,
	markup: true,
	rng: rng(1),
};
const plan = (script: Step[], o = {}) =>
	planTerminal(script, { ...opts, rng: rng(1), ...o });

describe("terminal markup", () => {
	it("maps colour tags to spans and leaves unknown tags alone", () => {
		expect(parseMarkup("{green}ok{/} done {nope}")).toEqual([
			{ text: "ok", color: "green" },
			{ text: " done {nope}" },
		]);
		expect(parseMarkup("{bold}{red}x{/}{/}")).toEqual([
			{ text: "x", bold: true, color: "red" },
		]);
		expect(parseMarkup("{red}x", false)).toEqual([{ text: "{red}x" }]);
	});
});

describe("terminal plan", () => {
	it("types each command, then submits, then streams output", () => {
		const p = plan([{ cmd: "ls" }, { output: ["a", "b"] }]);
		expect(p.keystrokes).toHaveLength(2);
		const submit = p.submits[0]?.frame ?? 0;
		expect(submit).toBeGreaterThan(p.keystrokes[1]?.frame ?? 0);
		expect(p.outputs[0]?.frame).toBeGreaterThan(submit);
		expect(p.outputs[0]?.end).toBeGreaterThan(p.outputs[0]?.frame ?? 0);
	});

	it("is deterministic per seed", () => {
		const a = plan([{ cmd: "pnpm install" }]).keystrokes;
		expect(plan([{ cmd: "pnpm install" }]).keystrokes).toEqual(a);
		expect(
			planTerminal([{ cmd: "pnpm install" }], { ...opts, rng: rng(2) })
				.keystrokes,
		).not.toEqual(a);
	});

	it("scrolls by whole lines once the screen is full, and retires scrolled lines", () => {
		const p = plan([
			{ output: Array.from({ length: 10 }, (_, i) => `line ${i}`) },
		]);
		const tops = p.scroll.map(([, top]) => top);
		expect(tops.every((t) => Number.isInteger(t))).toBe(true);
		expect(tops[tops.length - 1]).toBe(p.lines.length - opts.rows);
		// Never more than a screenful plus the lines gliding out (spec budget: rows + 6).
		for (let f = 0; f <= p.done + 10; f++) {
			const live = p.lines.filter((l) => l.appear <= f && f < l.until).length;
			expect(live).toBeLessThanOrEqual(opts.rows + 6);
		}
	});

	it("resolves spinners to a check mark on the same row", () => {
		const p = plan([{ spinner: "Installing", for: 30, done: "✔ installed" }]);
		const [spin] = p.spinners;
		const done = p.lines.find((l) => l.kind === "done");
		expect(done?.row).toBe(spin?.row);
		expect(done?.appear).toBe(spin?.to);
		expect(done?.spans.map((s) => s.text).join("")).toBe("installed");
		expect(p.checks[0]?.at).toBe(spin?.to);
	});

	it("clears the screen at once", () => {
		const p = plan([{ output: "a" }, { clear: true }, { output: "b" }]);
		const a = p.lines.find((l) => l.spans[0]?.text === "a");
		const jump = p.scroll.find(([, , j]) => j);
		expect(a?.until).toBe(jump?.[0]);
	});
});
