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
	ShapeNode,
	ShapeType,
	TextNode,
} from "@framefields/compositions/program";
import type { MeasureFn } from "./text.js";

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
}
