/**
 * Component gallery: renders each component's settled frame under every
 * built-in theme into `renders/gallery/<theme>/<name>.png`, plus an
 * `index.html` contact sheet that lays them side by side. Use it to review
 * how components look together, and how a change looks across themes.
 *
 *   pnpm --filter framefields gallery [Name …]   (e.g. `gallery ChatThread`)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { themes } from "../src/components/index.js";
import * as C from "../src/components/testing.js";
import { FontManager } from "../src/fonts/index.js";
import { Composition } from "../src/index.js";

type ThemeName = keyof typeof themes;

interface Shot {
	name: string;
	/** Frame to render: something settled, mid-story. */
	frame: number;
	build(theme: (typeof themes)[ThemeName]): Parameters<Composition["add"]>[0];
}

const W = 1280;
const H = 720;
const canvas = { width: W, height: H };
const code = `import { Composition } from "framefields";

export function intro(fps = 30) {
  const comp = new Composition({ fps });
  return comp.add(title("Ship it faster"));
}`;

const SHOTS: Shot[] = [
	{
		name: "LowerThird",
		frame: 40,
		build: (theme) =>
			["bar", "stacked", "tag", "line"].map((layout, i) =>
				C.LowerThird({
					theme,
					canvas: { width: W / 2, height: H / 2 },
					x: (i % 2) * (W / 2),
					y: Math.floor(i / 2) * (H / 2),
					name: "Ada Lovelace",
					role: "Engineer, Analytical Engine",
					layout: layout as "bar",
					stay: true,
				}),
			),
	},
	{
		name: "Toasts",
		frame: 90,
		build: (theme) =>
			C.Toasts({
				theme,
				canvas,
				items: [
					{
						at: 0,
						title: "Deployed to production",
						body: "v2.6.0 is live",
						kind: "success",
					},
					{ at: 20, title: "3 new comments", body: "On “Launch film”" },
					{ at: 40, title: "Render queue is busy", kind: "warning" },
				],
			}),
	},
	{
		name: "CardStack",
		frame: 20,
		build: (theme) =>
			C.CardStack({
				theme,
				x: (W - 960) / 2,
				y: 40,
				cards: [
					{ title: "Fast", body: "Renders on the GPU, frame-exact." },
					{ title: "Typed", body: "Props checked as you write them." },
					{ title: "Yours", body: "Components install as source." },
				],
			}),
	},
	{
		name: "Callout",
		frame: 60,
		build: (theme) => [
			C.Callout({
				theme,
				canvas,
				target: [520, 420],
				title: "New",
				text: "Faster renderer",
			}),
			C.Callout({
				theme,
				canvas,
				target: [900, 220],
				text: "Typed props",
				side: "left",
			}),
		],
	},
	{
		name: "ChatThread",
		frame: 220,
		build: (theme) =>
			C.ChatThread({
				theme,
				x: (W - 640) / 2,
				y: 20,
				width: 640,
				height: 680,
				me: "me",
				participants: { me: { name: "Me" }, sam: { name: "Sam" } },
				messages: [
					{ from: "me", text: "Is the launch film rendered?" },
					{
						from: "sam",
						text: "Rendering now, the new cards look great",
						reaction: "❤️",
					},
					{ from: "me", text: "Ship it 🚀" },
				],
			}),
	},
	{
		name: "CodeBlock",
		frame: 10,
		build: (theme) =>
			C.CodeBlock({ theme, x: 120, y: 120, code, lang: "ts", frame: true }),
	},
	{
		name: "TitleCard",
		frame: 60,
		build: (theme) =>
			C.TitleCard({
				theme,
				canvas,
				kicker: "Chapter one",
				title: "Ship it faster",
				subtitle: "What changed in 2.6",
			}),
	},
	{
		name: "Meter",
		frame: 60,
		build: (theme) => [
			C.Meter({
				theme,
				value: 72,
				kind: "ring",
				label: "Coverage",
				x: 200,
				y: 160,
				size: 320,
			}),
			C.Meter({ theme, value: 3.5, kind: "stars", x: 640, y: 300, size: 440 }),
		],
	},
];

async function main() {
	const only = new Set(process.argv.slice(2));
	await FontManager.register("assets/fonts/Inter.ttf");
	await FontManager.register("assets/fonts/JetBrainsMono.ttf");
	// Emoji (chat reactions, captions) draw from a color emoji font.
	await FontManager.registerEmojiFont(
		"../renderer/src/assets/NotoColorEmoji.ttf",
	);
	const out = resolve("../../renders/gallery");
	const names = Object.keys(themes) as ThemeName[];
	const shots = SHOTS.filter((s) => only.size === 0 || only.has(s.name));
	for (const themeName of names) {
		const theme = themes[themeName];
		mkdirSync(join(out, themeName), { recursive: true });
		for (const shot of shots) {
			const comp = new Composition({
				width: W,
				height: H,
				fps: 30,
				durationMs: 12_000,
				backgroundColor: theme.color.bg,
			});
			comp.add(shot.build(theme));
			const png = await comp.renderFrame({ frame: shot.frame });
			writeFileSync(join(out, themeName, `${shot.name}.png`), png);
			console.log(`${themeName}/${shot.name}.png`);
		}
	}
	writeFileSync(join(out, "index.html"), sheet(names, shots));
	console.log(`gallery: ${join(out, "index.html")}`);
}

function sheet(names: ThemeName[], shots: Shot[]): string {
	const rows = shots
		.map(
			(s) =>
				`<h2>${s.name}</h2><div class="row">${names
					.map(
						(t) =>
							`<figure><img src="${t}/${s.name}.png"><figcaption>${t}</figcaption></figure>`,
					)
					.join("")}</div>`,
		)
		.join("\n");
	return `<!doctype html><meta charset="utf-8"><title>Component gallery</title>
<style>body{font:14px system-ui;margin:24px;background:#888}h2{margin:24px 0 8px}
.row{display:grid;grid-template-columns:repeat(${names.length},1fr);gap:12px}
img{width:100%;display:block;border-radius:6px}figure{margin:0}figcaption{opacity:.7;margin-top:4px}</style>
${rows}`;
}

await main();
// The GPU device keeps the event loop alive once rendering is done.
process.exit(0);
