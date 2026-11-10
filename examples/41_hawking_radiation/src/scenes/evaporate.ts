/**
 * The end: the hole shrinks, which heats it, which shrinks it faster, until
 * it is gone in a flash. Two meters keep score.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import { type Key, valueAt } from "../motion.js";
import { BLUE, GOLD, H, INK_SOFT, RULE, sec } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { label } from "../type.js";
import { blackHole, sceneRoot } from "./shell.js";

const METER = { x: 120, width: 380 } as const;

/** A labelled bar whose length follows `level` (0–1), sampled every few frames. */
function meter(
	id: string,
	name: string,
	y: number,
	color: string,
	level: Key[],
	shown: { from: number; to: number },
): LayoutNode[] {
	const keys: Array<[number, number]> = [];
	for (let frame = 0; frame <= shown.to; frame += 3)
		keys.push([frame, Math.max(1, METER.width * valueAt(level, frame))]);
	const fade = LayerAnimation.keys("opacity", [
		[0, 0],
		[shown.from, 0, "hold"],
		[shown.from + 14, 1],
		[shown.to - 14, 1, "hold"],
		[shown.to, 0],
	]);
	const bar = (suffix: string, background: string) =>
		Layer.box({
			id: `${id}-${suffix}`,
			position: "absolute",
			x: METER.x,
			y: y + 34,
			width: METER.width,
			height: 6,
			borderRadius: 3,
			background,
			opacity: 0,
		}).animate(fade);
	return [
		label(name, { id: `${id}-label`, x: METER.x, y, ...shown }),
		bar("track", RULE),
		bar("level", color).animate(LayerAnimation.keys("width", keys)),
	];
}

export function evaporateScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const shrink = lineIn(t, "shrink");
	const burst = wordIn(t, "flash", "burst").start;
	const size: Key[] = [
		[0, 1],
		[shrink.end, 0.66, "linear"],
		[burst - 2, 0.04, "in"],
		[burst, 0, "hold"],
	];
	const heat: Key[] = [
		[0, 0.18],
		[shrink.end, 0.4, "linear"],
		[burst - 4, 1, "in"],
	];
	const shown = { from: sec(0.4), to: burst + sec(1.2) };

	return sceneRoot(t, [
		blackHole(t, {
			camDist: [
				[0, 13],
				[end, 15, "linear"],
			],
			camIncl: 0.18,
			camAz: [
				[0, 5.2],
				[end, 5.7, "linear"],
			],
			disk: 0,
			rs: size,
			heat,
			glow: [
				[0, 0.9],
				[burst - 4, 3.2, "in"],
			],
			particles: [
				[0, 0.7],
				[burst - sec(1), 1],
				[burst + 6, 1, "hold"],
				[burst + sec(2.2), 0, "out"],
			],
			flash: [
				[0, 0],
				[burst - 5, 0, "hold"],
				[burst + 2, 1.3, "out"],
				[burst + sec(1.6), 0, "out"],
			],
		}),
		...meter("evaporate-mass", "Mass", H - 210, INK_SOFT, size, shown),
		...meter("evaporate-heat", "Temperature", H - 130, GOLD, heat, shown),
		label("gone", {
			id: "evaporate-gone",
			x: METER.x,
			y: H - 150,
			fill: BLUE,
			from: burst + sec(1.6),
			to: end - sec(0.5),
		}),
	]);
}
