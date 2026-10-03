/**
 * Camera 3D mathematics, kinematics, and projection solver.
 * Provides unified View-Projection matrices, LookAt target tracking,
 * spherical orbit turntable, multi-octave camera shake, and rack-focus CoC solvers.
 */

import { type Mat4, Matrix4Math } from "./matrix4.js";
import { type Vec3, Vector3Math } from "./vector3.js";

export interface Camera3DPose {
	/** Camera Eye position in world space [x, y, z] */
	eye: Vec3;
	/** LookAt Target / Point of Interest [x, y, z] */
	target: Vec3;
	/** Camera Up vector (default [0, -1, 0] for Y-down screen coordinates) */
	up: Vec3;
	/** Vertical field of view in degrees (default 50) */
	fov: number;
	/** Viewport aspect ratio (width / height) */
	aspect: number;
	/** Near clipping plane distance (default 1.0) */
	near: number;
	/** Far clipping plane distance (default 50000.0) */
	far: number;
	/** Optical zoom multiplier (default 1.0) */
	zoom: number;
	/** Focal plane distance from camera for Depth of Field in pixels */
	focusDistance?: number;
	/** Lens f-number / aperture (e.g. 1.4, 2.8, 5.6) */
	fStop?: number;
	/** Maximum bokeh blur radius in pixels (default 32) */
	maxBlurRadius?: number;
}

export interface CameraShakeOptions {
	translationAmplitude: number;
	rotationAmplitude: number;
	frequency?: number;
	octaves?: number;
	seed?: number;
}

export type FrustumPlane = [number, number, number, number]; // [a, b, c, d] where ax + by + cz + d >= 0

export interface FrustumPlanes {
	left: FrustumPlane;
	right: FrustumPlane;
	bottom: FrustumPlane;
	top: FrustumPlane;
	near: FrustumPlane;
	far: FrustumPlane;
}

/** Deterministic pseudo-random gradient noise generator */
function pseudoNoise(t: number, seed: number): number {
	const n = Math.sin(t * 12.9898 + seed * 78.233) * 43758.5453123;
	const frac = n - Math.floor(n);
	return frac * 2.0 - 1.0;
}

/** Smooth multi-harmonic procedural continuous noise */
function smoothHarmonicNoise(t: number, seed: number, octaves = 3): number {
	let total = 0;
	let frequency = 1.0;
	let amplitude = 1.0;
	let maxAmp = 0;

	for (let i = 0; i < octaves; i++) {
		const s1 = Math.sin(t * frequency * 2.0 * Math.PI + seed + i * 1.7);
		const s2 = Math.cos(t * frequency * 1.414 * Math.PI + seed * 2.1 + i * 0.9);
		total += (s1 * 0.6 + s2 * 0.4) * amplitude;
		maxAmp += amplitude;
		frequency *= 2.0;
		amplitude *= 0.5;
	}

	return maxAmp > 0 ? total / maxAmp : 0;
}

export const Camera3D = {
	/**
	 * Creates a default canvas-aligned 3D camera.
	 * Calibrated so that layers at Z=0 project 1:1 with 2D canvas pixel coordinates.
	 */
	createDefaultCamera(
		width: number,
		height: number,
		fovDegrees = 50,
	): Camera3DPose {
		const fovRad = (fovDegrees * Math.PI) / 180;
		const distance = height / 2.0 / Math.tan(fovRad / 2.0);

		return {
			eye: [width / 2.0, height / 2.0, -distance],
			target: [width / 2.0, height / 2.0, 0],
			up: [0, -1, 0], // Y-down to match 2D canvas
			fov: fovDegrees,
			aspect: Math.max(1e-4, width / height),
			near: 1.0,
			far: 50000.0,
			zoom: 1.0,
			focusDistance: distance,
			fStop: 2.8,
			maxBlurRadius: 32,
		};
	},

	/**
	 * Computes LookAt view matrix from camera pose.
	 */
	computeViewMatrix(camera: Camera3DPose): Mat4 {
		return Matrix4Math.lookAt(camera.eye, camera.target, camera.up);
	},

	/**
	 * Computes WebGPU [0, 1] perspective projection matrix with zoom factor.
	 */
	computeProjectionMatrix(camera: Camera3DPose): Mat4 {
		const fovRad = (camera.fov * Math.PI) / 180;
		const p = Matrix4Math.perspective(
			fovRad,
			camera.aspect,
			camera.near,
			camera.far,
		);

		if (camera.zoom !== 1.0 && camera.zoom > 0) {
			p[0] *= camera.zoom;
			p[5] *= camera.zoom;
		}

		return p;
	},

	/**
	 * Computes combined View-Projection matrix: VP = P x V.
	 */
	computeViewProjectionMatrix(camera: Camera3DPose): Mat4 {
		const v = Camera3D.computeViewMatrix(camera);
		const p = Camera3D.computeProjectionMatrix(camera);
		return Matrix4Math.multiply(p, v);
	},

	/**
	 * Dolly camera along optical viewing axis.
	 * Positive delta moves eye closer to target.
	 */
	dolly(
		eye: Vec3,
		target: Vec3,
		deltaDistance: number,
	): { eye: Vec3; target: Vec3 } {
		const forward = Vector3Math.normalize(Vector3Math.subtract(target, eye));
		const move = Vector3Math.multiplyScalar(forward, deltaDistance);
		return {
			eye: Vector3Math.add(eye, move),
			target,
		};
	},

	/**
	 * Truck (lateral X) and Pedestal (vertical Y) camera translation in local camera space.
	 */
	truckPedestal(
		eye: Vec3,
		target: Vec3,
		up: Vec3,
		deltaX: number,
		deltaY: number,
	): { eye: Vec3; target: Vec3 } {
		const forward = Vector3Math.normalize(Vector3Math.subtract(target, eye));
		const right = Vector3Math.normalize(Vector3Math.cross(forward, up));
		const trueUp = Vector3Math.cross(right, forward);

		const moveX = Vector3Math.multiplyScalar(right, deltaX);
		const moveY = Vector3Math.multiplyScalar(trueUp, deltaY);
		const totalMove = Vector3Math.add(moveX, moveY);

		return {
			eye: Vector3Math.add(eye, totalMove),
			target: Vector3Math.add(target, totalMove),
		};
	},

	/**
	 * Computes camera Eye position orbiting around target in spherical coordinates.
	 * @param target Center point of orbit.
	 * @param radius Distance from target.
	 * @param azimuthDeg Horizontal orbit angle in degrees.
	 * @param elevationDeg Vertical elevation angle in degrees (from horizon).
	 */
	orbit(
		target: Vec3,
		radius: number,
		azimuthDeg: number,
		elevationDeg: number,
	): Vec3 {
		const azRad = (azimuthDeg * Math.PI) / 180;
		const elRad = (elevationDeg * Math.PI) / 180;

		const cosEl = Math.cos(elRad);
		const sinEl = Math.sin(elRad);
		const cosAz = Math.cos(azRad);
		const sinAz = Math.sin(azRad);

		const x = target[0] + radius * cosEl * sinAz;
		const y = target[1] - radius * sinEl; // negative for Y-down coordinates
		const z = target[2] - radius * cosEl * cosAz;

		return [x, y, z];
	},
	/**
	 * Applies Euler orientation angles (pitch, yaw, roll) in degrees to a camera pose.
	 * Pitch rotates around camera local Right axis (tilt up/down).
	 * Yaw rotates around camera local Up axis (pan left/right).
	 * Roll rotates around camera optical Forward axis (bank counter/clockwise).
	 */
	applyOrientation(
		pose: Camera3DPose,
		pitchDeg: number,
		yawDeg: number,
		rollDeg: number,
	): Camera3DPose {
		if (pitchDeg === 0 && yawDeg === 0 && rollDeg === 0) {
			return pose;
		}

		const forward = Vector3Math.normalize(
			Vector3Math.subtract(pose.target, pose.eye),
		);
		const right = Vector3Math.normalize(Vector3Math.cross(forward, pose.up));
		const trueUp = Vector3Math.cross(right, forward);
		const dist = Vector3Math.distance(pose.eye, pose.target);

		let fwd = forward;
		let up = trueUp;

		// 1. Yaw (pan around Up)
		if (yawDeg !== 0) {
			const yawRad = (yawDeg * Math.PI) / 180;
			const cosY = Math.cos(yawRad);
			const sinY = Math.sin(yawRad);
			fwd = Vector3Math.normalize(
				Vector3Math.subtract(
					Vector3Math.multiplyScalar(fwd, cosY),
					Vector3Math.multiplyScalar(right, sinY),
				),
			);
		}

		// Recompute right after yaw
		const currentRight = Vector3Math.normalize(Vector3Math.cross(fwd, up));

		// 2. Pitch (tilt around Right)
		if (pitchDeg !== 0) {
			const pitchRad = (pitchDeg * Math.PI) / 180;
			const cosP = Math.cos(pitchRad);
			const sinP = Math.sin(pitchRad);
			fwd = Vector3Math.normalize(
				Vector3Math.add(
					Vector3Math.multiplyScalar(fwd, cosP),
					Vector3Math.multiplyScalar(up, sinP),
				),
			);
			up = Vector3Math.normalize(Vector3Math.cross(currentRight, fwd));
		}

		// 3. Roll (bank around optical axis fwd)
		if (rollDeg !== 0) {
			const rollRad = (rollDeg * Math.PI) / 180;
			const cosR = Math.cos(rollRad);
			const sinR = Math.sin(rollRad);
			up = Vector3Math.normalize(
				Vector3Math.add(
					Vector3Math.multiplyScalar(up, cosR),
					Vector3Math.multiplyScalar(currentRight, sinR),
				),
			);
		}

		const newTarget = Vector3Math.add(
			pose.eye,
			Vector3Math.multiplyScalar(fwd, dist),
		);

		return {
			...pose,
			target: newTarget,
			up,
		};
	},

	/**
	 * Applies continuous procedural 3D camera shake (Simplex/harmonic noise).
	 */
	applyCameraShake(
		pose: Camera3DPose,
		timeSeconds: number,
		options: CameraShakeOptions,
	): Camera3DPose {
		const {
			translationAmplitude,
			rotationAmplitude,
			frequency = 2.5,
			octaves = 3,
			seed = 42,
		} = options;

		if (translationAmplitude <= 0 && rotationAmplitude <= 0) {
			return pose;
		}

		const t = timeSeconds * frequency;
		const dx = smoothHarmonicNoise(t, seed, octaves) * translationAmplitude;
		const dy =
			smoothHarmonicNoise(t, seed + 101.5, octaves) * translationAmplitude;
		const dz =
			smoothHarmonicNoise(t, seed + 203.7, octaves) *
			(translationAmplitude * 0.5);

		const rotX =
			smoothHarmonicNoise(t, seed + 307.1, octaves) * rotationAmplitude;
		const rotY =
			smoothHarmonicNoise(t, seed + 409.3, octaves) * rotationAmplitude;

		const forward = Vector3Math.normalize(
			Vector3Math.subtract(pose.target, pose.eye),
		);
		const right = Vector3Math.normalize(Vector3Math.cross(forward, pose.up));
		const trueUp = Vector3Math.cross(right, forward);

		const disp = Vector3Math.add(
			Vector3Math.multiplyScalar(right, dx),
			Vector3Math.add(
				Vector3Math.multiplyScalar(trueUp, dy),
				Vector3Math.multiplyScalar(forward, dz),
			),
		);

		const newEye = Vector3Math.add(pose.eye, disp);
		const newTarget = Vector3Math.add(
			pose.target,
			Vector3Math.add(
				Vector3Math.multiplyScalar(right, rotY * 10),
				Vector3Math.multiplyScalar(trueUp, rotX * 10),
			),
		);

		return {
			...pose,
			eye: newEye,
			target: newTarget,
		};
	},

	/**
	 * Computes Circle of Confusion (CoC) blur radius for Depth of Field.
	 * Points at depth == focusDistance produce 0.0 (sharp).
	 */
	computeCircleOfConfusion(
		depth: number,
		focusDistance: number,
		focalLengthMm: number,
		fStop: number,
		maxBlurRadius = 32,
	): number {
		if (focusDistance <= 0 || fStop <= 0 || depth <= 0) return 0;
		const delta = Math.abs(depth - focusDistance);
		const aperture = focalLengthMm / fStop;
		const coc = (delta / depth) * aperture * 0.5;
		return Math.min(maxBlurRadius, Math.max(0, coc));
	},

	/**
	 * Extracts the 6 frustum clipping planes from a View-Projection matrix.
	 */
	computeCameraFrustumPlanes(vp: Mat4): FrustumPlanes {
		const normalizePlane = (p: FrustumPlane): FrustumPlane => {
			const len = Math.hypot(p[0], p[1], p[2]);
			if (len === 0) return p;
			return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];
		};

		return {
			left: normalizePlane([
				vp[3] + vp[0],
				vp[7] + vp[4],
				vp[11] + vp[8],
				vp[15] + vp[12],
			]),
			right: normalizePlane([
				vp[3] - vp[0],
				vp[7] - vp[4],
				vp[11] - vp[8],
				vp[15] - vp[12],
			]),
			bottom: normalizePlane([
				vp[3] + vp[1],
				vp[7] + vp[5],
				vp[11] + vp[9],
				vp[15] + vp[13],
			]),
			top: normalizePlane([
				vp[3] - vp[1],
				vp[7] - vp[5],
				vp[11] - vp[9],
				vp[15] - vp[13],
			]),
			near: normalizePlane([vp[2], vp[6], vp[10], vp[14]]),
			far: normalizePlane([
				vp[3] - vp[2],
				vp[7] - vp[6],
				vp[11] - vp[10],
				vp[15] - vp[14],
			]),
		};
	},

	/**
	 * Checks whether an axis-aligned 3D bounding box intersects the camera frustum.
	 */
	isBoxInFrustum(min: Vec3, max: Vec3, planes: FrustumPlanes): boolean {
		const planeList: FrustumPlane[] = [
			planes.left,
			planes.right,
			planes.bottom,
			planes.top,
			planes.near,
			planes.far,
		];

		for (const p of planeList) {
			const px = p[0] > 0 ? max[0] : min[0];
			const py = p[1] > 0 ? max[1] : min[1];
			const pz = p[2] > 0 ? max[2] : min[2];
			if (p[0] * px + p[1] * py + p[2] * pz + p[3] < 0) {
				return false;
			}
		}
		return true;
	},
};
