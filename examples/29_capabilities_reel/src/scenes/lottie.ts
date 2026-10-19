/**
 * 02 — Lottie. Eight animations, each on its own card, flip in on the beat; on the third bar the
 * whole wall tips back in perspective while an abstract Lottie plays full-frame behind it.
 */
import { Blur, Color, Layer, LayerAnimation, LayerStyle } from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import { kick } from "../music.js";
import { lottie } from "../paths.js";
import {
	BAR,
	BEAT,
	CYAN,
	DISPLAY,
	GOLD,
	H,
	LIME,
	MONO,
	MUTED,
	NIGHT,
	PAPER,
	PINK,
	VIOLET,
	W,
} from "../theme.js";

const CARDS: Array<{
	name: string;
	label: string;
	bg: string;
	fit?: "cover" | "contain";
	pad?: number;
}> = [
	{
		name: "fireworks",
		label: "fireworks",
		bg: "#120E24",
		fit: "cover",
		pad: 0,
	},
	{
		name: "dogCar",
		label: "dog_car_ride",
		bg: "#4FC3C9",
		fit: "cover",
		pad: 0,
	},
	{ name: "gatin", label: "gatin", bg: "#1D6EAF", fit: "cover", pad: 0 },
	{ name: "growth", label: "growth", bg: "#E9E4F7" },
	{ name: "cactus", label: "cactus", bg: PAPER, pad: 46 },
	{
		name: "happy2016",
		label: "happy2016",
		bg: "#030B26",
		fit: "cover",
		pad: 0,
	},
	{ name: "squares", label: "9squares", bg: "#2A2A2A", fit: "cover", pad: 0 },
	{ name: "navidad", label: "navidad", bg: "#FFC7D9", pad: 10 },
];

const COLS = 4;
const CW = 390;
const CH = 270;
const GAP = 36;
const X0 = (W - (COLS * CW + (COLS - 1) * GAP)) / 2;
const Y0 = 250;

export function lottieScene(): Node {
	const cards = CARDS.map((card, i) => {
		const col = i % COLS;
		const row = Math.floor(i / COLS);
		const pad = card.pad ?? 26;
		const at = 6 + i * 5;
		return Layer.box({
			id: `lottie-card-${card.name}`,
			position: "absolute",
			x: X0 + col * (CW + GAP),
			y: Y0 + row * (CH + GAP + 34),
			width: CW,
			height: CH,
			borderRadius: 26,
			background: card.bg,
			borderColor: Color.alpha("#ffffff", 0.16),
			borderWidth: 1.5,
			overflow: "hidden",
			transformStyle: "preserve-3d",
			perspective: 1100,
			children: [
				Layer.lottie(lottie(card.name), {
					id: `lottie-${card.name}`,
					position: "absolute",
					x: pad,
					y: pad,
					width: CW - pad * 2,
					height: CH - pad * 2,
					fit: card.fit ?? "contain",
				}),
			],
		})
			.animate(
				keys("rotateY", [
					[0, -95],
					[at, -95],
					[at + 22, 0, "expo.out"],
				]),
				keys("opacity", [
					[0, 0],
					[at, 0],
					[at + 4, 1],
				]),
				keys("scale", [
					[0, 0.7],
					[at, 0.7],
					[at + 22, 1, "back.out(1.4)"],
				]),
			)
			.withEffect(
				new LayerStyle({
					dropShadow: {
						enabled: true,
						color: "#000000",
						opacity: 0.55,
						angle: 90,
						distance: 18,
						spread: 0,
						size: 34,
					},
				}),
			);
	});
	const labels = CARDS.map((card, i) =>
		Layer.text(`${String(i + 1).padStart(2, "0")}  ${card.label}.json`, {
			id: `lottie-label-${card.name}`,
			position: "absolute",
			x: X0 + (i % COLS) * (CW + GAP) + 4,
			y: Y0 + Math.floor(i / COLS) * (CH + GAP + 34) + CH + 12,
			width: CW,
			fontFamily: MONO,
			fontSize: 17,
			fill: MUTED,
		}).animate(
			keys("opacity", [
				[0, 0],
				[16 + i * 5, 0],
				[26 + i * 5, 1],
			]),
		),
	);

	return scene("lottie", NIGHT, [
		// Full-frame abstract Lottie, blurred into a moving backdrop.
		Layer.lottie(lottie("gradientShapes"), {
			id: "lottie-backdrop",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fit: "cover",
		})
			.withEffect(new Blur({ blurType: "Gaussian", strength: 40 }))
			.animate(
				keys("opacity", [
					[0, 0],
					[BAR, 0.45, "sine.inOut"],
				]),
			),
		full({
			background: `linear-gradient(180deg, ${NIGHT}00 0%, ${NIGHT} 92%)`,
		}),
		Layer.text("Lottie", {
			id: "lottie-title",
			position: "absolute",
			x: X0,
			y: 92,
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 96,
			letterSpacing: -2,
			fill: PAPER,
		}).animate(
			keys("x", [
				[0, X0 - 60],
				[20, X0, "expo.out"],
			]),
			keys("opacity", [
				[0, 0],
				[10, 1],
			]),
		),
		Layer.text(
			"vector animation, decoded and drawn on the GPU — any .json or .lottie",
			{
				id: "lottie-sub",
				position: "absolute",
				x: X0 + 4,
				y: 192,
				fontFamily: MONO,
				fontSize: 22,
				fill: MUTED,
			},
		).animate(
			keys("opacity", [
				[0, 0],
				[14, 0],
				[28, 1],
			]),
		),
		...[GOLD, CYAN, LIME, PINK, VIOLET].map((color, i) =>
			Layer.shape("circle", {
				id: `lottie-dot-${i}`,
				position: "absolute",
				x: X0 + 352 + i * 22,
				y: 132,
				width: 12,
				height: 12,
				fillColor: color,
			}).animate(
				LayerAnimation.create().signal("scale", kick, {
					multiplier: 0.8,
					offset: 1,
				}),
			),
		),
		Layer.box({
			id: "lottie-wall",
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			transformStyle: "preserve-3d",
			perspective: 1600,
			children: [...cards, ...labels],
		}).animate(
			keys("rotateX", [
				[BAR * 2 - BEAT, 0],
				[BAR * 3, 16, "power2.inOut"],
			]),
			keys("rotateY", [
				[BAR * 2 - BEAT, 0],
				[BAR * 3, -12, "power2.inOut"],
			]),
			keys("scale", [
				[BAR * 2 - BEAT, 1],
				[BAR * 3, 0.9, "power2.inOut"],
			]),
		),
		hud("lottie", [
			"Layer.lottie",
			"fit: cover | contain",
			"rotateY · perspective",
			"LayerStyle.dropShadow",
			"Blur",
		]),
	]);
}
