/**
 * What is left: the stars, and the thought the film was for.
 */
import type { LayoutNode } from "framefields";
import { GOLD, H, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { label, line } from "../type.js";
import { blackHole, sceneRoot } from "./shell.js";

export function closeScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const unseen = lineIn(t, "unseen");
	const forever = wordIn(t, "forever", "Even").start;
	return sceneRoot(t, [
		blackHole(t, {
			rs: 0,
			disk: 0,
			camAz: [
				[0, 5.7],
				[end, 6.1, "linear"],
			],
			camIncl: 0.18,
			exposure: [
				[0, 1],
				[end - sec(1.6), 1, "hold"],
				[end, 0],
			],
		}),
		label("Never observed: far too faint to see", {
			id: "close-unseen",
			x: 0,
			y: H / 2 - 12,
			width: W,
			align: "center",
			from: unseen.start + 6,
			to: forever - 8,
		}),
		line("Even black holes do not last forever.", {
			id: "close-forever",
			x: 0,
			y: H / 2 - 56,
			width: W,
			align: "center",
			size: 68,
			weight: 500,
			from: forever,
			to: end - sec(1.4),
		}),
		label("Hawking radiation", {
			id: "close-name",
			x: 0,
			y: H / 2 + 56,
			width: W,
			align: "center",
			fill: GOLD,
			from: forever + sec(1.2),
			to: end - sec(1.4),
		}),
	]);
}
