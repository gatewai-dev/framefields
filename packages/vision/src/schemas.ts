import { z } from "zod";
import { VISION_VARIANTS } from "./model/registry.js";

/**
 * Zod schemas for vision outputs and config.
 *
 * Deliberately a SEPARATE entry point (`@gitframes/vision/schemas`) so the core runtime entry
 * stays zod-free: the hot path (runner, decode, signals) never imports this module. Agents,
 * node config validation, and report round-tripping consume these.
 */

// ── Detection ───────────────────────────────────────────────────────────────

export const BoundingBoxSchema = z.object({
	originX: z.number(),
	originY: z.number(),
	width: z.number(),
	height: z.number(),
	normalizedX: z.number(),
	normalizedY: z.number(),
	normalizedWidth: z.number(),
	normalizedHeight: z.number(),
});

export const DetectedObjectSchema = z.object({
	category: z.string(),
	score: z.number(),
	boundingBox: BoundingBoxSchema,
});

// ── Instance segmentation / matte ───────────────────────────────────────────

export const InstanceMaskSchema = z.object({
	category: z.string(),
	mask: z.instanceof(Uint8Array),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	area: z.number().nonnegative(),
	coverage: z.number().nonnegative(),
	detectionIndex: z.number().int().nonnegative(),
	trackId: z.number().int().optional(),
});

export const SegmentationResultSchema = z.object({
	detections: z.array(DetectedObjectSchema),
	masks: z.array(InstanceMaskSchema),
});

export const PersonMatteSchema = z.object({
	mask: z.instanceof(Uint8Array),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	coverage: z.number().min(0).max(1),
});

// ── Pose ────────────────────────────────────────────────────────────────────

export const PoseKeypointSchema = z.object({
	x: z.number(),
	y: z.number(),
	visibility: z.number(),
});

export const PosePersonSchema = z.object({
	score: z.number(),
	boundingBox: BoundingBoxSchema,
	keypoints: z.array(PoseKeypointSchema).length(17),
	trackId: z.number().int().optional(),
});

export const PoseResultSchema = z.object({
	people: z.array(PosePersonSchema),
});

// ── Frame summary (agent DX) ────────────────────────────────────────────────

export const VisionSummarySchema = z.object({
	frame: z.number().int().nonnegative(),
	objects: z.array(
		z.object({
			trackId: z.number().int(),
			category: z.string(),
			score: z.number(),
			center: z.tuple([z.number(), z.number()]),
			speed: z.number(),
			active: z.boolean(),
		}),
	),
	classes: z.array(z.string()),
	masks: z.record(z.string(), z.number()),
});

// ── Runtime config ──────────────────────────────────────────────────────────

export const VisionConfigSchema = z
	.object({
		enableDetection: z.boolean().optional(),
		enableSegmentation: z.boolean().optional(),
		enablePose: z.boolean().optional(),
		enableMatte: z.boolean().optional(),
		classes: z.array(z.string()).optional(),
		confidence: z.number().min(0).max(1).optional(),
		variant: z.enum(VISION_VARIANTS).optional(),
		modelsDir: z.string().optional(),
		baseUrl: z.string().optional(),
		maskThreshold: z.number().min(0).max(1).optional(),
		featherRadius: z.number().min(0).max(1).optional(),
		cameraFov: z.number().optional(),
	})
	.strict();

// ── Analysis report (Phase C) ───────────────────────────────────────────────

export const VisionAnalysisTrackSummarySchema = z.object({
	trackId: z.number().int(),
	category: z.string(),
	frames: z.tuple([z.number().int(), z.number().int()]),
	speedMeanPxS: z.number(),
	centerPath: z.array(z.tuple([z.number(), z.number()])),
});

export const VisionAnalysisClassSummarySchema = z.object({
	framesPresent: z.number().int().nonnegative(),
	totalFrames: z.number().int().positive(),
	maxConfidence: z.number(),
	tracks: z.number().int().nonnegative(),
});

export const VisionAnalysisReportSchema = z.object({
	source: z.string(),
	totalFrames: z.number().int().positive(),
	fps: z.number().positive(),
	durationSec: z.number().nonnegative(),
	tasks: z.array(z.string()),
	modelDownloads: z.record(
		z.string(),
		z.object({
			bytes: z.number().int().nonnegative(),
			ms: z.number().nonnegative(),
		}),
	),
	inferenceMs: z.number().nonnegative(),
	trackCount: z.number().int().nonnegative(),
	classes: z.record(z.string(), VisionAnalysisClassSummarySchema),
	tracks: z.array(VisionAnalysisTrackSummarySchema),
	masks: z.record(z.string(), z.object({ meanCoverage: z.number() })),
});
