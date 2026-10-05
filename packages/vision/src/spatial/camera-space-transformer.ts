import type { Landmark3D } from "@framefields/core";

export interface Camera3DSpec {
	readonly width: number;
	readonly height: number;
	readonly fov?: number; // In degrees, default 60
	readonly cameraDistance?: number;
}

export interface ProjectedScreenCoordinate {
	readonly x: number; // In canvas pixels [0, width]
	readonly y: number; // In canvas pixels [0, height]
	readonly z: number; // Depth in canvas units
	readonly scale: number; // Perspective foreshortening scale
}

export class SpatialLandmarkTransformer {
	private width: number;
	private height: number;
	private fovRad: number;
	private focalDistance: number;

	constructor(camera: Camera3DSpec) {
		this.width = camera.width;
		this.height = camera.height;
		const fovDeg = camera.fov ?? 60;
		this.fovRad = (fovDeg * Math.PI) / 180;
		this.focalDistance =
			camera.cameraDistance ?? this.height / 2 / Math.tan(this.fovRad / 2);
	}

	/**
	 * Projects a normalized landmark [0, 1] into 2D/3D canvas coordinates.
	 */
	public projectNormalizedLandmark(
		landmark: Landmark3D,
		offsetZ = 0,
	): ProjectedScreenCoordinate {
		const screenX = landmark.x * this.width;
		const screenY = landmark.y * this.height;
		// Normalized landmark z is roughly scaled relative to width
		const rawZ = landmark.z * this.width + offsetZ;

		// Perspective foreshortening: S = d / (d - z)
		const effectiveZ = Math.min(rawZ, this.focalDistance - 10);
		const scale = this.focalDistance / (this.focalDistance - effectiveZ);

		return {
			x: screenX,
			y: screenY,
			z: rawZ,
			scale: Math.max(0.1, scale),
		};
	}

	/**
	 * Projects a metric world landmark [X_w, Y_w, Z_w] in meters into canvas space.
	 */
	public projectWorldLandmark(
		worldLandmark: Landmark3D,
		subjectDistanceMeters = 2.0,
		scaleMetersToPixels = 800,
	): ProjectedScreenCoordinate {
		// Subject centered at canvas center (width/2, height/2)
		const centerX = this.width / 2;
		const centerY = this.height / 2;

		const worldX = worldLandmark.x * scaleMetersToPixels;
		const worldY = worldLandmark.y * scaleMetersToPixels;
		const worldZ =
			(worldLandmark.z + subjectDistanceMeters) * scaleMetersToPixels;

		const effectiveZ = Math.min(worldZ, this.focalDistance - 10);
		const scale = this.focalDistance / (this.focalDistance - effectiveZ);

		return {
			x: centerX + worldX * scale,
			y: centerY + worldY * scale,
			z: worldZ,
			scale: Math.max(0.1, scale),
		};
	}
}
