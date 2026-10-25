/**
 * One build of every component (and its main variants) on the fake host,
 * shared by the cross-component tests: unique ids, meta in sync.
 */
import { annotate } from "../annotate/index.js";
import { appFrame } from "../app-frame/index.js";
import { backdrop } from "../backdrop/index.js";
import { beforeAfter } from "../before-after/index.js";
import { callout } from "../callout/index.js";
import { captions } from "../captions/index.js";
import { cardStack } from "../card-stack/index.js";
import { chatThread } from "../chat-thread/index.js";
import { codeBlock } from "../code-block/index.js";
import { confetti } from "../confetti/index.js";
import { bind } from "../core/contract.js";
import { counter } from "../counter/index.js";
import { deviceFrame } from "../device-frame/index.js";
import { focusZoom } from "../focus-zoom/index.js";
import { logoReveal } from "../logo-reveal/index.js";
import { lowerThird } from "../lower-third/index.js";
import { meter } from "../meter/index.js";
import { mousePointer } from "../mouse-pointer/index.js";
import { selection } from "../selection/index.js";
import { spotlight } from "../spotlight/index.js";
import { terminal } from "../terminal/index.js";
import { textReveal } from "../text-reveal/index.js";
import { titleCard } from "../title-card/index.js";
import { toasts } from "../toasts/index.js";
import { touchPoint } from "../touch-point/index.js";
import { waveform } from "../waveform/index.js";
import { wordCycle } from "../word-cycle/index.js";
import { fakeHost } from "./fake-host.js";

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

/** Every component, built with its options switched on. Name: `<Component>[ variant]`. */
export const cases: Array<[string, () => unknown]> = [
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
	[
		"ChatThread",
		() =>
			bind(
				fakeHost(),
				chatThread,
			)({
				messages: [
					{ from: "me", text: "a", reaction: "❤️" },
					{ from: "b", text: "c", time: "1:00" },
					{ from: "c", image: "x.png" },
				],
			}),
	],
	[
		"Toasts",
		() =>
			bind(
				fakeHost(),
				toasts,
			)({
				items: [
					{ at: 0, title: "a", body: "b", kind: "success" },
					{ at: 10, title: "c", kind: "error" },
				],
			}),
	],
	[
		"Callout",
		() =>
			bind(fakeHost(), callout)({ target: [100, 100], title: "t", text: "x" }),
	],
	[
		"Spotlight",
		() =>
			bind(
				fakeHost(),
				spotlight,
			)({
				targets: [
					{ at: 0, target: [10, 10] },
					{ at: 20, target: "full" },
				],
				shape: "ellipse",
			}),
	],
	[
		"Confetti",
		() =>
			bind(
				fakeHost(),
				confetti,
			)({
				bursts: [
					{ at: 0, origin: [10, 10] },
					{ at: 5, origin: [90, 10] },
				],
			}),
	],
	...(["slide", "pop", "draw", "rise"] as const).map(
		(style) =>
			[
				`LogoReveal ${style}`,
				() =>
					bind(
						fakeHost(),
						logoReveal,
					)({
						mark: { d: "M0 0L1 1Z", viewBox: [1, 1] },
						name: "ab",
						tagline: "t",
						style,
					}),
			] as [string, () => unknown],
	),
	...(["mesh", "grid", "dots", "solid"] as const).map(
		(kind) =>
			[`Backdrop ${kind}`, () => bind(fakeHost(), backdrop)({ kind })] as [
				string,
				() => unknown,
			],
	),
	...(["bars", "mirror", "dots", "radial"] as const).map(
		(kind) =>
			[
				`Waveform ${kind}`,
				() =>
					bind(
						fakeHost(),
						waveform,
					)({
						audio: {
							fps: 30,
							frames: 2,
							bands: [
								[0, 1],
								[1, 0],
							],
							level: [0, 1],
							beats: [],
						},
						kind,
						bars: 4,
					}),
			] as [string, () => unknown],
	),
	...(["roll", "fade", "slide", "type"] as const).map(
		(transition) =>
			[
				`WordCycle ${transition}`,
				() =>
					bind(
						fakeHost(),
						wordCycle,
					)({
						text: "a {} b",
						words: ["x", "yy", "zzz"],
						transition,
						slot: "pill",
					}),
			] as [string, () => unknown],
	),
	...(["phone", "tablet", "laptop"] as const).map(
		(device) =>
			[
				`DeviceFrame ${device}`,
				() =>
					bind(fakeHost(), deviceFrame)({ device, content: "a.mp4", tilt: {} }),
			] as [string, () => unknown],
	),
	[
		"TouchPoint",
		() =>
			bind(
				fakeHost(),
				touchPoint,
			)({
				touches: [
					{ to: [10, 10], tap: 2 },
					{ to: [20, 20], press: 20 },
					{ to: [30, 30], swipe: [30, 300] },
				],
			}),
	],
	[
		"BeforeAfter",
		() => bind(fakeHost(), beforeAfter)({ before: "a.mp4", after: "b.mp4" }),
	],
	[
		"Selection text",
		() =>
			bind(
				fakeHost(),
				selection,
			)({ target: { text }, drag: { frame: 0, end: 10 } }),
	],
	[
		"Selection marquee",
		() =>
			bind(
				fakeHost(),
				selection,
			)({
				kind: "marquee",
				drag: { frame: 0, end: 10 },
				items: [[5, 5], { x: 0, y: 0, width: 9, height: 9 }],
			}),
	],
	...(["cycle", "deal"] as const).map(
		(mode) =>
			[
				`CardStack ${mode}`,
				() =>
					bind(
						fakeHost(),
						cardStack,
					)({
						cards: [
							{ title: "a", body: "b", image: "i.png" },
							{ title: "c" },
							{ title: "d" },
						],
						mode,
					}),
			] as [string, () => unknown],
	),
];
