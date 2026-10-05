/**
 * 6.6–10.2 s — The same take, twice: flat camera log underneath, the finished
 * grade on top. An ember split-line sweeps across with the riser while the RGB
 * curve draws itself in the corner — the grade lands on the downbeat.
 */
import { ColorBalance, Curves, GradientMap, Layer, LayerAnimation, Vignette } from "framefields";
import {
	EASE_OUT,
	EMBER,
	H,
	PAPER,
	STONE,
	W,
	asset,
	chapter,
	headline,
	keys,
	label,
	scene,
	scrim,
} from "../theme.js";

export const GRADE_FROM = 198;
export const GRADE_TO = 306;

/**
 * Split-line position as a fraction of the frame: it snaps across to cut her
 * face in half, holds so the two passes can be compared, then finishes on the riser.
 */
const WIPE: [number, number, string?][] = [
	[18, 0],
	[46, 0.44, "expo.out"],
	[76, 0.44],
	[102, 1, "power3.inOut"],
];
const WIPE_END = WIPE[WIPE.length - 1][0];

/** Everything that rides the line shares one track. */
const wipe = (offset = 0, prop: "x" | "width" = "x") =>
	keys(prop, WIPE.map(([f, u, e]) => [f, offset + u * W, e] as [number, number, string?]));

/** Slow push shared by both passes so they stay pixel-aligned. */
const push = () => keys("scale", [[0, 1.0], [GRADE_TO - GRADE_FROM, 1.05, "sine.inOut"]]);

function plate(id: string) {
	return Layer.video(asset("portrait.mp4"), {
		id,
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		muted: true,
		// h3-max holds her likeness best in the back half of the take.
		trimStartSec: 2.95,
	});
}

export function gradeScene() {
	const log = plate("grade-log")
		.apply(new GradientMap({ stops: [{ position: 0, color: "#000000" }, { position: 1, color: "#FFFFFF" }], opacity: 0.6 }))
		.apply(new Curves({ master: [{ x: 0, y: 0.13 }, { x: 0.5, y: 0.52 }, { x: 1, y: 0.84 }] }))
		.animate(push());

	const graded = plate("grade-final")
		.apply(
			new Curves({
				master: [{ x: 0, y: 0.02 }, { x: 0.25, y: 0.17 }, { x: 0.5, y: 0.5 }, { x: 0.75, y: 0.83 }, { x: 1, y: 0.98 }],
				blue: [{ x: 0, y: 0 }, { x: 0.5, y: 0.47 }, { x: 1, y: 0.93 }],
			}),
		)
		.apply(
			new ColorBalance({
				shadows: { cyanRed: 6, yellowBlue: -4 },
				midtones: { cyanRed: 8, yellowBlue: -12 },
				highlights: { cyanRed: 4, yellowBlue: -6 },
			}),
		)
		.apply(new Vignette({ strength: 0.45, radius: 0.8, softness: 0.65 }))
		.animate(push());

	return scene({
		id: "grade",
		from: GRADE_FROM,
		to: GRADE_TO,
		children: [
			log,
			Layer.box({
				id: "grade-reveal",
				position: "absolute",
				x: 0,
				y: 0,
				width: 0,
				height: H,
				overflow: "hidden",
				children: [graded],
			}).animate(wipe(0, "width")),
			Layer.shape("rect", {
				id: "grade-split",
				position: "absolute",
				x: -1,
				y: 0,
				width: 3,
				height: H,
				fillColor: EMBER,
			}).animate(wipe(-1)),
			scrim("grade-scrim", "bottom", 420, 0.6),
			rider("grade-tag-graded", "Graded", -24 - 300, "end", 12),
			rider("grade-tag-log", "Log", 24, "start", 16),
			headline({
				id: "grade-title",
				text: "Grade it.",
				x: W - 96 - 900,
				y: 380,
				width: 900,
				align: "end",
				size: 124,
				color: PAPER,
				inAt: 6,
				outAt: 90,
			}),
			...chapter({ id: "grade-ch", index: "02", name: "Color", color: PAPER, accent: PAPER, inAt: 12, outAt: 92 }),
			curvesCard(),
		],
	});
}

/** A caption glued to the split-line. */
function rider(id: string, text: string, offset: number, align: "start" | "end", inAt: number) {
	const node = label({ id, text, x: offset, y: 88, width: 300, align, color: PAPER, inAt, outAt: WIPE_END - 6 });
	return Layer.box({ id: `${id}-rail`, position: "absolute", x: 0, y: 0, width: W, height: 140, overflow: "visible", children: [node] })
		.animate(wipe(0));
}

/** RGB curve readout: the neutral log line, then the S-curve drawing in with the wipe. */
function curvesCard() {
	const size = 272;
	const pad = 26;
	const plot = size - pad * 2;
	const x = W - 96 - size;
	const y = H - 96 - size;
	// Strokes are clipped to their layer, so curve layers get a little bleed.
	const bleed = 6;
	const pt = (u: number, v: number) => `${(bleed + u * plot).toFixed(1)} ${(bleed + (1 - v) * plot).toFixed(1)}`;
	const grid = [0.25, 0.5, 0.75].flatMap((t, i) => [
		Layer.shape("rect", { id: `grade-grid-v${i}`, position: "absolute", x: pad + t * plot, y: pad, width: 1, height: plot, fillColor: "rgba(238,233,224,0.10)" }),
		Layer.shape("rect", { id: `grade-grid-h${i}`, position: "absolute", x: pad, y: pad + t * plot, width: plot, height: 1, fillColor: "rgba(238,233,224,0.10)" }),
	]);
	const curve = (id: string, d: string, color: string, width: number) =>
		Layer.shape("path", {
			id,
			position: "absolute",
			x: pad - bleed,
			y: pad - bleed,
			width: plot + bleed * 2,
			height: plot + bleed * 2,
			d,
			fillType: "none",
			strokeColor: color,
			strokeWidth: width,
			strokeLineCap: "round",
		});

	return Layer.box({
		id: "grade-card",
		position: "absolute",
		x,
		y,
		width: size,
		height: size,
		background: "rgba(14,13,12,0.58)",
		borderRadius: 18,
		borderColor: "rgba(238,233,224,0.16)",
		borderWidth: 1,
		children: [
			...grid,
			curve("grade-curve-log", `M${pt(0, 0.13)} L${pt(1, 0.84)}`, STONE, 2),
			curve("grade-curve-s", `M${pt(0, 0.02)} C${pt(0.42, 0.0)} ${pt(0.58, 1.0)} ${pt(1, 0.98)}`, EMBER, 3).animate(
				keys("trimEnd", WIPE),
			),
		],
	}).animate(
		LayerAnimation.create()
			.fadeIn(10, 22, "power2.out")
			.fromTo("y", y + 24, y, { start: 10, end: 34, ease: EASE_OUT }),
	);
}
