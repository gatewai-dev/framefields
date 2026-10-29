import type {
	BoxNode,
	LayoutNode,
	MaterialType,
	Model3DNode,
} from "@framefields/compositions/program";
import {
	type CapsuleGeometryOptions,
	type CylinderGeometryOptions,
	type ExtrudeShapeGeometryOptions,
	generateExtrudedTextGeometry,
	getPrimitiveGeometry,
	type LatheGeometryOptions,
	type Line3DGeometryOptions,
	type Model3DData,
	Path3D,
	type Points3DGeometryOptions,
	type PolyhedronGeometryOptions,
	type PrimitiveGeometryOptions,
	type RingGeometryOptions,
	type RoundedBoxGeometryOptions,
	type ShardGeometryOptions,
	SlugFontCache,
	type SphereGeometryOptions,
	type TorusGeometryOptions,
	type TubeGeometryOptions,
	type TubePathSpec,
} from "@framefields/webgpu-renderers";
import { autoId } from "./ids.js";
import { type AnimatableNode, Layer } from "./index.js";
import type { PhysicsBody3D } from "./physics/world3d.js";
import { createSwarm3D, type Swarm3DOptions } from "./swarm3d.js";

/** Physically based surface options every 3D builder accepts. */
export interface Surface3DOptions {
	/** Light the surface gives off: a CSS color added on top of lighting. */
	emissive?: string;
	/** Emissive multiplier; above 1 glows past white and blooms. Default 1. */
	emissiveIntensity?: number;
	/** Falls into a `castShadow` light's shadow map (meshes default on, flat layers off). */
	castShadow?: boolean;
}

const MATERIAL_KEYS = [
	"material",
	"shininess",
	"roughness",
	"specularIntensity",
	"metallic",
	"ambientIntensity",
	"ior",
	"transmission",
	"dispersion",
	"fresnelPower",
	"envIntensity",
	"emissive",
	"emissiveIntensity",
	"castShadow",
] as const;

/** The material and surface options that were actually given. */
function materialProps(o: object): Record<string, unknown> {
	const src = o as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const k of MATERIAL_KEYS) {
		if (src[k] !== undefined) out[k] = src[k];
	}
	return out;
}

export interface CubeFaceConfig extends Surface3DOptions {
	background?: string;
	borderRadius?: number;
	borderWidth?: number;
	borderColor?: string;
	opacity?: number;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	children?: LayoutNode[];
}

export type CubeFaceInput = CubeFaceConfig | LayoutNode | string;

export interface Cube3DOptions extends Surface3DOptions {
	id?: string;
	size: number | [number, number, number];
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	faces?: {
		front?: CubeFaceInput;
		back?: CubeFaceInput;
		left?: CubeFaceInput;
		right?: CubeFaceInput;
		top?: CubeFaceInput;
		bottom?: CubeFaceInput;
	};
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
}

export interface Carousel3DOptions {
	id?: string;
	radius: number;
	items: LayoutNode[];
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	faceInward?: boolean;
	itemWidth?: number;
	itemHeight?: number;
	twoSided?: boolean;
	opacity?: number;
}

export interface Prism3DOptions extends Surface3DOptions {
	id?: string;
	/** Number of polygon sides (default 6). */
	sides?: number;
	/** Circumradius of the polygon (default 60). */
	radius?: number;
	/** Optional top (-y) radius; defaults to `radius`. */
	radiusTop?: number;
	/** Optional bottom (+y) radius; defaults to `radius`. */
	radiusBottom?: number;
	/** Height along Y (default 100). */
	height?: number;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	/** Leave the top and bottom polygon caps off (default false = solid capped prism). */
	openEnded?: boolean;
	/** Flat-shade each polygonal side facet (default true for crisp prism edges). */
	flatShaded?: boolean;
	/** Draw triangle edges instead of filled surfaces. */
	wireframe?: boolean;
	/** Surface color baked into the mesh (default `#3b82f6`). */
	color?: string;
	/** Animated color multiplier (`node.color`). */
	tint?: string;
	/** Optional per-side panel configs; when provided, builds a multi-panel preserve-3d container. */
	sideConfigs?: Array<CubeFaceInput>;
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
	startFrame?: number;
	durationFrames?: number;
}

export interface Pyramid3DOptions extends Surface3DOptions {
	id?: string;
	/** Number of base polygon sides (default 4 = square pyramid; 3 = triangular pyramid). */
	sides?: number;
	/** Circumradius of the base polygon (default 60). */
	radius?: number;
	/** Optional top (-y) truncation radius for a frustum pyramid (default 0 = sharp apex). */
	radiusTop?: number;
	/** Height from base (+y) to apex (-y) (default 100). */
	height?: number;
	/** Leave the base cap off (default false = solid capped pyramid). */
	openEnded?: boolean;
	/** Flat-shade each triangular side face (default true). */
	flatShaded?: boolean;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	wireframe?: boolean;
	color?: string;
	tint?: string;
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
	startFrame?: number;
	durationFrames?: number;
}

export interface Plane3DOptions extends Surface3DOptions {
	id?: string;
	width: number;
	height: number;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	background?: string;
	borderRadius?: number;
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	metallic?: number;
	ambientIntensity?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
	children?: LayoutNode[];
}

export interface Grid3DOptions {
	id?: string;
	width: number;
	height: number;
	divisions?: number;
	color?: string;
	/** Line thickness in world pixels (default 2). */
	lineWidth?: number;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	opacity?: number;
}

export interface Text3DOptions extends Surface3DOptions {
	id?: string;
	text: string;
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: number | string;
	fontStyle?: string;
	fill?: string;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	align?: "start" | "center" | "end" | "left" | "right";
	/**
	 * Base direction: "auto" (default) takes it from the first strong
	 * character, so Arabic and Hebrew read right to left. "start"/"end"
	 * alignment follows it.
	 */
	direction?: "ltr" | "rtl" | "auto";
	verticalAlign?: "top" | "middle" | "bottom";
	letterSpacing?: number;
	lineHeight?: number;
	is3D?: boolean;
	twoSided?: boolean;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
	background?: string;
	borderRadius?: number;
	padding?: number;
	stroke?: string;
	strokeWidth?: number;
	extrusionDepth?: number;
	/** @deprecated No effect: extruded text is one solid mesh, not a stack of slices. */
	extrusionSteps?: number;
	/**
	 * Extruded text only: color of the side walls. `fill` colors the letter
	 * faces (front and back). Defaults to `fill`.
	 */
	bevelColor?: string;
}

export interface ExtrudedText3DOptions extends Text3DOptions {
	depth: number;
	/** @deprecated No effect: extruded text is one solid mesh, not a stack of slices. */
	slices?: number;
	/** Fixed straight segments per curve; by default curves split as finely as their on-screen size needs. */
	curveSegments?: number;
	/** Most a flattened curve strays from the outline, in on-screen px at scale 1 (default 0.1). */
	curveTolerance?: number;
}

/** Node props shared by the mesh primitives (roundedBox, sphere, cylinder, torus, capsule, …). */
export interface Primitive3DNodeOptions extends Surface3DOptions {
	id?: string;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	scaleX?: number;
	scaleY?: number;
	scaleZ?: number;
	/** Render both front and back faces (default false for closed solids). */
	twoSided?: boolean;
	/** Draw triangle edges instead of filled surfaces. */
	wireframe?: boolean;
	/** Surface color baked into the mesh (default white). */
	color?: string;
	/**
	 * Multiplies the surface color. It is the node's `color`, so animate it
	 * with `.keys("color", …)`; the baked surface `color` stays fixed.
	 */
	tint?: string;
	material?: MaterialType;
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	metallic?: number;
	ior?: number;
	transmission?: number;
	dispersion?: number;
	fresnelPower?: number;
	envIntensity?: number;
	opacity?: number;
	startFrame?: number;
	durationFrames?: number;
}

export type RoundedBox3DOptions = Primitive3DNodeOptions &
	Omit<RoundedBoxGeometryOptions, "type" | "color" | "material">;
export type Sphere3DOptions = Primitive3DNodeOptions &
	Omit<SphereGeometryOptions, "type" | "color" | "material">;
export type Cylinder3DOptions = Primitive3DNodeOptions &
	Omit<CylinderGeometryOptions, "type" | "color" | "material">;
export type Torus3DOptions = Primitive3DNodeOptions &
	Omit<TorusGeometryOptions, "type" | "color" | "material">;
export type Capsule3DOptions = Primitive3DNodeOptions &
	Omit<CapsuleGeometryOptions, "type" | "color" | "material">;
export type Ring3DOptions = Primitive3DNodeOptions &
	Omit<RingGeometryOptions, "type" | "color" | "material">;
export type Polyhedron3DOptions = Primitive3DNodeOptions &
	Omit<PolyhedronGeometryOptions, "type" | "color" | "material"> & {
		/** Alias for `shape` (`"tetrahedron" | "octahedron" | "dodecahedron" | "icosahedron" | "icosphere"`). */
		type?: PolyhedronGeometryOptions["shape"];
	};
export type Icosphere3DOptions = Omit<Polyhedron3DOptions, "shape" | "type">;
export type ExtrudeShape3DOptions = Primitive3DNodeOptions &
	Omit<ExtrudeShapeGeometryOptions, "type" | "color" | "material">;
export type Lathe3DOptions = Primitive3DNodeOptions &
	Omit<LatheGeometryOptions, "type" | "color" | "material">;
export type Tube3DOptions = Primitive3DNodeOptions &
	Omit<TubeGeometryOptions, "type" | "color" | "material" | "path"> & {
		/** A `Path3D` instance, `TubePathSpec`, or array of 3D waypoints `[x, y, z]`. */
		path?: Path3D | TubePathSpec;
		/** Alias for `path` when passing an array of 3D waypoints `[x, y, z]` or a `Path3D`. */
		points?: Path3D | TubePathSpec;
	};
export type Line3DOptions = Primitive3DNodeOptions &
	Omit<Line3DGeometryOptions, "type" | "color" | "material" | "points"> & {
		/** A `Path3D` instance, `TubePathSpec`, or array of 3D points `[x, y, z]`. */
		points?: Path3D | TubePathSpec;
		/** Alias for `points` when passing a `Path3D` or `TubePathSpec`. */
		path?: Path3D | TubePathSpec;
	};
export type Points3DOptions = Primitive3DNodeOptions &
	Omit<Points3DGeometryOptions, "type" | "color" | "material" | "points"> & {
		/** A `Path3D` instance, `TubePathSpec`, or array of 3D points `[x, y, z]`. */
		points: Path3D | TubePathSpec;
	};
export type Shard3DOptions = Primitive3DNodeOptions &
	Omit<ShardGeometryOptions, "type" | "color" | "material">;

export interface InstanceTransform3D {
	x: number;
	y: number;
	z: number;
	/** Euler degrees [rx, ry, rz] or unit quaternion [qx, qy, qz, qw]. */
	rotation?: [number, number, number] | [number, number, number, number];
	scale?: number;
	color?: string | [number, number, number, number];
	emissive?: string | [number, number, number];
	emissiveIntensity?: number;
}

export interface Instances3DOptions extends Surface3DOptions {
	id?: string;
	/** One mesh node/primitive, or an array of mesh variants distributed across instances. */
	mesh: AnimatableNode<Model3DNode> | Array<AnimatableNode<Model3DNode>>;
	/** Count of instances when driven by `instanceAt` or `bodies`. */
	count?: number;
	/** Bind directly to Physics.world3d rigid bodies. */
	bodies?: readonly PhysicsBody3D[];
	/** Per-frame callback `(index, frame, fps) => InstanceTransform3D`. */
	instanceAt?: (
		index: number,
		frame: number,
		fps: number,
	) => InstanceTransform3D | undefined;
	/** Pre-computed array of instance transforms. */
	transforms?: InstanceTransform3D[];
	/** Optional speed/impact-to-emissive mapping when bound to `bodies`. */
	emissiveBySpeed?: {
		color: string | string[];
		maxSpeed: number;
		intensity?: number;
	};
	emissiveByImpact?: { color: string; intensity?: number };
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	scale?: number;
	color?: string;
	colorTint?: string;
	opacity?: number;
	twoSided?: boolean;
	wireframe?: boolean;
	material?: MaterialType;
	roughness?: number;
	metallic?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
	startFrame?: number;
	durationFrames?: number;
}

/** Mesh shading the geometry can bake in; layer materials (glass, …) apply on the node. */
function meshShading(
	material: MaterialType | undefined,
): "lit" | "unlit" | "toon" | undefined {
	return material === "lit" || material === "unlit" || material === "toon"
		? material
		: undefined;
}

function normalizePathSpec(input: Path3D | TubePathSpec): TubePathSpec {
	if (input instanceof Path3D) {
		return input.getPoints(96);
	}
	return input;
}

function primitiveNode(
	prefix: string,
	geometry: PrimitiveGeometryOptions,
	o: Primitive3DNodeOptions,
): AnimatableNode<Model3DNode> {
	// Only defined keys, so equal shapes share one cached mesh.
	const spec = Object.fromEntries(
		Object.entries({
			...geometry,
			color: o.color,
			material: meshShading(o.material),
			shininess: o.shininess,
			roughness: o.roughness,
			metallic: o.metallic,
		}).filter(([, v]) => v !== undefined),
	) as unknown as PrimitiveGeometryOptions;
	return Layer.model({
		id: o.id ?? autoId(prefix),
		modelData: getPrimitiveGeometry(spec),
		// What the compositor rebuilds the mesh from when modelData did not
		// survive (a spec sent as JSON).
		primitive3d: spec,
		is3D: true,
		x: o.x ?? 0,
		y: o.y ?? 0,
		z: o.z ?? 0,
		rotateX: o.rotateX ?? 0,
		rotateY: o.rotateY ?? 0,
		rotateZ: o.rotateZ ?? 0,
		scale: o.scale ?? 1,
		scaleX: o.scaleX ?? 1,
		scaleY: o.scaleY ?? 1,
		scaleZ: o.scaleZ ?? 1,
		opacity: o.opacity ?? 1,
		color: o.tint,
		material: o.material,
		shininess: o.shininess ?? 32,
		roughness: o.roughness,
		specularIntensity: o.specularIntensity ?? 0.5,
		ambientIntensity: o.ambientIntensity ?? 1.0,
		metallic: o.metallic,
		...materialProps(o),
		twoSided: o.twoSided ?? false,
		wireframe: o.wireframe,
		startFrame: o.startFrame,
		durationFrames: o.durationFrames,
	});
}

export type Shape3DContainer = AnimatableNode<BoxNode> & {
	faces?: AnimatableNode<BoxNode>[];
	items?: LayoutNode[];
	[Symbol.iterator](): Iterator<LayoutNode>;
};

export type SolidShape3DNode = AnimatableNode<Model3DNode> & {
	faces?: LayoutNode[];
	items?: LayoutNode[];
	[Symbol.iterator](): Iterator<LayoutNode>;
};

/**
 * Attaches the faces/items handles as non-enumerable properties, like
 * `animate`, so they stay out of `toSpec()` and schema validation.
 */
function withParts<T extends object>(
	node: T,
	parts: { faces?: LayoutNode[]; items?: LayoutNode[] },
): T & Shape3DContainer {
	const list = (parts.faces ?? parts.items ?? []) as LayoutNode[];
	for (const [key, value] of Object.entries(parts)) {
		Object.defineProperty(node, key, {
			value,
			enumerable: false,
			configurable: true,
		});
	}
	Object.defineProperty(node, Symbol.iterator, {
		value: function* () {
			yield* list;
		},
		enumerable: false,
		configurable: true,
	});
	return node as T & Shape3DContainer;
}

/** Largest initial scale of an extruded text node along its outline's axes. */
function extrudedTextScale(options: ExtrudedText3DOptions): number {
	const scale = options.scale ?? 1;
	const s = Math.max(
		Math.abs(scale * (options.scaleX ?? 1)),
		Math.abs(scale * (options.scaleY ?? 1)),
	);
	return s > 0 ? s : 1;
}

export const Layer3D = {
	/**
	 * Creates a true 3D volumetric cube with 6 textured or colored faces.
	 * Returns a preserve-3d container that can be transformed in 3D camera space.
	 */
	cube(options: Cube3DOptions): Shape3DContainer {
		const size = options.size;
		const [w, h, d] = typeof size === "number" ? [size, size, size] : size;
		const twoSided = options.twoSided ?? true;
		const defaultColors = {
			front: "#3b82f6",
			back: "#1d4ed8",
			left: "#2563eb",
			right: "#1e40af",
			top: "#60a5fa",
			bottom: "#172554",
		};

		const buildFace = (
			faceId: string,
			input: CubeFaceInput | undefined,
			defaultColor: string,
			faceW: number,
			faceH: number,
			faceProps: Partial<BoxNode>,
		): AnimatableNode<BoxNode> => {
			if (input && typeof input === "object" && "kind" in input) {
				const node = input as AnimatableNode<BoxNode>;
				node.position = "absolute";
				node.is3D = true;
				node.twoSided = twoSided;
				node.material = node.material ?? options.material ?? "lit";
				node.shininess = node.shininess ?? options.shininess ?? 32;
				node.specularIntensity =
					node.specularIntensity ?? options.specularIntensity ?? 0.5;
				if (options.roughness !== undefined && node.roughness === undefined) {
					node.roughness = options.roughness;
				}
				if (options.metallic !== undefined && node.metallic === undefined) {
					node.metallic = options.metallic;
				}
				if (
					options.ambientIntensity !== undefined &&
					node.ambientIntensity === undefined
				) {
					node.ambientIntensity = options.ambientIntensity;
				}
				Object.assign(node, faceProps);
				return node;
			}
			const cfg: CubeFaceConfig =
				typeof input === "string"
					? { background: input }
					: (input ?? { background: defaultColor });

			return Layer.box({
				id: `${options.id ?? "cube"}-${faceId}`,
				position: "absolute",
				width: faceW,
				height: faceH,
				is3D: true,
				twoSided,
				material: cfg.material ?? options.material ?? "lit",
				shininess: cfg.shininess ?? options.shininess ?? 32,
				specularIntensity:
					cfg.specularIntensity ?? options.specularIntensity ?? 0.5,
				roughness: cfg.roughness ?? options.roughness,
				metallic: cfg.metallic ?? options.metallic,
				ambientIntensity:
					cfg.ambientIntensity ?? options.ambientIntensity ?? 1.0,
				...materialProps({
					...options,
					...cfg,
				}),
				background: cfg.background ?? defaultColor,
				borderRadius: cfg.borderRadius ?? 0,
				borderWidth: cfg.borderWidth,
				borderColor: cfg.borderColor,
				opacity: cfg.opacity ?? 1,
				children: cfg.children ?? [],
				...faceProps,
			});
		};

		const halfW = w / 2;
		const halfH = h / 2;
		const halfD = d / 2;

		const faces: AnimatableNode<BoxNode>[] = [
			buildFace("front", options.faces?.front, defaultColors.front, w, h, {
				x: 0,
				y: 0,
				z: -halfD,
				rotateX: 0,
				rotateY: 0,
				rotateZ: 0,
			}),
			buildFace("back", options.faces?.back, defaultColors.back, w, h, {
				x: 0,
				y: 0,
				z: halfD,
				rotateX: 0,
				rotateY: 180,
				rotateZ: 0,
			}),
			buildFace("left", options.faces?.left, defaultColors.left, d, h, {
				x: -halfW,
				y: 0,
				z: 0,
				rotateX: 0,
				rotateY: 90,
				rotateZ: 0,
			}),
			buildFace("right", options.faces?.right, defaultColors.right, d, h, {
				x: halfW,
				y: 0,
				z: 0,
				rotateX: 0,
				rotateY: -90,
				rotateZ: 0,
			}),
			buildFace("top", options.faces?.top, defaultColors.top, w, d, {
				x: 0,
				y: -halfH,
				z: 0,
				rotateX: -90,
				rotateY: 0,
				rotateZ: 0,
			}),
			buildFace("bottom", options.faces?.bottom, defaultColors.bottom, w, d, {
				x: 0,
				y: halfH,
				z: 0,
				rotateX: 90,
				rotateY: 0,
				rotateZ: 0,
			}),
		];

		const container = Layer.box({
			id: options.id ?? autoId("cube"),
			position: "absolute",
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			width: w,
			height: h,
			is3D: true,
			transformStyle: "preserve-3d",
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			opacity: options.opacity ?? 1,
			background: "transparent",
			children: faces,
		});

		return withParts(container, { faces });
	},

	/**
	 * Creates a 3D cylindrical carousel of items arranged radially around a center point.
	 */
	carousel(options: Carousel3DOptions): Shape3DContainer {
		const { items, radius, faceInward = false, twoSided = true } = options;
		const n = items.length;
		const angleStep = n > 0 ? 360 / n : 0;

		const transformedItems = items.map((item, idx) => {
			// Item 0 sits nearest the default camera (-z) and the ring runs clockwise
			// seen from above. A face's front normal is (-sin ry, 0, -cos ry) (the
			// cube's convention: rotateY 90 faces -x), so the outward normal
			// (sin a, 0, -cos a) needs ry = -a, and inward needs 180 - a.
			const angleDeg = idx * angleStep;
			const rad = (angleDeg * Math.PI) / 180;
			const x = radius * Math.sin(rad);
			const z = -radius * Math.cos(rad);
			const ry = faceInward ? 180 - angleDeg : -angleDeg;

			const node = item as AnimatableNode<BoxNode>;
			node.position = "absolute";
			node.is3D = true;
			node.twoSided = twoSided;
			node.x = x;
			node.y = 0;
			node.z = z;
			node.rotateY = ry;
			return node;
		});

		const container = Layer.box({
			id: options.id ?? autoId("carousel"),
			position: "absolute",
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			width: options.itemWidth ?? 200,
			height: options.itemHeight ?? 200,
			is3D: true,
			transformStyle: "preserve-3d",
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			opacity: options.opacity ?? 1,
			background: "transparent",
			children: transformedItems,
		});

		return withParts(container, { items: transformedItems });
	},

	/**
	 * Creates an N-sided regular polygonal 3D prism with top and bottom caps,
	 * outward flat-shaded facet normals, and full material options.
	 * If `sideConfigs` are provided, builds a multi-panel preserve-3d container with all material props applied.
	 */
	prism(options: Prism3DOptions): Shape3DContainer {
		const n = Math.max(3, Math.round(options.sides));
		if (options.sideConfigs && options.sideConfigs.length > 0) {
			const { radius, height, twoSided = true } = options;
			const sideWidth = 2 * radius * Math.tan(Math.PI / n);
			const angleStep = 360 / n;
			const panels: AnimatableNode<BoxNode>[] = [];

			for (let i = 0; i < n; i++) {
				const angleDeg = i * angleStep;
				const rad = (angleDeg * Math.PI) / 180;
				const x = radius * Math.sin(rad);
				const z = -radius * Math.cos(rad);
				const input = options.sideConfigs[i];
				const defaultColor = options.color ?? `hsl(${(i * 360) / n}, 70%, 50%)`;

				if (input && typeof input === "object" && "kind" in input) {
					const node = input as AnimatableNode<BoxNode>;
					node.position = "absolute";
					node.is3D = true;
					node.twoSided = twoSided;
					node.x = x;
					node.y = 0;
					node.z = z;
					node.rotateY = -angleDeg;
					Object.assign(node, materialProps(options));
					panels.push(node);
					continue;
				}

				const cfg: CubeFaceConfig =
					typeof input === "string"
						? { background: input }
						: (input ?? { background: defaultColor });

				panels.push(
					Layer.box({
						id: `${options.id ?? "prism"}-panel-${i}`,
						position: "absolute",
						width: sideWidth,
						height,
						is3D: true,
						twoSided,
						x,
						y: 0,
						z,
						rotateY: -angleDeg,
						background: cfg.background ?? defaultColor,
						borderRadius: cfg.borderRadius ?? 0,
						borderWidth: cfg.borderWidth,
						borderColor: cfg.borderColor,
						opacity: cfg.opacity ?? options.opacity ?? 1,
						material: cfg.material ?? options.material ?? "lit",
						shininess: cfg.shininess ?? options.shininess ?? 32,
						specularIntensity:
							cfg.specularIntensity ?? options.specularIntensity ?? 0.5,
						ambientIntensity:
							cfg.ambientIntensity ?? options.ambientIntensity ?? 1.0,
						...materialProps({ ...options, ...cfg }),
						children: cfg.children ?? [],
					}),
				);
			}

			const container = Layer.box({
				id: options.id ?? autoId("prism"),
				position: "absolute",
				x: options.x ?? 0,
				y: options.y ?? 0,
				z: options.z ?? 0,
				width: sideWidth,
				height,
				is3D: true,
				transformStyle: "preserve-3d",
				rotateX: options.rotateX ?? 0,
				rotateY: options.rotateY ?? 0,
				rotateZ: options.rotateZ ?? 0,
				opacity: options.opacity ?? 1,
				background: "transparent",
				children: panels,
			});

			return withParts(container, { faces: panels });
		}

		const modelNode = primitiveNode(
			"prism",
			{
				type: "cylinder",
				radius: options.radius,
				radiusTop: options.radiusTop ?? options.radius,
				radiusBottom: options.radiusBottom ?? options.radius,
				height: options.height,
				segments: n,
				openEnded: options.openEnded ?? false,
				flatShaded: options.flatShaded ?? true,
			},
			{
				...options,
				color: options.color ?? "#3b82f6",
				twoSided: options.twoSided ?? Boolean(options.openEnded),
			},
		);

		return withParts(modelNode, {
			faces: [modelNode],
			items: [modelNode],
		}) as unknown as Shape3DContainer;
	},

	/**
	 * Creates a solid N-sided regular polygonal pyramid (or truncated pyramid when `radiusTop > 0`)
	 * with a bottom cap and crisp flat-shaded side facets.
	 */
	pyramid(options: Pyramid3DOptions): AnimatableNode<Model3DNode> {
		const n = Math.max(3, Math.round(options.sides ?? 4));
		return primitiveNode(
			"pyramid",
			{
				type: "cylinder",
				radius: options.radius ?? 60,
				radiusTop: options.radiusTop ?? 0,
				radiusBottom: options.radius ?? 60,
				height: options.height,
				segments: n,
				openEnded: options.openEnded ?? false,
				flatShaded: options.flatShaded ?? true,
			},
			{
				...options,
				color: options.color ?? "#f59e0b",
				twoSided: options.twoSided ?? Boolean(options.openEnded),
			},
		);
	},

	/**
	 * Creates a standalone planar 3D card/quad.
	 */
	plane(options: Plane3DOptions): AnimatableNode<BoxNode> {
		return Layer.box({
			id: options.id ?? autoId("plane"),
			position: "absolute",
			width: options.width,
			height: options.height,
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			is3D: true,
			twoSided: options.twoSided ?? true,
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			background: options.background ?? "#3b82f6",
			borderRadius: options.borderRadius ?? 0,
			opacity: options.opacity ?? 1,
			...materialProps(options),
			children: options.children ?? [],
		});
	},

	/**
	 * Creates a 3D perspective ground grid: `divisions` cells per side, each
	 * line its own unlit quad so it stays crisp at any camera distance.
	 */
	grid(options: Grid3DOptions): AnimatableNode<BoxNode> {
		const { width, height } = options;
		const id = options.id ?? autoId("grid");
		const divisions = Math.max(1, Math.round(options.divisions ?? 10));
		const lineWidth = options.lineWidth ?? 2;
		const color = options.color ?? "rgba(59, 130, 246, 0.5)";
		const line = (
			lineId: string,
			x: number,
			y: number,
			w: number,
			h: number,
		): AnimatableNode<BoxNode> =>
			Layer.box({
				id: `${id}-${lineId}`,
				position: "absolute",
				x,
				y,
				z: 0,
				width: w,
				height: h,
				is3D: true,
				twoSided: true,
				material: "unlit",
				background: color,
			});
		// Every quad is backed by a texture of its own size, so long lines are
		// split into segments that stay well inside the GPU's texture limit.
		const MAX_SEGMENT = 4096;
		const lines: AnimatableNode<BoxNode>[] = [];
		const vSegments = Math.ceil(height / MAX_SEGMENT);
		const hSegments = Math.ceil(width / MAX_SEGMENT);
		for (let i = 0; i <= divisions; i++) {
			const u = i / divisions - 0.5;
			for (let k = 0; k < vSegments; k++) {
				const len = height / vSegments;
				const y = -height / 2 + len * (k + 0.5);
				lines.push(line(`v${i}-${k}`, u * width, y, lineWidth, len));
			}
			for (let k = 0; k < hSegments; k++) {
				const len = width / hSegments;
				const x = -width / 2 + len * (k + 0.5);
				lines.push(line(`h${i}-${k}`, x, u * height, len, lineWidth));
			}
		}
		return Layer.box({
			id,
			position: "absolute",
			width,
			height,
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			is3D: true,
			transformStyle: "preserve-3d",
			rotateX: options.rotateX ?? 90,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			background: "transparent",
			opacity: options.opacity ?? 1,
			children: lines,
		});
	},

	/**
	 * Creates a standalone planar 3D text node, or solid extruded 3D text when `extrusionDepth` is set.
	 */
	text(options: Text3DOptions): AnimatableNode<LayoutNode> {
		if (options.extrusionDepth && options.extrusionDepth > 0) {
			return Layer3D.extrudedText({
				...options,
				depth: options.extrusionDepth,
			});
		}

		return Layer.text(options.text, {
			id: options.id ?? autoId("text3d"),
			position: "absolute",
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			is3D: true,
			twoSided: options.twoSided ?? true,
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			fontSize: options.fontSize ?? 48,
			fontFamily: options.fontFamily,
			fontWeight: options.fontWeight ?? "bold",
			fontStyle: options.fontStyle,
			fill: options.fill ?? "#ffffff",
			align: (options.align ?? "center") as
				| "left"
				| "center"
				| "right"
				| "start"
				| "end",
			direction: options.direction,
			verticalAlign: options.verticalAlign ?? "middle",
			letterSpacing: options.letterSpacing,
			lineHeight: options.lineHeight,
			material: options.material ?? "lit",
			shininess: options.shininess ?? 64,
			roughness: options.roughness,
			specularIntensity: options.specularIntensity ?? 0.8,
			ambientIntensity: options.ambientIntensity ?? 1.0,
			metallic: options.metallic,
			...materialProps(options),
			opacity: options.opacity ?? 1,
			background: options.background,
			borderRadius: options.borderRadius,
			padding: options.padding,
			stroke: options.stroke,
			strokeWidth: options.strokeWidth,
		});
	},

	/**
	 * Creates solid extruded 3D typography: `fill` colors the letter faces,
	 * `bevelColor` the side walls; curves are tessellated to `curveTolerance`.
	 */
	extrudedText(options: ExtrudedText3DOptions): Shape3DContainer {
		const { depth, text, fill = "#ffffff", bevelColor } = options;

		let modelData: Model3DData | undefined;
		// Tolerance is in on-screen px: a node scaled up 3x needs 3x finer geometry.
		const curveTolerance =
			(options.curveTolerance ?? 0.1) / extrudedTextScale(options);
		const parsedFont =
			(options.fontFamily
				? SlugFontCache.getParsed(options.fontFamily)
				: null) ??
			SlugFontCache.getParsed("Inter") ??
			SlugFontCache.getParsed("Unbounded") ??
			SlugFontCache.getFirstParsed();

		if (parsedFont) {
			const res = generateExtrudedTextGeometry({
				text,
				// SlugFontCache holds fontkit fonts under a narrower type.
				font: parsedFont as unknown as Parameters<
					typeof generateExtrudedTextGeometry
				>[0]["font"],
				fontSize: options.fontSize ?? 48,
				depth,
				fill,
				bevelColor,
				curveSegments: options.curveSegments,
				curveTolerance,
				align: options.align,
				direction: options.direction,
				verticalAlign: options.verticalAlign,
				letterSpacing: options.letterSpacing,
				// The mesh's own shading only knows these; glass and the like are
				// layer materials, applied by the model node below.
				material:
					options.material === "lit" ||
					options.material === "unlit" ||
					options.material === "toon"
						? options.material
						: undefined,
				shininess: options.shininess,
				roughness: options.roughness,
				metallic: options.metallic,
			});
			modelData = res.modelData;
		}

		const modelNode = Layer.model({
			id: options.id ?? autoId("extruded-text"),
			modelData,
			is3D: true,
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			scale: options.scale ?? 1,
			scaleX: options.scaleX ?? 1,
			scaleY: options.scaleY ?? 1,
			scaleZ: options.scaleZ ?? 1,
			opacity: options.opacity ?? 1,
			material: options.material,
			shininess: options.shininess ?? 32,
			roughness: options.roughness,
			specularIntensity: options.specularIntensity ?? 0.8,
			ambientIntensity: options.ambientIntensity ?? 1.0,
			metallic: options.metallic,
			...materialProps(options),
			twoSided: options.twoSided ?? true,
			// What the compositor rebuilds the mesh from when modelData did not
			// survive (a spec sent as JSON): the same tolerance as here.
			text3dOptions: { ...options, curveTolerance },
		});

		return withParts(modelNode, {
			faces: [modelNode],
			items: [modelNode],
		}) as unknown as Shape3DContainer;
	},

	/**
	 * A solid box with rounded edges and corners, as one smooth-shaded mesh:
	 * cards, buttons, device bodies. `taper` below 1 narrows the top (-y)
	 * face, the shape of a keycap. Equal shapes share one GPU buffer.
	 */
	roundedBox(options: RoundedBox3DOptions): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"rounded-box",
			{
				type: "roundedBox",
				width: options.width,
				height: options.height,
				depth: options.depth,
				radius: options.radius,
				segments: options.segments,
				taper: options.taper,
			},
			options,
		);
	},

	/** A UV sphere mesh. */
	sphere(options: Sphere3DOptions): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"sphere",
			{ type: "sphere", radius: options.radius, segments: options.segments },
			options,
		);
	},

	/** A capped cylinder, or a cone/frustum with different top and bottom radii. */
	cylinder(options: Cylinder3DOptions): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"cylinder",
			{
				type: "cylinder",
				radius: options.radius,
				radiusTop: options.radiusTop,
				radiusBottom: options.radiusBottom,
				height: options.height,
				segments: options.segments,
				openEnded: options.openEnded,
				flatShaded: options.flatShaded,
			},
			{
				...options,
				twoSided: options.twoSided ?? Boolean(options.openEnded),
			},
		);
	},

	/**
	 * A 3D torus (donut / ring) mesh with major `radius`, tube radius `tube`,
	 * and optional partial `arc` sweep in degrees.
	 */
	torus(options: Torus3DOptions = {}): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"torus",
			{
				type: "torus",
				radius: options.radius,
				tube: options.tube,
				radialSegments: options.radialSegments,
				tubularSegments: options.tubularSegments,
				arc: options.arc,
			},
			options,
		);
	},

	/**
	 * A smooth 3D capsule (pill) mesh aligned along the Y axis: a cylinder of
	 * length `length` and radius `radius` capped by two hemispheres.
	 */
	capsule(options: Capsule3DOptions = {}): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"capsule",
			{
				type: "capsule",
				radius: options.radius,
				length: options.length,
				capSegments: options.capSegments,
				radialSegments: options.radialSegments,
			},
			options,
		);
	},

	/**
	 * A 3D ring / annulus with `innerRadius`, `outerRadius`, and optional `depth`
	 * for a thick-walled washer/annular solid.
	 */
	ring(options: Ring3DOptions = {}): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"ring",
			{
				type: "ring",
				innerRadius: options.innerRadius,
				outerRadius: options.outerRadius,
				depth: options.depth,
				thetaSegments: options.thetaSegments,
				phiSegments: options.phiSegments,
				thetaStart: options.thetaStart,
				thetaLength: options.thetaLength,
			},
			options,
		);
	},

	/**
	 * A Platonic polyhedron (`tetrahedron`, `octahedron`, `dodecahedron`, `icosahedron`)
	 * or geodesic `icosphere` with configurable subdivision `detail` and `flatShaded` facets.
	 */
	polyhedron(options: Polyhedron3DOptions = {}): AnimatableNode<Model3DNode> {
		const shape = options.shape ?? options.type ?? "icosahedron";
		return primitiveNode(
			shape,
			{
				type: "polyhedron",
				shape,
				radius: options.radius,
				detail: options.detail,
				flatShaded: options.flatShaded,
			},
			options,
		);
	},

	/**
	 * An icosahedron (20-sided regular polyhedron), optionally subdivided with `detail`.
	 */
	icosahedron(options: Icosphere3DOptions = {}): AnimatableNode<Model3DNode> {
		return Layer3D.polyhedron({ ...options, shape: "icosahedron" });
	},

	/**
	 * An evenly distributed geodesic icosphere mesh (`detail` defaults to 2, smooth-shaded by default).
	 */
	icosphere(options: Icosphere3DOptions = {}): AnimatableNode<Model3DNode> {
		return Layer3D.polyhedron({
			...options,
			shape: "icosphere",
			detail: options.detail ?? 2,
			flatShaded: options.flatShaded ?? false,
		});
	},

	/**
	 * Extrudes a 2D outline (an SVG path string with curves/holes or a 2D point contour array)
	 * into a 3D solid mesh with optional front/back bevels (`bevelThickness`, `bevelSize`, `bevelSegments`)
	 * and separate side wall color (`bevelColor`).
	 */
	extrude(options: ExtrudeShape3DOptions): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"extrude",
			{
				type: "extrude",
				shape: options.shape,
				d: options.d,
				contour: options.contour,
				holes: options.holes,
				depth: options.depth,
				bevelThickness: options.bevelThickness,
				bevelSize: options.bevelSize,
				bevelSegments: options.bevelSegments,
				bevelColor: options.bevelColor,
				curveSegments: options.curveSegments,
				curveTolerance: options.curveTolerance,
				center: options.center,
			},
			options,
		);
	},

	/**
	 * Revolves a 2D profile (`[[r, y], ...]` or an SVG path string) around the Y axis
	 * to create bowls, bottles, goblets, vases, and turned solids.
	 */
	lathe(options: Lathe3DOptions): AnimatableNode<Model3DNode> {
		const capped = options.capped ?? options.closed;
		return primitiveNode(
			"lathe",
			{
				type: "lathe",
				points: options.points,
				segments: options.segments,
				phiStart: options.phiStart,
				phiLength: options.phiLength,
				capped,
				closed: options.closed,
				flatShaded: options.flatShaded,
			},
			{
				...options,
				twoSided: options.twoSided ?? !(capped ?? false),
			},
		);
	},

	/**
	 * Sweeps a circular or thick-walled hollow pipe cross-section (`innerRadius > 0`)
	 * along a 3D curve (`Path3D`, `TubePathSpec`, or 3D waypoints `[x, y, z]`) using
	 * Rotation-Minimizing Frames.
	 */
	tube(options: Tube3DOptions): AnimatableNode<Model3DNode> {
		const pathInput = options.path ?? options.points;
		if (!pathInput) {
			throw new Error("Layer3D.tube requires `path` or `points`");
		}
		return primitiveNode(
			"tube",
			{
				type: "tube",
				path: normalizePathSpec(pathInput),
				radius: options.radius,
				innerRadius: options.innerRadius,
				radiusTaper: options.radiusTaper,
				tubularSegments: options.tubularSegments,
				radialSegments: options.radialSegments,
				closed: options.closed,
				capped: options.capped,
			},
			{
				...options,
				twoSided: options.twoSided ?? options.capped === false,
			},
		);
	},

	/**
	 * 3D line / curve geometry (`line-list` topology) along 3D points or a `Path3D` curve,
	 * supporting dashed segments (`dashSize`, `gapSize`) and per-vertex colors for 3D diagrams.
	 */
	line(options: Line3DOptions): AnimatableNode<Model3DNode> {
		const pointsInput = options.points ?? options.path;
		if (!pointsInput) {
			throw new Error("Layer3D.line requires `points` or `path`");
		}
		return primitiveNode(
			"line3d",
			{
				type: "line3d",
				points: normalizePathSpec(pointsInput),
				colors: options.colors,
				mode: options.mode,
				closed: options.closed,
				dashSize: options.dashSize,
				gapSize: options.gapSize,
			},
			{
				...options,
				material: options.material ?? "unlit",
				castShadow: options.castShadow ?? false,
			},
		);
	},

	/**
	 * 3D point cloud / diagram vertex geometry along 3D points or a `Path3D` curve.
	 * Pass `pointSize > 0` for 3D spherical diagram dots that scale in perspective,
	 * or omit `pointSize` for native GPU `point-list` pixels.
	 */
	points(options: Points3DOptions): AnimatableNode<Model3DNode> {
		const isPixelPoints = (options.pointSize ?? 0) <= 0;
		return primitiveNode(
			"points3d",
			{
				type: "points3d",
				points: normalizePathSpec(options.points),
				colors: options.colors,
				pointSize: options.pointSize,
			},
			{
				...options,
				material: options.material ?? (isPixelPoints ? "unlit" : "lit"),
				castShadow: options.castShadow ?? !isPixelPoints,
			},
		);
	},

	/**
	 * A procedural faceted convex polyhedron / rock shard: carved from half-space planes.
	 * Convex hull collider in Physics.world3d is derived automatically.
	 */
	shard(options: Shard3DOptions = {}): AnimatableNode<Model3DNode> {
		return primitiveNode(
			"shard",
			{
				type: "shard",
				radius: options.radius,
				size: options.size,
				facets: options.facets,
				seed: options.seed,
				irregularity: options.irregularity,
			},
			options,
		);
	},

	/**
	 * Single-draw-call hardware-instanced 3D mesh batch node.
	 * Renders hundreds or thousands of 3D meshes in 1 draw call per mesh variant,
	 * driven by Physics.world3d rigid bodies, procedural callbacks, or transform arrays.
	 */
	instances(options: Instances3DOptions): AnimatableNode<Model3DNode> {
		const primaryMesh = Array.isArray(options.mesh)
			? options.mesh[0]
			: options.mesh;
		const node: Model3DNode = {
			id: options.id ?? autoId("instances3d"),
			kind: "model3d",
			x: options.x ?? 0,
			y: options.y ?? 0,
			z: options.z ?? 0,
			rotateX: options.rotateX ?? 0,
			rotateY: options.rotateY ?? 0,
			rotateZ: options.rotateZ ?? 0,
			scale: options.scale ?? 1,
			color: options.color,
			colorTint: options.colorTint,
			opacity: options.opacity ?? 1,
			twoSided: options.twoSided ?? true,
			wireframe: options.wireframe ?? false,
			material: options.material ?? "lit",
			roughness: options.roughness,
			metallic: options.metallic,
			specularIntensity: options.specularIntensity,
			ambientIntensity: options.ambientIntensity,
			startFrame: options.startFrame,
			durationFrames: options.durationFrames,
			instances3d: { ...options },
			...materialProps(options),
		};
		if (primaryMesh) {
			const m = primaryMesh as unknown as Record<string, unknown>;
			if (m.modelData) node.modelData = m.modelData;
			if (m.primitive3d) node.primitive3d = m.primitive3d;
			if (m.src) node.src = m.src as string;
		}
		return Layer.model(
			node as unknown as Partial<Model3DNode>,
		) as unknown as AnimatableNode<Model3DNode>;
	},

	/**
	 * GPU-simulated 3D particle swarm and shard system.
	 * Simulates thousands of 3D mesh particles natively inside WebGPU with 3D curl noise,
	 * attractors, vortex fields, floor collisions, and speed/friction-driven HDR bloom emission.
	 */
	swarm(options: Swarm3DOptions = {}): AnimatableNode<Model3DNode> {
		return createSwarm3D(options);
	},

	/**
	 * Creates a 3D model node rendered natively with WebGPU mesh shaders.
	 */
	model(options: Partial<Model3DNode> = {}): AnimatableNode<Model3DNode> {
		return Layer.model(options);
	},

	/**
	 * Convenience helper to create a 3D Wavefront OBJ model node.
	 */
	obj(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.obj(src, options);
	},

	/**
	 * Convenience helper to create a 3D Autodesk FBX model node with skeletal animation support.
	 */
	fbx(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.fbx(src, options);
	},

	/**
	 * Convenience helper to create a 3D glTF 2.0 model node.
	 */
	gltf(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.gltf(src, options);
	},

	/**
	 * Convenience helper to create a 3D GLB binary container model node.
	 */
	glb(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.glb(src, options);
	},

	/**
	 * Convenience helper to create a 3D STL CAD / 3D printing model node.
	 */
	stl(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.stl(src, options);
	},

	/**
	 * Convenience helper to create a 3D Stanford PLY scan model node.
	 */
	ply(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.ply(src, options);
	},

	/**
	 * Convenience helper to create a 3D MagicaVoxel VOX model node.
	 */
	vox(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.vox(src, options);
	},

	/**
	 * Convenience helper to create a 3D Studio (3DS) binary model node.
	 */
	threeDS(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.threeDS(src, options);
	},

	/**
	 * Convenience helper to create a 3D Object File Format (OFF) model node.
	 */
	off(
		src: string,
		options: Partial<Model3DNode> = {},
	): AnimatableNode<Model3DNode> {
		return Layer.off(src, options);
	},
};
