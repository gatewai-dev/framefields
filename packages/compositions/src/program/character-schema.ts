/**
 * Schemas for character animation on model nodes: layered clips, two-bone
 * IK, look-at, spring bones, and skinned crowds on instance nodes.
 *
 * Time-varying values are tracks: a constant, keyframes `[[frame, …value]]`
 * (linear, in the layer's own frames), or, in process, a function of the
 * frame (not serializable; a spec sent as JSON keeps constants and keys).
 */
import { z } from "zod";

const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
const isFunction = (v: unknown) => typeof v === "function";

/** A number over time: constant, `[[frame, value], …]` keys, or `(frame) => value`. */
export const NumberTrackSchema = z.union([
	z.number(),
	z.array(z.tuple([z.number(), z.number()])).min(1),
	z.custom<(frame: number) => number>(isFunction),
]);
export type NumberTrack = z.infer<typeof NumberTrackSchema>;

/** A point over time: `[x, y, z]`, `[[frame, x, y, z], …]` keys, or `(frame) => [x, y, z]`. */
export const Vec3TrackSchema = z.union([
	Vec3Schema,
	z.array(z.tuple([z.number(), z.number(), z.number(), z.number()])).min(1),
	z.custom<(frame: number) => [number, number, number]>(isFunction),
]);
export type Vec3Track = z.infer<typeof Vec3TrackSchema>;

const ClipRefSchema = z.union([z.string(), z.number().int().min(0)]);

export const ModelAnimationLayerSchema = z
	.object({
		/** Clip name or index in the model file. */
		clip: ClipRefSchema,
		/** 0..1 over the layers beneath. Default 1. */
		weight: NumberTrackSchema.optional(),
		/** Playback speed. Default 1. */
		speed: z.number().optional(),
		/** Seconds into the clip at the layer's first frame. Default 0. */
		timeOffset: z.number().optional(),
		/** Only these joints and their descendants take this layer. */
		mask: z.array(z.string()).optional(),
		/** Default true; false holds the last pose. */
		loop: z.boolean().optional(),
	})
	.strict();
export type ModelAnimationLayer = z.infer<typeof ModelAnimationLayerSchema>;

export const TwoBoneIkSchema = z
	.object({
		/** [root, mid, effector] joint names, e.g. ["UpperArm.L", "LowerArm.L", "Hand.L"]. */
		chain: z.tuple([z.string(), z.string(), z.string()]),
		/** Where the effector reaches, in scene coordinates. */
		target: Vec3TrackSchema,
		/** The knee / elbow bends toward this point, scene coordinates. */
		poleTarget: Vec3TrackSchema.optional(),
		weight: NumberTrackSchema.optional(),
	})
	.strict();
export type TwoBoneIkConstraint = z.infer<typeof TwoBoneIkSchema>;

export const LookAtSchema = z
	.object({
		joint: z.string(),
		/** Scene coordinates. */
		target: Vec3TrackSchema,
		weight: NumberTrackSchema.optional(),
		/** Largest turn from the animated pose, degrees. Default 70. */
		maxAngleDeg: z.number().min(0).max(180).optional(),
		/** The joint's local axis that faces the target. Default [0, 0, 1] (glTF forward). */
		axis: Vec3Schema.optional(),
	})
	.strict();
export type LookAtConstraint = z.infer<typeof LookAtSchema>;

export const SpringBoneChainSchema = z
	.object({
		/** Root joints of chains (cape, tail, antenna, hair); each runs down its first child. */
		joints: z.array(z.string()).min(1),
		/** Pull back toward the animated pose, per second. Default 6. */
		stiffness: z.number().min(0).optional(),
		/** Share of velocity lost per second, 0..1. Default 0.6. */
		damping: z.number().min(0).max(1).optional(),
		/** Scene acceleration, px/s² (+y is down). Default [0, 0, 0]. */
		gravity: Vec3Schema.optional(),
	})
	.strict();
export type SpringBoneChain = z.infer<typeof SpringBoneChainSchema>;

export const CrowdSchema = z
	.object({
		/** Clips the instances play (names or indices); instance i plays clip i % n unless it says. */
		clips: z.array(ClipRefSchema).min(1),
		/** Baked samples per second. Default 30. */
		fps: z.number().min(1).max(120).optional(),
		/** Seeds each instance's phase and speed. */
		seed: z.number().optional(),
		/** Random playback speed per instance. Default [1, 1]. */
		speedRange: z.tuple([z.number().min(0), z.number().min(0)]).optional(),
		/** "random" (default) staggers instances through their clip; "sync" starts all together. */
		phase: z.enum(["random", "sync"]).optional(),
	})
	.strict();
export type CrowdConfig = z.infer<typeof CrowdSchema>;
