/**
 * The host: what framefields injects into components. framefields bundles
 * this package, so components can't import from it without a cycle; instead
 * framefields binds each component to an object implementing `Host`.
 *
 * Types here are structural on purpose: framefields' real `AnimatableNode`
 * satisfies `Animatable`, and its binding restores the full types for users.
 */
import type {
	BoxNode,
	FlexNode,
	LayoutNode,
	ShapeNode,
	ShapeType,
	TextNode,
} from "@framefields/compositions/program";
import type { MeasureFn } from "./text.js";

/** Photoshop-style layer styles (framefields' `LayerStyle`). Omitted styles are off. */
export interface LayerStyleConfig {
	dropShadow?: {
		color?: string;
		opacity?: number;
		/** Light angle in degrees (90 = shadow straight down). */
		angle?: number;
		distance?: number;
		spread?: number;
		size?: number;
		blendMode?: string;
	};
	outerGlow?: {
		color?: string;
		opacity?: number;
		size?: number;
		spread?: number;
		blendMode?: string;
	};
	innerShadow?: {
		color?: string;
		opacity?: number;
		angle?: number;
		distance?: number;
		size?: number;
	};
	stroke?: {
		size?: number;
		position?: "inside" | "center" | "outside";
		color?: string;
		opacity?: number;
	};
}

export interface MediaOptions {
	id?: string;
	position?: "absolute" | "relative";
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	fit?: "cover" | "contain" | "fill";
}

/** The part of framefields' `AnimatableNode` components rely on. */
export interface AnimatableMethods {
	animate(...anims: unknown[]): unknown;
}

export type Animatable<T> = T & AnimatableMethods;

export interface Host {
	box(options: Partial<BoxNode>): Animatable<BoxNode>;
	flex(options: Partial<FlexNode>): Animatable<FlexNode>;
	text(content: string, options?: Partial<TextNode>): Animatable<TextNode>;
	shape(type: ShapeType, options?: Partial<ShapeNode>): Animatable<ShapeNode>;
	/** `FontManager.measure`. */
	measure: MeasureFn;
	/** Registered font families. */
	fonts(): readonly string[];
	/** A default id: stable per run (a counter per prefix), like `Layer.*` ids. */
	autoId(prefix: string): string;
	/** A video, image or SVG layer, by file extension. */
	media(source: string, options: MediaOptions): Animatable<LayoutNode>;
	/** Attach layer styles (shadow, glow, stroke) to `node`; returns it. */
	style<T extends Animatable<LayoutNode>>(node: T, config: LayerStyleConfig): T;
	/**
	 * Mask `node` by `matte`'s alpha (a box: solid or CSS-gradient
	 * background), or by its inverse (`"alpha-inverted"`: show `node`
	 * everywhere the matte is not). The matte is laid out like a sibling of
	 * `node`; returns `node`.
	 */
	matte<T extends Animatable<LayoutNode>>(
		node: T,
		matte: LayoutNode,
		mode?: "alpha" | "alpha-inverted",
	): T;
	/**
	 * A video showing only its person / subject (vision segmentation), the
	 * rest transparent: stacked over captions so text passes behind them.
	 */
	cutout(source: string, options: CutoutOptions): Animatable<LayoutNode>;
	/** A GPU particle system layer. */
	particles(options: ParticleOptions): Animatable<LayoutNode>;
	/**
	 * A per-frame signal from values (framefields' `Signal.fromArray`), for
	 * `LayerAnimation.signal`. Signals read the composition's frame: value
	 * `k` drives composition frame `k`.
	 */
	signal(values: readonly number[], fps: number): object;
	/**
	 * An animated film-grain layer to put over other layers: neutral grey
	 * carrying framefields' `FilmGrain`, soft-light blended. (Effects only
	 * attach to media layers, so grain can't go on a box.)
	 */
	grain(options: GrainOptions): Animatable<LayoutNode>;
	/** Solid extruded 3D text (framefields' `Layer3D.extrudedText`), centred on x, y. */
	extrudedText(options: ExtrudedTextOptions): Animatable<LayoutNode>;
}

export interface GrainOptions {
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	/** 0–100, the engine's scale. */
	strength: number;
	size?: number;
}

export interface ExtrudedTextOptions {
	id?: string;
	text: string;
	/** Centre of the text. */
	x: number;
	y: number;
	depth: number;
	fontFamily?: string;
	fontSize: number;
	fontWeight?: number;
	fill?: string;
	bevelColor?: string;
	material?: "lit" | "glass";
	metallic?: number;
	roughness?: number;
	shininess?: number;
	opacity?: number;
}

/** A GPU particle system (framefields' `Layer.particles`), as plain data. */
export interface ParticleOptions {
	id?: string;
	x: number;
	y: number;
	width: number;
	height: number;
	seed?: number;
	/** Most particles alive at once. */
	max?: number;
	emitter: {
		shape: "point";
		x: number;
		y: number;
		/** Particles a second (0 for bursts only). */
		rate: number;
		bursts: Array<{ frame: number; count: number }>;
	};
	/** Seconds each particle lives. */
	lifetime?: [number, number];
	/** Launch speed, px/s. */
	speed?: [number, number];
	/** Degrees, 0 = right, -90 = up. */
	direction?: number;
	spread?: number;
	/** px/s², down. */
	gravity?: number;
	drag?: number;
	noise?: { strength: number; scale: number; speed: number };
	/** A floor line (layer px) particles bounce on and settle. */
	floor?: number;
	bounce?: number;
	/** px at birth → death. */
	size?: [number, number];
	sizeJitter?: number;
	fade?: [number, number];
	shape?: "circle" | "soft" | "square" | "spark";
	stretch?: number;
	blend?: "normal" | "add" | "screen";
	color?: string | string[];
	opacity?: number;
}

export interface CutoutOptions extends MediaOptions {
	mode?: "person" | "subject";
}
