/**
 * Empty space, which is not empty: pairs of particles appear and vanish.
 * Then the edge of the black hole rises into the frame, and one pair is
 * followed as it is pulled apart: one partner falls in, the other escapes.
 */
import type { LayoutNode } from "framefields";
import type { Key } from "../motion.js";
import { HORIZON_TOP } from "../shaders/quantum.js";
import { BLUE, GOLD, INK, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { label, leader } from "../type.js";
import { quantum, sceneRoot, toPixels } from "./shell.js";

/** Where the followed pair is born, and where its partners wait, in frame heights. */
const BORN = [0, HORIZON_TOP.up + 0.075] as const;
const GOLD_REST = [0.075, BORN[1] + 0.045] as const;
const BLUE_REST = [-0.075, BORN[1] - 0.02] as const;

export function vacuumScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const never = wordIn(t, "never", "never");
	const pairs = lineIn(t, "pairs");
	const edge = lineIn(t, "edge");
	const appears = wordIn(t, "split", "pair").start;
	const meet = wordIn(t, "split", "meet").start;
	const falls = wordIn(t, "split", "falls").start;
	const escapes = wordIn(t, "split", "escapes").start;

	const along = (
		axis: 0 | 1,
		rest: readonly [number, number],
		leave: number,
		gone: readonly [number, number],
		travel: number,
	): Key[] => [
		[appears, BORN[axis]],
		[meet, rest[axis], "out"],
		[leave, rest[axis], "hold"],
		[leave + travel, gone[axis], "in"],
	];
	const [goldX, goldY] = toPixels(...GOLD_REST);
	const [blueX, blueY] = toPixels(...BLUE_REST);
	const [, edgeY] = toPixels(0, HORIZON_TOP.up);

	return sceneRoot(t, [
		quantum(t, {
			zoom: [
				[0, 1.3],
				[end, 0.95, "linear"],
			],
			pairs: [
				[0, 0],
				[never.start, 0, "hold"],
				[never.start + sec(2), 0.5],
				[edge.start, 0.5, "hold"],
				[edge.start + sec(2), 0.62],
			],
			horizon: [
				[0, 0],
				[edge.start - 12, 0, "hold"],
				[edge.start + sec(2.6), 1],
			],
			stream: [
				[0, 0],
				[escapes + sec(0.8), 0, "hold"],
				[escapes + sec(2.4), 0.75],
			],
			hero: [
				[0, 0],
				[appears - 4, 0, "hold"],
				[appears + 6, 1, "out"],
				[escapes + sec(1.6), 1, "hold"],
				[escapes + sec(2.2), 0],
			],
			heroGoldX: along(0, GOLD_REST, escapes - 6, [0.42, 0.75], sec(1.6)),
			heroGoldY: along(1, GOLD_REST, escapes - 6, [0.42, 0.75], sec(1.6)),
			heroBlueX: along(0, BLUE_REST, falls - 4, [-0.12, -0.34], sec(1.5)),
			heroBlueY: along(1, BLUE_REST, falls - 4, [-0.12, -0.34], sec(1.5)),
			link: [
				[0, 1],
				[falls - 4, 1, "hold"],
				[falls + 14, 0],
			],
			focus: [
				[0, 0],
				[appears - 12, 0, "hold"],
				[appears + 14, 1],
				[escapes + sec(1.2), 1, "hold"],
				[escapes + sec(2.2), 0],
			],
		}),
		label("Particle pairs", {
			id: "vacuum-pairs",
			x: 120,
			y: 120,
			from: wordIn(t, "pairs", "pairs").start,
			to: pairs.end + sec(0.4),
			fill: INK,
		}),
		label("appear, then vanish", {
			id: "vacuum-pairs-sub",
			x: 120,
			y: 152,
			size: 19,
			from: wordIn(t, "pairs", "pop").start,
			to: pairs.end + sec(0.4),
		}),
		label("Event horizon", {
			id: "vacuum-horizon",
			x: 0,
			y: edgeY + 64,
			width: W,
			align: "center",
			from: edge.start + sec(2),
			to: end - sec(0.4),
		}),
		...leader(
			"vacuum-falls-line",
			[blueX - 210, blueY + 6],
			[blueX - 40, blueY + 6],
			{ from: falls - 6, to: falls + sec(1.7) },
			BLUE,
		),
		label("falls in", {
			id: "vacuum-falls",
			x: blueX - 520,
			y: blueY - 6,
			width: 290,
			align: "end",
			from: falls - 6,
			to: falls + sec(1.7),
			fill: BLUE,
		}),
		...leader(
			"vacuum-escapes-line",
			[goldX + 210, goldY - 6],
			[goldX + 40, goldY - 6],
			{ from: escapes - 10, to: escapes + sec(1.2) },
			GOLD,
		),
		label("escapes", {
			id: "vacuum-escapes",
			x: goldX + 228,
			y: goldY - 18,
			from: escapes - 10,
			to: escapes + sec(1.2),
			fill: GOLD,
		}),
	]);
}
