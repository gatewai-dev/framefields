/**
 * 03 — Emoji + physics. Thirty Noto animated emoji (each a Lottie, still playing) rain onto three
 * tilted glass bars and pile up on the floor in a Rapier world. The loudest hit each frame shakes
 * the stage.
 */
import {
	Color,
	Gradient,
	Layer,
	LayerAnimation,
	LayerStyle,
	Physics,
} from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import type { NotoName } from "../manifest.js";
import { emoji } from "../paths.js";
import {
	BEAT,
	BG,
	COBALT,
	DISPLAY,
	FG,
	FPS,
	FROST,
	H,
	MONO,
	MUTED,
	SIGNAL,
	SKY,
	W,
	WHITE,
} from "../theme.js";
import { chapter } from "../timeline.js";

const RAIN: NotoName[] = [
	"rocket",
	"heartEyes",
	"fire",
	"starStruck",
	"party",
	"mindBlown",
	"unicorn",
	"robot",
	"rainbow",
	"cool",
	"partying",
	"alien",
	"heart",
	"zap",
	"gem",
	"brain",
	"globe",
	"popcorn",
	"rofl",
	"inLove",
	"octopus",
	"catHeart",
	"trophy",
	"crystalBall",
	"eyes",
	"clap",
	"thumbsUp",
	"glowingStar",
	"volcano",
	"melting",
];

function rng(seed: number) {
	let s = seed;
	return () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 4294967296;
	};
}

export async function emojiScene(): Promise<Node> {
	const c = chapter("emoji");
	const world = await Physics.world2d({
		fps: FPS,
		frames: c.frames + 30,
		startFrame: c.start,
		gravity: 2600,
		substeps: 6,
	});
	const floor = H - 24;
	world.walls({ width: W, height: floor, restitution: 0.25 });

	const bars: Node[] = [
		{ x: 60, y: 600, w: 520, r: 15 },
		{ x: 1340, y: 600, w: 520, r: -15 },
		{ x: 760, y: 470, w: 400, r: 0 },
	].map((b, i) => {
		const bar = Layer.box({
			id: `emoji-bar-${i}`,
			position: "absolute",
			x: b.x,
			y: b.y,
			width: b.w,
			height: 34,
			rotation: b.r,
			borderRadius: 17,
			background: Gradient.linear([SKY, SIGNAL, COBALT], 90),
			borderColor: Color.alpha("#ffffff", 0.6),
			borderWidth: 1.5,
		}).withEffect(
			new LayerStyle({
				outerGlow: {
					enabled: true,
					color: SKY,
					opacity: 0.5,
					size: 22,
					spread: 0,
				},
			}),
		);
		world.body(bar, { type: "fixed", restitution: 0.5, friction: 0.3 });
		return bar.animate(
			keys("scaleX", [
				[0, 0],
				[6 + i * 4, 0],
				[22 + i * 4, 1, "expo.out"],
			]),
		);
	});

	const rand = rng(29);
	const drops = RAIN.map((name, i) => {
		const size = Math.round(118 + rand() * 60);
		const layer = Layer.lottie(emoji(name), {
			id: `emoji-drop-${name}`,
			position: "absolute",
			x: Math.round(120 + rand() * (W - 240 - size)),
			y: -size - 40 - Math.round(rand() * 140),
			width: size,
			height: size,
			rotation: Math.round(rand() * 60 - 30),
		});
		world.body(layer, {
			shape: "circle",
			restitution: 0.42,
			friction: 0.35,
			density: 0.8,
			angularVelocity: rand() * 240 - 120,
			startFrame: 8 + Math.round((i * (BEAT * 7)) / RAIN.length),
		});
		return layer;
	});
	world.simulate();

	return scene("emoji", BG, [
		full({ background: Gradient.linear([WHITE, FROST], 180) }),
		full({
			background: Gradient.radial([Color.alpha(SKY, 0.35), "transparent"]),
		}),
		// The stage shakes with the loudest impact.
		full({
			id: "emoji-stage",
			children: [...bars, ...drops],
		}).animate(
			LayerAnimation.create().signal("y", world.impact, {
				multiplier: 9,
				offset: 0,
				smoothing: 1,
			}),
		),
		full({
			id: "emoji-flash",
			background: SKY,
			opacity: 0,
			blendMode: "multiply",
		}).animate(
			LayerAnimation.create().signal("opacity", world.impact, {
				multiplier: 0.12,
			}),
		),
		Layer.text(
			[
				{ text: "Animated emoji\n" },
				{ text: "with real physics", fill: COBALT },
			] as never,
			{
				id: "emoji-title",
				zIndex: 20,
				position: "absolute",
				x: 110,
				y: 96,
				width: 1300,
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 84,
				lineHeight: 92,
				letterSpacing: -2.5,
				fill: FG,
			},
		).animate(
			keys("opacity", [
				[0, 0],
				[8, 1],
			]),
			keys("y", [
				[0, 130],
				[22, 96, "expo.out"],
			]),
		),
		Layer.text(
			"Noto Animated Emoji as Lottie  ·  Physics.world2d  ·  body.impact → camera shake",
			{
				id: "emoji-sub",
				zIndex: 20,
				position: "absolute",
				x: 112,
				y: 300,
				fontFamily: MONO,
				fontSize: 21,
				fill: MUTED,
			},
		).animate(
			keys("opacity", [
				[0, 0],
				[16, 0],
				[30, 1],
			]),
		),
		hud("emoji", [
			"Physics.world2d",
			"world.body(lottie, { shape: circle })",
			"world.impact → shake",
		]),
	]);
}
