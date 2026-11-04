import type {
	EnvironmentPreset,
	LightNode,
	ToneMapping,
} from "@framefields/compositions/program";
import { autoId } from "./ids.js";
import {
	type AnimatableNode,
	type EnvironmentOptions,
	Light,
} from "./index.js";

export interface LightingRigOptions {
	/** What the lights aim at (world px). Default: the canvas center at z 0. */
	target?: [number, number, number];
	/** How far the lights sit from the target. Default 1600. */
	distance?: number;
	/** Turns the whole rig (lights and environment) around the vertical axis, degrees. */
	rotation?: number;
	/** Scales every light. Default 1. */
	intensity?: number;
	/** Exposure in stops. Default 0. */
	exposure?: number;
	toneMapping?: ToneMapping;
	/** Key light casts a soft shadow. Default true. */
	shadows?: boolean;
	/** Shadow edge blur in texels. Default 3. */
	shadowSoftness?: number;
	/** Fog fading into the background, e.g. `{ color: BG, start: 2500, end: 6000 }`. */
	fog?: EnvironmentOptions["fog"];
	/** Volumetric fog & shadowed light shafts (god rays): `true` or settings. */
	volumetricFog?: EnvironmentOptions["volumetricFog"];
	/** Glow around emissive surfaces and highlights: `true` or settings. */
	bloom?: EnvironmentOptions["bloom"];
	/** Prefix for the rig's node ids. */
	id?: string;
}

interface RigSpec {
	environment: EnvironmentPreset;
	envIntensity: number;
	/** Light directions relative to the target, before `rotation`; y is down. */
	key: { dir: [number, number, number]; color: string; intensity: number };
	rim?: { dir: [number, number, number]; color: string; intensity: number };
	fill?: { dir: [number, number, number]; color: string; intensity: number };
}

const RIGS = {
	/** Product photography: soft overhead key with a shadow, cool rim, studio reflections. */
	studio: {
		environment: "studio",
		envIntensity: 1,
		key: { dir: [-0.55, -1, -0.7], color: "#fff6ec", intensity: 1.1 },
		rim: { dir: [0.9, -0.5, 0.9], color: "#dbe8ff", intensity: 0.9 },
	},
	/** Bright, airy, low contrast: lifestyle and UI-on-device shots. */
	soft: {
		environment: "soft",
		envIntensity: 1,
		key: { dir: [-0.4, -1, -0.8], color: "#ffffff", intensity: 1.0 },
	},
	/** Low warm sun, long shadows, cool sky fill. */
	sunset: {
		environment: "sunset",
		envIntensity: 0.9,
		key: { dir: [-1, -0.35, -0.3], color: "#ffb27a", intensity: 2.2 },
		fill: { dir: [0.8, -0.6, -0.4], color: "#7f9cff", intensity: 0.35 },
	},
	/** Moody: dark world, hard key, strong rim. Pair with emissive accents. */
	dramatic: {
		environment: "night",
		envIntensity: 0.8,
		key: { dir: [-0.8, -1, -0.35], color: "#ffffff", intensity: 2.4 },
		rim: { dir: [0.7, -0.4, 1], color: "#8fb4ff", intensity: 1.8 },
	},
} satisfies Record<string, RigSpec>;

export type LightingRig = keyof typeof RIGS;

function rotateY(
	[x, y, z]: [number, number, number],
	degrees: number,
): [number, number, number] {
	const r = (degrees * Math.PI) / 180;
	const c = Math.cos(r);
	const s = Math.sin(r);
	return [c * x + s * z, y, -s * x + c * z];
}

function aim(
	dir: [number, number, number],
	target: [number, number, number],
	distance: number,
	rotation: number,
): Pick<LightNode, "x" | "y" | "z" | "targetX" | "targetY" | "targetZ"> {
	const [dx, dy, dz] = rotateY(dir, rotation);
	const len = Math.hypot(dx, dy, dz) || 1;
	return {
		x: target[0] + (dx / len) * distance,
		y: target[1] + (dy / len) * distance,
		z: target[2] + (dz / len) * distance,
		targetX: target[0],
		targetY: target[1],
		targetZ: target[2],
	};
}

function rig(
	name: LightingRig,
	options: LightingRigOptions,
): AnimatableNode<LightNode>[] {
	const spec: RigSpec = RIGS[name];
	const target = options.target ?? [960, 540, 0];
	const distance = options.distance ?? 1600;
	const rotation = options.rotation ?? 0;
	const k = options.intensity ?? 1;
	const id = options.id ?? autoId(`lighting-${name}`);
	const nodes: AnimatableNode<LightNode>[] = [
		Light.environment(spec.environment, {
			id: `${id}-environment`,
			intensity: spec.envIntensity * k,
			rotation,
			exposure: options.exposure,
			toneMapping: options.toneMapping,
			fog: options.fog,
			volumetricFog: options.volumetricFog,
			bloom: options.bloom,
		}),
		Light.directional({
			id: `${id}-key`,
			color: spec.key.color,
			intensity: spec.key.intensity * k,
			...aim(spec.key.dir, target, distance, rotation),
			castShadow: options.shadows ?? true,
			shadowSoftness: options.shadowSoftness ?? 3,
		}),
	];
	for (const [part, light] of [
		["rim", spec.rim],
		["fill", spec.fill],
	] as const) {
		if (!light) continue;
		nodes.push(
			Light.directional({
				id: `${id}-${part}`,
				color: light.color,
				intensity: light.intensity * k,
				...aim(light.dir, target, distance, rotation),
			}),
		);
	}
	return nodes;
}

/**
 * Ready-made lighting: an environment (physical shading, tone mapping) plus
 * placed key / rim / fill lights, the key casting a soft shadow. Add the
 * returned nodes to the composition: `comp.add(Lighting.studio({ target }))`.
 *
 * Tweak from there rather than starting from zero: `intensity`, `exposure`,
 * `rotation` (turns the rig), `shadowSoftness`, `fog`.
 */
export const Lighting = {
	studio: (options: LightingRigOptions = {}) => rig("studio", options),
	soft: (options: LightingRigOptions = {}) => rig("soft", options),
	sunset: (options: LightingRigOptions = {}) => rig("sunset", options),
	dramatic: (options: LightingRigOptions = {}) => rig("dramatic", options),
};
