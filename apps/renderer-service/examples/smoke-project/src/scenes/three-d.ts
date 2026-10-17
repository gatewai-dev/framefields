import {
	CameraAnimation,
	Layer,
	Layer3D,
	LayerAnimation,
	Lighting,
} from "framefields";
import { asset, CX, CY, INK, label } from "../theme.js";

export const THREE_D_FRAMES = 120;

/**
 * A lit 3D scene: studio environment (physically based shading, bloom,
 * shadows), an orbiting camera with rack focus, procedural primitives
 * (chrome sphere, satin box, neon cylinder), extruded 3D text and a glTF
 * model.
 */
export function threeDLayers() {
	const camera = Layer.camera({
		id: "cam",
		targetX: CX,
		targetY: CY,
		targetZ: 0,
		animation: CameraAnimation.camera().orbit({
			azimuth: { from: -40, to: 25 },
			elevation: { from: 12, to: 22 },
			radius: { from: 1150, to: 850 },
			start: 0,
			end: THREE_D_FRAMES,
			ease: "sine.inOut",
		}),
	});

	const floor = Layer3D.roundedBox({
		id: "floor",
		width: 6000,
		height: 10,
		depth: 6000,
		x: CX,
		y: CY + 160,
		z: 0,
		color: "#1a1d26",
		roughness: 0.85,
	});

	const chrome = Layer3D.sphere({
		id: "chrome",
		radius: 90,
		x: CX - 300,
		y: CY + 70,
		z: 0,
		color: "#e8e8e8",
		metallic: 1,
		roughness: 0.15,
	});

	const satin = Layer3D.roundedBox({
		id: "satin",
		width: 170,
		height: 170,
		depth: 170,
		radius: 24,
		x: CX + 300,
		y: CY + 75,
		z: 60,
		color: "#ff5a1f",
		roughness: 0.45,
	}).animate(
		LayerAnimation.keys("rotateY", [
			[0, 0],
			[THREE_D_FRAMES, 120, "none"],
		]),
	);

	const neon = Layer3D.cylinder({
		id: "neon",
		radius: 14,
		height: 260,
		x: CX,
		y: CY + 30,
		z: -260,
		color: "#111111",
		emissive: "#4da3ff",
		emissiveIntensity: 4,
	});

	const gem = Layer.glb(asset("model.glb"), {
		id: "gem",
		x: CX,
		y: CY - 20,
		z: 40,
	}).animate(
		LayerAnimation.keys("rotateY", [
			[0, 0],
			[THREE_D_FRAMES, 360, "none"],
		]),
		LayerAnimation.keys("y", [
			[0, CY - 60],
			[THREE_D_FRAMES / 2, CY - 10, "sine.inOut"],
			[THREE_D_FRAMES, CY - 60, "sine.inOut"],
		]),
	);

	const title = Layer3D.extrudedText({
		id: "title-3d",
		text: "3D",
		fontFamily: "Syne",
		fontSize: 160,
		depth: 30,
		x: CX,
		y: CY - 230,
		z: -200,
		fill: "#f4f1ea",
	});

	return [
		...Lighting.studio({ target: [CX, CY, 0], bloom: true }),
		camera,
		floor,
		chrome,
		satin,
		neon,
		gem,
		title,
		label(
			"environment · shadows · bloom · camera orbit · primitives · extruded text · glTF",
		),
	];
}

export const THREE_D_BACKGROUND = INK;
