import { Layer, type LayoutNode } from "framefields";
import { morph } from "../morph.js";
import {
	ACCENT,
	CYAN_TEXT,
	DISPLAY,
	H,
	MARGIN,
	MONO,
	TEXT,
	W,
} from "../theme.js";
import { OUTRO } from "../timeline.js";
import { riseAt, scene } from "../ui.js";

const BARS = 16;
const STATES = 9;
const EQ_H = 420;

/** Bar heights at state `k`: two drifting waves, like a level meter. */
export function levels(k: number): number[] {
	return Array.from({ length: BARS }, (_, i) => {
		const v =
			0.55 +
			0.3 * Math.sin(i * 0.7 + k * 1.3) +
			0.15 * Math.sin(i * 1.9 - k * 2.1);
		return Math.round(Math.max(0.08, Math.min(1, v)) * 100);
	});
}

function eqView(k: number): LayoutNode {
	return Layer.chart(
		{
			type: "bar",
			width: W,
			height: EQ_H,
			padding: 0,
			categories: Array.from({ length: BARS }, (_, i) => `${i}`),
			series: [{ data: levels(k), color: ACCENT }],
			yAxis: { min: 0, max: 100, show: false, grid: false },
			xAxis: { show: false },
			legend: false,
			cornerRadius: 10,
			animate: { start: 0, duration: 12, stagger: 1 },
		},
		{ id: "outro-eq", position: "absolute", x: 0, y: H - EQ_H, opacity: 0.3 },
	);
}

/** The point of the film, over a bar chart whose data never sits still. */
export function outroScene(): LayoutNode {
	const eq = morph(
		Array.from({ length: STATES }, (_, k) => ({
			at: 30 + (k - 1) * 7,
			node: eqView(k),
		})),
		{ duration: 7, ease: "sine.inOut" },
	);
	return scene("outro", OUTRO.from, OUTRO.to, [
		eq,
		Layer.text("Every bar is a node.", {
			id: "outro-line",
			position: "absolute",
			x: MARGIN,
			y: 300,
			width: W - 2 * MARGIN,
			height: 140,
			fontFamily: DISPLAY,
			fontSize: 96,
			fontWeight: 800,
			fill: TEXT,
			align: "center",
		}).animate(riseAt(6, 300, 60, 30)),
		Layer.text("Layer.chart   ·   d3   ·   signals   ·   gsap", {
			id: "outro-stack",
			position: "absolute",
			x: MARGIN,
			y: 460,
			width: W - 2 * MARGIN,
			height: 40,
			fontFamily: MONO,
			fontSize: 30,
			fontWeight: 600,
			letterSpacing: 2,
			fill: CYAN_TEXT,
			align: "center",
		}).animate(riseAt(18, 460, 30)),
	]);
}
