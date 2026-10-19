/**
 * 07 — Vision, on the drop. The dancer clip, analysed on device as it renders: a giant word sits
 * behind her (a matte cutout of the same clip is layered above it), embers part around her
 * silhouette, and animated sparkle emoji ride her tracked wrists.
 */
import fs from "node:fs";
import {
	Color,
	type Composition,
	Layer,
	LayerAnimation,
	Signal,
} from "framefields";
import { full, hud, keys, type Node, scene } from "../kit.js";
import { DANCER, emoji } from "../paths.js";
import {
	COBALT,
	DISPLAY,
	EMBER,
	GOLD,
	H,
	MONO,
	NAVY,
	PAPER,
	W,
} from "../theme.js";
import { chapter } from "../timeline.js";

export async function visionScene(comp: Composition): Promise<Node> {
	const c = chapter("vision");
	if (!fs.existsSync(DANCER))
		throw new Error(
			`Missing ${DANCER}. Run \`pnpm assets\` in examples/19_framefields_film.`,
		);
	// The clip starts on this chapter's downbeat; vision results use the composition clock.
	const dancer = comp.vision(DANCER, { startFrame: c.start });
	const person = dancer.person.place({ width: W, height: H, fit: "cover" });

	const video = (id: string, muted: boolean) =>
		Layer.video(DANCER, {
			id,
			position: "absolute",
			x: 0,
			y: 0,
			width: W,
			height: H,
			fit: "cover",
			muted,
		});

	const embers = Layer.particles({
		id: "vision-embers",
		width: W,
		height: H,
		max: 14000,
		seed: 21,
		emitter: { shape: "rect", x: 0, y: 360, width: W, height: 640, rate: 2600 },
		lifetime: [3, 5],
		speed: [0, 30],
		drag: 2.2,
		gravity: -8,
		noise: { strength: 220, scale: 160, speed: 0.3 },
		push: { person, strength: 9000, sweep: 120000 },
		floor: 1010,
		bounce: 0.1,
		size: [10, 6],
		sizeJitter: 0.6,
		fade: [0.15, 0.3],
		color: [NAVY, EMBER, GOLD, "#DBEAFE"],
		colorBySpeed: 500,
		prewarm: 3,
	} as never);

	// Sparkles riding each wrist (pose keypoints, read as the frame renders).
	const sparkle = (side: "left" | "right") => {
		const size = 150;
		const at = (frame: number) => person.point(`${side}Wrist`, frame);
		return Layer.lottie(emoji(side === "left" ? "sparkles" : "glowingStar"), {
			id: `vision-${side}-sparkle`,
			position: "absolute",
			x: 0,
			y: 0,
			width: size,
			height: size,
		}).animate(
			LayerAnimation.create()
				.signal(
					"x",
					Signal.programmatic((ctx) => at(ctx.frame).x - size / 2),
				)
				.signal(
					"y",
					Signal.programmatic((ctx) => at(ctx.frame).y - size / 2),
				),
			keys("opacity", [
				[0, 0],
				[6, 0],
				[14, 1],
			]),
		);
	};

	return scene("vision", "#E9D3B4", [
		video("vision-plate", true),
		// The word behind her.
		Layer.text("VISION", {
			id: "vision-word",
			position: "absolute",
			x: 0,
			y: 210,
			width: W,
			align: "center",
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 360,
			letterSpacing: -14,
			fill: Color.alpha(COBALT, 0.94),
		}).animate(
			keys("scale", [
				[0, 1.3],
				[20, 1, "expo.out"],
			]),
			keys("opacity", [
				[0, 0],
				[4, 1],
			]),
		),
		embers,
		video("vision-cutout", true).withVision({ mode: "matte" }),
		sparkle("left"),
		sparkle("right"),
		Layer.text(
			"comp.vision(clip) · person.place() · withVision({ mode: matte }) · particles push: { person }",
			{
				id: "vision-caption",
				position: "absolute",
				x: 80,
				y: 70,
				fontFamily: MONO,
				fontSize: 20,
				fill: Color.alpha(NAVY, 0.8),
			},
		).animate(
			keys("opacity", [
				[0, 0],
				[16, 0],
				[28, 1],
			]),
		),
		full({ id: "vision-flash", background: PAPER, opacity: 0 }).animate(
			keys("opacity", [
				[0, 0.9],
				[10, 0, "power2.out"],
			]),
		),
		hud(
			"vision",
			[
				"on-device pose + segmentation",
				"matte cutout",
				"pose-tracked Lotties",
				"particles pushed by silhouette",
			],
			{ dark: true },
		),
	]);
}
