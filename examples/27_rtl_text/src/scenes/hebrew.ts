/**
 * Hebrew in 2D: a headline rising letter by letter in reading order (from
 * the right), a mixed Hebrew / English / number paragraph aligned to its
 * start (the right edge), and Hebrew flowing along a curve.
 */
import {
	Layer,
	LayerAnimation,
	TextAnimator,
	TextPathBuilder,
} from "framefields";
import { INK, label, PAPER, RUBIK, scene, TEAL, W } from "../theme.js";

export const HEBREW_FRAMES = 165;

export function hebrewScene() {
	return scene("hebrew", PAPER, [
		Layer.text("שלום עולם", {
			id: "he-title",
			position: "absolute",
			x: 0,
			y: 110,
			width: W,
			fontFamily: RUBIK,
			fontWeight: 800,
			fontSize: 180,
			fill: INK,
			align: "center",
			animators: [TextAnimator.waveRise({ y: 60, rotationX: 60 })],
		}).animate(LayerAnimation.create().kineticSweep(-1, 1, 4, 50)),
		Layer.text(
			"framefields מציירת עברית מימין לשמאל, עם English ו-2026 בתוך השורה.",
			{
				id: "he-mixed",
				position: "absolute",
				x: 260,
				y: 380,
				width: W - 520,
				fontFamily: RUBIK,
				fontWeight: 500,
				fontSize: 64,
				lineHeight: 1.3,
				fill: INK,
				// The paragraph opens with a Latin word, so "auto" would read it
				// left to right (as a browser does); force Hebrew's direction.
				direction: "rtl",
				// "start" is then the right edge.
				align: "start",
			},
		).animate(LayerAnimation.create().typewriter(30, 100)),
		Layer.text("טקסט שזורם לאורך מסלול · טקסט שזורם לאורך מסלול", {
			id: "he-path",
			position: "absolute",
			x: 0,
			y: 560,
			width: W,
			height: 400,
			fontFamily: RUBIK,
			fontWeight: 600,
			fontSize: 56,
			fill: TEAL,
			pathOptions: TextPathBuilder.fromSvg("M 380 330 Q 960 20 1540 330")
				.forceAlignment(true)
				.build(),
		}).animate(
			LayerAnimation.create().keys("opacity", [
				[90, 0],
				[115, 1, "power2.out"],
			]),
		),
		label(
			"he-label",
			"Hebrew · Rubik · right to left, embedded English and numbers, text on a path",
		),
	]);
}
