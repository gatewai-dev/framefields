/**
 * The window: framefields desktop as one large frame standing in the field.
 * A metal slab with the app on its face, and the preview is an opening in
 * it: what the preview shows is the field behind, so when the line typed in
 * the composer wakes the field, the preview shows it because it is it.
 *
 * Laid out in world px (the app at 2×), y down, the face toward -z.
 */
import {
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
} from "framefields";
import { PLAYHEAD_REACH, playheadX } from "./field.js";
import { BEAT, DISPLAY, PROMPT, SIGNAL, TEXT } from "./theme.js";

/** The app's light theme: paper and ink. */
const PAPER = "#e6e8e6";
const SIDE = "#dcdfdc";
const CHAT = "#cfd2cf";
const SHEET = "#f4f5f3";
const INK = "#0b0c0d";
const STEEL = "#4f5256";
const RULE = "#b4b8b8";

const WW = 2400;
const WH = 1500;
/** The window hovers just off the floor. */
const BOTTOM = -90;
const LEFT = -WW / 2;
const TOP = BOTTOM - WH;
const BAR = 96;
const SIDEBAR = 620;
/** The face sits this far in front of the slab's middle. */
const FACE = -26;

const MAIN_X = LEFT + SIDEBAR;
const MAIN_W = WW - SIDEBAR;
const PREVIEW_H = Math.round((MAIN_W * 9) / 16);
/** The preview: an opening onto the field. */
export const PREVIEW = {
	x: MAIN_X,
	y: TOP + BAR,
	width: MAIN_W,
	height: PREVIEW_H,
	cx: MAIN_X + MAIN_W / 2,
	cy: TOP + BAR + PREVIEW_H / 2,
} as const;
const PANEL_Y = PREVIEW.y + PREVIEW_H;
const PANEL_H = BOTTOM - PANEL_Y;

const BOX = { x: 44, y: PANEL_H - 36 - 112, width: MAIN_W - 88, height: 112 };
/** The composer's middle, for the lens. */
export const COMPOSER = {
	/** Where the typed line starts. */
	left: MAIN_X + BOX.x + 40,
	cx: MAIN_X + BOX.x + BOX.width / 2,
	cy: PANEL_Y + BOX.y + BOX.height / 2,
} as const;

const label = (
	text: string,
	x: number,
	y: number,
	size: number,
	fill: string,
	weight = 500,
	extra: Record<string, unknown> = {},
) =>
	Layer.text(text, {
		position: "absolute",
		x,
		y,
		fontFamily: TEXT,
		fontSize: size,
		fontWeight: weight,
		fill,
		...extra,
	});

const rect = (
	x: number,
	y: number,
	width: number,
	height: number,
	background: string,
	extra: Record<string, unknown> = {},
) =>
	Layer.box({
		position: "absolute",
		x,
		y,
		width,
		height,
		background,
		...extra,
	});

/** The window starts under the floor and rises out of it, a little past its place and back. */
const RISE = WH + 260;
const RISE_FRAMES = 32;
const rising = (y: number) =>
	LayerAnimation.keys("y", [
		[0, y + RISE],
		[BEAT.rise, y + RISE],
		[BEAT.rise + RISE_FRAMES, y, "back.out(1.25)"],
	]);

interface Piece {
	y?: unknown;
	animate(animation: ReturnType<typeof LayerAnimation.keys>): unknown;
}

/** A piece of the interface arriving: up into its place and in, each a moment after the last. */
function arrive<T extends Piece>(piece: T, order: number, drop = 22): T {
	const at = Math.round(BEAT.rise + RISE_FRAMES - 10 + order * 2);
	const y = typeof piece.y === "number" ? piece.y : 0;
	piece.animate(
		LayerAnimation.create()
			.keys("opacity", [
				[0, 0],
				[at, 0],
				[at + 6, 1],
			])
			.keys("y", [
				[0, y + drop],
				[at, y + drop],
				[at + 12, y, "expo.out"],
			]),
	);
	return piece;
}

/** A face of the window: an unlit plane in front of the slab. */
function face(
	id: string,
	x: number,
	y: number,
	width: number,
	height: number,
	background: string,
	children: unknown[],
) {
	return Layer3D.plane({
		id,
		x,
		y,
		z: FACE,
		width,
		height,
		background,
		material: "unlit",
		twoSided: false,
		children: children as LayoutNode[],
	}).animate(rising(y));
}

function titleBar() {
	const pill = (text: string, x: number, width: number, on: boolean) =>
		Layer.flex({
			position: "absolute",
			x,
			y: 22,
			width,
			height: 52,
			borderRadius: 8,
			background: on ? INK : PAPER,
			borderColor: on ? INK : RULE,
			borderWidth: 2,
			justify: "center",
			align: "center",
			children: [
				Layer.text(text, {
					fontFamily: TEXT,
					fontSize: 26,
					fontWeight: 600,
					fill: on ? PAPER : INK,
				}),
			],
		});
	const pieces = [
		...[0, 1, 2].map((i) =>
			rect(40 + i * 38, 37, 22, 22, RULE, { borderRadius: 11 }),
		),
		label("First light", 196, 30, 30, INK, 650),
		label("Brand film · 16:9", 372, 32, 27, STEEL, 450),
		pill("Preview", WW - 520, 150, true),
		pill("Files", WW - 356, 110, false),
		pill("Renders", WW - 232, 160, false),
	];
	return face("win-bar", LEFT, TOP, WW, BAR, PAPER, [
		...pieces.map((piece, i) => arrive(piece, i)),
		rect(0, BAR - 2, WW, 2, RULE),
	]);
}

const SESSIONS = [
	["First light", "Brand film · 16:9"],
	["Speaker launch teaser", "Product launch · 16:9"],
	["Creator cut", "Social · 9:16"],
	["Shapes bumper", "Bumper · 16:9"],
	["How the gearbox works", "Explainer · 16:9"],
	["Lyric video, verse two", "Music · 16:9"],
] as const;

function sidebar() {
	const pieces = [
		Layer.text("framefields", {
			position: "absolute",
			x: 44,
			y: 40,
			fontFamily: DISPLAY,
			fontSize: 58,
			fontWeight: 800,
			fontVariations: { wdth: 68 },
			letterSpacing: -0.3,
			fill: INK,
		}),
		Layer.box({
			position: "absolute",
			x: 40,
			y: 138,
			width: SIDEBAR - 80,
			height: 78,
			borderRadius: 10,
			borderColor: RULE,
			borderWidth: 2,
			background: SIDE,
			children: [label("+  New", 30, 20, 30, INK, 550)],
		}),
		...SESSIONS.flatMap(([title, kind], i) => {
			const y = 262 + i * 136;
			return [
				...(i === 0
					? [
							rect(28, y - 14, SIDEBAR - 56, 118, SHEET, { borderRadius: 8 }),
							rect(28, y - 14, 6, 118, INK),
						]
					: []),
				label(title, 56, y, 31, INK, i === 0 ? 600 : 500),
				label(kind, 56, y + 46, 26, STEEL, 450),
			];
		}),
	];
	return face("win-side", LEFT, TOP + BAR, SIDEBAR, WH - BAR, SIDE, [
		...pieces.map((piece, i) => arrive(piece, 3 + i * 0.8)),
		rect(SIDEBAR - 2, 0, 2, WH - BAR, RULE),
	]);
}

/** The preview's timeline: ticks, and the playhead the field follows. */
function timeline() {
	const x0 = 110;
	const width = MAIN_W - 170;
	const at = (frame: number) =>
		x0 + ((playheadX(frame) + PLAYHEAD_REACH) / (2 * PLAYHEAD_REACH)) * width;
	const ticks = Array.from({ length: 41 }, (_, i) =>
		rect(
			x0 + (i / 40) * width - 1,
			i % 5 === 0 ? 20 : 28,
			2,
			i % 5 === 0 ? 24 : 12,
			RULE,
		),
	);
	return [
		rect(0, 0, MAIN_W, 2, RULE),
		// Play.
		Layer.shape("path", {
			position: "absolute",
			x: 44,
			y: 18,
			width: 28,
			height: 28,
			d: "M 4 2 L 26 14 L 4 26 Z",
			fill: INK,
		}),
		...ticks.map((tick, i) => arrive(tick, 8 + i * 0.2, 10)),
		rect(x0, 31, width, 2, RULE),
		rect(x0 - 4, 8, 8, 48, SIGNAL, {
			id: "win-playhead",
			borderRadius: 2,
		}).animate(
			LayerAnimation.keys("x", [
				[0, x0 - 4],
				[BEAT.play, at(BEAT.play) - 4],
				[BEAT.played, at(BEAT.played) - 4, "none"],
			]),
		),
		rect(0, 62, MAIN_W, 2, RULE),
	];
}

const TYPE = { fontFamily: TEXT, fontSize: 36, fontWeight: 480 } as const;

/** The composer: the line typed a key at a time, the caret, send. */
function composer() {
	const measured = FontManager.measure(PROMPT, TYPE);
	const perKey = (BEAT.typed - BEAT.type) / PROMPT.length;
	const keyFrame = (k: number) => Math.round(BEAT.type + k * perKey);
	const textX = 40;
	const caretKeys: Array<[number, number, string]> = [[0, textX, "hold"]];
	for (let k = 1; k <= PROMPT.length; k++)
		caretKeys.push([keyFrame(k), textX + measured.caretX(k) + 3, "hold"]);
	// The caret blinks while it waits, and stays lit while keys land.
	const blink: Array<[number, number, string]> = [];
	for (let f = 0; f < BEAT.send; f += 15) {
		const typing = f >= BEAT.type - 15 && f <= BEAT.typed;
		blink.push([f, typing || (f / 15) % 2 === 0 ? 1 : 0, "hold"]);
	}
	blink.push([BEAT.send, 0, "hold"]);
	return Layer.box({
		id: "win-composer",
		position: "absolute",
		...BOX,
		borderRadius: 18,
		background: SHEET,
		borderColor: RULE,
		borderWidth: 2,
		children: [
			Layer.text(PROMPT, {
				id: "win-line",
				position: "absolute",
				x: textX,
				y: 32,
				...TYPE,
				fill: INK,
			}).animate(
				LayerAnimation.create()
					.typewriter(BEAT.type, BEAT.typed, "none")
					.keys("opacity", [
						[BEAT.send, 1],
						[BEAT.send + 5, 0],
					]),
			),
			rect(textX, 30, 3, 50, INK, { id: "win-caret" }).animate(
				LayerAnimation.create().keys("x", caretKeys).keys("opacity", blink),
			),
			// Send: ink once there is a line to send, pressed on the beat.
			Layer.box({
				id: "win-send",
				position: "absolute",
				x: BOX.width - 96,
				y: 20,
				width: 72,
				height: 72,
				borderRadius: 36,
				background: RULE,
				children: [
					rect(0, 0, 72, 72, INK, { borderRadius: 36, opacity: 0 }).animate(
						LayerAnimation.keys("opacity", [
							[BEAT.type, 0],
							[BEAT.type + 8, 1],
							[BEAT.send + 6, 1],
							[BEAT.send + 16, 0],
						]),
					),
					Layer.shape("path", {
						position: "absolute",
						x: 20,
						y: 18,
						width: 32,
						height: 36,
						d: "M 16 34 L 16 4 M 3 16 L 16 3 L 29 16",
						strokeColor: PAPER,
						strokeWidth: 5,
						fill: "transparent",
					}),
				],
			}).animate(
				LayerAnimation.keys("scale", [
					[BEAT.send - 3, 1],
					[BEAT.send, 0.84, "power2.in"],
					[BEAT.send + 8, 1, "back.out(2)"],
				]),
			),
		],
	});
}

/** After send: the line as a message, and the render filling until the field wakes. */
function conversation() {
	const width = FontManager.measure(PROMPT, TYPE).width + 72;
	const x = MAIN_W - 44 - width;
	const bubble = Layer.box({
		id: "win-message",
		position: "absolute",
		x,
		y: 84,
		width,
		height: 76,
		borderRadius: 16,
		background: SHEET,
		opacity: 0,
		children: [label(PROMPT, 36, 15, TYPE.fontSize, INK, TYPE.fontWeight)],
	}).animate(
		LayerAnimation.create()
			.keys("opacity", [
				[BEAT.send, 0],
				[BEAT.send + 6, 1],
			])
			.keys("y", [
				[BEAT.send, 150],
				[BEAT.send + 14, 84, "expo.out"],
			]),
	);
	const track = 760;
	const bar = Layer.box({
		id: "win-render",
		position: "absolute",
		x: 44,
		y: 100,
		width: 110 + track,
		height: 44,
		opacity: 0,
		children: [
			label("film", 0, 0, 31, INK, 650),
			Layer.box({
				position: "absolute",
				x: 96,
				y: 17,
				width: track,
				height: 10,
				borderRadius: 5,
				background: RULE,
				overflow: "hidden",
				children: [
					rect(-track, 0, track, 10, INK, { borderRadius: 5 }).animate(
						LayerAnimation.keys("x", [
							[BEAT.work, -track],
							[BEAT.work + 30, -track * 0.62, "power2.out"],
							[BEAT.wake - 22, -track * 0.3, "sine.inOut"],
							[BEAT.wake, 0, "power3.in"],
						]),
					),
				],
			}),
		],
	}).animate(
		LayerAnimation.keys("opacity", [
			[BEAT.work - 6, 0],
			[BEAT.work, 1],
		]),
	);
	return [bubble, bar];
}

function roundedRect(
	cx: number,
	cy: number,
	w: number,
	h: number,
	r: number,
	reverse: boolean,
): string {
	const x0 = cx - w / 2;
	const x1 = cx + w / 2;
	const y0 = cy - h / 2;
	const y1 = cy + h / 2;
	return reverse
		? `M ${x0 + r} ${y0} Q ${x0} ${y0} ${x0} ${y0 + r} L ${x0} ${y1 - r} Q ${x0} ${y1} ${x0 + r} ${y1} L ${x1 - r} ${y1} Q ${x1} ${y1} ${x1} ${y1 - r} L ${x1} ${y0 + r} Q ${x1} ${y0} ${x1 - r} ${y0} Z`
		: `M ${x0 + r} ${y0} L ${x1 - r} ${y0} Q ${x1} ${y0} ${x1} ${y0 + r} L ${x1} ${y1 - r} Q ${x1} ${y1} ${x1 - r} ${y1} L ${x0 + r} ${y1} Q ${x0} ${y1} ${x0} ${y1 - r} L ${x0} ${y0 + r} Q ${x0} ${y0} ${x0 + r} ${y0} Z`;
}

/** The window's layers: the slab, its faces and the light it throws on the field. */
export function appWindow(): LayoutNode[] {
	const cy = TOP + WH / 2;
	const edge = 18;
	const slab = Layer3D.extrude({
		id: "win-slab",
		x: 0,
		y: cy,
		z: 0,
		d: `${roundedRect(0, 0, WW + edge * 2, WH + edge * 2, 46, false)} ${roundedRect(PREVIEW.cx, PREVIEW.cy - cy, PREVIEW.width - 4, PREVIEW.height - 4, 2, true)}`,
		depth: 44,
		bevelThickness: 3,
		bevelSegments: 3,
		center: false,
		color: "#c9cccd",
		roughness: 0.5,
		metallic: 0.9,
	}).animate(rising(cy));
	const panel = face("win-panel", MAIN_X, PANEL_Y, MAIN_W, PANEL_H, CHAT, [
		...timeline(),
		...conversation(),
		arrive(composer(), 12, 46),
	]);
	const glow = Layer.rectLight({
		id: "win-light",
		x: 0,
		y: cy,
		z: -80,
		targetX: 0,
		targetY: cy + 500,
		targetZ: -3000,
		width: WW,
		height: WH,
		color: "#eef1ff",
		intensity: 2.4,
	}).animate(
		LayerAnimation.keys("intensity", [
			[0, 0],
			[BEAT.rise + 6, 0],
			[BEAT.rise + RISE_FRAMES, 2.4, "sine.out"],
		]),
	);
	return [slab, titleBar(), sidebar(), panel, glow] as LayoutNode[];
}

export const WINDOW = {
	width: WW,
	height: WH,
	top: TOP,
	bottom: BOTTOM,
} as const;
