import {
	Gradient,
	Layer,
	LayerAnimation,
	LayerStyle,
	TextAnimator,
} from "framefields";
import { CX, EMBER, H, INDIGO, label, MUTED, PAPER, W } from "../theme.js";

export const TITLE_FRAMES = 120;

/**
 * Typography and vector shapes: Slug text with per-glyph animators, a matte
 * reveal, flex layout, CSS gradients, star/arrow/path shapes with trim-path
 * draw-on, procedural wiggle and a layer style.
 */
export function titleScene() {
	const headline = Layer.text("FRAMEFIELDS", {
		id: "headline",
		position: "absolute",
		x: 0,
		y: 200,
		width: W,
		align: "center",
		fontFamily: "Syne",
		fontSize: 132,
		fill: PAPER,
		letterSpacing: 6,
		animators: [TextAnimator.waveRise({ y: 60, opacity: 0, blur: 8 })],
	}).animate(LayerAnimation.create().kineticSweep(-1, 1, 0, 30, "power2.out"));

	// Revealed by a sliding bar (track matte).
	const subtitle = Layer.text("rendered from git, on a GPU", {
		id: "subtitle",
		position: "absolute",
		x: 0,
		y: 360,
		width: W,
		height: 60,
		align: "center",
		fontFamily: "Inter",
		fontSize: 40,
		fill: MUTED,
	}).withMatte(
		Layer.box({
			position: "absolute",
			x: 0,
			y: 360,
			width: W,
			height: 60,
			background: "#fff",
		}).animate(
			LayerAnimation.keys("x", [
				[0, -W],
				[20, -W],
				[44, 0, "expo.out"],
			]),
		),
	);

	const pills = Layer.flex({
		id: "pills",
		position: "absolute",
		x: CX - 330,
		y: 460,
		width: 660,
		dir: "row",
		gap: 20,
		justify: "center",
		children: ["text", "shapes", "media", "3D", "vision"].map((t, i) =>
			Layer.box({
				padding: 14,
				borderRadius: 999,
				background: i % 2 ? "#1f2433" : INDIGO,
				children: [
					Layer.text(t, { fontFamily: "Inter", fontSize: 22, fill: PAPER }),
				],
			}).animate(
				LayerAnimation.keys("opacity", [
					[0, 0],
					[30 + i * 5, 0],
					[42 + i * 5, 1],
				]),
				LayerAnimation.keys("scale", [
					[30 + i * 5, 0.6],
					[44 + i * 5, 1, "back.out(1.8)"],
				]),
			),
		),
	}).withEffect(
		new LayerStyle({
			dropShadow: {
				enabled: true,
				color: "#000000",
				opacity: 0.6,
				distance: 8,
				size: 16,
			},
		}),
	);

	const star = Layer.shape("star", {
		id: "star",
		position: "absolute",
		x: 120,
		y: 90,
		width: 140,
		height: 140,
		fill: "linear-gradient(135deg, #ff5a1f, #ffb800)",
	}).animate(
		LayerAnimation.keys("rotation", [
			[0, -90],
			[TITLE_FRAMES, 90, "sine.inOut"],
		]),
	);

	const orb = Layer.shape("circle", {
		id: "orb",
		position: "absolute",
		x: W - 260,
		y: 80,
		width: 160,
		height: 160,
		fill: Gradient.radial([INDIGO, "transparent"]),
	}).animate(
		LayerAnimation.create()
			.wiggle("x", { frequency: 0.8, amplitude: 30 })
			.wiggle("y", { frequency: 0.6, amplitude: 20 }),
	);

	// A hand-drawn underline that draws itself on (trim path).
	const underline = Layer.shape("path", {
		id: "underline",
		position: "absolute",
		x: CX - 300,
		y: 330,
		width: 600,
		height: 40,
		d: "M 0 20 C 150 0, 300 40, 450 20 S 600 10, 600 20",
		fill: "transparent",
		strokeColor: EMBER,
		strokeWidth: 6,
	}).animate(
		LayerAnimation.keys("trimEnd", [
			[10, 0],
			[50, 1, "power2.inOut"],
		]),
	);

	const arrow = Layer.shape("arrow", {
		id: "arrow",
		position: "absolute",
		x: W - 220,
		y: H - 150,
		width: 140,
		height: 60,
		fill: EMBER,
	}).animate(
		LayerAnimation.keys("x", [
			[0, W],
			[36, W - 220, "expo.out"],
		]),
	);

	return Layer.box({
		id: "title",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: "radial-gradient(circle at 50% 40%, #1b1f2e, #0b0d14 70%)",
		children: [
			orb,
			star,
			headline,
			underline,
			subtitle,
			pills,
			arrow,
			label("text · animators · matte · flex · gradients · shapes"),
		],
	});
}
