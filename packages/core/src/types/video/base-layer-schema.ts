import { z } from "zod";
import { GlobalCompositeOperation } from "../config/schemas.js";

export const AnimationTypeSchema = z.enum([
	"fade-in",
	"fade-out",
	"slide-in-left",
	"slide-in-right",
	"slide-in-top",
	"slide-in-bottom",
	"zoom-in",
	"zoom-out",
	"rotate-cw",
	"rotate-ccw",
	"bounce",
	"shake",
]);

export type AnimationType = z.infer<typeof AnimationTypeSchema>;

export const VideoAnimationSchema = z.object({
	id: z.string(),
	type: AnimationTypeSchema,
	value: z.number(),
});

export type VideoAnimation = z.infer<typeof VideoAnimationSchema>;

export const VideoSpatialPropsSchema = z.object({
	x: z.number().default(0),
	y: z.number().default(0),
	width: z.number().optional(),
	height: z.number().optional(),
	rotation: z.number().default(0),
	scale: z.number().min(0).default(1),
	opacity: z.number().min(0).max(1).default(1),
	zIndex: z.number().int().optional(),
	blendMode: GlobalCompositeOperation.optional(),
});

export const VideoTimingPropsSchema = z.object({
	startFrame: z.number().int().min(0).default(0),
	durationInMS: z.number().int().min(1).optional(),
	trimStart: z.number().int().min(0).optional(),
	trimEnd: z.number().int().min(0).optional(),
	speed: z.number().min(0.25).max(4.0).optional(),
});

export const VideoTextPropsSchema = z.object({
	text: z.string().optional(),
	fontSize: z.number().optional(),
	fontFamily: z.string().optional(),
	fontStyle: z.string().optional(),
	fontWeight: z.union([z.number(), z.string()]).optional(),
	fill: z.string().optional(),
	align: z.string().optional(),
	verticalAlign: z.string().optional(),
	letterSpacing: z.number().optional(),
	lineHeight: z.number().optional(),
	padding: z.number().optional(),
	stroke: z.string().optional(),
	strokeWidth: z.number().optional(),
	strokeAlign: z.enum(["inside", "center", "outside"]).optional(),
	textShadow: z.string().optional(),
	// Advanced Skia Props
	textBackgroundColor: z.string().optional(),
	shadows: z
		.array(
			z.object({
				color: z.string(),
				offset: z.object({ x: z.number(), y: z.number() }).optional(),
				blurRadius: z.number().optional(),
			}),
		)
		.optional(),
	// Text/Caption animations
	textAnimation: z.any().optional(),
	bottomPadding: z.number().optional(),
	maxWidth: z.number().optional(),
});

export const VideoStylePropsSchema = z.object({
	backgroundColor: z.string().optional(),
	borderColor: z.string().optional(),
	borderWidth: z.number().optional(),
	strokeRadius: z.number().optional(),
	autoDimensions: z.boolean().optional(),
});

export const VideoLayerTypeSchema = z.enum([
	"Video",
	"Image",
	"Audio",
	"Text",
	"Caption",
	"SVG",
	"GIF",
	"Lottie",
]);

export type VideoLayerType = z.infer<typeof VideoLayerTypeSchema>;

export const BaseVideoLayerPropsSchema = VideoSpatialPropsSchema.merge(
	VideoTimingPropsSchema,
)
	.merge(VideoTextPropsSchema)
	.merge(VideoStylePropsSchema)
	.extend({
		type: VideoLayerTypeSchema.optional(),
		animations: z.array(VideoAnimationSchema).optional(),
	});

export type BaseVideoLayerProps = z.infer<typeof BaseVideoLayerPropsSchema>;
