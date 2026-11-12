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

/** A glass vase of flowers: transmission and thickness. CC0. */
export const GLASS_VASE: Download = {
	file: path.join(ASSETS, "GlassVaseFlowers.glb"),
	url: `${SAMPLES}/GlassVaseFlowers/glTF-Binary/GlassVaseFlowers.glb`,
	bytes: 1819824,
	sha256: "faa2e19329961652b585cc62132ef50b1d95dca8a6a2fd63409158e680563761",
	credit:
		"Glass Vase Flowers: vase by Eric Chadwick, flowers by Rico Cilliers, CC0 (Khronos glTF-Sample-Assets)",
};

/** A lamp of iridescent glass (IOR 1.6, thin film). CC-BY 4.0. */
export const IRIDESCENCE_LAMP: Download = {
	file: path.join(ASSETS, "IridescenceLamp.glb"),
	url: `${SAMPLES}/IridescenceLamp/glTF-Binary/IridescenceLamp.glb`,
	bytes: 4083912,
	sha256: "17cfdc79ec9e38fadb28db159734c5f9592ca423977b546e5057e350ba29ff13",
	credit:
		"Iridescence Lamp © 2022 Wayfair, LLC (Eric Chadwick), CC-BY 4.0 (Khronos glTF-Sample-Assets)",
};

/** A mosquito inside a polished amber stone. CC-BY 4.0. */
export const AMBER: Download = {
	file: path.join(ASSETS, "MosquitoInAmber.glb"),
	url: `${SAMPLES}/MosquitoInAmber/glTF-Binary/MosquitoInAmber.glb`,
	bytes: 24229904,
	sha256: "1c0b49000650e8a8c00d69bc8d64e46d33527871a47d74e4f2278887325cc35f",
	credit:
		"Mosquito in Amber © 2018 Loïc Norgeot, © 2019 Sketchfab, CC-BY 4.0 (Khronos glTF-Sample-Assets)",
};

/** A bright photo studio with one large window and plants, 2048×1024. CC0. */
export const WINDOW_STUDIO: Download = {
	file: path.join(ASSETS, "brown_photostudio_02_2k.hdr"),
	url: "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/2k/brown_photostudio_02_2k.hdr",
	bytes: 6492863,
	sha256: "153ca0cb899575c00f5b23065958d250a0f73e8789c8cf5957ccea313baf2bb6",
	credit: "Brown Photostudio 02 by Sergej Majboroda, CC0 (Poly Haven)",
};
