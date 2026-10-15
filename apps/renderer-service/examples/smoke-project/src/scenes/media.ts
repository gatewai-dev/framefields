import {
	ApplyLUT,
	ColorBalance,
	Curves,
	Layer,
	LayerAnimation,
	Vignette,
} from "framefields";
import { asset, H, INK, label, PAPER, W } from "../theme.js";

export const MEDIA_FRAMES = 120;

/**
 * Media sources: a raster image (LUT + curves, Ken Burns move), an SVG, a
 * Lottie animation, a video (graded, rounded) and video inside type (matte).
 */
export function mediaScene() {
	const photo = Layer.image(asset("portrait.jpg"), {
		id: "photo",
		position: "absolute",
		x: 0,
		y: 0,
		width: W / 2,
		height: H,
		fit: "cover",
	})
		.withEffect(
			new ApplyLUT({ lutUrl: asset("teal-orange.cube"), intensity: 0.9 }),
		)
		.withEffect(
			new Curves({
				master: [
					{ x: 0, y: 0.04 },
					{ x: 0.5, y: 0.5 },
					{ x: 1, y: 0.96 },
				],
			}),
		)
		.animate(
			LayerAnimation.keys("scale", [
				[0, 1.0],
				[MEDIA_FRAMES, 1.12, "none"],
			]),
		);

	const video = Layer.video(asset("dancer.mp4"), {
		id: "video",
		position: "absolute",
		x: W / 2 + 40,
		y: 60,
		width: W / 2 - 80,
		height: 330,
		fit: "cover",
		muted: true,
		borderRadius: 24,
	})
		.withEffect(new ColorBalance({ shadows: { cyanRed: -6, yellowBlue: 8 } }))
		.withEffect(new Vignette({ strength: 35, radius: 0.9, softness: 0.6 }));

	// Video seen through the letters.
	const typeMatte = Layer.video(asset("dancer.mp4"), {
		id: "type-video",
		position: "absolute",
		x: W / 2 + 40,
		y: 420,
		width: W / 2 - 80,
		height: 150,
		fit: "cover",
		muted: true,
	}).withMatte(
		Layer.text("MOTION", {
			position: "absolute",
			x: W / 2 + 40,
			y: 420,
			width: W / 2 - 80,
			align: "center",
			fontFamily: "Syne",
			fontSize: 140,
			fill: "#fff",
		}),
	);

	const logo = Layer.svg(asset("logo.svg"), {
		id: "logo",
		position: "absolute",
		x: 40,
		y: 40,
		width: 120,
		height: 120,
		fit: "contain",
	}).animate(
		LayerAnimation.keys("rotation", [
			[0, 0],
			[MEDIA_FRAMES, 360, "none"],
		]),
	);

	const badge = Layer.lottie(asset("badge.json"), {
		id: "badge",
		position: "absolute",
		x: W / 2 - 220,
		y: H - 240,
		width: 200,
		height: 200,
		fit: "contain",
	});

	return Layer.box({
		id: "media",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		background: INK,
		children: [
			photo,
			video,
			typeMatte,
			logo,
			badge,
			Layer.text("image · svg · lottie · video", {
				position: "absolute",
				x: 40,
				y: H - 120,
				fontFamily: "Syne",
				fontSize: 34,
				fill: PAPER,
			}),
			label("LUT · curves · color balance · vignette · video matte"),
		],
	});
}
