import type {
	BoxNode,
	LayoutNode,
	MaterialType,
	Model3DNode,
} from "@framefields/compositions/program";
import {
	generateExtrudedTextGeometry,
	type Model3DData,
	SlugFontCache,
} from "@framefields/webgpu-renderers";
import { autoId } from "./ids.js";
import { type AnimatableNode, Layer } from "./index.js";

export interface CubeFaceConfig {
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

export interface Cube3DOptions {
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

export interface Prism3DOptions {
	id?: string;
	sides: number;
	radius: number;
	height: number;
	x?: number;
	y?: number;
	z?: number;
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
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
}

export interface Plane3DOptions {
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

export interface Text3DOptions {
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

export type Shape3DContainer = AnimatableNode<BoxNode> & {
	faces?: AnimatableNode<BoxNode>[];
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
			width: (options.itemWidth ?? 200) as any,
			height: (options.itemHeight ?? 200) as any,
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
	 * Creates an N-sided regular polygonal 3D prism.
	 */
	prism(options: Prism3DOptions): Shape3DContainer {
		const { sides, radius, height, twoSided = true } = options;
		const n = Math.max(3, sides);
		const sideWidth = 2 * radius * Math.tan(Math.PI / n);
		const angleStep = 360 / n;
		const panels: AnimatableNode<BoxNode>[] = [];

		for (let i = 0; i < n; i++) {
			const angleDeg = i * angleStep;
			const rad = (angleDeg * Math.PI) / 180;
			const x = radius * Math.sin(rad);
			const z = radius * Math.cos(rad);
			const cfg = options.sideConfigs?.[i];
			const color =
				typeof cfg === "string"
					? cfg
					: ((cfg as { background?: string } | undefined)?.background ??
						`hsl(${(i * 360) / n}, 70%, 50%)`);

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
					rotateY: angleDeg,
					background: color,
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
			align: (options.align as any) ?? "center",
			verticalAlign: options.verticalAlign ?? "middle",
			letterSpacing: options.letterSpacing,
			lineHeight: options.lineHeight,
			material: options.material ?? "lit",
			shininess: options.shininess ?? 64,
			roughness: options.roughness,
			specularIntensity: options.specularIntensity ?? 0.8,
			ambientIntensity: options.ambientIntensity ?? 1.0,
			metallic: options.metallic,
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
