/**
 * The contract between a particle system's authoring object (framefields'
 * `Particles` effect, carried on the op as `effect`) and this renderer.
 * Static settings are read once per system; per-frame inputs (driven values,
 * a performer's silhouette) are asked for each simulated frame.
 */

export type EmitterShape = "point" | "line" | "rect" | "circle" | "ring";
export type ParticleShape = "circle" | "soft" | "square" | "spark";
export type ParticleBlend = "normal" | "add" | "screen";
export type ParticleBounds = "none" | "kill" | "bounce" | "wrap";

export interface ParticleStatic {
	/** Capacity: the most particles alive at once. */
	max: number;
	seed: number;
	/** Layer box in composition px (sampling silhouettes needs the origin). */
	layer: { x: number; y: number; width: number; height: number };
	emitter: {
		shape: EmitterShape;
		x: number;
		y: number;
		width: number;
		height: number;
		radius: number;
		/** Aim away from the emitter's center instead of along `direction`. */
		radial: boolean;
	};
	/** Seconds. */
	lifetime: [number, number];
	/** px/s. */
	speed: [number, number];
	/** Degrees, 0 = right, -90 = up. */
	direction: number;
	/** Degrees around `direction`. */
	spread: number;
	bounds: ParticleBounds;
	/** Floor line in layer px, or null. */
	floor: number | null;
	bounce: number;
	/** px at birth and death. */
	size: [number, number];
	/** 0–1 random scale per particle. */
	sizeJitter: number;
	/** Fractions of life spent fading in and out. */
	fade: [number, number];
	shape: ParticleShape;
	/** Spark length per px/s of speed. */
	stretch: number;
	blend: ParticleBlend;
	/** Up to 8 colors, evenly spaced over life (or speed). */
	colors: Array<[number, number, number, number]>;
	/** Color by speed instead of age: speed (px/s) that reaches the last color. */
	colorBySpeed: number | null;
	opacity: number;
	substeps: number;
	/** Seconds simulated before the first frame, so it starts full. */
	prewarm: number;
}

export interface ParticleAttractor {
	x: number;
	y: number;
	/** px/s² at the center; negative repels. */
	strength: number;
	/** Falloff radius, px. */
	radius: number;
}

/** A silhouette grid (0–1 per cell) and how composition px map onto it. */
export interface ParticleMask {
	data: Float32Array;
	width: number;
	height: number;
	/** cell = (px − origin) / scale − 0.5 */
	originX: number;
	originY: number;
	scaleX: number;
	scaleY: number;
}

export interface ParticleFrame {
	/** Emitter position this frame, when it moves (layer px); births spread back toward `previous`. */
	emitter?: { x: number; y: number; previousX: number; previousY: number };
	/** Particles per second this frame. */
	rate: number;
	/** Extra particles born this frame. */
	burst: number;
	gravity: [number, number];
	/** Velocity damping per second. */
	drag: number;
	noise: { strength: number; scale: number; speed: number };
	attractors: ParticleAttractor[];
	push: {
		strength: number;
		/** Extra push where the silhouette just arrived. */
		sweep: number;
		mask: ParticleMask | null;
		previous: ParticleMask | null;
	} | null;
}

export interface ParticleProgram {
	readonly particleStatic: ParticleStatic;
	/** Inputs for composition frame `frame` (layer-local frames are the effect's concern). */
	particleFrame(frame: number, fps: number): ParticleFrame;
	/** Renderer-owned state, kept on the authoring object so it lives as long as the system. */
	particleState?: unknown;
}

export function isParticleProgram(value: unknown): value is ParticleProgram {
	return (
		typeof value === "object" &&
		value !== null &&
		"particleStatic" in value &&
		typeof (value as ParticleProgram).particleFrame === "function"
	);
}
