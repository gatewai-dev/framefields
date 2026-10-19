/**
 * 11 — Finale. A GPU particle vortex that surges on every kick, Lottie fireworks going off round
 * the frame, every emoji SVG orbiting the framefields mark, the name and the install line — then
 * the last hit and an old-TV power-off to black. The asset credits sit along the bottom.
 */
import {
	Color,
	FontManager,
	Gradient,
	Layer,
	LayerAnimation,
	LayerStyle,
	Signal,
} from "framefields";
import { blend, full, keys, type Node, popIn, scene } from "../kit.js";
import { FLUENT, TWEMOJI } from "../manifest.js";
import { kick, kickAt } from "../music.js";
import { fluent, LOGO, lottie, twemoji } from "../paths.js";
import { still } from "../precomp.js";
import {
	BAR,
	BEAT,
	CYAN,
	DISPLAY,
	GOLD,
	H,
	INK,
	MONO,
	MUTED,
	PAPER,
	PINK,
	VIOLET,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

const CX = W / 2;
const CY = 470;

export async function finaleScene(): Promise<Node> {
	const c = chapter("finale");
	const hit = BAR * 3; // the last downbeat
	const off = hit + BEAT * 2; // power-off

	const NAME = {
		fontFamily: DISPLAY,
		fontWeight: 800,
		fontSize: 128,
		letterSpacing: -3,
	};
	const nw = Math.ceil(FontManager.measure("framefields", NAME).width + 60);
	const nameGlow = await still("finale-name", nw, 190, [
		Layer.text("framefields", {
			position: "absolute",
			x: 0,
			y: 0,
			width: nw,
			height: 190,
			...NAME,
			fill: PAPER,
			align: "center",
		}),
	]);

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
		blend: "add",
		color: [CYAN, VIOLET, PINK],
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
			}),
			"screen",
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

	const logo = 230;
	const stage = full({
		id: "finale-stage",
		children: [
			full({ background: Gradient.radial([Color.alpha(VIOLET, 0.4), INK]) }),
			blend(
				Layer.vfx({
					id: "finale-aurora",
					effectType: "Aurora",
					width: W,
					height: H,
					colorStart: VIOLET,
					colorEnd: CYAN,
					density: 0.65,
					speed: 1.4,
					intensity: 0.7,
				}),
				"screen",
			),
			vortex,
			// A dark halo keeps the mark and the name readable over the vortex.
			Layer.shape("ellipse", {
				id: "finale-halo",
				position: "absolute",
				x: CX - 700,
				y: CY - 380,
				width: 1400,
				height: 860,
				fillColor: Gradient.radial([
					Color.alpha(INK, 0.85),
					Color.alpha(INK, 0),
				]),
			}),
			...fireworks,
			...orbit,
			Layer.box({
				id: "finale-mark",
				position: "absolute",
				x: CX - logo / 2,
				y: CY - logo / 2 - 120,
				width: logo,
				height: logo,
				children: [
					Layer.image(LOGO, {
						id: "finale-logo",
						position: "absolute",
						x: 0,
						y: 0,
						width: logo,
						height: logo,
						fit: "contain",
					})
						.withEffect(
							new LayerStyle({
								outerGlow: {
									enabled: true,
									color: CYAN,
									opacity: 0.8,
									size: 50,
									spread: 0,
								},
							}),
						)
						.animate(popIn(4, 22, 0)),
				],
			}).animate(
				LayerAnimation.create().signal("scale", kick, {
					multiplier: 0.06,
					offset: 1,
				}),
				keys("rotation", [
					[hit - 1, 0],
					[hit, -6],
					[hit + 20, 0, "elastic.out(1, 0.4)"],
				]),
			),
			Layer.box({
				id: "finale-name",
				position: "absolute",
				x: CX - nw / 2,
				y: CY + 30,
				width: nw,
				height: 190,
				children: [
					Layer.image(nameGlow, {
						id: "finale-name-img",
						position: "absolute",
						x: 0,
						y: 0,
						width: nw,
						height: 190,
					}).withEffect(
						new LayerStyle({
							outerGlow: {
								enabled: true,
								color: PINK,
								opacity: 0.55,
								size: 40,
								spread: 0,
							},
						}),
					),
				],
			}).animate(
				keys("opacity", [
					[0, 0],
					[16, 0],
					[24, 1],
				]),
				keys("y", [
					[16, CY + 90],
					[36, CY + 30, "expo.out"],
				]),
			),
			Layer.box({
				id: "finale-install",
				position: "absolute",
				x: CX - 250,
				y: CY + 240,
				width: 500,
				height: 74,
				borderRadius: 37,
				background: Color.alpha("#ffffff", 0.08),
				borderColor: Color.alpha("#ffffff", 0.25),
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
						fill: GOLD,
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
			full({ id: "finale-hit", background: PAPER, opacity: 0 }).animate(
				keys("opacity", [
					[hit - 1, 0],
					[hit, 0.9],
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

	return scene("finale", "#000000", [
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
		full({ id: "finale-end", background: "#000000", opacity: 0 }).animate(
			keys("opacity", [
				[off + 14, 0],
				[off + 15, 1],
			]),
		),
	]);
}
