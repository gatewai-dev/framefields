/**
 * @file packages/framefields/src/swarm3d.ts
 * GPU-Simulated 3D Particle Swarm & Faceted Shards (`Layer3D.swarm`).
 */

import type {
	MaterialType,
	Model3DNode,
} from "@framefields/compositions/program";
import { autoId } from "./ids.js";
import { type AnimatableNode, Layer } from "./index.js";
import type { PhysicsDriver } from "./physics/core.js";
import { Layer3D, type Surface3DOptions } from "./shapes3d.js";

export interface Swarm3DOptions extends Surface3DOptions {
	id?: string;
	startFrame?: number;
	durationFrames?: number;
	/** Maximum 3D mesh particles alive at once (default 2000, up to 100000). */
	max?: number;
	seed?: number;
	/**
	 * Geometry drawn per particle:
	 * - `"shard"` (default: 8 procedural shard variants)
	 * - `{ type: "shard", variants?: number, facets?: number, irregularity?: number, bevel?: number }`
	 * - `"sphere" | "roundedBox" | "cylinder"`
	 * - `AnimatableNode<Model3DNode> | Array<AnimatableNode<Model3DNode>>`
	 */
	mesh?:
		| "shard"
		| "sphere"
		| "roundedBox"
		| "cylinder"
		| {
				type: "shard";
				variants?: number;
				facets?: number;
				irregularity?: number;
				bevel?: number;
		  }
		| AnimatableNode<Model3DNode>
		| Array<AnimatableNode<Model3DNode>>;
	/** Particle radius/scale in px at birth -> death (default [18, 12]). */
	size?: number | [number, number];
	sizeJitter?: number;
	fade?: [number, number];
	emitter?: {
		shape?: "point" | "box" | "sphere" | "shell" | "ring" | "disc";
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		z?: PhysicsDriver;
		width?: number;
		height?: number;
		depth?: number;
		radius?: number;
		rate?: PhysicsDriver;
		bursts?: Array<{ frame: number; count: number }>;
	};
	lifetime?: number | [number, number];
	speed?: number | [number, number];
	direction?: [number, number, number];
	spread?: number;
	angularSpeed?: number | [number, number];
	angularDrag?: PhysicsDriver;
	gravity?: PhysicsDriver | [PhysicsDriver, PhysicsDriver, PhysicsDriver];
	drag?: PhysicsDriver;
	noise?: {
		strength?: PhysicsDriver;
		scale?: number;
		speed?: number;
	};
	attractors?: Array<{
		x: PhysicsDriver;
		y: PhysicsDriver;
		z: PhysicsDriver;
		strength: PhysicsDriver;
		radius?: number;
	}>;
	vortex?: {
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		z?: PhysicsDriver;
		axis?: [number, number, number];
		/** Tangential swirl acceleration (px/s²). */
		swirl?: PhysicsDriver;
		/** Radial pull toward the vortex center/axis (px/s²). */
		pull?: PhysicsDriver;
		/** Axial acceleration along `axis` (px/s²). */
		axial?: PhysicsDriver;
		radius?: number;
	};
	floor?: {
		y: number;
		bounce?: number;
		/** Sliding friction damping (0 = ice, 3 = rough stone). Default 1.5. */
		friction?: PhysicsDriver;
		/** How strongly floor scraping & sharp acceleration build up `heat`. Default 1.0. */
		heatGain?: number;
		/** Seconds for friction/acceleration heat to cool down. Default 0.45. */
		heatDecay?: number;
	};
	/** Base surface color (default "#232026"). */
	color?: string | string[];
	roughness?: number;
	metallic?: number;
	material?: MaterialType;
	shininess?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	/** Dynamic HDR emission driven by particle speed and/or friction heat. */
	heat?: {
		/** Source driver: `"friction"` | `"speed"` | `"both"` (default `"both"`). */
		source?: "friction" | "speed" | "both";
		/** Speed (px/s) that reaches full heat=1 when source includes speed (default 900). */
		maxSpeed?: number;
		/** Emissive color ramp from cool (0) to hot (1). */
		color: string | string[];
		/** Peak HDR emissiveIntensity at heat = 1 (feeds bloom when > 2.5). Default 5.0. */
		intensity?: PhysicsDriver;
		/** Power curve shaping the heat ramp (default 1.6). */
		curve?: number;
	};
	/** Optional secondary fine sparks spawned from hot/scraping shards in 3D. */
	sparks?: {
		max?: number;
		rate?: number;
		threshold?: number;
		size?: number | [number, number];
		lifetime?: number | [number, number];
		speed?: number | [number, number];
		stretch?: number;
		color?: string | string[];
		intensity?: number;
	};
	substeps?: number;
	prewarm?: number;
}

export function createSwarm3D(
	options: Swarm3DOptions,
): AnimatableNode<Model3DNode> {
	let meshVariants: Array<AnimatableNode<Model3DNode>>;

	if (Array.isArray(options.mesh)) {
		meshVariants = options.mesh;
	} else if (
		options.mesh &&
		typeof options.mesh === "object" &&
		"kind" in options.mesh
	) {
		meshVariants = [options.mesh as AnimatableNode<Model3DNode>];
	} else if (
		options.mesh &&
		typeof options.mesh === "object" &&
		options.mesh.type === "shard"
	) {
		const numVariants = Math.max(1, options.mesh.variants ?? 8);
		meshVariants = [];
		for (let i = 0; i < numVariants; i++) {
			meshVariants.push(
				Layer3D.shard({
					radius: 20,
					facets: options.mesh.facets ?? 12 + (i % 6),
					seed: (options.seed ?? 1) * 31 + i * 17,
					irregularity: options.mesh.irregularity ?? 0.35,
				}),
			);
		}
	} else if (options.mesh === "sphere") {
		meshVariants = [Layer3D.sphere({ radius: 20 })];
	} else if (options.mesh === "roundedBox") {
		meshVariants = [Layer3D.roundedBox({ size: [30, 30, 30] })];
	} else if (options.mesh === "cylinder") {
		meshVariants = [Layer3D.cylinder({ radius: 15, height: 35 })];
	} else {
		// Default: 8 procedural shard variants
		const numVariants = 8;
		meshVariants = [];
		for (let i = 0; i < numVariants; i++) {
			meshVariants.push(
				Layer3D.shard({
					radius: 20,
					facets: 10 + (i % 8) * 2,
					seed: (options.seed ?? 42) + i * 13,
					irregularity: 0.35 + (i % 3) * 0.1,
				}),
			);
		}
	}

	const node: Model3DNode = {
		id: options.id ?? autoId("swarm3d"),
		kind: "model3d",
		x: 0,
		y: 0,
		z: 0,
		opacity: 1,
		twoSided: true,
		material: options.material ?? "lit",
		roughness: options.roughness ?? 0.35,
		metallic: options.metallic ?? 0.7,
		specularIntensity: options.specularIntensity ?? 0.5,
		ambientIntensity: options.ambientIntensity ?? 1.0,
		startFrame: options.startFrame,
		durationFrames: options.durationFrames,
		swarm3d: {
			...options,
			meshVariants,
		},
	};

	const primary = meshVariants[0] as unknown as Record<string, unknown>;
	if (primary) {
		if (primary.modelData) node.modelData = primary.modelData;
		if (primary.primitive3d) node.primitive3d = primary.primitive3d;
	}

	return Layer.model(
		node as unknown as Partial<Model3DNode>,
	) as unknown as AnimatableNode<Model3DNode>;
}
