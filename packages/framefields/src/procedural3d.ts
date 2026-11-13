/**
 * Procedural 3D builders behind `Layer3D.terrain`, `Layer3D.sdf` and
 * `Layer3D.scatter`. Each returns an ordinary model node, so it takes
 * materials, lights, physics, layer textures (image, video, any layout) and
 * animation like every other Layer3D mesh.
 */
import type {
	LayoutNode,
	Model3DNode,
	Scatter3DSpec,
	WindConfig,
} from "@framefields/compositions/program";
import {
	type ClayGeometryOptions,
	createTerrainSampler,
	getPrimitiveGeometry,
	type Mat4,
	Matrix4Math,
	type Model3DData,
	type PrimitiveGeometryOptions,
	type ScatterOptions,
	type ScatterPoint,
	type SdfGeometryOptions,
	scatterOnSurface,
	type TerrainGeometryOptions,
	type TerrainSampler,
	terrainSegments,
} from "@framefields/webgpu-renderers";
import type { AnimatableNode } from "./index.js";
import {
	type Instances3DOptions,
	Layer3D,
	type Primitive3DNodeOptions,
	primitiveNode,
} from "./shapes3d.js";

type GeometryKeys = "type" | "color" | "material";

export type Terrain3DOptions = Primitive3DNodeOptions &
	Omit<TerrainGeometryOptions, GeometryKeys> & {
		/**
		 * Custom heights: `(u, v) => 0..1` over the grid (u across x, v across
		 * z, both 0..1 from the near-left corner). Sampled into `heights`.
		 */
		heightFn?: (u: number, v: number) => number;
	};

export type Sdf3DOptions = Primitive3DNodeOptions &
	Omit<SdfGeometryOptions, GeometryKeys>;

export type Clay3DOptions = Primitive3DNodeOptions &
	Omit<ClayGeometryOptions, GeometryKeys>;

export type Scatter3DOptions = Omit<
	Instances3DOptions,
	"count" | "instanceAt" | "transforms" | "bodies"
> &
	ScatterOptions & {
		/** The surface: `Layer3D.terrain`, `Layer3D.sdf`, any primitive or `Layer.model`. */
		surface: AnimatableNode<Model3DNode>;
		/** Push each instance this far into the surface, px. Default 0. */
		sink?: number;
		/** Procedural wind sway; the meshes bend from their base. */
		wind?: WindConfig;
	};

/** Where a model node's mesh sits: its static transform. */
function staticMatrix(n: Partial<Model3DNode>): Mat4 {
	const rad = Math.PI / 180;
	const s = n.scale ?? 1;
	let m = Matrix4Math.translate(n.x ?? 0, n.y ?? 0, n.z ?? 0);
	if (n.rotateZ)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateZ(n.rotateZ * rad));
	if (n.rotateY)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateY(n.rotateY * rad));
	if (n.rotateX)
		m = Matrix4Math.multiply(m, Matrix4Math.rotateX(n.rotateX * rad));
	return Matrix4Math.multiply(
		m,
		Matrix4Math.scale(
			s * (n.scaleX ?? 1),
			s * (n.scaleY ?? 1),
			s * (n.scaleZ ?? 1),
		),
	);
}

/** A terrain node's helpers for standing other layers on it. */
export interface TerrainSurface {
	/**
	 * Surface y at (x, z) in the terrain's parent space (where its own x, y,
	 * z live), so a camera, light, video screen or model can stand on it.
	 * Follows the terrain's position and scale; rotation is not applied.
	 */
	heightAt(x: number, z: number): number;
	/** Unit surface normal at (x, z), parent space (unrotated). */
	normalAt(x: number, z: number): [number, number, number];
	/** Normalized altitude 0..1 at (x, z). */
	elevationAt(x: number, z: number): number;
}

export type Terrain3DNode = AnimatableNode<Model3DNode> & TerrainSurface;

function defineHidden(target: object, values: Record<string, unknown>): void {
	for (const [key, value] of Object.entries(values)) {
		Object.defineProperty(target, key, {
			value,
			enumerable: false,
			configurable: true,
		});
	}
}

function surfaceHelpers(
	sampler: TerrainSampler,
	o: Terrain3DOptions,
): TerrainSurface {
	const s = o.scale ?? 1;
	const sx = s * (o.scaleX ?? 1);
	const sy = s * (o.scaleY ?? 1);
	const sz = s * (o.scaleZ ?? 1);
	const local = (x: number, z: number): [number, number] => [
		(x - (o.x ?? 0)) / sx,
		(z - (o.z ?? 0)) / sz,
	];
	return {
		heightAt: (x, z) => (o.y ?? 0) + sampler.heightAt(...local(x, z)) * sy,
		elevationAt: (x, z) => sampler.elevationAt(...local(x, z)),
		normalAt(x, z) {
			const n = sampler.normalAt(...local(x, z));
			// Normals take the inverse scale.
			const m = [n[0] / sx, n[1] / sy, n[2] / sz];
			const len = Math.hypot(m[0]!, m[1]!, m[2]!) || 1;
			return [m[0]! / len, m[1]! / len, m[2]! / len];
		},
	};
}

/** Procedural terrain (see `Layer3D.terrain`). */
export function terrain3d(options: Terrain3DOptions): Terrain3DNode {
	const { heightFn, ...o } = options;
	const geometry: TerrainGeometryOptions = {
		type: "terrain",
		width: o.width,
		depth: o.depth,
		height: o.height,
		segments: o.segments,
		noise: o.noise,
		heights: o.heights,
		overhangWarp: o.overhangWarp,
		colorByElevation: o.colorByElevation,
		flatShaded: o.flatShaded,
		base: o.base,
	};
	if (heightFn) {
		const [cols, rows] = terrainSegments(geometry);
		const heights: number[] = [];
		for (let j = 0; j <= rows; j++)
			for (let i = 0; i <= cols; i++)
				heights.push(heightFn(i / cols, j / rows));
		geometry.heights = heights;
	}
	const node = primitiveNode("terrain", geometry, o) as Terrain3DNode;
	defineHidden(
		node,
		surfaceHelpers(
			createTerrainSampler(geometry),
			options,
		) as unknown as Record<string, unknown>,
	);
	return node;
}

/** A signed-distance sculpture (see `Layer3D.sdf`). */
export function sdf3d(options: Sdf3DOptions): AnimatableNode<Model3DNode> {
	return primitiveNode(
		"sdf",
		{
			type: "sdf",
			primitives: options.primitives,
			bounds: options.bounds,
			resolution: options.resolution,
			flatShaded: options.flatShaded,
		},
		options,
	);
}

/** A Clayfield sculpture (see `Layer3D.clay`). */
export function clay3d(options: Clay3DOptions): AnimatableNode<Model3DNode> {
	return primitiveNode(
		"clay",
		{
			type: "clay",
			ops: options.ops,
			symmetry: options.symmetry,
			bounds: options.bounds,
			bricks: options.bricks,
			resolution: options.resolution,
			draw: options.draw,
		},
		options,
	);
}

const SURFACE_KEYS = [
	"x",
	"y",
	"z",
	"rotateX",
	"rotateY",
	"rotateZ",
	"scale",
	"scaleX",
	"scaleY",
	"scaleZ",
	"primitive3d",
	"src",
	"modelFormat",
	"center",
	"normalizeSize",
] as const;

/** What the renderer rebuilds and places the surface from. */
function surfaceSpec(surface: Partial<Model3DNode>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const k of SURFACE_KEYS) {
		if (surface[k] !== undefined) out[k] = surface[k];
	}
	// In-memory meshes with nothing to rebuild them from travel as they are.
	if (!surface.primitive3d && !surface.src && surface.modelData)
		out.modelData = surface.modelData;
	return out;
}

/** The surface's mesh when it is already in memory (primitives, terrain, SDF). */
function surfaceModel(surface: Partial<Model3DNode>): Model3DData | undefined {
	const data = surface.modelData as Model3DData | undefined;
	if (data && "meshes" in data) return data;
	if (surface.primitive3d)
		return getPrimitiveGeometry(
			surface.primitive3d as PrimitiveGeometryOptions,
		);
	return undefined;
}

const SCATTER_KEYS = [
	"count",
	"minDistance",
	"seed",
	"slopeRange",
	"elevationRange",
	"alignToNormal",
	"scaleRange",
	"randomYaw",
	"exclude",
	"sink",
] as const;

export type Scatter3DNode = AnimatableNode<Model3DNode> & {
	/**
	 * The scattered points (surface position, normal, rotation, scale) in the
	 * surface's parent space, for placing other layers among the instances.
	 * Empty for a surface loaded from a file (its mesh is read at render).
	 */
	points(): ScatterPoint[];
};

/** Instances scattered on a surface (see `Layer3D.scatter`). */
export function scatter3d(options: Scatter3DOptions): Scatter3DNode {
	const { surface, wind, ...rest } = options;
	const spec: Record<string, unknown> = {
		surface: surfaceSpec(surface as Partial<Model3DNode>),
	};
	const instanceOptions: Record<string, unknown> = { ...rest };
	for (const k of SCATTER_KEYS) {
		if (rest[k] !== undefined) spec[k] = rest[k];
		delete instanceOptions[k];
	}
	const node = Layer3D.instances(
		instanceOptions as unknown as Instances3DOptions,
	) as Scatter3DNode;
	const target = node as unknown as Model3DNode;
	target.scatter3d = spec as unknown as Scatter3DSpec;
	if (wind) target.wind = wind;
	defineHidden(node, {
		points: (): ScatterPoint[] => {
			const model = surfaceModel(surface as Partial<Model3DNode>);
			if (!model) return [];
			return scatterOnSurface(
				{ model, matrix: staticMatrix(surface as Partial<Model3DNode>) },
				spec as unknown as ScatterOptions,
			).points;
		},
	});
	return node;
}

/**
 * Share of a scatter's surface its slope / altitude filters keep (for
 * `lint`), or undefined when the surface is a file not loaded yet.
 */
export function scatterCoverage(spec: Scatter3DSpec): number | undefined {
	const surface = spec.surface as Partial<Model3DNode>;
	const model = surfaceModel(surface);
	if (!model) return undefined;
	return scatterOnSurface(
		{ model, matrix: staticMatrix(surface) },
		{ ...spec, count: 0 },
	).acceptedArea;
}

/** `texture` on a Layer3D mesh: an image path, or any layer drawn each frame. */
export function textureLayerOf(
	texture: string | LayoutNode,
	image: (src: string) => LayoutNode,
): { node: LayoutNode } {
	return { node: typeof texture === "string" ? image(texture) : texture };
}
