/**
 * @file program/sequence.ts
 * @module @gitframes/compositions/program/sequence
 *
 * Multi-Scene Timeline Orchestration, Camera Choreography & Carrier Match Cuts.
 * Complies with specs/cinematic-sequencing.ts.
 */

import { z } from "zod";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";

// ==============================================================================================
// 1. DATA SCHEMAS & CONFIGURATION
// ==============================================================================================

/**
 * Camera Transition Type across scene boundaries.
 */
export const SceneTransitionTypeSchema = z.enum([
	"cut", // Instant zero-frame hard cut
	"carrierMatchCut", // Smooth position/velocity continuous carrier handoff
	"cameraWhip", // Fast motion-blurred spatial pan transition
	"focusPullDissolve", // Optical DoF defocus -> refocus dissolve
	"irisAperture", // Non-linear optical circle zoom reveal
	"pushDirectional", // Spatial slide push along dominant motion axis
]);

export type SceneTransitionType = z.infer<typeof SceneTransitionTypeSchema>;

/**
 * Carrier Object Handoff Configuration Schema.
 */
export const CarrierHandoffConfigSchema = z
	.object({
		/** Layer ID of the carrier element in the outgoing scene */
		sourceLayerId: z.string(),

		/** Layer ID of the recipient element in the incoming scene */
		targetLayerId: z.string(),

		/**
		 * Spatial continuity mode:
		 * - "exact": Preserves exact screen-space (x, y, scale) across the cut.
		 * - "preserveVelocity": Preserves directional derivative dx/dt across cut.
		 * - "morph": Interpolates geometry bounds across transition overlap.
		 * Default: "preserveVelocity"
		 */
		mode: z
			.enum(["exact", "preserveVelocity", "morph"])
			.default("preserveVelocity"),

		/** Transition blend duration in frames (0 for instant zero-overlap cut) */
		blendFrames: z.number().int().min(0).max(30).default(0),
	})
	.strict();

export type CarrierHandoffConfig = z.infer<typeof CarrierHandoffConfigSchema>;

/**
 * Individual Scene Definition Schema.
 */
export const SceneDefinitionSchema = z
	.object({
		/** Unique identifier for the scene (e.g. "act-1-kinetic-hook") */
		id: z.string(),

		/** Narrative chapter classification */
		chapter: z
			.enum([
				"hook",
				"tension",
				"solution",
				"feature_spotlight",
				"outro",
				"custom",
			])
			.default("custom"),

		/** Scene duration in milliseconds or frames */
		durationMs: z.number().positive().optional(),
		durationFrames: z.number().int().positive().optional(),

		/** Transition into the next scene */
		transitionOut: z
			.object({
				type: SceneTransitionTypeSchema.default("cut"),
				durationFrames: z.number().int().min(0).default(0),
				carrier: CarrierHandoffConfigSchema.optional(),
				whipDirection: z.enum(["left", "right", "up", "down"]).default("left"),
			})
			.default({ type: "cut", durationFrames: 0, whipDirection: "left" }),
	})
	.passthrough();

export type SceneDefinition = z.infer<typeof SceneDefinitionSchema>;

// ==============================================================================================
// 2. MATHEMATICAL MODEL FOR CARRIER MATCH CUTS
// ==============================================================================================

export interface CarrierState {
	x: number;
	y: number;
	scale: number;
	vx: number;
	vy: number;
}

export function computeCarrierContinuity(
	stateAtCut: CarrierState,
	targetInitialState: Partial<CarrierState>,
): CarrierState {
	return {
		x: stateAtCut.x,
		y: stateAtCut.y,
		scale: stateAtCut.scale,
		vx: stateAtCut.vx,
		vy: stateAtCut.vy,
		...targetInitialState,
	};
}

// ==============================================================================================
// 3. MULTI-ACT SEQUENCE BUILDER & TIMELINE ORCHESTRATION
// ==============================================================================================

export interface SequenceTimelineResult {
	totalFrames: number;
	totalDurationMs: number;
	sceneOffsets: Array<{
		sceneId: string;
		startFrame: number;
		durationFrames: number;
	}>;
}

/**
 * Calculates global scene offsets and handoff frames across a sequence.
 */
export function calculateSequenceTimeline(
	scenes: Array<{
		id: string;
		durationFrames?: number;
		durationMs?: number;
		transitionOverlap?: number;
		transitionOut?: { durationFrames?: number };
	}>,
	fps = 60,
): SequenceTimelineResult {
	let accumulatedFrame = 0;
	const offsets: Array<{
		sceneId: string;
		startFrame: number;
		durationFrames: number;
	}> = [];

	for (const scene of scenes) {
		const startFrame = accumulatedFrame;
		const dur =
			scene.durationFrames ??
			(scene.durationMs ? Math.round((scene.durationMs / 1000) * fps) : 60);

		offsets.push({ sceneId: scene.id, startFrame, durationFrames: dur });
		const overlap =
			scene.transitionOverlap ?? scene.transitionOut?.durationFrames ?? 0;
		accumulatedFrame += Math.max(1, dur - overlap);
	}

	const totalFrames = accumulatedFrame;
	const totalDurationMs = Math.round((totalFrames / fps) * 1000);

	return {
		totalFrames,
		totalDurationMs,
		sceneOffsets: offsets,
	};
}

export interface SceneOptions {
	id: string;
	chapter?:
		| "hook"
		| "tension"
		| "solution"
		| "feature_spotlight"
		| "outro"
		| "custom";
	durationMs?: number;
	durationFrames?: number;
	transitionOut?: {
		type?: SceneTransitionType;
		durationFrames?: number;
		carrier?: CarrierHandoffConfig;
		whipDirection?: "left" | "right" | "up" | "down";
	};
	layout?: LayoutNode[];
}

export class Scene {
	public id: string;
	public chapter:
		| "hook"
		| "tension"
		| "solution"
		| "feature_spotlight"
		| "outro"
		| "custom";
	public durationMs?: number;
	public durationFrames?: number;
	public transitionOut: {
		type: SceneTransitionType;
		durationFrames: number;
		carrier?: CarrierHandoffConfig;
		whipDirection: "left" | "right" | "up" | "down";
	};
	public layout: LayoutNode[];

	constructor(options: SceneOptions) {
		this.id = options.id;
		this.chapter = options.chapter ?? "custom";
		this.durationMs = options.durationMs;
		this.durationFrames = options.durationFrames;
		this.transitionOut = {
			type: options.transitionOut?.type ?? "cut",
			durationFrames: options.transitionOut?.durationFrames ?? 0,
			carrier: options.transitionOut?.carrier,
			whipDirection: options.transitionOut?.whipDirection ?? "left",
		};
		this.layout = options.layout ?? [];
	}

	static create(options: SceneOptions): Scene {
		return new Scene(options);
	}
}

export interface SequenceOptions {
	fps?: number;
	width?: number;
	height?: number;
	backgroundColor?: string;
	fonts?: string[];
	signals?: Record<string, unknown>;
	scenes?: Scene[];
}

export class Sequence {
	public fps: number;
	public width: number;
	public height: number;
	public backgroundColor: string;
	public fonts?: string[];
	public signals?: Record<string, unknown>;
	private scenes: Scene[] = [];

	constructor(options: SequenceOptions = {}) {
		this.fps = options.fps ?? 60;
		this.width = options.width ?? 1920;
		this.height = options.height ?? 1080;
		this.backgroundColor = options.backgroundColor ?? "#ffffff";
		this.fonts = options.fonts;
		this.signals = options.signals;
		if (options.scenes) {
			for (const sc of options.scenes) {
				this.addScene(sc);
			}
		}
	}

	static create(options: SequenceOptions = {}): Sequence {
		return new Sequence(options);
	}

	addScene(scene: Scene | SceneOptions): this {
		const s = scene instanceof Scene ? scene : new Scene(scene);
		this.scenes.push(s);
		return this;
	}

	getScenes(): readonly Scene[] {
		return this.scenes;
	}

	calculateTimeline(): SequenceTimelineResult {
		return calculateSequenceTimeline(this.scenes, this.fps);
	}

	toProgram(): CompositorProgramConfig {
		const timeline = this.calculateTimeline();
		const rootLayout: LayoutNode[] = [];

		for (let i = 0; i < this.scenes.length; i++) {
			const scene = this.scenes[i];
			const offset = timeline.sceneOffsets[i];
			if (!offset) continue;

			// Wrap scene elements inside a temporal container or offset their startFrames
			for (const node of scene.layout) {
				const cloned = { ...node } as LayoutNode;
				cloned.startFrame = (cloned.startFrame ?? 0) + offset.startFrame;
				if (cloned.durationFrames === undefined) {
					cloned.durationFrames = offset.durationFrames;
				}
				rootLayout.push(cloned);
			}
		}

		return {
			width: this.width,
			height: this.height,
			backgroundColor: this.backgroundColor,
			fps: this.fps,
			volume: 1,
			mode: "Video",
			layout: rootLayout,
			fonts: this.fonts,
			signals: this.signals,
		};
	}
}
