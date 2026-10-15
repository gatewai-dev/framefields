import { Layer, LayerAnimation } from "framefields";
import { asset, EMBER, H, label, PAPER, W } from "../theme.js";

export const VISION_FRAMES = 60;

/**
 * On-device ONNX vision on a video: a subject cutout with text behind it
 * (instance segmentation), plus pose skeleton and tracked boxes panels. The
 * models download on first use into $FRAMEFIELDS_MODELS_DIR.
 */
export function visionLayers() {
	const plate = Layer.video(asset("dancer.mp4"), {
		id: "plate",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		muted: true,
	});

	const behind = Layer.text("VISION", {
		id: "behind",
		position: "absolute",
		x: 0,
		y: 170,
		width: W,
		align: "center",
		fontFamily: "Syne",
		fontSize: 300,
		fill: EMBER,
	}).animate(
		LayerAnimation.keys("opacity", [
			[0, 0],
			[12, 1],
		]),
	);

	// The dancer cut out and drawn over the text.
	const cutout = Layer.video(asset("dancer.mp4"), {
		id: "cutout",
		position: "absolute",
		x: 0,
		y: 0,
		width: W,
		height: H,
		fit: "cover",
		muted: true,
	}).withVision({
		mode: "matte",
		enableSegmentation: true,
		classes: ["person"],
	});

	const panel = (id: string, x: number) =>
		Layer.video(asset("dancer.mp4"), {
			id,
			position: "absolute",
			x,
			y: H - 230,
			width: 300,
			height: 170,
			fit: "cover",
			muted: true,
			borderRadius: 12,
		});

	return [
		plate,
		behind,
		cutout,
		panel("pose", W - 640).withVision({ mode: "skeleton", enablePose: true }),
		panel("boxes", W - 320).withVision({
			mode: "boxes",
			enableDetection: true,
		}),
		Layer.text("segmentation · pose · detection", {
			position: "absolute",
			x: W - 640,
			y: H - 270,
			fontFamily: "Inter",
			fontSize: 22,
			fill: PAPER,
		}),
		label("ONNX: RTMDet-Ins matte · RTMO pose · tracked boxes"),
	];
}
