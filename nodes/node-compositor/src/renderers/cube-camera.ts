import {
	type Camera3DPose,
	type CubeLensOptions,
	cameraBasis,
	defaultCubeFaceSize,
	type LensProjection,
	type LensRemapOptions,
	lensCenterDensity,
	type RelativisticObserver,
	type Vec3,
	Vector3Math,
} from "@framefields/webgpu-renderers";

/** Largest face a cube camera picks on its own; `lens.cubeSize` may go higher. */
const DEFAULT_MAX_FACE = 4096;

/** A camera drawn as a cube map and remapped through its lens. */
export interface CubeCamera {
	faceSize: number;
	remap: LensRemapOptions;
	/** Output pixels per radian at the centre of the view. */
	centerDensity: number;
}

interface AuthoredCamera {
	lens?: {
		projection?: LensProjection;
		fov?: number;
		zoom?: number;
		cubeSize?: number;
	};
	relativity?: {
		speed?: number;
		direction?: Vec3;
		doppler?: boolean;
		beaming?: boolean;
		exposure?: number | "auto";
	};
}

/**
 * The cube camera an authored camera asks for, or null for an ordinary
 * perspective view. A camera with `relativity` is always a cube camera, even
 * at speed 0, so a shot that accelerates from rest never switches pipelines.
 */
export function resolveCubeCamera(
	authored: AuthoredCamera | undefined,
	camera: Camera3DPose,
	speed: number,
	width: number,
	height: number,
	maxTextureSize: number,
): CubeCamera | null {
	const projection = authored?.lens?.projection ?? "perspective";
	const relativity = authored?.relativity;
	if (projection === "perspective" && !relativity) return null;
	const lens: CubeLensOptions = {
		projection,
		fov: camera.fov,
		zoom: camera.zoom,
	};
	const requested = authored?.lens?.cubeSize;
	const faceSize = Math.min(
		maxTextureSize,
		requested ??
			defaultCubeFaceSize(
				lens,
				width,
				height,
				Math.min(DEFAULT_MAX_FACE, maxTextureSize),
			),
	);
	const basis = cameraBasis(camera);
	const observer: RelativisticObserver | null = relativity
		? {
				speed,
				direction: relativity.direction
					? Vector3Math.normalize(relativity.direction)
					: basis.forward,
				doppler: relativity.doppler ?? true,
				beaming: relativity.beaming ?? true,
				exposure: relativity.exposure ?? "auto",
			}
		: null;
	return {
		faceSize,
		remap: { ...lens, basis, observer },
		centerDensity: lensCenterDensity(lens, width, height),
	};
}
