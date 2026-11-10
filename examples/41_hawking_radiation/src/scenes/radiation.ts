/**
 * Pulling back: from the edge of the hole to the whole of it, now with the
 * escaping particles streaming away as a glow. The film's subject gets its
 * name here.
 */
import type { LayoutNode } from "framefields";
import { GOLD, H, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { label, line } from "../type.js";
import { blackHole, sceneRoot } from "./shell.js";

export function radiationScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const glow = lineIn(t, "glow");
	const named = {
		from: wordIn(t, "glow", "This").start,
		to: end - sec(0.5),
	};
	return sceneRoot(t, [
		blackHole(t, {
			camDist: [
				[0, 6.5],
				[glow.end - sec(1), 30],
				[end, 33, "linear"],
			],
			camIncl: 0.24,
			camAz: [
				[0, 0.5],
				[end, 1.1, "linear"],
			],
			roll: -0.08,
			disk: 0.2,
			glow: 1.15,
			heat: 0.24,
			particles: [
				[0, 0.4],
				[sec(3), 0.95],
			],
		}),
		line("Hawking radiation", {
			id: "radiation-title",
			x: 0,
			y: H - 236,
			width: W,
			align: "center",
			size: 88,
			weight: 600,
			...named,
		}),
		label("particles escaping from the edge of a black hole", {
			id: "radiation-sub",
			x: 0,
			y: H - 118,
			width: W,
			align: "center",
			from: named.from + 10,
			to: named.to,
			fill: GOLD,
		}),
	]);
}
