/**
 * "After Effects, Photoshop, Premiere, Cinema 4D, Blender, Illustrator, all
 * of it in one import." Each tool is named by the voice and lands as an app
 * tile (a monogram in its colours, not its logo), captioned with what
 * gitframes takes from it. On "all of it" the tiles fall into one line of
 * code; "lightweight, typed and fast" answers, and "the weight" drops off
 * the bottom of the frame.
 */
import { Layer, LayerAnimation } from "gitframes";
import { bar } from "../grid.js";
import { lineWords, type SungWord, sung } from "../lyrics.js";
import {
	ACCENT,
	BG,
	EASE_IN,
	EASE_OUT,
	FG,
	flashes,
	H,
	HAIRLINE,
	label,
	MONO,
	MUTED,
	plane,
	SNAP,
	scene,
	sungLine,
	W,
} from "../theme.js";
import { CH } from "../timeline.js";

const CX = W / 2;
const CY = H / 2;
const TILE = 260;

interface Tool {
	word: SungWord;
	mono: string;
	ink: string;
	paper: string;
	/** What gitframes does that this tool is bought for. */
	brings: string;
}

function tools(): Tool[] {
	return [
		{
			word: sung("after"),
			mono: "Ae",
			ink: "#9999FF",
			paper: "#00005B",
			brings: "keyframes · text animators",
		},
		{
			word: sung("photoshop"),
			mono: "Ps",
			ink: "#31A8FF",
			paper: "#001E36",
			brings: "blend modes · masks · grading",
		},
		{
			word: sung("premiere"),
			mono: "Pr",
			ink: "#EA77FF",
			paper: "#2A0040",
			brings: "timeline · audio · cuts",
		},
		{
			word: sung("cinema"),
			mono: "C4D",
			ink: "#FFFFFF",
			paper: "#011A6A",
			brings: "3D · cameras · lights",
		},
		{
			word: sung("blender"),
			mono: "Bl",
			ink: "#F5792A",
			paper: "#14213D",
			brings: "glTF · rigs · skinning",
		},
		{
			word: sung("illustrator"),
			mono: "Ai",
			ink: "#FF9A00",
			paper: "#330000",
			brings: "paths · shapes · strokes",
		},
	];
}

const slot = (i: number) => ({
	x: CX + ((i % 3) - 1) * 600,
	y: CY - 220 + Math.floor(i / 3) * 400,
});

function tile(
	t: Tool,
	i: number,
	from: number,
	gather: number,
	importAt: number,
) {
	const at = t.word.at - from;
	const { x, y } = slot(i);
	return [
		Layer.box({
			id: `tools-tile-${i}`,
			position: "absolute",
			x: x - TILE / 2,
			y: y - TILE / 2,
			width: TILE,
			height: TILE,
			borderRadius: 46,
			background: t.paper,
			borderColor: t.ink,
			borderWidth: 6,
			startFrame: at,
			children: [
				Layer.text(t.mono, {
					id: `tools-mono-${i}`,
					position: "absolute",
					x: 0,
					y: 0,
					width: TILE,
					height: TILE,
					fontFamily: "Unbounded",
					fontSize: t.mono.length > 2 ? 64 : 92,
					fontWeight: 700,
					fill: t.ink,
					align: "center",
					verticalAlign: "middle",
				}),
			],
		} as never).animate(
			// Frames are the tile's own: it starts on its word.
			LayerAnimation.create()
				.fromTo("scale", 1.7, 1, { start: 0, end: 10, ease: EASE_OUT })
				.fromTo("rotation", -12, 0, { start: 0, end: 12, ease: SNAP })
				.fromTo("opacity", 0, 1, { start: 0, end: 2, ease: "none" })
				// "all of it in one import": every tile falls into the line of code.
				.fromTo("x", x - TILE / 2, CX - TILE / 2, {
					start: gather - at + i * 2,
					end: importAt - at,
					ease: EASE_IN,
				})
				.fromTo("y", y - TILE / 2, CY - TILE / 2, {
					start: gather - at + i * 2,
					end: importAt - at,
					ease: EASE_IN,
				})
				.fromTo("scale", 1, 0.2, {
					start: gather - at + i * 2,
					end: importAt - at,
					ease: EASE_IN,
				})
				.fadeOut(importAt - at - 2, importAt - at, "none"),
		),
		label({
			id: `tools-brings-${i}`,
			text: t.brings,
			x: x - 300,
			width: 600,
			y: y + TILE / 2 + 26,
			size: 24,
			color: FG,
			inAt: at + 6,
			outAt: gather,
		}),
	];
}

export function toolsScene() {
	const from = bar(CH.tools);
	const to = bar(CH.type);
	const list = tools();
	const all = sung("all", from);
	const importWord = sung("import", from);
	const gather = all.at - from;
	const importAt = importWord.at - from;
	const light = sung("lightweight", from);
	const power = sung("power", from);
	const weight = sung("weight", from);
	const lightLine = lineWords(light.line);
	const powerLine = lineWords(power.line);
	const noneAt = sung("none", from).at - from;
	const weightAt = weight.at - from;

	return scene(
		"tools",
		from,
		to,
		[
			...list.flatMap((t, i) => tile(t, i, from, gather, importAt)),
			// "…in one import": the tiles land in a line of code.
			sungLine({
				id: "tools-all",
				words: lineWords(all.line),
				from,
				y: H - 200,
				size: 64,
				weight: 300,
				outAt: light.at - from - 6,
			}),
			Layer.box({
				id: "tools-import",
				position: "absolute",
				x: CX - 520,
				y: CY - 60,
				width: 1040,
				height: 120,
				borderRadius: 60,
				background: FG,
				startFrame: importAt,
				durationFrames: light.at - from - importAt,
				children: [
					Layer.text('import { everything } from "gitframes";', {
						id: "tools-import-code",
						position: "absolute",
						x: 0,
						y: 0,
						width: 1040,
						height: 120,
						fontFamily: MONO,
						fontSize: 38,
						fontWeight: 600,
						fill: BG,
						align: "center",
						verticalAlign: "middle",
					}),
				],
			} as never).animate(
				LayerAnimation.create()
					.fromTo("scaleX", 0.2, 1, {
						start: 0,
						end: 10,
						ease: EASE_OUT,
					})
					.fromTo("scale", 1.15, 1, {
						start: 0,
						end: 12,
						ease: SNAP,
					}),
			),
			plane("tools-hit", ACCENT).animate(
				flashes([{ at: importAt, peak: 0.35 }], 10),
			),
			// "lightweight, typed and fast": three answers, the last in the accent.
			sungLine({
				id: "tools-light",
				words: lightLine,
				from,
				y: CY - 200,
				size: 120,
				colors: lightLine.map((w) =>
					w.text.startsWith("fast") ? ACCENT : undefined,
				),
				outAt: power.at - from - 10,
			}),
			label({
				id: "tools-light-sub",
				text: "one npm package  ·  TypeScript end to end  ·  native WebGPU",
				y: CY - 20,
				size: 22,
				color: MUTED,
				inAt: sung("typed", from).at - from,
				outAt: power.at - from - 10,
			}),
			// "all the power, none of the weight": the weight falls off the frame.
			sungLine({
				id: "tools-power",
				words: powerLine.filter((w) => w.at < sung("none", from).at),
				from,
				y: CY - 160,
				size: 130,
			}),
			sungLine({
				id: "tools-none",
				words: powerLine.filter(
					(w) => w.at >= sung("none", from).at && w !== weight,
				),
				from,
				y: CY + 20,
				size: 90,
				weight: 300,
				color: MUTED,
			}),
			Layer.text("WEIGHT.", {
				id: "tools-weight",
				position: "absolute",
				x: 0,
				y: CY + 140,
				width: W,
				fontFamily: "Unbounded",
				fontSize: 150,
				fontWeight: 900,
				fill: ACCENT,
				align: "center",
				anchorX: 0.5,
				anchorY: 0.5,
				startFrame: weightAt,
			}).animate(
				LayerAnimation.create()
					.fromTo("scale", 1.4, 1, {
						start: 0,
						end: 6,
						ease: EASE_OUT,
					})
					.fromTo("y", CY + 140, H + 260, {
						start: 8,
						end: to - from - weightAt,
						ease: EASE_IN,
					})
					.fromTo("rotation", 0, 14, {
						start: 8,
						end: to - from - weightAt,
						ease: EASE_IN,
					}),
			),
			Layer.box({
				id: "tools-floor-line",
				position: "absolute",
				x: 160,
				y: H - 120,
				width: W - 320,
				height: 2,
				background: HAIRLINE,
				startFrame: noneAt,
			}),
		],
		{ background: BG },
	);
}
