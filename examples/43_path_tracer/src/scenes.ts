/**
 * Three scenes that stress `environment.pathTrace` where it can break:
 *
 *  - character: Cesium Man walking (a skinned mesh whose BVH is refitted
 *    every frame) beside water bottles whose material has base color,
 *    normal, metallic-roughness, occlusion and emissive maps (the trace
 *    atlas and normal mapping);
 *  - sun: an HDRI whose sun carries most of the light (light sampling);
 *  - motion: two seconds of moving camera and objects with motion blur and
 *    bloom (frame-to-frame flicker of the per-frame denoiser).
 */
import {
	Composition,
	Layer,
	Layer3D,
	LayerAnimation,
	type LayoutNode,
} from "framefields";
import { CESIUM_MAN, SKY, WATER_BOTTLE } from "./paths.js";

export type PathTraceQuality = "draft" | "standard" | "high" | "reference";

export const W = 960;
export const H = 540;
export const FPS = 30;
const FLOOR = 420;

export interface SceneOptions {
	/** Raster instead of tracing (for comparison). */
	raster?: boolean;
	quality?: PathTraceQuality;
	frames?: number;
	/** Output size as a multiple of 960×540 (2 = 1920×1080); the framing stays the same. */
	scale?: number;
}

function composition(frames: number, scale = 1): Composition {
	return new Composition({
		width: W * scale,
		height: H * scale,
		fps: FPS,
		durationFrames: frames,
		backgroundColor: "#0c0e13",
	});
}

/** The scene's path tracing: the library's default preset (high) unless one is asked for. */
function trace(o: SceneOptions) {
	return o.raster
		? {}
		: { pathTrace: o.quality ? { quality: o.quality } : true };
}

/** Cesium Man, feet on the floor, `height` px tall, walking (its one clip, looped). */
function man(x: number, z: number, height: number, rotateY = 0): LayoutNode {
	return Layer.glb(CESIUM_MAN.file, {
		id: `man-${x}`,
		x,
		// The model's origin is between its feet.
		y: FLOOR,
		z,
		// About 1.5 m tall in model space.
		scale: height / 1.5,
		rotateX: 180,
		rotateY,
		loop: true,
		castShadow: true,
	}) as LayoutNode;
}

/** A water bottle standing on the floor, `height` px tall (0.26 m in model space). */
function bottle(x: number, z: number, height: number, rotateY = 0): LayoutNode {
	return Layer.glb(WATER_BOTTLE.file, {
		id: `bottle-${x}`,
		x,
		y: FLOOR - height / 2,
		z,
		scale: height / 0.26,
		rotateX: 180,
		rotateY,
		castShadow: true,
	}) as LayoutNode;
}

export function characterScene(o: SceneOptions = {}): Composition {
	const comp = composition(o.frames ?? FPS, o.scale);
	comp.add([
		Layer.camera({
			x: 480,
			y: 170,
			z: -760,
			targetX: 480,
			targetY: 250,
			targetZ: 0,
		}),
		Layer.environment("studio", {
			intensity: 0.9,
			floor: {
				y: FLOOR,
				color: "#3b3f47",
				reflectivity: 0.15,
				roughness: 0.45,
			},
			...trace(o),
		}),
		Layer.directionalLight({
			x: -200,
			y: -700,
			z: -500,
			targetX: 480,
			targetY: 300,
			targetZ: 0,
			intensity: 1.3,
			castShadow: true,
		}),
		Layer.rectLight({
			x: 900,
			y: 0,
			z: -200,
			targetX: 480,
			targetY: 250,
			targetZ: 0,
			width: 300,
			height: 300,
			intensity: 1.6,
			radius: 3000,
		}),
		man(400, 0, 340, 20),
		bottle(600, -60, 200, 30),
		bottle(700, 40, 170, -50),
	] as LayoutNode[]);
	return comp;
}

export function sunScene(o: SceneOptions = {}): Composition {
	const comp = composition(o.frames ?? 1, o.scale);
	comp.add([
		Layer.camera({
			x: 480,
			y: 190,
			z: -820,
			targetX: 480,
			targetY: 300,
			targetZ: 0,
		}),
		Layer.environment({
			hdri: SKY,
			intensity: 1,
			rotation: 0,
			exposure: -0.5,
			floor: {
				y: FLOOR,
				color: "#8d8a84",
				reflectivity: 0.04,
				roughness: 0.9,
				fadeDistance: 3000,
			},
			...trace(o),
		}),
		man(330, 40, 300, -25),
		bottle(470, -100, 150, 20),
		Layer3D.sphere({
			x: 560,
			y: FLOOR - 80,
			z: -20,
			radius: 80,
			color: "#e6e8ec",
			metallic: 1,
			roughness: 0.08,
			castShadow: true,
		}),
		Layer3D.sphere({
			x: 720,
			y: FLOOR - 70,
			z: -90,
			radius: 70,
			color: "#ffffff",
			material: "glass",
			castShadow: true,
		}),
		Layer3D.roundedBox({
			x: 680,
			y: FLOOR - 60,
			z: 160,
			width: 160,
			height: 120,
			depth: 160,
			radius: 8,
			color: "#d9d4ca",
			roughness: 0.7,
			castShadow: true,
		}),
	] as LayoutNode[]);
	return comp;
}

export function motionScene(o: SceneOptions = {}): Composition {
	const frames = o.frames ?? 2 * FPS;
	const comp = composition(frames, o.scale);
	const camera = Layer.camera({
		x: 480,
		y: 180,
		z: -800,
		targetX: 480,
		targetY: 300,
		targetZ: 0,
		motionBlur: { shutter: 180 },
	} as never);
	comp.add([
		camera.animate(
			LayerAnimation.create()
				.keys("x", [
					[0, 200],
					[frames - 1, 760, "sine.inOut"],
				])
				.keys("z", [
					[0, -700],
					[frames / 2, -900, "sine.inOut"],
					[frames - 1, -700, "sine.inOut"],
				]),
		),
		Layer.environment("night", {
			intensity: 0.5,
			bloom: { intensity: 0.4, threshold: 1.2, radius: 6 },
			floor: {
				y: FLOOR,
				color: "#22252c",
				reflectivity: 0.35,
				roughness: 0.25,
			},
			...trace(o),
		}),
		Layer.directionalLight({
			x: 0,
			y: -800,
			z: -400,
			targetX: 480,
			targetY: 300,
			targetZ: 0,
			intensity: 0.9,
			castShadow: true,
		}),
		man(380, 60, 300, 35),
		// A bouncing chrome ball and a spinning neon ring: fast motion and a bloom source.
		Layer3D.sphere({
			x: 640,
			y: FLOOR - 60,
			z: -60,
			radius: 60,
			color: "#dfe3ea",
			metallic: 1,
			roughness: 0.12,
			castShadow: true,
		}).animate(
			LayerAnimation.create().keys("y", [
				[0, FLOOR - 60],
				[15, FLOOR - 240, "power2.out"],
				[30, FLOOR - 60, "power2.in"],
				[45, FLOOR - 240, "power2.out"],
				[60, FLOOR - 60, "power2.in"],
			]),
		),
		Layer3D.torus({
			x: 760,
			y: FLOOR - 160,
			z: 120,
			radius: 90,
			tube: 10,
			color: "#111111",
			emissive: "#3fb6ff",
			emissiveIntensity: 4,
		}).animate(
			LayerAnimation.create().keys("rotateY", [
				[0, 0],
				[frames - 1, 360],
			]),
		),
	] as LayoutNode[]);
	return comp;
}
