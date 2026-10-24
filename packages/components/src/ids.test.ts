import { describe, expect, it } from "vitest";
import { annotate } from "./annotate/index.js";
import { appFrame } from "./app-frame/index.js";
import { captions } from "./captions/index.js";
import { codeBlock } from "./code-block/index.js";
import { bind } from "./core/contract.js";
import { counter } from "./counter/index.js";
import { focusZoom } from "./focus-zoom/index.js";
import { lowerThird } from "./lower-third/index.js";
import { meter } from "./meter/index.js";
import { mousePointer } from "./mouse-pointer/index.js";
import { terminal } from "./terminal/index.js";
import { fakeHost } from "./test/fake-host.js";
import { textReveal } from "./text-reveal/index.js";
import { titleCard } from "./title-card/index.js";

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
const words = "one two three four"
	.split(" ")
	.map((text, i) => ({ text, start: i * 0.4, end: i * 0.4 + 0.3 }));
const text = {
	kind: "text",
	id: "t",
	text: "mark these words",
	x: 0,
	y: 0,
	width: 200,
	fontSize: 20,
	fontFamily: "Inter",
};

const cases: Array<[string, () => unknown]> = [
	[
		"MousePointer",
		() =>
			bind(
				fakeHost(),
				mousePointer,
			)({
				path: [{ to: [10, 10] }, { to: [200, 100], click: 2 }],
				trail: {},
				label: "Hi",
			}),
	],
	[
		"AppFrame",
		() =>
			bind(
				fakeHost(),
				appFrame,
			)({
				kind: "browser",
				url: { text: "a.dev", typeAt: 4 },
				tabs: ["a", "b"],
			}),
	],
	[
		"FocusZoom",
		() =>
			bind(
				fakeHost(),
				focusZoom,
			)({ content: [], shots: [{ at: 0, target: [100, 100] }] }),
	],
	...(
		[
			"rise",
			"slam",
			"scramble",
			"mask",
			"wipe",
			"type",
			"stream",
			"scatter",
		] as const
	).map(
		(style) =>
			[
				`TextReveal ${style}`,
				() =>
					bind(
						fakeHost(),
						textReveal,
					)({
						text: "aa bb cc",
						style,
						exitStyle: style === "mask" ? "mask" : "rise",
						width: 60,
					}),
			] as [string, () => unknown],
	),
	[
		"Counter",
		() =>
			bind(
				fakeHost(),
				counter,
			)({ to: 12345.5, format: "$,.2f", values: undefined }),
	],
	[
		"Annotate",
		() =>
			bind(
				fakeHost(),
				annotate,
			)({
				target: { text, match: "these words" },
				mark: "highlight",
				label: "x",
			}),
	],
	[
		"Annotate arrow",
		() =>
			bind(
				fakeHost(),
				annotate,
			)({ target: [100, 100], mark: "arrow", from: [10, 10] }),
	],
	...(["karaoke", "highlight", "pill", "gradient", "bold"] as const).map(
		(style) =>
			[
				`Captions ${style}`,
				() =>
					bind(
						fakeHost(),
						captions,
					)({ words, style, behind: { video: "v.mp4" } }),
			] as [string, () => unknown],
	),
	[
		"Terminal",
		() =>
			bind(
				fakeHost(),
				terminal,
			)({
				script: [
					{ cmd: "ls" },
					{ spinner: "a", for: 10 },
					{ progress: "p", for: 10 },
					{ output: ["x", "y"] },
					{ clear: true },
				],
			}),
	],
	[
		"CodeBlock",
		() =>
			bind(
				fakeHost(),
				codeBlock,
			)({
				code: "a\nb\nc",
				typing: true,
				focus: [{ at: 5, lines: [1] }],
				diff: { to: "a\n  c\nd", at: 40 },
				frame: true,
			}),
	],
	...(["center", "left", "stack", "split"] as const).map(
		(layout) =>
			[
				`TitleCard ${layout}`,
				() =>
					bind(
						fakeHost(),
						titleCard,
					)({
						kicker: "k",
						title: "Title",
						subtitle: "s",
						layout,
						exitStyle: "rise",
					}),
			] as [string, () => unknown],
	),
	...(["bar", "stacked", "tag", "line"] as const).map(
		(layout) =>
			[
				`LowerThird ${layout}`,
				() =>
					bind(
						fakeHost(),
						lowerThird,
					)({ name: "Ada", role: "Engineer", layout }),
			] as [string, () => unknown],
	),
	...(["ring", "arc", "bar", "segments", "stars"] as const).map(
		(kind) =>
			[
				`Meter ${kind}`,
				() =>
					bind(
						fakeHost(),
						meter,
					)({ value: kind === "stars" ? 3.5 : 60, kind, label: "L" }),
			] as [string, () => unknown],
	),
];

describe("node ids", () => {
	for (const [name, build] of cases)
		it(`${name} emits unique ids`, () => {
			const list = ids(build());
			const dupes = list.filter((id, i) => list.indexOf(id) !== i);
			expect(dupes).toEqual([]);
		});
});
