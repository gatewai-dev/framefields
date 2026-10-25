import { describe, expect, it } from "vitest";
import { bind } from "../core/contract.js";
import { fakeHost } from "../test/fake-host.js";
import { chatThread } from "./index.js";

const make = () => bind(fakeHost(), chatThread);
type Node = { id?: string; x?: number; text?: string; children?: Node[] };
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

	it("respects explicit times, sets reactions as text, and needs text or an image", () => {
		const c = make()({
			id: "c",
			messages: [
				{ from: "a", text: "x", at: 50 },
				{ from: "b", text: "y", at: 90 },
			],
		});
		expect(c.cues.messages.map((m) => m.frame)).toEqual([50, 90]);
		expect(
			find(make()({ id: "c", messages }), "c-reaction-2-text"),
		).toMatchObject({ text: "❤️" });
		const word = make()({
			id: "w",
			messages: [{ from: "a", text: "x", reaction: "heart" }],
		});
		expect(find(word, "w-reaction-0-text")).toMatchObject({ text: "❤️" });
		expect(() => make()({ messages: [{ from: "a" }] })).toThrow(
			/needs `text` or `image`/,
		);
	});

	it("shows avatars for others once anyone has a picture, initials otherwise", () => {
		const avatarMessages = [
			{ from: "me", text: "Shipped?" },
			{ from: "sam", text: "Yes." },
			{ from: "sam", text: "All of it." },
			{ from: "me", text: "Nice" },
		];
		const plain = make()({ id: "c", messages: avatarMessages, width: 720 });
		expect(find(plain, "c-avatar-1")).toBeUndefined();

		const c = make()({
			id: "c",
			messages: avatarMessages,
			width: 720,
			participants: { sam: { name: "Sam Ortiz", avatar: "sam.jpg" } },
		});
		// One per run, on its first message's index; none for me.
		expect(find(c, "c-avatar-1-image")).toBeDefined();
		expect(find(c, "c-avatar-2")).toBeUndefined();
		expect(find(c, "c-avatar-0")).toBeUndefined();
		// Sam's bubbles move over to make room.
		expect(find(c, "c-bubble-1")?.x).toBeGreaterThan(
			find(plain, "c-bubble-1")?.x ?? 0,
		);

		const all = make()({
			id: "c",
			messages: avatarMessages,
			width: 720,
			avatars: "everyone",
			participants: { sam: { name: "Sam Ortiz" } },
		});
		expect(find(all, "c-avatar-0-initials")?.text).toBe("M");
		expect(find(all, "c-avatar-1-initials")?.text).toBe("SO");
	});
});
