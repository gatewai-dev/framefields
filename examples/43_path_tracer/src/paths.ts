import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const ASSETS = path.join(ROOT, "assets");
export const OUTPUT = path.join(ROOT, "output");
export const SKY = path.join(ASSETS, "sun-sky.hdr");

/** Khronos glTF-Sample-Assets at a fixed commit. */
const SAMPLES =
	"https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/8f492390ddc7a2ae221a1369ef560589cf8c70fb/Models";

export interface Download {
	file: string;
	url: string;
	bytes: number;
	sha256: string;
	credit: string;
}

/** Skinned and animated (a walk cycle), base color texture. CC-BY 4.0. */
export const CESIUM_MAN: Download = {
	file: path.join(ASSETS, "CesiumMan.glb"),
	url: `${SAMPLES}/CesiumMan/glTF-Binary/CesiumMan.glb`,
	bytes: 438044,
	sha256: "b7001eaeea8254bd44773bcd247e78696d94169388fbb2a1800fc69434e777d9",
	credit: "Cesium Man © 2017 Cesium, CC-BY 4.0 (Khronos glTF-Sample-Assets)",
};

/** Base color, normal, metallic-roughness, occlusion and emissive maps. CC0. */
export const WATER_BOTTLE: Download = {
	file: path.join(ASSETS, "WaterBottle.glb"),
	url: `${SAMPLES}/WaterBottle/glTF-Binary/WaterBottle.glb`,
	bytes: 8966700,
	sha256: "b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b",
	credit: "Water Bottle, CC0 (Khronos glTF-Sample-Assets)",
};
