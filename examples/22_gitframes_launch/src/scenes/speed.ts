/**
 * "A hundred twenty frames a second, watch it move." Three stacks of cubes
 * build on sixteenths while the camera orbits; the winner's number counts to
 * the sung figure, and on "move" the camera whips round and rushes it.
 */
import { CameraAnimation, Layer, Layer3D, LayerAnimation } from "gitframes";
import { BEAT, bar } from "../grid.js";
import { kickPulse } from "../hits.js";
import { lineWords, sung } from "../lyrics.js";
import {
	ACCENT,
	ACCENT_DEEP,
	BG,
	DISPLAY,
	EASE_IN,
	FG,
	GRID,
	H,
	keys,
	MONO,
	MUTED,
	plane,
	SNAP,
	SURFACE,
	scene,
	sungLine,
	W,
} from "../theme.js";
import { CH } from "../timeline.js";
import { NOT_TO } from "./not.js";

const CX = W / 2;
const CY = H / 2;
const CUBE = 64;
const GAP = 8;
const FLOOR = CY + 380;

interface Stack {
	name: string;
	fps: number;
	blocks: number;
	hero: boolean;
	x: number;
}

const STACKS: Stack[] = [
	{ name: "HEADLESS CHROMIUM", fps: 12, blocks: 1, hero: false, x: CX - 520 },
	{ name: "GITFRAMES", fps: 120, blocks: 10, hero: true, x: CX },
	{ name: "CANVAS 2D", fps: 30, blocks: 3, hero: false, x: CX + 520 },
];

const top = (s: Stack) => FLOOR - s.blocks * (CUBE + GAP);

function cubes(s: Stack, popFrom: number) {
	return Array.from({ length: s.blocks }, (_, i) => {
		const at = popFrom + i * (BEAT / 4);
		const face = s.hero ? ACCENT : SURFACE;
		const side = s.hero ? ACCENT_DEEP : MUTED;
		return Layer3D.cube({
			id: `speed-${s.fps}-${i}`,
			size: CUBE,
			x: s.x,
			y: FLOOR - CUBE / 2 - i * (CUBE + GAP),
			z: 0,
			faces: {
				front: face,
				back: face,
				left: side,
				right: side,
				top: BG,
				bottom: side,
			},
		}).animate(
			keys("scale", [
				[0, 0],
				[at, 0],
				[at + 8, 1, SNAP],
			]),
		);
	});
}

/** A number standing in 3D above its stack, shown over [from, to) of the scene. */
function figure(id: string, s: Stack, text: string, from: number, to?: number) {
	return Layer.text(text, {
		id,
		is3D: true,
		position: "absolute",
		x: s.x - 300,
		y: top(s) - 180,
		z: 0,
		width: 600,
		height: 160,
		fontFamily: DISPLAY,
		fontWeight: 900,
		fontSize: s.hero ? 150 : 90,
		fill: s.hero ? ACCENT : FG,
		align: "center",
		verticalAlign: "middle",
		startFrame: from,
		durationFrames: to === undefined ? undefined : to - from,
	} as never).animate(
		keys("scale", [
			[0, 1.25],
			[10, 1, "expo.out"],
		]),
	);
}

function caption(
	id: string,
	text: string,
	s: Stack,
	y: number,
	size: number,
	at: number,
) {
	return Layer.text(text, {
		id,
		is3D: true,
		position: "absolute",
		x: s.x - 400,
		y,
		z: -80,
		width: 800,
		fontFamily: MONO,
		fontWeight: 600,
		fontSize: size,
		letterSpacing: size * 0.25,
		fill: FG,
		align: "center",
	} as never).animate(
		keys("opacity", [
			[0, 0],
			[at - 1, 0],
			[at, 1, "none"],
		]),
	);
}

export function speedScene() {
	const from = NOT_TO;
	const to = bar(CH.tools);
	const len = to - from;
	const local = (word: string) => sung(word, from).at - from;
	const move = local("move");
	const cam = CameraAnimation.camera()
		.orbit({
			azimuth: { from: 42, to: -18 },
			elevation: { from: 6, to: 14 },
			radius: { from: 1650, to: 1500 },
			start: 0,
			end: move,
			ease: "sine.inOut",
		})
		// "watch it move": the whip, then a slow orbit, then the rush onto the winner.
		.orbit({
			azimuth: { from: -18, to: -70 },
			elevation: { from: 14, to: 24 },
			radius: { from: 1500, to: 1400 },
			start: move + 1,
			end: move + 30,
			ease: "expo.out",
		})
		.orbit({
			azimuth: { from: -70, to: -40 },
			elevation: { from: 24, to: 18 },
			radius: { from: 1400, to: 1350 },
			start: move + 31,
			end: len - 40,
			ease: "sine.inOut",
		})
		.orbit({
			azimuth: { from: -40, to: 0 },
			elevation: { from: 18, to: 2 },
			radius: { from: 1350, to: 380 },
			start: len - 39,
			end: len,
			ease: EASE_IN,
		});
	keys(
		"targetY",
		[
			[0, CY],
			[len - 40, CY],
			[len, top(STACKS[1]) - 100, EASE_IN],
		],
		cam,
	);

	const hero = STACKS[1];
	const popFrom = local("a");
	return scene("speed", from, to, [
		Layer.camera({
			id: "speed-cam",
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: cam,
		} as never),
		Layer.directionalLight({
			id: "speed-key",
			color: "#FFFFFF",
			intensity: 1,
			direction: [-0.5, 0.7, 0.8],
		} as never),
		Layer.ambientLight({
			id: "speed-fill",
			color: "#FFFFFF",
			intensity: 0.6,
		} as never),
		Layer3D.grid({
			id: "speed-floor",
			width: 6000,
			height: 6000,
			divisions: 40,
			lineWidth: 3,
			color: GRID,
			x: CX,
			y: FLOOR,
			z: 0,
		}),
		...STACKS.flatMap((s) => cubes(s, popFrom)),
		// The figure counts with the voice: "a hundred" … "twenty".
		figure("speed-num-100", hero, "100", local("hundred"), local("twenty")),
		figure("speed-num-120", hero, "120", local("twenty")),
		figure("speed-num-12", STACKS[0], "12", local("twenty")),
		figure("speed-num-30", STACKS[2], "30", local("twenty")),
		sungLine({
			id: "speed-unit",
			words: [
				sung("frames", from),
				sung("a", sung("frames", from).at),
				sung("second", from),
			],
			from,
			x: hero.x - 500,
			width: 1000,
			y: top(hero) - 50,
			size: 34,
			font: MONO,
			weight: 600,
			z: -80,
		}),
		// "every pixel rendered true": standing tall behind the stacks.
		sungLine({
			id: "speed-true",
			words: lineWords(sung("pixel", from).line),
			from,
			x: CX - 1200,
			width: 2400,
			y: CY - 610,
			size: 130,
			color: ACCENT,
			z: 1200,
			outAt: local("watch") - 4,
		}),
		...STACKS.map((s) =>
			caption(`speed-name-${s.fps}`, s.name, s, FLOOR + 40, 24, popFrom + BEAT),
		),
		// The kick lights the room: one reactive accent.
		plane("speed-pulse", ACCENT, "multiply").animate(
			LayerAnimation.create().signal("opacity", kickPulse(), {
				multiplier: 0.06,
				offset: 0,
			}),
		),
	]);
}
