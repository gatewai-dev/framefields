import { describe, expect, it } from "vitest";
import { cases } from "./test/cases.js";

/**
 * The renderer keys layout and motion by node id: two nodes with one id
 * share geometry and keyframes. No component may emit a duplicate.
 */
function ids(node: unknown, out: string[] = []): string[] {
	const n = node as {
		id?: string;
		children?: unknown[];
		matte?: { node: unknown };
	};
	if (n.id) out.push(n.id);
	for (const c of n.children ?? []) ids(c, out);
	if (n.matte) ids(n.matte.node, out);
	return out;
}
describe("node ids", () => {
	for (const [name, build] of cases)
		it(`${name} emits unique ids`, () => {
			const list = ids(build());
			const dupes = list.filter((id, i) => list.indexOf(id) !== i);
			expect(dupes).toEqual([]);
		});
});
