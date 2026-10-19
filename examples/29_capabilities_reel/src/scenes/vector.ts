/**
 * 04 — SVG + shapes. On paper: ten Lucide icons draw themselves on stroke by stroke (`trimEnd`),
 * while a single path shape morphs blob → star → heart → blob on the beat with a gradient fill,
 * ringed by Fluent Emoji color SVGs orbiting it.
 */
import { Color, Gradient, Layer, LayerAnimation, Signal } from "framefields";
import {
	blobPath,
	circleD,
	heartPath,
	hud,
	type Key,
	keys,
	type Node,
	popIn,
	scalePath,
	scene,
	starPath,
	svgToPath,
} from "../kit.js";
import type { FluentName } from "../manifest.js";
import { kick } from "../music.js";
import { fluent, lucide } from "../paths.js";
import {
	BEAT,
	CYAN,
	DISPLAY,
	EMBER,
	GOLD,
	INK,
	MONO,
	PAPER,
	PINK,
	VIOLET,
} from "../theme.js";
import { chapter } from "../timeline.js";

const ICONS = [
	"clapperboard",
	"wand-sparkles",
	"layers",
	"cpu",
	"palette",
	"music",
	"box",
	"aperture",
	"orbit",
	"rocket",
];
const ORBIT: FluentName[] = [
	"rocket",
	"sparkles",
	"heart",
	"unicorn",
	"crystalBall",
	"gem",
	"rainbow",
	"party",
];

const MORPH = 560;
const MX = 1200;
const MY = 250;

export function vectorScene(): Node {
	const c = chapter("vector");
	const scale = 5.4;
	const cell = 24 * scale;
	const icons = ICONS.map((name, i) => {
		const col = i % 5;
		const row = Math.floor(i / 5);
		const at = 8 + i * 6;
		const cx = 150 + col * 180 + cell / 2;
		const cy = 420 + row * 200 + cell / 2;
		return Layer.shape("path", {
			id: `vector-icon-${name}`,
			position: "absolute",
			// The 24-unit Lucide geometry scaled up, drawn at full size (not an enlarged 24 px raster).
			x: cx - cell / 2,
			y: cy - cell / 2,
			width: cell,
			height: cell,
			d: scalePath(svgToPath(lucide(name)), scale),
			fillType: "none",
			fillColor: "transparent",
			strokeColor: INK,
			strokeWidth: 1.6 * scale,
			strokeLineCap: "round",
			strokeLineJoin: "round",
		}).animate(
			keys("trimEnd", [
				[0, 0],
				[at, 0],
				[at + 34, 1, "power2.inOut"],
			]),
			keys("strokeColor", [
				[at + 34, INK],
				[at + 44, [EMBER, VIOLET, CYAN, PINK, GOLD][i % 5], "power2.out"],
			]),
		);
	});

	const shapes = [
		blobPath(MORPH, 0.5),
		starPath(MORPH, 5, 0.5),
		heartPath(MORPH),
		blobPath(MORPH, 2.4, 0.16),
		circleD(MORPH),
		starPath(MORPH, 8, 0.7),
	];
	const morphKeys: Key[] = shapes.map((d, i) =>
		i === 0 ? [0, d] : [14 + i * BEAT * 2, d, "expo.inOut"],
	);

	const centre = { x: MX + MORPH / 2, y: MY + MORPH / 2 };
	const orbit = ORBIT.map((name, i) => {
		const size = 124;
		const phase = (i / ORBIT.length) * Math.PI * 2;
		const angle = (frame: number) =>
			phase + ((frame - c.start) / c.frames) * Math.PI * 0.9;
		return Layer.box({
			id: `vector-orbit-${name}`,
			position: "absolute",
			x: 0,
			y: 0,
			width: size,
			height: size,
			children: [
				Layer.svg(fluent(name), {
					id: `vector-svg-${name}`,
					position: "absolute",
					x: 0,
					y: 0,
					width: size,
					height: size,
				}).animate(popIn(20 + i * 7, 18, 0)),
			],
		}).animate(
			LayerAnimation.create()
				.signal(
					"x",
					Signal.programmatic(
						(ctx) => centre.x + Math.cos(angle(ctx.frame)) * 400 - size / 2,
					),
				)
				.signal(
					"y",
					Signal.programmatic(
						(ctx) => centre.y + Math.sin(angle(ctx.frame)) * 290 - size / 2,
					),
				),
		);
	});

	return scene("vector", PAPER, [
		Layer.text("SVG, shapes", {
			id: "vector-title",
			position: "absolute",
			x: 150,
			y: 108,
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 104,
			letterSpacing: -3,
			fill: INK,
		}).animate(
			keys("opacity", [
				[0, 0],
				[8, 1],
			]),
			keys("y", [
				[0, 140],
				[24, 108, "expo.out"],
			]),
		),
		Layer.text("& morphing", {
			id: "vector-title-2",
			position: "absolute",
			x: 150,
			y: 222,
			fontFamily: DISPLAY,
			fontWeight: 800,
			fontSize: 104,
			letterSpacing: -3,
			fill: VIOLET,
		}).animate(
			keys("opacity", [
				[0, 0],
				[14, 0],
				[22, 1],
			]),
			keys("y", [
				[0, 260],
				[36, 222, "expo.out"],
			]),
		),
		Layer.text("Lucide icons → path d, drawn on with trimEnd", {
			id: "vector-sub",
			position: "absolute",
			x: 152,
			y: 840,
			fontFamily: MONO,
			fontSize: 21,
			fill: Color.alpha(INK, 0.6),
		}).animate(
			keys("opacity", [
				[0, 0],
				[40, 0],
				[54, 1],
			]),
		),
		...icons,
		// The morphing hero shape, squashing on the kick.
		Layer.box({
			id: "vector-morph-wrap",
			position: "absolute",
			x: MX,
			y: MY,
			width: MORPH,
			height: MORPH,
			children: [
				Layer.shape("path", {
					id: "vector-morph",
					position: "absolute",
					x: 0,
					y: 0,
					width: MORPH,
					height: MORPH,
					d: shapes[0],
					fillColor: Gradient.linear([EMBER, PINK, VIOLET, CYAN], 135),
					strokeWidth: 0,
				}).animate(
					LayerAnimation.keys("d", morphKeys as never),
					keys("rotation", [
						[0, -8],
						[c.frames, 14, "none"],
					]),
					popIn(4, 22, 0.2),
				),
			],
		}).animate(
			LayerAnimation.create().signal("scaleY", kick, {
				multiplier: 0.05,
				offset: 1,
			}),
		),
		...orbit,
		hud(
			"vector",
			[
				"Layer.svg",
				"Layer.shape(path)",
				"trimEnd",
				"d keyframes → morph",
				"Gradient.linear",
			],
			{ dark: true },
		),
	]);
}
