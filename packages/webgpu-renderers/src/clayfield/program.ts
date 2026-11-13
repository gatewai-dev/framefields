/**
 * A Clayfield sculpture is a program: an ordered list of operations on a
 * scalar field, never a mesh. Solids and strokes add or carve material,
 * warps move what is already there, and inflate / detail shift the surface.
 * The field is evaluated where it is needed: per pixel by the raster pass,
 * per lattice point when something asks for triangles.
 *
 * Local space follows the primitives': px, centered on the origin, up is -y.
 */

type V3 = [number, number, number];

/** How a solid or stroke meets the material before it. */
export type ClayMode = "add" | "carve" | "intersect";

interface ClayMaterialOp {
	/** Default "add". */
	mode?: ClayMode;
	/** Blend radius of the join, px (0 = a hard edge). Default 0. */
	smoothness?: number;
	/** Surface color where this operation forms the surface. */
	color?: string;
}

interface ClayPlaced {
	/** Center, px. Default [0, 0, 0]. */
	center?: V3;
	/** Euler degrees [x, y, z]. */
	rotation?: V3;
}

export type ClaySolid = ClayMaterialOp &
	ClayPlaced &
	(
		| { type: "sphere"; radius: number }
		| {
				type: "box";
				size: V3;
				/** Corner rounding, px. */
				radius?: number;
		  }
		| { type: "cylinder" | "capsule"; radius: number; height: number }
		| { type: "torus"; radius: number; tube: number }
	);

/**
 * A brush stroke: a ball swept along a smooth curve through `path`. Each
 * point is [x, y, z] or [x, y, z, radius]; points without a radius take
 * `radius`.
 */
export interface ClayStroke extends ClayMaterialOp {
	type: "stroke";
	path: Array<V3 | [number, number, number, number]>;
	/** Brush radius, px. */
	radius: number;
	/** How much of the stroke is drawn, 0..1. Default 1. */
	progress?: number;
}

interface ClayWarpBase {
	/** Where the brush presses, px. */
	center: V3;
	/** Brush radius, px: the size of the region that moves most. */
	radius: number;
	/** Where the push fades to nothing, px. Default 4 × radius. */
	reach?: number;
}

/**
 * Elastic brushes (regularized Kelvinlets): the material already sculpted
 * answers a push as an incompressible elastic solid would.
 */
export type ClayWarp =
	| (ClayWarpBase & {
			type: "grab";
			/** How far the center is dragged, px. */
			delta: V3;
	  })
	| (ClayWarpBase & {
			type: "twist";
			/** Rotation axis. */
			axis: V3;
			/** Turn at the center, degrees. */
			angle: number;
	  })
	| (ClayWarpBase & {
			type: "bulge";
			/** Relative growth at the center: 0.3 swells by 30%, -0.3 shrinks. */
			amount: number;
	  });

/** Pushes the surface out (or in, negative) inside a round region. */
export interface ClayInflate {
	type: "inflate";
	center: V3;
	radius: number;
	/** px. */
	amount: number;
}

/**
 * Procedural surface detail (pores, stone, hammered metal). Octaves finer
 * than a pixel are left out where the surface is evaluated, so detail never
 * shimmers and costs nothing far away.
 */
export interface ClayDetail {
	type: "detail";
	/** Height of the largest features, px. */
	amplitude: number;
	/** Size of the largest features, px. */
	scale: number;
	/** 1..8. Default 4. */
	octaves?: number;
	/** Each octave's height relative to the one before. Default 0.5. */
	persistence?: number;
	/** Each octave's frequency relative to the one before. Default 2. */
	lacunarity?: number;
	/** Sharp creases instead of rolling bumps. */
	ridged?: boolean;
	seed?: number;
	/** Limit the detail to a round region. */
	center?: V3;
	radius?: number;
}

export type ClayOp =
	| ClaySolid
	| ClayStroke
	| ClayWarp
	| ClayInflate
	| ClayDetail;

export interface ClayGeometryOptions {
	type: "clay";
	ops: ClayOp[];
	/** Mirror the sculpture across these axes: "x", "xz", … */
	symmetry?: string;
	/**
	 * Clip the sculpture to this box [width, height, depth], px, centered on
	 * the origin. Default: fitted to the operations.
	 */
	bounds?: V3;
	/**
	 * Bricks along the longest side, 4..48. More bricks give each pixel less
	 * to evaluate and a finer distance cache, for more memory. Default 32.
	 */
	bricks?: number;
	/**
	 * Lattice cells along the longest side of the triangle mesh of the
	 * field, 16..1024. Default 64. Used where triangles are needed: `draw:
	 * "mesh"`, glass, blended, textured and instanced draws, path tracing,
	 * physics, scatter.
	 */
	resolution?: number;
	/**
	 * "field" (default) draws the field itself, per pixel: exact at any
	 * size. "mesh" draws its triangles at `resolution`: a mesh's cost, a
	 * mesh's fixed detail.
	 */
	draw?: "mesh" | "field";
	color?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	metallic?: number;
}
