/**
 * The price: the partner that falls in carries negative energy, so the hole
 * gets lighter. One pair is followed again, labelled this time, while a
 * meter of the hole's mass ticks down with every particle that leaves.
 */
import { Layer, LayerAnimation, type LayoutNode } from "framefields";
import type { Key } from "../motion.js";
import { HORIZON_TOP } from "../shaders/quantum.js";
import { BLUE, GOLD, H, INK, INK_SOFT, RULE, sec } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { figure, label } from "../type.js";
import { quantum, sceneRoot, toPixels } from "./shell.js";

const BORN = [0.02, HORIZON_TOP.up + 0.2] as const;
const GOLD_REST = [0.11, BORN[1] + 0.06] as const;
const BLUE_REST = [-0.07, BORN[1] - 0.05] as const;
const METER = { x: 120, y: H - 150, width: 460 } as const;

export function energyScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const negative = lineIn(t, "negative");
	const partner = wordIn(t, "negative", "partner").start;
	const carries = wordIn(t, "negative", "carries").start;
	const lighter = wordIn(t, "negative", "lighter").start;
	const escapes = wordIn(t, "mass", "escapes").start;
	const loses = wordIn(t, "mass", "loses").start;

	const along = (
		axis: 0 | 1,
		rest: readonly [number, number],
		leave: number,
		gone: readonly [number, number],
	): Key[] => [
		[partner - 14, BORN[axis]],
		[partner + 14, rest[axis], "out"],
		[leave, rest[axis], "hold"],
		[leave + sec(1.5), gone[axis], "in"],
	];
	const [goldX, goldY] = toPixels(...GOLD_REST);
	const [blueX, blueY] = toPixels(...BLUE_REST);
	const paired = { from: partner - 6, to: lighter + 6 };

	// The meter loses a sliver whenever something escapes.
	const steps: Array<[number, number, string?]> = [[0, METER.width]];
	let width: number = METER.width;
	for (let at = lighter; at < end - sec(0.6); at += sec(0.55)) {
		width -= at >= loses ? 16 : 7;
		steps.push(
			[at, width + (at >= loses ? 16 : 7), "hold"],
			[at + 8, width, "power2.out"],
		);
	}

	return sceneRoot(t, [
		quantum(t, {
			zoom: [
				[0, 0.95],
				[end, 0.82, "linear"],
			],
			horizon: 1,
			pairs: 0.62,
			stream: [
				[0, 0.45],
				[escapes, 0.6, "hold"],
				[escapes + sec(1.5), 1],
			],
			hero: [
				[0, 0],
				[partner - 16, 0, "hold"],
				[partner - 4, 1, "out"],
				[negative.end + sec(1.4), 1, "hold"],
				[negative.end + sec(2), 0],
			],
			heroGoldX: along(0, GOLD_REST, negative.end - 4, [0.5, 0.8]),
			heroGoldY: along(1, GOLD_REST, negative.end - 4, [0.5, 0.8]),
			heroBlueX: along(0, BLUE_REST, lighter - 14, [-0.1, -0.36]),
			heroBlueY: along(1, BLUE_REST, lighter - 14, [-0.1, -0.36]),
			link: [
				[0, 1],
				[lighter - 14, 1, "hold"],
				[lighter + 4, 0],
			],
			focus: [
				[0, 0],
				[partner - 20, 0, "hold"],
				[partner + 6, 1],
				[negative.end + sec(1), 1, "hold"],
				[negative.end + sec(2), 0],
			],
		}),
		figure("+E", {
			id: "energy-plus",
			x: goldX + 44,
			y: goldY - 44,
			size: 38,
			fill: GOLD,
			from: carries - 10,
			to: paired.to + sec(0.6),
		}),
		figure("−E", {
			id: "energy-minus",
			x: blueX - 140,
			y: blueY - 26,
			width: 90,
			align: "end",
			size: 38,
			fill: BLUE,
			from: carries - 10,
			to: paired.to,
		}),
		label("negative energy", {
			id: "energy-negative",
			x: blueX - 700,
			y: blueY - 14,
			width: 520,
			align: "end",
			fill: BLUE,
			from: wordIn(t, "negative", "negative").start,
			to: paired.to,
		}),
		label("Black hole mass", {
			id: "energy-meter-label",
			x: METER.x,
			y: METER.y - 40,
			fill: INK,
			from: lighter - 20,
			to: end - sec(0.4),
		}),
		Layer.box({
			id: "energy-meter-track",
			position: "absolute",
			x: METER.x,
			y: METER.y,
			width: METER.width,
			height: 6,
			borderRadius: 3,
			background: RULE,
			opacity: 0,
		}).animate(
			LayerAnimation.keys("opacity", [
				[0, 0],
				[lighter - 20, 0, "hold"],
				[lighter - 6, 1],
				[end - sec(0.4) - 14, 1, "hold"],
				[end - sec(0.4), 0],
			]),
		),
		Layer.box({
			id: "energy-meter",
			position: "absolute",
			x: METER.x,
			y: METER.y,
			width: METER.width,
			height: 6,
			borderRadius: 3,
			background: INK_SOFT,
			opacity: 0,
		})
			.animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[lighter - 20, 0, "hold"],
					[lighter - 6, 1],
					[end - sec(0.4) - 14, 1, "hold"],
					[end - sec(0.4), 0],
				]),
			)
			.animate(LayerAnimation.keys("width", steps)),
	]);
}
