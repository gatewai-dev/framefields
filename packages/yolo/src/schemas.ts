import { z } from "zod";

/**
 * Shared zod schemas for YOLO outputs (specs/yolov4plan.ts §Phase A).
 *
 * Deliberately a SEPARATE entry point (`@gitframes/yolo/schemas`) so the core runtime entry
 * stays zod-free: the hot path (runner, decode, signals) never imports this module. Agents,
 * node config validation, and report round-tripping consume these.
 */

// ── Bounding box / detection ────────────────────────────────────────────────

export const YoloBoundingBoxSchema = z.object({
	originX: z.number(),
	originY: z.number(),
	width: z.number(),
	height: z.number(),
	normalizedX: z.number(),
	normalizedY: z.number(),
	normalizedWidth: z.number(),
	normalizedHeight: z.number(),
	angle: z.number().optional(),
});

export const YoloDetectionSchema = z.object({
	category: z.string(),
	classIndex: z.number().int(),
	score: z.number(),
	boundingBox: YoloBoundingBoxSchema,
});

// ── Instance segmentation ───────────────────────────────────────────────────

export const YoloInstanceMaskSchema = z.object({
	category: z.string(),
	mask: z.instanceof(Uint8Array),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	area: z.number().nonnegative(),
	coverage: z.number().nonnegative(),
	detectionIndex: z.number().int().nonnegative(),
	trackId: z.number().int().optional(),
});

export const YoloSegmentationResultSchema = z.object({
	detections: z.array(YoloDetectionSchema),
	masks: z.array(YoloInstanceMaskSchema),
});

// ── Pose ────────────────────────────────────────────────────────────────────

export const YoloPoseKeypointSchema = z.object({
	x: z.number(),
	y: z.number(),
	visibility: z.number(),
});

export const YoloPosePersonSchema = z.object({
	score: z.number(),
	boundingBox: YoloBoundingBoxSchema,
	keypoints: z.array(YoloPoseKeypointSchema).length(17),
	trackId: z.number().int().optional(),
});

export const YoloPoseResultSchema = z.object({
	people: z.array(YoloPosePersonSchema),
});

// ── Classification ──────────────────────────────────────────────────────────

export const YoloClassifyResultSchema = z.object({
	top1: z.number().int(),
	top1Score: z.number(),
	top5: z.array(z.object({ index: z.number().int(), score: z.number() })),
});

// ── OBB ─────────────────────────────────────────────────────────────────────

export const YoloOBBDetectionSchema = z.object({
	category: z.string(),
	classIndex: z.number().int(),
	score: z.number(),
	boundingBox: YoloBoundingBoxSchema.extend({ angle: z.number() }),
	corners: z.array(z.tuple([z.number(), z.number()])).length(4),
});

export const YoloOBBResultSchema = z.object({
	detections: z.array(YoloOBBDetectionSchema),
});

// ── Frame summary (agent DX) ────────────────────────────────────────────────

export const YoloSummarySchema = z.object({
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

export const CustomModelConfigSchema = z.object({
	path: z.string().optional(),
	url: z.string().optional(),
	task: z.enum(["detect", "segment", "pose", "obb", "classify", "world"]),
	classes: z.array(z.string()),
	imgsz: z.number().int().min(320).max(1280).optional(),
});

export const YoloConfigSchema = z.object({
	enableDetection: z.boolean().optional(),
	enableSegmentation: z.boolean().optional(),
	enablePose: z.boolean().optional(),
	enableClassification: z.boolean().optional(),
	enableObb: z.boolean().optional(),
	enableWorld: z.boolean().optional(),
	prompts: z.array(z.string()).optional(),
	customModel: CustomModelConfigSchema.optional(),
	classes: z.array(z.string()).optional(),
	confidence: z.number().min(0).max(1).optional(),
	iouThreshold: z.number().min(0).max(1).optional(),
	variant: z.enum(["n", "s", "m", "l", "x"]).optional(),
	imgsz: z.number().int().min(320).max(1280).optional(),
	delegate: z.enum(["cpu", "webgpu"]).optional(),
	modelsDir: z.string().optional(),
	baseUrl: z.string().optional(),
	maskThreshold: z.number().min(0).max(1).optional(),
	featherRadius: z.number().min(0).max(1).optional(),
	autoDownload: z.boolean().optional(),
	cameraFov: z.number().optional(),
});

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
