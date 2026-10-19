/**
 * 11 — Finale. A GPU particle vortex that surges on every kick, Lottie fireworks going off round
 * the frame, every emoji SVG orbiting the brand lockup and the install line — then the last hit
 * and an old-TV power-off to the brand's night blue. The asset credits sit along the bottom.
 */
import {
	Color,
	Gradient,
	Layer,
	LayerAnimation,
	LayerStyle,
	Signal,
} from "framefields";
import {
	blend,
	brandTint,
	full,
	keys,
	type Node,
	popIn,
	scene,
} from "../kit.js";
import { FLUENT, TWEMOJI } from "../manifest.js";
import { kick, kickAt } from "../music.js";
import { fluent, lottie, twemoji, WORDMARK } from "../paths.js";
import {
	BAR,
	BEAT,
	COBALT,
	FROST,
	H,
	LINE,
	MONO,
	MUTED,
	NIGHT,
	SIGNAL,
	SKY,
	W,
	WHITE,
} from "../theme.js";
import { chapter } from "../timeline.js";

const CX = W / 2;
const CY = 470;

export async function finaleScene(): Promise<Node> {
	const c = chapter("finale");
	const hit = BAR * 3; // the last downbeat
	const off = hit + BEAT * 2; // power-off

	const vortex = Layer.particles({
		id: "finale-vortex",
		width: W,
		height: H,
		max: 30000,
		seed: 13,
		emitter: {
			shape: "ring",
			x: CX,
			y: CY,
			radius: 700,
			rate: (f: number) => 700 + 6000 * kickAt(f),
		},
		lifetime: [1.0, 1.8],
		speed: [60, 140],
		direction: 0,
		spread: 360,
		drag: 0.6,
		noise: { strength: 160, scale: 260, speed: 0.4 },
		attractors: [{ x: CX, y: CY, strength: 900, radius: 900 }],
		size: [5, 1.5],
		sizeJitter: 0.5,
		fade: [0.1, 0.4],
		shape: "spark",
		blend: "normal",
		color: [SKY, SIGNAL, COBALT],
		colorBySpeed: 900,
		prewarm: 2,
	} as never);

	const BURSTS: Array<[number, number, number, number]> = [
		[120, 120, 0, 520],
		[1500, 90, 18, 560],
		[1380, 560, 40, 480],
		[180, 560, 62, 460],
		[1140, 600, 128, 420],
	];
	const fireworks = BURSTS.map(([x, y, at, size], i) =>
		blend(
			Layer.lottie(lottie("fireworks"), {
				id: `finale-fw-${i}`,
				position: "absolute",
				x,
				y,
				width: size,
				height: size * 1.4,
				fit: "cover",
				startFrame: at,
			}).withEffect(brandTint()),
			"normal",
		),
	);

	const ring = [
		...Object.keys(FLUENT).map((n) => fluent(n)),
		...Object.keys(TWEMOJI)
			.slice(0, 6)
			.map((n) => twemoji(n)),
	];
	const orbit = ring.map((src, i) => {
		const size = 92;
		const phase = (i / ring.length) * Math.PI * 2;
		const radius = (frame: number) =>
			440 + 40 * Math.sin((frame - c.start) / 9 + i);
		const angle = (frame: number) => phase + ((frame - c.start) / 60) * 0.55;
		return Layer.box({
			id: `finale-orbit-${i}`,
			position: "absolute",
			x: 0,
			y: 0,
			width: size,
			height: size,
			children: [
				Layer.svg(src, {
					position: "absolute",
					x: 0,
					y: 0,
					width: size,
					height: size,
				}).animate(popIn(6 + (i % 12) * 3, 14, 0)),
			],
		}).animate(
			LayerAnimation.create()
				.signal(
					"x",
					Signal.programmatic(
						(ctx) =>
							CX +
							Math.cos(angle(ctx.frame)) * radius(ctx.frame) * 1.75 -
							size / 2,
					),
				)
				.signal(
					"y",
					Signal.programmatic(
						(ctx) =>
							CY +
							30 +
							Math.sin(angle(ctx.frame)) * radius(ctx.frame) * 0.9 -
							size / 2,
					),
				),
		);
	});

	const stage = full({
		id: "finale-stage",
		children: [
			full({ background: Gradient.radial([WHITE, FROST]) }),
			blend(
				Layer.vfx({
					id: "finale-aurora",
					effectType: "Aurora",
					width: W,
					height: H,
					colorStart: SKY,
					colorEnd: SIGNAL,
					density: 0.65,
					speed: 1.4,
					intensity: 0.7,
				}),
				"multiply",
			).animate(keys("opacity", [[0, 0.3]])),
			vortex,
			// A white halo keeps the lockup clean over the vortex.
			Layer.shape("ellipse", {
				id: "finale-halo",
				position: "absolute",
				x: CX - 760,
				y: CY - 360,
				width: 1520,
				height: 820,
				fillColor: Gradient.radial([
					Color.alpha(WHITE, 0.95),
					Color.alpha(WHITE, 0),
				]),
			}),
			...fireworks,
			...orbit,
			// The brand lockup (assets/brand/logo-wordmark-light.svg): mark and name.
			Layer.box({
				id: "finale-lockup",
				position: "absolute",
				x: CX - 1060 / 2,
				y: CY - 210 / 2 - 40,
				width: 1060,
				height: 210,
				children: [
					Layer.svg(WORDMARK, {
						id: "finale-wordmark",
						position: "absolute",
						x: 0,
						y: 0,
						width: 1060,
						height: 210,
						fit: "contain",
					})
						.withEffect(
							new LayerStyle({
								outerGlow: {
									enabled: true,
									color: SKY,
									opacity: 0.6,
									size: 40,
									spread: 0,
								},
							}),
						)
						.animate(popIn(4, 22, 0.3)),
				],
			}).animate(
				LayerAnimation.create().signal("scale", kick, {
					multiplier: 0.03,
					offset: 1,
				}),
				keys("rotation", [
					[hit - 1, 0],
					[hit, -3],
					[hit + 20, 0, "elastic.out(1, 0.4)"],
				]),
			),
			Layer.box({
				id: "finale-install",
				position: "absolute",
				x: CX - 250,
				y: CY + 150,
				width: 500,
				height: 74,
				borderRadius: 37,
				background: WHITE,
				borderColor: LINE,
				borderWidth: 1.5,
				children: [
					Layer.text("$ npm i framefields", {
						id: "finale-install-text",
						position: "absolute",
						x: 0,
						y: 18,
						width: 500,
						align: "center",
						fontFamily: MONO,
						fontSize: 30,
						fill: COBALT,
					}).animate(LayerAnimation.create().typewriter(40, 64, "linear")),
				],
			}).animate(popIn(34, 16, 0.6)),
			Layer.text(
				"Emoji: Noto Animated Emoji (CC BY 4.0) · Fluent Emoji (MIT) · Twemoji (CC BY 4.0)  ·  Lottie: Airbnb samples, LottieFiles  ·  Icons: Lucide  ·  Score: synthesized",
				{
					id: "finale-credits",
					position: "absolute",
					x: 60,
					y: H - 70,
					width: W - 120,
					align: "center",
					fontFamily: MONO,
					fontSize: 15,
					fill: MUTED,
				},
			).animate(
				keys("opacity", [
					[0, 0],
					[BAR, 0],
					[BAR + 20, 1],
				]),
			),
			full({
				id: "finale-hit",
				background: SKY,
				opacity: 0,
				blendMode: "multiply",
			}).animate(
				keys("opacity", [
					[hit - 1, 0],
					[hit, 0.5],
					[hit + 12, 0, "power2.out"],
				]),
			),
		],
	}).animate(
		// The power-off: the picture folds to a line, then to a dot.
		keys("scaleY", [
			[off, 1],
			[off + 7, 0.004, "power3.in"],
		]),
		keys("scaleX", [
			[off + 7, 1],
			[off + 13, 0, "power3.in"],
		]),
	);

	return scene("finale", NIGHT, [
		stage,
		Layer.shape("ellipse", {
			id: "finale-dot",
			position: "absolute",
			x: CX - 30,
			y: H / 2 - 3,
			width: 60,
			height: 6,
			fillColor: "#ffffff",
			opacity: 0,
		}).animate(
			keys("opacity", [
				[off + 6, 0],
				[off + 8, 1],
				[off + 20, 0, "power2.out"],
			]),
			keys("scaleX", [
				[off + 8, 1],
				[off + 16, 0.05, "power2.in"],
			]),
		),
		full({ id: "finale-end", background: NIGHT, opacity: 0 }).animate(
			keys("opacity", [
				[off + 14, 0],
				[off + 15, 1],
			]),
		),
	]);
}
