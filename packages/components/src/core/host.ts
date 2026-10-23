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
	/** A video or image layer, by file extension. */
	media(source: string, options: MediaOptions): Animatable<LayoutNode>;
	/** Attach layer styles (shadow, glow, stroke) to `node`; returns it. */
	style<T extends Animatable<LayoutNode>>(node: T, config: LayerStyleConfig): T;
	/**
	 * Mask `node` by `matte`'s alpha (a box: solid or CSS-gradient
	 * background). The matte is laid out like a sibling of `node`; returns `node`.
	 */
	matte<T extends Animatable<LayoutNode>>(node: T, matte: LayoutNode): T;
}
