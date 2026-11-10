/**
 * The strange part, side by side: a large black hole, cold and dim, and a
 * small one, hot and bright. Then the numbers for one as heavy as the Sun.
 */
import {
	FontManager,
	Layer,
	LayerAnimation,
	type LayoutNode,
} from "framefields";
import { BLUE, GOLD, H, INK, INK_SOFT, MONO, RULE, sec, W } from "../theme.js";
import { lineIn, type SceneTiming, wordIn } from "../timeline.js";
import { figure, label, rule } from "../type.js";
import { blackHole, sceneRoot } from "./shell.js";

const HALF = W / 2;
const FIGURE = 60;

interface Shown {
	from: number;
	to: number;
}

/** "10" with a raised exponent, then a unit, set as three runs of the mono face. */
function power(
	id: string,
	lead: string,
	exponent: string,
	unit: string,
	x: number,
	y: number,
	fill: string,
	shown: Shown,
): LayoutNode[] {
	const width = (text: string, fontSize: number) =>
		FontManager.measure(text, { fontFamily: MONO, fontSize }).width;
	const raised = FIGURE * 0.52;
	const afterLead = x + width(lead, FIGURE);
	const afterExponent = afterLead + width(exponent, raised) + 14;
	return [
		figure(lead, { id: `${id}-lead`, x, y, size: FIGURE, fill, ...shown }),
		figure(exponent, {
			id: `${id}-exponent`,
			x: afterLead + 4,
			y: y - 6,
			size: raised,
			fill,
			...shown,
		}),
		figure(unit, {
			id: `${id}-unit`,
			x: afterExponent,
			y,
			size: FIGURE,
			fill,
			...shown,
		}),
	];
}

export function temperatureScene(t: SceneTiming): LayoutNode {
	const end = t.duration;
	const sun = lineIn(t, "sun");
	const compared = { from: sec(0.5), to: sun.start - 4 };
	const facts = { to: end - sec(0.4) };
	const column = HALF + 110;
	const fade = LayerAnimation.keys("opacity", [
		[0, 1],
		[sun.start - 10, 1, "hold"],
		[sun.start + 20, 0],
	]);

	return sceneRoot(t, [
		blackHole(
			t,
			{
				camDist: [
					[0, 13.5],
					[end, 12, "linear"],
				],
				camIncl: 0.15,
				camAz: [
					[0, 2.0],
					[end, 2.3, "linear"],
				],
				disk: 0,
				glow: 0.5,
				heat: 0.03,
				particles: 0.3,
			},
			{ id: "hole-large", width: HALF },
		),
		blackHole(
			t,
			{
				camDist: 30,
				camIncl: 0.15,
				camAz: [
					[0, 4.0],
					[end, 4.3, "linear"],
				],
				disk: 0,
				glow: [
					[0, 0.9],
					[wordIn(t, "hotter", "hotter").start + 20, 2.2],
				],
				heat: [
					[0, 0.5],
					[wordIn(t, "hotter", "hotter").start + 20, 0.92],
				],
				particles: 1,
			},
			{ id: "hole-small", x: HALF, width: HALF },
		).animate(fade),
		Layer.box({
			id: "temperature-divide",
			position: "absolute",
			x: HALF - 1,
			y: 0,
			width: 2,
			height: H,
			background: RULE,
		}),
		label("Large", {
			id: "temperature-large",
			x: 0,
			y: H - 170,
			width: HALF,
			align: "center",
			fill: INK,
			...compared,
		}),
		label("colder, dimmer", {
			id: "temperature-large-sub",
			x: 0,
			y: H - 136,
			width: HALF,
			align: "center",
			fill: BLUE,
			...compared,
		}),
		label("Small", {
			id: "temperature-small",
			x: HALF,
			y: H - 170,
			width: HALF,
			align: "center",
			fill: INK,
			from: wordIn(t, "hotter", "smaller").start,
			to: compared.to,
		}),
		label("hotter, brighter", {
			id: "temperature-small-sub",
			x: HALF,
			y: H - 136,
			width: HALF,
			align: "center",
			fill: GOLD,
			from: wordIn(t, "hotter", "hotter").start,
			to: compared.to,
		}),
		Layer.box({
			id: "temperature-panel",
			position: "absolute",
			x: HALF + 1,
			y: 0,
			width: HALF - 1,
			height: H,
			background: "#04060d",
			opacity: 0,
		}).animate(
			LayerAnimation.keys("opacity", [
				[0, 0],
				[sun.start - 10, 0, "hold"],
				[sun.start + 20, 1],
			]),
		),
		label("A black hole as heavy as the Sun", {
			id: "temperature-sun",
			x: column,
			y: 236,
			width: 760,
			fill: INK,
			from: wordIn(t, "sun", "Sun").start - 10,
			...facts,
		}),
		label("Temperature", {
			id: "temperature-kelvin-label",
			x: column,
			y: 356,
			from: wordIn(t, "sun", "barely").start,
			...facts,
		}),
		figure("0.000 000 06 K", {
			id: "temperature-kelvin",
			x: column,
			y: 390,
			size: FIGURE,
			fill: BLUE,
			from: wordIn(t, "sun", "barely").start + 4,
			...facts,
		}),
		label("Time to evaporate", {
			id: "temperature-life-label",
			x: column,
			y: 536,
			from: wordIn(t, "sun", "longer").start,
			...facts,
		}),
		...power("temperature-life", "10", "67", "years", column, 570, GOLD, {
			from: wordIn(t, "sun", "longer").start + 4,
			...facts,
		}),
		label("Age of the universe so far", {
			id: "temperature-age-label",
			x: column,
			y: 716,
			from: wordIn(t, "sun", "age").start,
			...facts,
		}),
		...power(
			"temperature-age",
			"1.4 × 10",
			"10",
			"years",
			column,
			750,
			INK_SOFT,
			{ from: wordIn(t, "sun", "age").start + 4, ...facts },
		),
		rule("temperature-rule", column, 316, 620, {
			from: wordIn(t, "sun", "Sun").start - 10,
			...facts,
		}),
	]);
}
