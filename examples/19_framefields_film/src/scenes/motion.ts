/**
 * 10.2–15.0 s — The downbeat slams to ember. "Move it." then five dots race
 * the same distance with five different curves (linear → spring), out and back,
 * every one motion-blurred by the engine's shutter.
 */
import { Layer, LayerAnimation } from "framefields";
import { EASE_OUT, EMBER, H, INK, W, chapter, headline, keys, label, scene } from "../theme.js";

export const MOTION_FROM = 306;
export const MOTION_TO = 450;

const RACES: { name: string; ease: string }[] = [
	{ name: "linear", ease: "linear" },
	{ name: "cubic-bezier", ease: "cubic(0.65, 0, 0.35, 1)" },
	{ name: "expo.out", ease: "expo.out" },
	{ name: "back.out", ease: "back.out(1.7)" },
	{ name: "spring", ease: "spring(11, 170, 1)" },
];

const TRACK_X = 560;
const TRACK_W = 1160;
const DOT = 40;
const ROW_GAP = 104;
const ROW_Y0 = H / 2 - ROW_GAP * 2 + 20;

export function motionScene() {
	const rows = RACES.flatMap(({ name, ease }, i) => {
		const y = ROW_Y0 + i * ROW_GAP;
		const t = i * 3;
		return [
			label({ id: `motion-label-${i}`, text: name, x: 200, y: y - 11, color: INK, inAt: 40 + t }),
			Layer.shape("rect", {
				id: `motion-track-${i}`,
				position: "absolute",
				x: TRACK_X,
				y: y - 1,
				width: 0,
				height: 2,
				fillColor: "rgba(14,13,12,0.22)",
			}).animate(keys("width", [[38 + t, 0], [64 + t, TRACK_W, EASE_OUT]])),
			Layer.shape("rect", {
				id: `motion-finish-${i}`,
				position: "absolute",
				x: TRACK_X + TRACK_W - 2,
				y: y - 14,
				width: 2,
				height: 28,
				fillColor: INK,
			}).animate(LayerAnimation.create().fadeIn(56 + t, 64 + t)),
			Layer.shape("circle", {
				id: `motion-dot-${i}`,
				position: "absolute",
				x: TRACK_X,
				y: y - DOT / 2,
				width: DOT,
				height: DOT,
				fillColor: INK,
				anchorX: 0.5,
				anchorY: 0.5,
				motionBlurShutter: 150,
			}).animate(
				keys(
					"x",
					[
						[62, TRACK_X],
						[98, TRACK_X + TRACK_W - DOT, ease],
						[110, TRACK_X + TRACK_W - DOT],
						[140, TRACK_X, ease],
					],
					keys("scale", [[0, 0], [42 + t, 0], [58 + t, 1, "back.out(2)"]]),
				),
			),
		];
	});

	return scene({
		id: "motion",
		from: MOTION_FROM,
		to: MOTION_TO,
		background: EMBER,
		children: [
			headline({
				id: "motion-title",
				text: "Move it.",
				x: 0,
				y: (H - 375) / 2 - 20,
				size: 300,
				color: INK,
				align: "center",
				inAt: 0,
				sweep: 10,
				outAt: 30,
				drift: 14,
			}),
			...rows,
			...chapter({ id: "motion-ch", index: "03", name: "Motion", color: INK, inAt: 44 }),
			label({
				id: "motion-caption",
				text: "Keyframes  ·  Easing  ·  Springs  ·  Motion blur",
				x: W - 96 - 900,
				y: H - 92,
				width: 900,
				align: "end",
				color: INK,
				inAt: 50,
			}),
		],
	});
}
