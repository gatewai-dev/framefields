import { Effect } from "@framefields/core";
import type {
	EmitterShape,
	ParticleBlend,
	ParticleBounds,
	ParticleFrame,
	ParticleProgram,
	ParticleShape,
	ParticleStatic,
} from "@framefields/node-particles";
import { parseColor } from "@framefields/webgpu-renderers";
import type { PersonTrack } from "./clip-vision.js";
import { type PhysicsDriver, sampleDriver } from "./physics/core.js";

export type { EmitterShape, ParticleBlend, ParticleBounds, ParticleShape };

type Range = number | [number, number];

export interface ParticlesOptions {
	/** Particle layer box in composition px (the particles' own space; default the whole canvas). */
	x?: number;
	y?: number;
	width: number;
	height: number;
	id?: string;
	startFrame?: number;
	durationFrames?: number;
	zIndex?: number;
	/** Most particles alive at once (default 20000). Costs GPU memory, not time when idle. */
	max?: number;
	seed?: number;
	emitter?: {
		/** `"rect"` (default, the whole layer), `"point"`, `"line"`, `"circle"` (area) or `"ring"` (edge). Layer px. */
		shape?: EmitterShape;
		/** Emitter position (layer px). A driver moves it: `(f) => person.point("rightWrist", f).x` paints with light. */
		x?: PhysicsDriver;
		y?: PhysicsDriver;
		width?: number;
		height?: number;
		radius?: number;
		/** Aim away from the emitter's center instead of along `direction`. */
		radial?: boolean;
		/** Particles per second (default 1000); a driver for bursts of activity. */
		rate?: PhysicsDriver;
		/** Extra particles at given layer frames. */
		bursts?: Array<{ frame: number; count: number }>;
	};
	/** Seconds each particle lives (default [2, 4]). */
	lifetime?: Range;
	/** Launch speed, px/s (default [40, 160]). */
	speed?: Range;
	/** Launch direction, degrees (0 = right, -90 = up; default -90). */
	direction?: number;
	/** Spread around `direction`, degrees (default 360). */
	spread?: number;
	/** px/s². A single driver pulls down. */
	gravity?: PhysicsDriver | [PhysicsDriver, PhysicsDriver];
	/** Velocity damping per second (default 0.4). Higher reads as thicker air or liquid. */
	drag?: PhysicsDriver;
	/** Swirling, divergence-free flow (curl noise): smoke, ink, flow fields. */
	noise?: { strength?: PhysicsDriver; scale?: number; speed?: number };
	/** Points that pull (positive) or push (negative), px/s² at the center, falling off over `radius`. Layer px. Up to 8. */
	attractors?: Array<{
		x: PhysicsDriver;
		y: PhysicsDriver;
		strength: PhysicsDriver;
		radius?: number;
	}>;
	/**
	 * A performer pushes particles out of their silhouette, harder where it
	 * is sweeping in: `person` from `comp.vision(clip).person.place(…)`.
	 */
	push?: {
		person: PersonTrack;
		strength?: PhysicsDriver;
		sweep?: PhysicsDriver;
	};
	/** What happens at the layer's edges: `"none"` (default), `"kill"`, `"bounce"`, `"wrap"`. */
	bounds?: ParticleBounds;
	/** A floor line in layer px that particles bounce on. */
	floor?: number;
	/** Bounciness at the floor and bounced edges (default 0.3). */
	bounce?: number;
	/** px at birth → death (default [6, 0]). */
	size?: Range;
	/** Random size variation, 0–1 (default 0.5). */
	sizeJitter?: number;
	/** Fractions of life to fade in and out (default [0.1, 0.3]). */
	fade?: [number, number];
	/** `"circle"` (default), `"soft"` (glow), `"square"`, `"spark"` (streaks along motion). */
	shape?: ParticleShape;
	/** Spark length per px/s (default 0.04). */
	stretch?: number;
	/** `"normal"` (default), `"add"` (glows build up), `"screen"`. */
	blend?: ParticleBlend;
	/** One color, or up to 8 spread over each particle's life (default white). */
	color?: string | string[];
	/** Color by speed instead of age: the px/s that reaches the last color. */
	colorBySpeed?: number;
	opacity?: number;
	/** Solver steps per frame (default 2). */
	substeps?: number;
	/** Seconds simulated before the first frame, so it starts already full. */
	prewarm?: number;
}

const range = (
	r: Range | undefined,
	fallback: [number, number],
): [number, number] =>
	r === undefined ? fallback : typeof r === "number" ? [r, r] : r;

/**
 * A GPU particle system: tens of thousands of particles simulated in a
 * compute shader and drawn in one call. Used through `Layer.particles()`.
 * It steps as the composition renders (snapshots make scrubbing back
 * cheap), and its drivers are read every frame.
 */
export class Particles
	extends Effect<Record<string, never>>
	implements ParticleProgram
{
	public readonly op = "Particles";
	readonly particleStatic: ParticleStatic;
	particleState?: unknown;
	private readonly options: ParticlesOptions;

	constructor(options: ParticlesOptions) {
		super({});
		this.options = options;
		const e = options.emitter ?? {};
		const staticPos = (d: PhysicsDriver | undefined) =>
			typeof d === "number" ? d : undefined;
		const width = options.width;
		const height = options.height;
		const colors = (
			Array.isArray(options.color)
				? options.color
				: [options.color ?? "#ffffff"]
		).map((c): [number, number, number, number] => {
			const p = parseColor(c);
			return [p.r, p.g, p.b, p.a];
		});
		this.particleStatic = {
			max: Math.max(1, Math.round(options.max ?? 20000)),
			seed: Math.round(options.seed ?? 1) >>> 0,
			layer: { x: options.x ?? 0, y: options.y ?? 0, width, height },
			emitter: {
				shape: e.shape ?? "rect",
				x:
					staticPos(e.x) ??
					(e.shape === "circle" || e.shape === "ring" || e.shape === "point"
						? width / 2
						: 0),
				y:
					staticPos(e.y) ??
					(e.shape === "circle" || e.shape === "ring" || e.shape === "point"
						? height / 2
						: 0),
				width: e.width ?? width,
				height: e.height ?? (e.shape === "line" ? 0 : height),
				radius: e.radius ?? Math.min(width, height) / 4,
				radial: e.radial ?? false,
			},
			lifetime: range(options.lifetime, [2, 4]),
			speed: range(options.speed, [40, 160]),
			direction: options.direction ?? -90,
			spread: options.spread ?? 360,
			bounds: options.bounds ?? "none",
			floor: options.floor ?? null,
			bounce: options.bounce ?? 0.3,
			size: range(options.size, [6, 0]),
			sizeJitter: options.sizeJitter ?? 0.5,
			fade: options.fade ?? [0.1, 0.3],
			shape: options.shape ?? "circle",
			stretch: options.stretch ?? 0.04,
			blend: options.blend ?? "normal",
			colors: colors.slice(0, 8),
			colorBySpeed: options.colorBySpeed ?? null,
			opacity: options.opacity ?? 1,
			substeps: options.substeps ?? 2,
			prewarm: options.prewarm ?? 0,
		};
	}

	particleFrame(frame: number, fps: number): ParticleFrame {
		const o = this.options;
		const read = (d: PhysicsDriver | undefined, fallback: number) =>
			d === undefined ? fallback : sampleDriver(d, frame, fps);
		const layerFrame = frame - (o.startFrame ?? 0);
		const burst = (o.emitter?.bursts ?? [])
			.filter((b) => Math.round(b.frame) === layerFrame)
			.reduce((n, b) => n + b.count, 0);
		const g = o.gravity;
		const gravity: [number, number] = Array.isArray(g)
			? [read(g[0], 0), read(g[1], 0)]
			: [0, read(g, 0)];
		let push: ParticleFrame["push"] = null;
		if (o.push) {
			push = {
				strength: read(o.push.strength, 6000),
				sweep: read(o.push.sweep, 60000),
				mask: o.push.person.silhouetteGrid(frame),
				previous: o.push.person.silhouetteGrid(Math.max(0, frame - 1)),
			};
		}
		const ex = o.emitter?.x;
		const ey = o.emitter?.y;
		const moving =
			(ex !== undefined && typeof ex !== "number") ||
			(ey !== undefined && typeof ey !== "number");
		const at = (f: number) => ({
			x:
				ex === undefined
					? this.particleStatic.emitter.x
					: sampleDriver(ex, f, fps),
			y:
				ey === undefined
					? this.particleStatic.emitter.y
					: sampleDriver(ey, f, fps),
		});
		let emitter: ParticleFrame["emitter"];
		if (moving) {
			const now = at(frame);
			const before = at(Math.max(0, frame - 1));
			emitter = {
				x: now.x,
				y: now.y,
				previousX: before.x,
				previousY: before.y,
			};
		}
		return {
			...(emitter && { emitter }),
			rate: read(o.emitter?.rate, 1000),
			burst,
			gravity,
			drag: read(o.drag, 0.4),
			noise: {
				strength: read(o.noise?.strength, 0),
				scale: o.noise?.scale ?? 300,
				speed: o.noise?.speed ?? 0.3,
			},
			attractors: (o.attractors ?? []).map((a) => ({
				x: read(a.x, 0),
				y: read(a.y, 0),
				strength: read(a.strength, 0),
				radius: a.radius ?? 200,
			})),
			push,
		};
	}
}
