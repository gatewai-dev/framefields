/**
 * 08 — Typography. A ring of text on a circular path turns through the whole chapter while three
 * beats of type play inside it: per-glyph 3D flips, a Lottie playing inside giant letters (the
 * type is its matte), then the same greeting in Latin, Arabic and Hebrew — shaped and laid out
 * right to left — over a line being typed in code.
 */
import {
	Color,
	Layer,
	LayerAnimation,
	TextAnimator,
	TextPathBuilder,
} from "framefields";
import { brandTint, full, hud, keys, type Node, scene } from "../kit.js";
import { kick } from "../music.js";
import { lottie } from "../paths.js";
import {
	ARABIC,
	BAR,
	BEAT,
	BG,
	COBALT,
	DISPLAY,
	FG,
	H,
	HEBREW,
	MONO,
	MUTED,
	ROYAL,
	SANS,
	SIGNAL,
	SKY,
	VIOLET,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

const CX = W / 2;
const CY = 520;

function phase(id: string, from: number, len: number, children: Node[]): Node {
	return full({
		id: `type-phase-${id}`,
		startFrame: from,
		durationFrames: len,
		children,
	});
}

export function typeScene(): Node {
	const c = chapter("type");
	const R = 430;
	const ringText =
		"TEXT ON A PATH · SLUG GPU GLYPHS · RIGHT TO LEFT · KINETIC · ";
	const ring = Layer.box({
		id: "type-ring",
		position: "absolute",
		x: CX - R - 40,
		y: CY - R - 40,
		width: 2 * R + 80,
		height: 2 * R + 80,
		children: [
			Layer.text(ringText + ringText, {
				id: "type-ring-text",
				position: "absolute",
				x: 0,
				y: 0,
				width: 2 * R + 80,
				height: 2 * R + 80,
				fontFamily: MONO,
				fontWeight: 700,
				fontSize: 26,
				letterSpacing: 4,
				fill: Color.alpha(FG, 0.45),
				pathOptions: TextPathBuilder.circularBadge(R + 40, R + 40, R).build(),
			} as never),
		],
	}).animate(
		keys("rotation", [
			[0, 0],
			[c.frames, 72, "none"],
		]),
		keys("opacity", [
			[0, 0],
			[12, 1],
		]),
	);

	const kinetic = phase("kinetic", 0, BAR, [
		Layer.text("Kinetic", {
			id: "type-kinetic",
			position: "absolute",
			x: 0,
			y: CY - 170,
			width: W,
			align: "center",
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 200,
			letterSpacing: -6,
			fill: FG,
			animators: [TextAnimator.flip3D({ rotationX: 100 })],
		}).animate(
			LayerAnimation.create().kineticSweep(-1, 1, 4, 34, "power2.out"),
		),
		Layer.text("type, per glyph", {
			id: "type-kinetic-sub",
			position: "absolute",
			x: 0,
			y: CY + 60,
			width: W,
			align: "center",
			fontFamily: SANS,
			fontWeight: 600,
			fontSize: 72,
			fill: COBALT,
			animators: [TextAnimator.waveRise({ y: 50, rotationX: 50, blur: 8 })],
		}).animate(
			LayerAnimation.create().kineticSweep(-1, 1, 18, 46, "power2.out"),
		),
	]);

	// A Lottie seen through the letters.
	const inside = phase("inside", BAR, BAR, [
		Layer.box({
			id: "type-inside-fill",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			background: `linear-gradient(120deg, ${ROYAL}, ${SIGNAL} 50%, ${SKY})`,
			children: [
				Layer.lottie(lottie("gradientShapes"), {
					id: "type-inside-lottie",
					position: "absolute",
					x: 0,
					y: 0,
					width: W,
					height: H,
					fit: "cover",
				}).withEffect(brandTint()),
			],
		}).withMatte(
			Layer.text("INSIDE", {
				id: "type-inside-matte",
				position: "absolute",
				x: 0,
				y: CY - 200,
				width: W,
				align: "center",
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 330,
				letterSpacing: -10,
				fill: "#ffffff",
			}).animate(
				keys("scale", [
					[0, 0.6],
					[16, 1, "expo.out"],
				]),
			),
		),
		Layer.text("a Lottie, with the type as its matte", {
			id: "type-inside-sub",
			position: "absolute",
			x: 0,
			y: CY + 170,
			width: W,
			align: "center",
			fontFamily: MONO,
			fontSize: 26,
			fill: MUTED,
		}).animate(
			keys("opacity", [
				[0, 0],
				[10, 0],
				[20, 1],
			]),
		),
	]);

	const GREETINGS: Array<[string, string, string]> = [
		["Hello", DISPLAY, COBALT],
		["مرحبا", ARABIC, SIGNAL],
		["שלום", HEBREW, ROYAL],
	];
	const hello = phase("hello", BAR * 2, BAR + 30, [
		...GREETINGS.map(([word, family, color], i) =>
			Layer.text(word, {
				id: `type-hello-${i}`,
				position: "absolute",
				x: 0,
				y: CY - 320 + i * 190,
				width: W,
				align: "center",
				direction: "auto",
				fontFamily: family,
				fontWeight: 800,
				fontSize: 140,
				fill: color,
			}).animate(
				keys("opacity", [
					[0, 0],
					[i * BEAT, 0],
					[i * BEAT + 4, 1],
				]),
				keys("scale", [
					[0, 0.5],
					[i * BEAT, 0.5],
					[i * BEAT + 14, 1, "back.out(2)"],
				]),
			),
		),
		Layer.text(
			'Layer.text(word, { direction: "auto" })  // shaped · bidi · right to left',
			{
				id: "type-hello-code",
				position: "absolute",
				x: 0,
				y: CY + 250,
				width: W,
				align: "center",
				fontFamily: MONO,
				fontSize: 26,
				fill: VIOLET,
			},
		).animate(
			LayerAnimation.create().typewriter(BEAT * 3, BEAT * 3 + 34, "linear"),
		),
	]);

	return scene("type", BG, [
		full({
			background: `radial-gradient(circle, ${Color.alpha(SKY, 0.35)}, transparent 70%)`,
		}).animate(
			LayerAnimation.create().signal("opacity", kick, {
				multiplier: 0.5,
				offset: 0.5,
			}),
		),
		ring,
		kinetic,
		inside,
		hello,
		hud("type", [
			"TextAnimator.flip3D · waveRise",
			"withMatte(text)",
			"direction: auto (RTL)",
			"typewriter",
			"TextPathBuilder",
		]),
	]);
}
