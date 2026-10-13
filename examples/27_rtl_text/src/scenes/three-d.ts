/**
 * Arabic and Hebrew in 3D: solid extruded words (shaped like 2D text, then
 * tessellated and extruded) turning under a studio light, and flat
 * `Layer3D.text` captions on planes in the same space.
 */
import {
	FontManager,
	Layer,
	Layer3D,
	LayerAnimation,
	Lighting,
} from "framefields";
import {
	ACCENT,
	CAIRO,
	H,
	label,
	RUBIK,
	SANS,
	STUDIO,
	scene,
	TEAL,
	W,
} from "../theme.js";

export const THREE_D_FRAMES = 180;

const CX = W / 2;
const CY = H / 2;

/**
 * A planar caption centred on `cx`: a planar text node's `x` is its left
 * edge, so measure the shaped line (right to left included) and shift.
 */
function caption(
	id: string,
	text: string,
	family: string,
	cx: number,
	fill: string,
) {
	const fontSize = 64;
	const { width } = FontManager.measure(text, {
		fontFamily: family,
		fontSize,
		fontWeight: 600,
	});
	return Layer3D.text({
		id,
		text,
		fontFamily: family,
		fontWeight: 600,
		fontSize,
		fill,
		material: "unlit",
		x: cx - width / 2,
		y: CY + 200,
		z: 0,
	});
}

/** A slow turn and settle, so the side walls catch the light. */
function turn(from: number, to: number) {
	return LayerAnimation.create()
		.keys("rotateY", [
			[0, from],
			[THREE_D_FRAMES, to, "sine.inOut"],
		])
		.keys("opacity", [
			[0, 0],
			[20, 1, "power2.out"],
		]);
}

export function threeDScene() {
	return scene("three-d", STUDIO, [
		...Lighting.studio({ target: [CX, CY, 0], shadows: false }),
		Layer3D.text({
			id: "x-arabic",
			text: "مرحبا",
			fontFamily: CAIRO,
			fontWeight: 800,
			fontSize: 300,
			extrusionDepth: 70,
			fill: ACCENT,
			bevelColor: "#7c2d12",
			roughness: 0.35,
			x: CX - 400,
			y: CY - 60,
			z: 0,
		}).animate(turn(-28, 18)),
		Layer3D.text({
			id: "x-hebrew",
			text: "שלום",
			fontFamily: RUBIK,
			fontWeight: 800,
			fontSize: 280,
			extrusionDepth: 70,
			fill: TEAL,
			bevelColor: "#134e4a",
			roughness: 0.35,
			x: CX + 400,
			y: CY - 60,
			z: 0,
		}).animate(turn(28, -18)),
		caption("p-arabic", "نص ثلاثي الأبعاد", CAIRO, CX - 400, "#f3e8dc").animate(
			turn(-12, 8),
		),
		caption("p-hebrew", "טקסט תלת־ממדי", RUBIK, CX + 400, "#d9f2ee").animate(
			turn(12, -8),
		),
		Layer.text("3D", {
			id: "x-kicker",
			position: "absolute",
			x: 0,
			y: 90,
			width: W,
			align: "center",
			fontFamily: SANS,
			fontWeight: 700,
			fontSize: 34,
			fill: "#9ca3af",
			letterSpacing: 6,
		}),
		label(
			"x-label",
			"Extruded Layer3D.text (Cairo, Rubik) and planar Layer3D.text captions",
			"#9ca3af",
		),
	]);
}
