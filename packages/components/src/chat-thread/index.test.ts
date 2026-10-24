import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { chatThread } from "./index.js";

const make = () => bind(fakeHost(), chatThread);
type Node = { id?: string; x?: number; children?: Node[] };
const find = (n: unknown, id: string): Node | undefined => {
	const node = n as Node;
	if (node.id === id) return node;
	for (const c of node.children ?? []) {
		const hit = find(c, id);
		if (hit) return hit;
	}
	return undefined;
};
const messages = [
	{ from: "me", text: "Shipped?" },
	{ from: "sam", text: "Yes, all of it." },
	{ from: "me", text: "Nice", reaction: "❤️" },
];

describe("ChatThread", () => {
	it("lands the other side's replies after their typing dots", () => {
		const c = make()({ messages });
		expect(c.cues.typing).toHaveLength(1);
		expect(c.cues.messages[1]?.frame).toBe(c.cues.typing[0]?.end);
		for (let i = 1; i < c.cues.messages.length; i++)
			expect(c.cues.messages[i]?.frame).toBeGreaterThan(
				c.cues.messages[i - 1]?.frame ?? 0,
			);
	});

	it("puts me on the right, others on the left", () => {
		const c = make()({ id: "c", messages, width: 720 });
		expect(find(c, "c-bubble-0")?.x).toBeGreaterThan(360);
		expect(find(c, "c-bubble-1")?.x).toBeLessThan(100);
	});

	it("respects explicit times, draws hearts, and needs text or an image", () => {
		const c = make()({
			id: "c",
			messages: [
				{ from: "a", text: "x", at: 50 },
				{ from: "b", text: "y", at: 90 },
			],
		});
		expect(c.cues.messages.map((m) => m.frame)).toEqual([50, 90]);
		expect(
			find(make()({ id: "c", messages }), "c-reaction-2-heart"),
		).toBeDefined();
		expect(() => make()({ messages: [{ from: "a" }] })).toThrow(
			/needs `text` or `image`/,
		);
	});
});
