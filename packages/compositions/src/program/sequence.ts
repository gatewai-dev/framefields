/**
 * @file program/sequence.ts
 * @module @framefields/compositions/program/sequence
 *
 * Multi-Scene Timeline Orchestration, Camera Choreography & Carrier Match Cuts.
 * Complies with specs/cinematic-sequencing.ts.
 */

import { assertFps } from "@framefields/core";
import { z } from "zod";
import type { CompositorProgramConfig, LayoutNode } from "./schema.js";

// ==============================================================================================
// 1. DATA SCHEMAS & CONFIGURATION
// ==============================================================================================

/**
 * Camera Transition Type across scene boundaries.
 *
 * @deprecated Recorded on scenes but not rendered. Use framefields'
 * `Layer.sequence([...])` with `Transition.push` / `wipe` / `iris` /
 * `crossfade` / `zoom` / `whip`, which render as keyframes and mattes.
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
	assertFps(fps);
	const durations = scenes.map((scene) => sceneDuration(scene, fps));
	let startFrame = 0;
	let totalFrames = 0;
	const sceneOffsets: SequenceTimelineResult["sceneOffsets"] = [];
	for (const [i, scene] of scenes.entries()) {
		const durationFrames = durations[i];
		const endFrame = startFrame + durationFrames;
		if (!Number.isSafeInteger(endFrame))
			throw new Error(`Scene '${scene.id}' exceeds the safe frame range`);
		sceneOffsets.push({ sceneId: scene.id, startFrame, durationFrames });
		totalFrames = Math.max(totalFrames, endFrame);
		const overlap =
			scene.transitionOverlap ?? scene.transitionOut?.durationFrames ?? 0;
		if (!Number.isSafeInteger(overlap) || overlap < 0)
			throw new Error(
				`Scene '${scene.id}' overlap must be a nonnegative safe integer`,
			);
		if (
			i + 1 < scenes.length &&
			overlap > Math.min(durationFrames, durations[i + 1])
		)
			throw new Error(
				`Scene '${scene.id}' overlap exceeds an adjacent scene duration`,
			);
		startFrame = endFrame - (i + 1 < scenes.length ? overlap : 0);
	}
	const totalDurationMs = Math.round((totalFrames / fps) * 1000);
	if (!Number.isFinite(totalDurationMs))
		throw new Error("Sequence duration exceeds the finite range");
	return { totalFrames, totalDurationMs, sceneOffsets };
}

function sceneDuration(
	scene: { id: string; durationFrames?: number; durationMs?: number },
	fps: number,
): number {
	if (
		scene.durationMs !== undefined &&
		(!Number.isFinite(scene.durationMs) || scene.durationMs <= 0)
	)
		throw new Error(
			`Scene '${scene.id}' durationMs must be finite and positive`,
		);
	const duration =
		scene.durationFrames ??
		(scene.durationMs === undefined
			? 60
			: Math.round((scene.durationMs / 1000) * fps));
	if (!Number.isSafeInteger(duration) || duration <= 0)
		throw new Error(
			`Scene '${scene.id}' duration must resolve to a positive safe integer frame count`,
		);
	return duration;
}

function compileSceneLayer(
	node: LayoutNode,
	sceneId: string,
	offset: SequenceTimelineResult["sceneOffsets"][number],
): LayoutNode {
	const start = node.startFrame ?? 0;
	const duration = node.durationFrames ?? offset.durationFrames - start;
	if (
		!Number.isSafeInteger(start) ||
		start < 0 ||
		!Number.isSafeInteger(duration) ||
		duration <= 0 ||
		start + duration > offset.durationFrames
	)
		throw new Error(
			`Scene '${sceneId}', layer '${node.id}': window must fit within frames [0, ${offset.durationFrames})`,
		);
	return {
		...node,
		startFrame: offset.startFrame + start,
		durationFrames: duration,
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
	/** Scene duration in milliseconds; rounded to frames using sequence FPS. */
	durationMs?: number;
	/** Positive integer frame count, taking precedence over durationMs. Defaults to 60. */
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
		SceneDefinitionSchema.parse(options);
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

			for (const node of scene.layout) {
				rootLayout.push(compileSceneLayer(node, scene.id, offset));
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
