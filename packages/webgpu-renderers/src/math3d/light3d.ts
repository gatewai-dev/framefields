/**
 * WebGPU 3D Lighting & Material Shading engine.
 * Supports Ambient, Directional, Point, and Spot light sources,
 * normal matrix computation for non-uniform surface scaling,
 * and binary uniform buffer packing for WGSL shaders.
 */

import { type Mat4, Matrix4Math } from "./matrix4.js";
import { type Vec3, Vector3Math } from "./vector3.js";

export type LightKind = "ambient" | "directional" | "point" | "spot";

export interface Light3DOptions {
	id?: string;
	lightType?: LightKind;
	type?: LightKind;
	color?: string | [number, number, number] | [number, number, number, number] | { r: number; g: number; b: number; a?: number } | unknown;
	intensity?: number;
	x?: number;
	y?: number;
	z?: number;
	position?: [number, number, number];
	targetX?: number;
	targetY?: number;
	targetZ?: number;
	target?: [number, number, number];
	direction?: [number, number, number];
	radius?: number; // Distance cutoff / range
	decay?: number; // Attenuation exponent (default 2.0)
	angle?: number; // Outer cone half-angle in degrees (default 45)
	penumbra?: number; // Softness fraction [0, 1] (default 0.2)
}

export interface GPULightData {
	/** xyz = position, w = type (0=ambient, 1=directional, 2=point, 3=spot) */
	posType: [number, number, number, number];
	/** xyz = normalized direction, w = radius */
	dirRadius: [number, number, number, number];
	/** rgb = linear color, w = intensity */
	colorIntensity: [number, number, number, number];
	/** x = cos(outer), y = cos(inner), z = decay, w = 0 */
	spotParams: [number, number, number, number];
}

export const MAX_LIGHTS = 8;
export const LIGHT_UNIFORM_SIZE_BYTES = 544; // 16 (ambient) + 16 (params) + 8 * 64 (lights)

export interface LightsUniformData {
	ambientColor: [number, number, number, number];
	params: [number, number, number, number];
	lights: GPULightData[];
}

/**
 * Parses CSS / hex / rgb color strings, arrays, or color objects into normalized linear [r, g, b] floats in [0, 1].
 */
export function parseColorToRgb(
	color?: string | [number, number, number] | [number, number, number, number] | { r: number; g: number; b: number; a?: number } | unknown,
): [number, number, number] {
	if (!color) return [1, 1, 1];
	if (Array.isArray(color)) {
		const r = color[0] ?? 1;
		const g = color[1] ?? 1;
		const b = color[2] ?? 1;
		return [r > 1 ? r / 255 : r, g > 1 ? g / 255 : g, b > 1 ? b / 255 : b];
	}
	if (typeof color === "object" && color !== null) {
		const r = (color as { r?: number }).r ?? 1;
		const g = (color as { g?: number }).g ?? 1;
		const b = (color as { b?: number }).b ?? 1;
		return [r > 1 ? r / 255 : r, g > 1 ? g / 255 : g, b > 1 ? b / 255 : b];
	}
	if (typeof color !== "string") return [1, 1, 1];
	const str = color.trim().toLowerCase();

	if (str.startsWith("#")) {
		const hex = str.slice(1);
		if (hex.length === 3) {
			const r = Number.parseInt(hex[0] + hex[0], 16) / 255;
			const g = Number.parseInt(hex[1] + hex[1], 16) / 255;
			const b = Number.parseInt(hex[2] + hex[2], 16) / 255;
			return [r, g, b];
		}
		if (hex.length >= 6) {
			const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
			const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
			const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
			return [r, g, b];
		}
	}

	const rgbMatch = str.match(/rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/);
	if (rgbMatch) {
		const r = Number.parseFloat(rgbMatch[1]) / 255;
		const g = Number.parseFloat(rgbMatch[2]) / 255;
		const b = Number.parseFloat(rgbMatch[3]) / 255;
		return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
	}

	const hslMatch = str.match(/hsla?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?/);
	if (hslMatch) {
		const h = Number.parseFloat(hslMatch[1]) / 360;
		const s = Number.parseFloat(hslMatch[2]) / 100;
		const l = Number.parseFloat(hslMatch[3]) / 100;
		return hslToRgb(h, s, l);
	}

	return [1, 1, 1];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
	if (s === 0) return [l, l, l];
	const hue2rgb = (p: number, q: number, t: number) => {
		let tt = t;
		if (tt < 0) tt += 1;
		if (tt > 1) tt -= 1;
		if (tt < 1 / 6) return p + (q - p) * 6 * tt;
		if (tt < 1 / 2) return q;
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
		return p;
	};
	const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
	const p = 2 * l - q;
	return [hue2rgb(p, q, h + 1 / 3), hue2rgb(p, q, h), hue2rgb(p, q, h - 1 / 3)];
}

export const Light3D = {
	/**
	 * Computes the 3x3 normal matrix (stored in 4x4 layout) from a 4x4 Model matrix.
	 * Evaluates N = (M^-1)^T to preserve true orthogonal surface normals under non-uniform scaling.
	 */
	computeNormalMatrix(modelMatrix: Mat4): Mat4 {
		const inv = Matrix4Math.invert(modelMatrix);
		if (!inv) {
			return Matrix4Math.identity();
		}
		// Transpose of the inverted matrix
		const normMat: Mat4 = [
			inv[0], inv[4], inv[8], 0,
			inv[1], inv[5], inv[9], 0,
			inv[2], inv[6], inv[10], 0,
			0, 0, 0, 1,
		];
		return normMat;
	},

	/**
	 * Converts high-level light options into uniform data ready for GPU packing.
	 */
	processLight(opt: Light3DOptions): GPULightData {
		const color = parseColorToRgb(opt.color);
		const intensity = opt.intensity ?? 1.0;
		const posX = opt.position ? opt.position[0] : (opt.x ?? 0);
		const posY = opt.position ? opt.position[1] : (opt.y ?? 0);
		const posZ = opt.position ? opt.position[2] : (opt.z ?? 0);

		const kind = opt.lightType ?? opt.type ?? "directional";
		let typeVal = 1.0; // default directional
		if (kind === "ambient") typeVal = 0.0;
		else if (kind === "directional") typeVal = 1.0;
		else if (kind === "point") typeVal = 2.0;
		else if (kind === "spot") typeVal = 3.0;

		let dir: Vec3 = [0, 0, -1];
		if (opt.direction) {
			dir = Vector3Math.normalize(opt.direction);
		} else if (
			opt.target ||
			opt.targetX !== undefined ||
			opt.targetY !== undefined ||
			opt.targetZ !== undefined
		) {
			const targetX = opt.target ? opt.target[0] : (opt.targetX ?? posX);
			const targetY = opt.target ? opt.target[1] : (opt.targetY ?? posY);
			const targetZ = opt.target ? opt.target[2] : (opt.targetZ ?? posZ);
			const target: Vec3 = [targetX, targetY, targetZ];
			const fromLight = Vector3Math.subtract(target, [posX, posY, posZ]);
			const len = Vector3Math.length(fromLight);
			if (len > 1e-4) {
				dir = Vector3Math.normalize(fromLight);
			}
		}

		const radius = Math.max(1.0, opt.radius ?? 1000);
		const decay = opt.decay ?? 2.0;
		const angleDeg = Math.max(0.1, Math.min(180, opt.angle ?? 45));
		const penumbraFrac = Math.max(0, Math.min(1, opt.penumbra ?? 0.2));

		const outerRad = (angleDeg * Math.PI) / 180;
		const innerRad = outerRad * (1 - penumbraFrac);
		const cosOuter = Math.cos(outerRad);
		const cosInner = Math.cos(innerRad);

		return {
			posType: [posX, posY, posZ, typeVal],
			dirRadius: [dir[0], dir[1], dir[2], radius],
			colorIntensity: [color[0], color[1], color[2], intensity],
			spotParams: [cosOuter, cosInner, decay, 0.0],
		};
	},

	/**
	 * Packs active scene lights into a Float32Array matching WGSL LightsUniforms layout.
	 */
	packLightsUniforms(lights: Light3DOptions[]): Float32Array {
		const buffer = new Float32Array(LIGHT_UNIFORM_SIZE_BYTES / 4);

		if (!lights || lights.length === 0) {
			// No lights: params.y = 0.0 indicates unlit mode
			buffer[4] = 0.0; // lightCount = 0
			buffer[5] = 0.0; // hasLights = 0.0 (unlit)
			return buffer;
		}

		let ambientR = 0;
		let ambientG = 0;
		let ambientB = 0;

		const directLights: GPULightData[] = [];

		for (const l of lights) {
			const kind = l.lightType ?? l.type;
			if (kind === "ambient") {
				const col = parseColorToRgb(l.color);
				const int = l.intensity ?? 1.0;
				ambientR += col[0] * int;
				ambientG += col[1] * int;
				ambientB += col[2] * int;
			} else {
				if (directLights.length < MAX_LIGHTS) {
					directLights.push(Light3D.processLight(l));
				}
			}
		}

		// Offset 0: ambientColor (vec4<f32>)
		buffer[0] = ambientR;
		buffer[1] = ambientG;
		buffer[2] = ambientB;
		buffer[3] = 1.0;

		// Offset 4: params (vec4<f32>)
		buffer[4] = directLights.length;
		buffer[5] = 1.0; // hasLights = 1.0 (lit mode)
		buffer[6] = 0.0;
		buffer[7] = 0.0;

		// Offset 8 onwards: array<GPULightData, 8> (each light = 16 floats = 64 bytes)
		let offset = 8;
		for (let i = 0; i < MAX_LIGHTS; i++) {
			if (i < directLights.length) {
				const dl = directLights[i];
				// posType
				buffer[offset + 0] = dl.posType[0];
				buffer[offset + 1] = dl.posType[1];
				buffer[offset + 2] = dl.posType[2];
				buffer[offset + 3] = dl.posType[3];
				// dirRadius
				buffer[offset + 4] = dl.dirRadius[0];
				buffer[offset + 5] = dl.dirRadius[1];
				buffer[offset + 6] = dl.dirRadius[2];
				buffer[offset + 7] = dl.dirRadius[3];
				// colorIntensity
				buffer[offset + 8] = dl.colorIntensity[0];
				buffer[offset + 9] = dl.colorIntensity[1];
				buffer[offset + 10] = dl.colorIntensity[2];
				buffer[offset + 11] = dl.colorIntensity[3];
				// spotParams
				buffer[offset + 12] = dl.spotParams[0];
				buffer[offset + 13] = dl.spotParams[1];
				buffer[offset + 14] = dl.spotParams[2];
				buffer[offset + 15] = dl.spotParams[3];
			} else {
				// Zero-fill unused light slots
				for (let j = 0; j < 16; j++) {
					buffer[offset + j] = 0.0;
				}
			}
			offset += 16;
		}

		return buffer;
	},
};
