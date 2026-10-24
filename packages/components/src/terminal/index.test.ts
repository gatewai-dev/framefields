import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { terminal } from "./index.js";

const make = () => bind(fakeHost(), terminal);
type Node = { id?: string; children?: Node[]; x?: number };
const find = (n: unknown, id: string): Node | undefined => {
	const node = n as Node;
	if (node.id === id) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};

describe("Terminal", () => {
	it("cues keystrokes, submits and the end in the parent's timeline", () => {
		const t = make()({
			id: "t",
			at: 20,
			script: [{ cmd: "ls" }, { output: "a" }],
		});
		expect(t.cues.keystrokes).toHaveLength(2);
		expect(t.cues.keystrokes[0]?.frame).toBeGreaterThan(20);
		expect(t.cues.done[0]?.frame).toBeGreaterThan(
			t.cues.submits[0]?.frame ?? 0,
		);
		expect(t.span.end).toBe(Number.POSITIVE_INFINITY);
	});

	it("wraps in a terminal window by default, bare on request", () => {
		expect(
			find(make()({ id: "t", script: [{ cmd: "ls" }] }), "t-window"),
		).toBeDefined();
		expect(
			find(
				make()({ id: "t", script: [{ cmd: "ls" }], frame: false }),
				"t-window",
			),
		).toBeUndefined();
	});

	it("draws spinners, checks and progress (with a counter) as their own parts", () => {
		const t = make()({
			id: "t",
			script: [
				{ spinner: "Installing", for: 20 },
				{ progress: "Encoding", for: 30 },
			],
		});
		expect(find(t, "t-spinner-0")).toBeDefined();
		expect(find(t, "t-check-0")).toBeDefined();
		expect(find(t, "t-progress-0-percent")).toBeDefined();
		// The label sits two columns in, clear of the spinner.
		expect(find(t, "t-line-0")?.x).toBeGreaterThan(0);
	});

	it("rejects unknown steps", () => {
		expect(() => make()({ script: [{ run: "ls" } as never] })).toThrow(
			/invalid props/,
		);
	});
});
