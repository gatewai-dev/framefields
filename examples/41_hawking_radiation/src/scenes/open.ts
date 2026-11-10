/**
 * The black hole, seen whole: a slow push in and around it while the
 * narrator says what it is, then the first hint of the glow Hawking found.
 */
import type { LayoutNode } from "framefields";
import { type Key, valueAt } from "../motion.js";
import { BLACK_HOLE_UNIFORMS } from "../shaders/blackhole.js";
import { H, INK, INK_SOFT, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { label, leader, line } from "../type.js";
import { blackHole, sceneRoot } from "./shell.js";

export function openScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const hole = lineIn(t, "hole");
	const hawking = lineIn(t, "hawking");
	const horizon = wordIn(t, "hole", "horizon");
	const glows = wordIn(t, "hawking", "glow").start;
	const evaporates = wordIn(t, "hawking", "evaporate").start;

	const camDist: Key[] = [
		[0, 56],
		[end, 23, "out"],
	];
	// Where the shadow's edge is while its label is up.
	const shadow =
		(BLACK_HOLE_UNIFORMS.focal * 2.6 * H) /
		valueAt(camDist, horizon.start + sec(1));
	const tip: [number, number] = [W / 2 + shadow * 0.74, H / 2 - shadow * 0.58];
	const named = { from: horizon.start - 6, to: hole.end + sec(0.8) };

	return sceneRoot(t, [
		blackHole(t, {
			camDist,
			camAz: [
				[0, -0.55],
				[end, 0.4, "linear"],
			],
			camIncl: [
				[0, 0.06],
				[end, 0.21],
			],
			roll: [
				[0, 0.16],
				[end, 0.07],
			],
			disk: [
				[0, 1],
				[glows - 10, 1, "hold"],
				[glows + sec(2), 0.42],
			],
			glow: [
				[0, 0],
				[glows - 10, 0, "hold"],
				[glows + sec(1.2), 1.1],
			],
			heat: 0.26,
			particles: [
				[0, 0],
				[evaporates - 8, 0, "hold"],
				[evaporates + sec(1.5), 0.75],
			],
			exposure: [
				[0, 0],
				[sec(1.8), 1],
			],
		}),
		label("Hawking radiation", {
			id: "open-title",
			x: 120,
			y: H - 150,
			from: sec(0.8),
			to: hole.start + sec(1.6),
			fill: INK,
		}),
		label("how black holes evaporate", {
			id: "open-sub",
			x: 120,
			y: H - 116,
			from: sec(1.0),
			to: hole.start + sec(1.6),
		}),
		...leader("open-horizon-line", [tip[0] + 190, tip[1] - 150], tip, named),
		label("Event horizon", {
			id: "open-horizon",
			x: tip[0] + 206,
			y: tip[1] - 176,
			...named,
			fill: INK,
		}),
		label("the point of no return", {
			id: "open-horizon-sub",
			x: tip[0] + 206,
			y: tip[1] - 144,
			...named,
			size: 19,
		}),
		line("Stephen Hawking", {
			id: "open-hawking",
			x: 120,
			y: H - 190,
			from: wordIn(t, "hawking", "Stephen").start,
			to: end - sec(0.4),
			size: 40,
		}),
		label("1974", {
			id: "open-year",
			x: 122,
			y: H - 130,
			from: wordIn(t, "hawking", "Stephen").start + 6,
			to: end - sec(0.4),
			fill: INK_SOFT,
		}),
		label("black holes glow", {
			id: "open-glow",
			x: W - 720,
			y: H - 150,
			width: 600,
			align: "end",
			from: glows,
			to: end - sec(0.4),
			fill: INK,
		}),
		label("and evaporate", {
			id: "open-evaporate",
			x: W - 720,
			y: H - 116,
			width: 600,
			align: "end",
			from: evaporates,
			to: Math.max(end - sec(0.4), hawking.end),
		}),
	]);
}
