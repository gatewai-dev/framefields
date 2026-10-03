/**
 * 15.0–19.8 s — The film so far was code. A TypeScript file types itself on
 * the left; the preview on the right hot-reloads line by line (raw clip →
 * halftone → ember gradient map), a render bar runs, and the preview blows up
 * to full frame on the drop.
 */
import { GradientMap, HalftoneScreen, Layer, LayerAnimation, Signal } from "gitframes";
import {
	EMBER,
	FPS,
	GRAPHITE,
	H,
	INK,
	MONO,
	PAPER,
	SAND,
	STONE,
	W,
	asset,
	chapter,
	headline,
	keys,
	label,
	scene,
} from "../theme.js";

export const CODE_FROM = 450;
export const CODE_TO = 594;

const SOURCE = [
	"const film = new Composition({ fps: 30 });",
	"",
	"film.add(",
	'  Layer.video("dancer.mp4")',
	"    .apply(new HalftoneScreen({ frequency: 56 }))",
	"    .apply(new GradientMap({ stops: [ember, paper] })),",
	");",
	"",
	'await film.renderVideo("gitframes.mp4");',
];

const FONT_SIZE = 24;
const ADVANCE = FONT_SIZE * 0.6; // JetBrains Mono is 600/1000 em wide
const LINE_H = 44;
const CARD = { x: 96, y: 296, w: 900, h: 560 };
const CODE_X = CARD.x + 40;
const CODE_Y = CARD.y + 48;
const PREVIEW = { x: 1040, y: 296, w: 784, h: 441 };

const CHARS_PER_FRAME = 3.2;
const TYPE_FROM = 6;
const LINE_PAUSE = 2;

const COLORS = {
	keyword: SAND,
	type: PAPER,
	literal: EMBER,
	member: "#E2CFB4",
	plain: "#A39B90",
};

const TOKEN = /\s+|"[^"]*"|\d+|[A-Za-z_]\w*|./g;
const KEYWORDS = new Set(["const", "new", "await"]);

type Token = { text: string; col: number; kind: keyof typeof COLORS };

function tokenize(line: string): Token[] {
	const out: Token[] = [];
	for (const m of line.matchAll(TOKEN)) {
		const text = m[0];
		const col = m.index ?? 0;
		if (/^\s+$/.test(text)) continue;
		const prev = line[col - 1];
		const kind: Token["kind"] = KEYWORDS.has(text)
			? "keyword"
			: /^"|^\d/.test(text)
				? "literal"
				: /^[A-Z]/.test(text)
					? "type"
					: prev === "." && /^\w/.test(text)
						? "member"
						: "plain";
		out.push({ text, col, kind });
	}
	return out;
}

/** Lay the file out on a typing clock; returns token layers, the cursor, and when each line finished. */
function typeSetCode() {
	const layers: unknown[] = [];
	const lineDone: number[] = [];
	const cursorX: [number, number, string?][] = [];
	const cursorY: [number, number, string?][] = [];
	let clock = TYPE_FROM;

	SOURCE.forEach((line, row) => {
		const y = CODE_Y + row * LINE_H;
		const tokens = tokenize(line);
		if (tokens.length === 0) {
			lineDone[row] = clock;
			return;
		}
		const lineStart = clock;
		const firstCol = tokens[0].col;
		cursorY.push([lineStart, y + 6, "hold"]);
		cursorX.push([lineStart, CODE_X + firstCol * ADVANCE, "hold"]);
		for (const tok of tokens) {
			const start = lineStart + (tok.col - firstCol) / CHARS_PER_FRAME;
			const end = start + tok.text.length / CHARS_PER_FRAME;
			layers.push(
				Layer.text(tok.text, {
					id: `code-${row}-${tok.col}`,
					position: "absolute",
					x: CODE_X + tok.col * ADVANCE,
					y,
					fontFamily: MONO,
					fontSize: FONT_SIZE,
					fill: COLORS[tok.kind],
				}).animate(LayerAnimation.create().typewriter(Math.round(start), Math.max(Math.round(start) + 1, Math.round(end)), "linear")),
			);
		}
		const last = tokens[tokens.length - 1];
		const end = lineStart + (last.col + last.text.length - firstCol) / CHARS_PER_FRAME;
		cursorX.push([Math.round(end), CODE_X + (last.col + last.text.length) * ADVANCE, "linear"]);
		lineDone[row] = Math.round(end);
		clock = Math.round(end) + LINE_PAUSE;
	});

	const cursor = Layer.shape("rect", {
		id: "code-cursor",
		position: "absolute",
		x: CODE_X,
		y: CODE_Y + 6,
		width: 3,
		height: 30,
		fillColor: EMBER,
	}).animate(
		keys("x", cursorX, keys("y", cursorY, keys("opacity", blink(TYPE_FROM, clock)))),
	);
	return { layers: [...layers, cursor], lineDone, typedAt: clock };
}

/** Solid while typing, 2 Hz blink afterwards. */
function blink(from: number, typedAt: number): [number, number, string?][] {
	const out: [number, number, string?][] = [[0, 0], [from, 1, "hold"]];
	for (let f = typedAt + 8, on = false; f < CODE_TO - CODE_FROM; f += 8, on = !on) out.push([f, on ? 1 : 0, "hold"]);
	return out;
}

/** Effect opacity that switches on over 4 frames at a scene-local frame (effects see source frames). */
function switchOn(sceneFrame: number, clipStart: number, trimFrames: number) {
	const at = sceneFrame - clipStart + trimFrames;
	return Signal.builder({ type: "custom", fn: (ctx) => Math.min(1, Math.max(0, (ctx.frame - at) / 4)) });
}

export const DANCER_TRIM_SEC = 0;
export const HALFTONE = { frequency: 56, angle: 45, dotColor: INK, paperColor: PAPER };
export const EMBER_STOPS = [
	{ position: 0, color: EMBER },
	{ position: 1, color: PAPER },
];

const TYPESET = typeSetCode();
/** Scene-local frame the preview clip starts (when `Layer.video(...)` is typed). */
export const PREVIEW_CLIP_START = TYPESET.lineDone[3];

export function codeScene() {
	const { layers, lineDone, typedAt } = TYPESET;
	const clipStart = PREVIEW_CLIP_START;
	const trim = Math.round(DANCER_TRIM_SEC * FPS);
	const end = CODE_TO - CODE_FROM;
	// The preview takes the frame over the last bar and a half, landing on the drop.
	const expandAt = end - 26;
	const GROW = "power3.inOut";

	const dancer = Layer.video(asset("dancer.mp4"), {
		id: "code-preview-clip",
		width: "fill",
		height: "fill",
		fit: "cover",
		muted: true,
		startFrame: clipStart,
		trimStartSec: DANCER_TRIM_SEC,
	})
		.apply(new HalftoneScreen({ ...HALFTONE, opacity: switchOn(lineDone[4], clipStart, trim) }))
		.apply(new GradientMap({ stops: EMBER_STOPS, opacity: switchOn(lineDone[5], clipStart, trim) }));

	/** Editor chrome slides off left as the preview takes the frame. */
	const uiExit = (x: number) =>
		LayerAnimation.create()
			.fromTo("x", x, x - 160, { start: expandAt - 8, end: expandAt + 12, ease: "power2.in" })
			.fadeOut(expandAt - 2, expandAt + 12, "power2.in");

	return scene({
		id: "code",
		from: CODE_FROM,
		to: CODE_TO,
		background: INK,
		children: [
			headline({ id: "code-title", text: "Code it.", x: 96, y: 96, width: 900, size: 124, color: PAPER, inAt: 0, outAt: expandAt - 8 }),
			Layer.box({
				id: "code-card",
				position: "absolute",
				x: CARD.x,
				y: CARD.y,
				width: CARD.w,
				height: CARD.h,
				background: GRAPHITE,
				borderRadius: 22,
				borderColor: "rgba(238,233,224,0.08)",
				borderWidth: 1,
			}).animate(uiExit(CARD.x)),
			Layer.box({
				id: "code-lines",
				position: "absolute",
				x: 0,
				y: 0,
				width: W,
				height: H,
				overflow: "visible",
				children: layers as never,
			}).animate(uiExit(0)),
			label({ id: "code-file", text: "film.ts", x: CARD.x, y: CARD.y - 40, color: STONE, inAt: 4, outAt: expandAt - 6 }),
			label({ id: "code-live", text: "Live preview  ·  WebGPU", x: PREVIEW.x, y: PREVIEW.y - 40, color: STONE, inAt: 8, outAt: expandAt - 6 }),
			Layer.box({
				id: "code-preview",
				position: "absolute",
				x: PREVIEW.x,
				y: PREVIEW.y,
				width: PREVIEW.w,
				height: PREVIEW.h,
				background: GRAPHITE,
				borderRadius: 18,
				borderColor: "rgba(238,233,224,0.08)",
				borderWidth: 1,
				overflow: "hidden",
				children: [
					// Until Layer.video is typed there is nothing to draw — the opening line, again.
					label({ id: "code-preview-empty", text: "Empty composition", x: 0, y: PREVIEW.h / 2 - 14, width: PREVIEW.w, align: "center", color: STONE, inAt: 10 }),
					dancer,
				],
			}).animate(
				keys("x", [[expandAt, PREVIEW.x], [end, 0, GROW]],
					keys("y", [[expandAt, PREVIEW.y], [end, 0, GROW]],
						keys("width", [[expandAt, PREVIEW.w], [end, W, GROW]],
							keys("height", [[expandAt, PREVIEW.h], [end, H, GROW]],
								keys("borderRadius", [[expandAt, 18], [end, 0, GROW]]))))),
			),
			...renderBar(typedAt, expandAt),
			...chapter({ id: "code-ch", index: "04", name: "Code", color: PAPER, inAt: 10, outAt: expandAt - 6 }),
			label({
				id: "code-caption",
				text: "TypeScript  ·  Headless  ·  Deterministic",
				x: W - 96 - 900,
				y: H - 92,
				width: 900,
				align: "end",
				color: SAND,
				inAt: 16,
				outAt: expandAt - 6,
			}),
		],
	});
}

/** Progress rule under the preview once `renderVideo` is typed. */
function renderBar(typedAt: number, expandAt: number) {
	const y = PREVIEW.y + PREVIEW.h + 36;
	return [
		label({ id: "code-render-label", text: "Rendering  1920 × 1080  ·  30 fps", x: PREVIEW.x, y, color: PAPER, inAt: typedAt - 2, outAt: expandAt - 4 }),
		Layer.shape("rect", {
			id: "code-render-track",
			position: "absolute",
			x: PREVIEW.x,
			y: y + 40,
			width: PREVIEW.w,
			height: 2,
			fillColor: "rgba(238,233,224,0.14)",
		}).animate(LayerAnimation.create().fadeIn(typedAt - 2, typedAt + 2).fadeOut(expandAt - 6, expandAt + 6)),
		Layer.shape("rect", {
			id: "code-render-fill",
			position: "absolute",
			x: PREVIEW.x,
			y: y + 40,
			width: 0,
			height: 2,
			fillColor: EMBER,
		}).animate(keys("width", [[typedAt, 0], [expandAt + 2, PREVIEW.w, "power2.inOut"]], LayerAnimation.create().fadeOut(expandAt - 6, expandAt + 6))),
	];
}
