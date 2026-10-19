/**
 * 09 — 3D. An orbiting camera over a physically shaded scene: the name extruded in brushed
 * metal, a chrome and a glass sphere, a cube whose faces are Lottie animations, a carousel of
 * Lottie cards turning round it all, and emissive orbs that bloom on every kick.
 */
import {
	CameraAnimation,
	Color,
	Gradient,
	Layer,
	Layer3D,
	LayerAnimation,
	Lighting,
} from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import { kick } from "../music.js";
import { lottie } from "../paths.js";
import {
	CYAN,
	DISPLAY,
	EMBER,
	GOLD,
	H,
	LIME,
	PINK,
	VIOLET,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

const CX = W / 2;
const CY = H / 2;

function card(name: string, bg: string, size = 300): Node {
	return Layer.box({
		id: `space-card-${name}`,
		width: size,
		height: size * 0.72,
		borderRadius: 24,
		background: bg,
		overflow: "hidden",
		children: [
			Layer.lottie(lottie(name), {
				position: "absolute",
				x: 0,
				y: 0,
				width: size,
				height: size * 0.72,
				fit: "cover",
			}),
		],
	});
}

export function spaceScene(): Node {
	const c = chapter("space");
	// Keys must end inside the clip: a 3D track that runs past it does not play at all.
	const len = c.frames;
	const cam = CameraAnimation.camera().orbit({
		azimuth: { from: -34, to: 24 },
		elevation: { from: 18, to: 6 },
		radius: { from: 2400, to: 1750 },
		start: 0,
		end: len,
		ease: "sine.inOut",
	});

	const orbs = [EMBER, GOLD, LIME, CYAN, VIOLET, PINK].map((color, i) => {
		const a = (i / 6) * Math.PI * 2;
		return Layer3D.sphere({
			id: `space-orb-${i}`,
			radius: 34,
			x: CX + Math.cos(a) * 620,
			y: CY + 250 + Math.sin(a) * 60,
			z: Math.sin(a) * 420,
			color: "#111111",
			emissive: color,
			emissiveIntensity: 4,
		}).animate(
			LayerAnimation.create().signal("emissiveIntensity", kick, {
				multiplier: 6,
				offset: 3,
			}),
		);
	});

	const world = full({
		id: "space-world",
		transformStyle: "preserve-3d",
		children: [
			Layer3D.extrudedText({
				id: "space-name",
				text: "framefields",
				fontFamily: DISPLAY,
				fontWeight: 800,
				fontSize: 200,
				depth: 70,
				x: CX,
				y: CY - 40,
				z: 0,
				fill: "#FFE3B8",
				metallic: 0.35,
				roughness: 0.3,
			}),
			Layer3D.sphere({
				id: "space-chrome",
				radius: 120,
				x: CX - 760,
				y: CY - 230,
				z: 260,
				color: "#f2f2f2",
				metallic: 1,
				roughness: 0.08,
			}),
			Layer3D.sphere({
				id: "space-glass",
				radius: 130,
				x: CX + 740,
				y: CY - 250,
				z: 180,
				color: "#cfe8ff",
				material: "glass",
				roughness: 0.02,
			}),
			Layer.cube({
				id: "space-cube",
				size: 200,
				x: CX,
				y: CY - 330,
				z: -320,
				faces: {
					front: card("dogCar", "#4FC3C9", 230),
					back: card("gatin", "#1D6EAF", 230),
					left: card("growth", "#E9E4F7", 230),
					right: card("fireworks", "#120E24", 230),
					top: card("squares", "#2A2A2A", 230),
					bottom: card("happy2016", "#030B26", 230),
				},
			} as never).animate(
				keys("rotateY", [
					[0, -30],
					[len, 250, "none"],
				]),
				keys("rotateX", [
					[0, -20],
					[len, 40, "sine.inOut"],
				]),
			),
			Layer.carousel3d({
				id: "space-carousel",
				radius: 1050,
				x: CX,
				y: CY - 20,
				z: 0,
				itemWidth: 300,
				itemHeight: 216,
				twoSided: true,
				items: [
					card("boat", "#ffffff"),
					card("cactus", "#F4EFE6"),
					card("navidad", "#FFC7D9"),
					card("bodymovin", "#2A1458"),
					card("gradientStrokes", "#120E24"),
					card("pinJump", "#F4EFE6"),
					card("iconTransitions", "#0E1A2A"),
					card("adrock", "#3A1020"),
				],
			} as never).animate(
				keys("rotateY", [
					[0, 0],
					[len, -70, "none"],
				]),
			),
			...orbs,
		],
	});

	return scene("space", "#05040A", [
		full({
			background: Gradient.radial([Color.alpha(VIOLET, 0.35), "#05040A"]),
		}),
		Layer.particles({
			id: "space-stars",
			width: W,
			height: H,
			max: 1500,
			seed: 5,
			emitter: { shape: "rect", x: 0, y: 0, width: W, height: H, rate: 120 },
			lifetime: [6, 10],
			speed: [2, 12],
			spread: 360,
			size: [3, 1],
			sizeJitter: 0.8,
			fade: [0.3, 0.3],
			shape: "soft",
			blend: "add",
			color: ["#ffffff", "#b9c7ff"],
			prewarm: 8,
		} as never),
		Layer.camera({
			id: "space-cam",
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: cam,
		} as never),
		...(Lighting.dramatic({
			target: [CX, CY, 0],
			bloom: true,
			exposure: 0.2,
		} as never) as Node[]),
		world,
		hud("space", [
			"CameraAnimation.orbit",
			"Lighting.dramatic + bloom",
			"Layer3D.extrudedText",
			"material: glass",
			"Layer.cube(faces: Lottie)",
			"carousel3d",
		]),
	]);
}
