/**
 * "Gitframes!" — out of the accent flood the logo and the name, extruded in 3D, whip
 * round on an orbiting camera and lands on the sung word, then drifts until
 * the drop cuts it away.
 */
import { CameraAnimation, Layer, Layer3D } from "gitframes";
import { bar } from "../grid.js";
import { sung } from "../lyrics.js";
import {
	ACCENT,
	DISPLAY,
	EASE_OUT,
	FG,
	H,
	keys,
	label,
	logoMark,
	plane,
	scene,
	W,
	window3D,
} from "../theme.js";
import { CH } from "../timeline.js";
import { OPEN_TO } from "./open.js";

const CX = W / 2;
const CY = H / 2;

export function logoScene() {
	const from = OPEN_TO;
	const to = bar(CH.not);
	const len = to - from;
	// The whip settles as the name finishes ringing out.
	const land = sung("gitframes").at - from + 12;
	const cam = CameraAnimation.camera()
		.orbit({
			azimuth: { from: -82, to: -8 },
			elevation: { from: 38, to: 10 },
			radius: { from: 3400, to: 1500 },
			start: 0,
			end: land,
			ease: EASE_OUT,
		})
		.orbit({
			azimuth: { from: -8, to: 6 },
			elevation: { from: 10, to: 5 },
			radius: { from: 1500, to: 1360 },
			start: land + 1,
			end: len,
			ease: "sine.inOut",
		});

	return scene("logo", from, to, [
		Layer.camera({
			id: "logo-cam",
			targetX: CX,
			targetY: CY,
			targetZ: 0,
			animation: cam,
		} as never),
		Layer.directionalLight({
			id: "logo-key",
			color: "#FFFFFF",
			intensity: 1.1,
			direction: [-0.4, 0.5, 1],
		} as never),
		Layer.ambientLight({
			id: "logo-fill",
			color: "#FFFFFF",
			intensity: 0.6,
		} as never),
		// The logo and the name stand only once the name is sung.
		logoMark({
			id: "logo-mark",
			size: 200,
			x: CX,
			y: CY - 250,
			z: 0,
			startFrame: land - 12,
		}),
		window3D("logo-name-window", land - 12, len - land + 12, [
			Layer3D.extrudedText({
				id: "logo-3d",
				text: "gitframes",
				fontFamily: DISPLAY,
				fontWeight: 900,
				fontSize: 210,
				fill: ACCENT,
				depth: 90,
				x: CX,
				y: CY,
				z: 0,
			}),
		]),
		label({
			id: "logo-sub",
			text: "The WebGPU motion engine",
			y: CY + 170,
			inAt: land + 6,
			color: FG,
			size: 26,
		}),
		// The flood from the hook drains away as the camera swings in.
		plane("logo-flood", ACCENT).animate(
			keys("opacity", [
				[0, 1],
				[10, 0, "power2.out"],
			]),
		),
	]);
}
