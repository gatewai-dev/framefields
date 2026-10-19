/**
 * 01 — Open. Out of the dark a Noto fire emoji (a Lottie) catches and throws GPU sparks; the name
 * wave-rises letter by letter under it. On the third bar the kick arrives: shockwaves ring out of
 * the flame on every beat, emoji pop around the title, an aurora wakes behind it, and an RGB
 * split climbs into the whip.
 */
import {
	FontManager,
	Gradient,
	Layer,
	LayerAnimation,
	LayerStyle,
	RGBSplit,
	Signal,
	TextAnimator,
} from "framefields";
import { blend, full, hud, keys, type Node, popIn, scene } from "../kit.js";
import type { NotoName } from "../manifest.js";
import { KICK_FRAMES, kick, kickAt } from "../music.js";
import { emoji } from "../paths.js";
import { still } from "../precomp.js";
import {
	BAR,
	BEAT,
	CYAN,
	DISPLAY,
	EMBER,
	GOLD,
	H,
	INK,
	MUTED,
	PAPER,
	PINK,
	PLUM,
	SERIF,
	VIOLET,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

const TITLE = {
	fontFamily: DISPLAY,
	fontWeight: 800,
	fontSize: 210,
	letterSpacing: -6,
};
const POPS: Array<[NotoName, number, number, number]> = [
	["sparkles", 250, 300, 150],
	["rocket", 1530, 280, 160],
	["zap", 180, 690, 130],
	["starStruck", 1600, 700, 150],
	["party", 470, 160, 120],
	["hundred", 1330, 150, 120],
	["boom", 820, 860, 120],
	["glowingStar", 1080, 870, 110],
];

export async function openScene(): Promise<Node> {
	const c = chapter("open");
	const fireSize = 300;
	const fireX = W / 2 - fireSize / 2;
	const fireY = 140;
	const breathe = LayerAnimation.create().signal("scale", kick, {
		multiplier: 0.035,
		offset: 1,
	});
	const drop = BAR * 2;

	const m = FontManager.measure("framefields", TITLE);
	const tw = Math.ceil(m.width + 80);
	const th = 240;
	const titlePng = await still("open-title", tw, th, [
		Layer.text("framefields", {
			position: "absolute",
			x: 0,
			y: 0,
			width: tw,
			height: th,
			...TITLE,
			fill: PAPER,
			align: "center",
		}),
	]);
	const tx = (W - tw) / 2;
	const ty = 470;
	const split = Signal.programmatic((ctx) => {
		const t = (ctx.frame - c.start - (c.frames - BEAT * 2)) / (BEAT * 2);
		return t <= 0 ? 0 : 3 + 22 * t * t;
	});

	// A shockwave out of the flame on every kick of the drop bar.
	const rings = KICK_FRAMES.filter(
		(f) => f >= c.start + drop && f < c.start + c.frames,
	).map((f, i) => {
		const at = f - c.start;
		return Layer.shape("circle", {
			id: `open-ring-${i}`,
			position: "absolute",
			x: W / 2 - 200,
			y: fireY + fireSize / 2 - 200,
			width: 400,
			height: 400,
			fillColor: "transparent",
			fillType: "none",
			strokeColor: [EMBER, GOLD, PINK, CYAN][i % 4],
			strokeWidth: 6,
			opacity: 0,
		}).animate(
			keys("scale", [
				[at, 0.3],
				[at + 24, 3.4, "expo.out"],
			]),
			keys("opacity", [
				[0, 0],
				[at - 1, 0],
				[at, 0.9],
				[at + 24, 0, "power2.out"],
			]),
			keys("strokeWidth", [
				[at, 10],
				[at + 24, 1, "power2.out"],
			]),
		);
	});

	return scene("open", INK, [
		full({ background: Gradient.radial([PLUM, INK]) }).animate(
			keys("opacity", [
				[0, 0],
				[BAR, 1, "sine.inOut"],
			]),
		),
		// The aurora wakes on the drop.
		blend(
			Layer.vfx({
				id: "open-aurora",
				effectType: "Aurora",
				width: W,
				height: H,
				colorStart: VIOLET,
				colorEnd: CYAN,
				density: 0.7,
				speed: 1.2,
				intensity: 0.8,
			}),
			"screen",
		).animate(
			keys("opacity", [
				[0, 0],
				[drop - 6, 0],
				[drop + 10, 0.7, "power2.out"],
			]),
		),
		blend(
			Layer.vfx({
				id: "open-embers",
				effectType: "Embers",
				width: W,
				height: H,
				density: 0.9,
				speed: 0.9,
				intensity: 1,
				colorStart: GOLD,
				colorEnd: EMBER,
				seed: 11,
			}),
			"screen",
		).animate(
			keys("opacity", [
				[0, 0],
				[30, 0],
				[90, 1, "sine.inOut"],
			]),
		),
		// GPU sparks thrown off the flame, harder on every kick.
		Layer.particles({
			id: "open-sparks",
			width: W,
			height: H,
			max: 6000,
			seed: 3,
			emitter: {
				shape: "circle",
				x: W / 2,
				y: fireY + fireSize * 0.62,
				radius: 70,
				rate: (f: number) => (f < c.start + 12 ? 0 : 160 + 900 * kickAt(f)),
			},
			lifetime: [0.8, 1.8],
			speed: [160, 520],
			direction: -90,
			spread: 70,
			gravity: -60,
			drag: 1.2,
			noise: { strength: 180, scale: 140, speed: 0.6 },
			size: [7, 2],
			sizeJitter: 0.6,
			fade: [0.05, 0.4],
			shape: "spark",
			blend: "add",
			color: ["#FFF3C4", GOLD, EMBER, "#7A2E14"],
		} as never),
		...rings,
		Layer.box({
			id: "open-fire-breath",
			position: "absolute",
			x: fireX,
			y: fireY,
			width: fireSize,
			height: fireSize,
			children: [
				Layer.lottie(emoji("fire"), {
					id: "open-fire",
					position: "absolute",
					x: 0,
					y: 0,
					width: fireSize,
					height: fireSize,
				})
					.withEffect(
						new LayerStyle({
							outerGlow: {
								enabled: true,
								color: EMBER,
								opacity: 0.85,
								size: 70,
								spread: 0,
							},
						}),
					)
					.animate(
						keys("scale", [
							[0, 0],
							[8, 0],
							[30, 1, "back.out(2.2)"],
						]),
					),
			],
		}).animate(breathe),
		...POPS.map(([name, x, y, size], i) =>
			Layer.lottie(emoji(name), {
				id: `open-pop-${name}`,
				position: "absolute",
				x,
				y,
				width: size,
				height: size,
			}).animate(
				popIn(drop + i * 7, 16, 0),
				keys("rotation", [
					[drop + i * 7, -25],
					[drop + i * 7 + 20, 0, "back.out(2)"],
				]),
			),
		),
		Layer.box({
			id: "open-title-box",
			position: "absolute",
			x: tx,
			y: ty,
			width: tw,
			height: th,
			children: [
				// The glow: a precomposed copy of the title with an outer glow, behind the live type.
				Layer.image(titlePng, {
					id: "open-title-glow",
					position: "absolute",
					x: 0,
					y: 0,
					width: tw,
					height: th,
				})
					.withEffect(
						new LayerStyle({
							outerGlow: {
								enabled: true,
								color: EMBER,
								opacity: 0.7,
								size: 46,
								spread: 0,
							},
						}),
					)
					.animate(
						keys("opacity", [
							[0, 0],
							[60, 0],
							[80, 1, "power2.out"],
						]),
					),
				Layer.text("framefields", {
					id: "open-title",
					position: "absolute",
					x: 0,
					y: 0,
					width: tw,
					height: th,
					...TITLE,
					fill: PAPER,
					align: "center",
					animators: [
						TextAnimator.waveRise({
							y: 120,
							rotationX: 70,
							blur: 14,
							easing: "expo.out",
						}),
					],
				}).animate(
					LayerAnimation.create().kineticSweep(-1, 1, 24, 66, "power2.out"),
				),
				// The split copy takes over for the last two beats, into the whip.
				Layer.image(titlePng, {
					id: "open-title-split",
					position: "absolute",
					x: 0,
					y: 0,
					width: tw,
					height: th,
				})
					.withEffect(new RGBSplit({ amount: split, angle: 0 }))
					.animate(
						keys("opacity", [
							[0, 0],
							[c.frames - BEAT * 2, 0],
							[c.frames - BEAT * 2 + 2, 1],
						]),
					),
			],
		}).animate(breathe),
		Layer.text("every capability · one render · no browser", {
			id: "open-sub",
			position: "absolute",
			x: 0,
			y: 728,
			width: W,
			fontFamily: SERIF,
			fontStyle: "italic",
			fontSize: 50,
			fill: MUTED,
			align: "center",
			animators: [TextAnimator.blurIn({ unit: "word", blur: 18, y: 18 })],
		}).animate(
			LayerAnimation.create().kineticSweep(-1, 1, 64, 104, "power3.out"),
		),
		hud("open", [
			"Layer.lottie",
			"Layer.particles",
			"Layer.vfx(Aurora, Embers)",
			"TextAnimator",
			"LayerStyle",
			"RGBSplit",
		]),
	]);
}
