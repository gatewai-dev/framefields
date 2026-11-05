/**
 * Pose retargeting: a performer's 2D pose (vision keypoints, or any source
 * of named points) drives a 3D character's bones. Each bone is aimed along
 * its segment in the picture (shoulder → elbow, hip → knee, …), parents
 * first, so the character copies the performer's silhouette at its own
 * proportions. Aims run after clips and `pose`, before `lookAt` and `ik`,
 * so clips can carry what the camera can't see and IK can plant the feet.
 *
 * ```ts
 * const dancer = comp.vision("dance.mp4").person.place({ width: W, height: H });
 * Layer.glb("robot.glb", { aim: retargetPose(dancer, { rig: "mixamo" }) });
 * ```
 *
 * The picture has no depth: limbs swing in the plane facing the camera.
 */
import {
	type AimConstraint,
	type NumberTrack,
	numberAt,
	type TrackClock,
} from "@framefields/compositions/program";
import type { PoseKeypointName } from "./clip-vision.js";

/** Anything that answers where a keypoint is at a frame (a vision `PersonTrack`, a mocap reader). */
export interface PoseSource {
	point(
		name: PoseKeypointName,
		frame: number,
	): { x: number; y: number; visibility: number };
}

/** The bones a performer's 2D pose can aim. */
export type RetargetBone =
	| "spine"
	| "neck"
	| "leftUpperArm"
	| "leftLowerArm"
	| "rightUpperArm"
	| "rightLowerArm"
	| "leftUpperLeg"
	| "leftLowerLeg"
	| "rightUpperLeg"
	| "rightLowerLeg";

/** Joint names per bone; names match without a namespace prefix and case (`"LeftArm"` finds `"mixamorig:LeftArm"`). */
export type RigMap = Partial<Record<RetargetBone, string>>;

/** Joint names of common rigs. */
export const RIG_PRESETS = {
	/** Mixamo (`mixamorig:` prefix, any number). */
	mixamo: {
		spine: "Spine",
		neck: "Neck",
		leftUpperArm: "LeftArm",
		leftLowerArm: "LeftForeArm",
		rightUpperArm: "RightArm",
		rightLowerArm: "RightForeArm",
		leftUpperLeg: "LeftUpLeg",
		leftLowerLeg: "LeftLeg",
		rightUpperLeg: "RightUpLeg",
		rightLowerLeg: "RightLeg",
	},
	/** Unity humanoid / VRM bone names. */
	humanoid: {
		spine: "Spine",
		neck: "Neck",
		leftUpperArm: "LeftUpperArm",
		leftLowerArm: "LeftLowerArm",
		rightUpperArm: "RightUpperArm",
		rightLowerArm: "RightLowerArm",
		leftUpperLeg: "LeftUpperLeg",
		leftLowerLeg: "LeftLowerLeg",
		rightUpperLeg: "RightUpperLeg",
		rightLowerLeg: "RightLowerLeg",
	},
	/** Blender Rigify deform bones. */
	rigify: {
		spine: "spine",
		neck: "neck",
		leftUpperArm: "upper_arm.L",
		leftLowerArm: "forearm.L",
		rightUpperArm: "upper_arm.R",
		rightLowerArm: "forearm.R",
		leftUpperLeg: "thigh.L",
		leftLowerLeg: "shin.L",
		rightUpperLeg: "thigh.R",
		rightLowerLeg: "shin.R",
	},
} as const satisfies Record<string, RigMap>;

export interface RetargetOptions {
	/** The character's joint names: a preset or a map. Default "mixamo". */
	rig?: keyof typeof RIG_PRESETS | RigMap;
	/** Only these bones (e.g. arms, over a walk clip). Default: every mapped bone. */
	bones?: RetargetBone[];
	/**
	 * Drive the character's right side with the performer's left: for a
	 * character seen from behind. Default false (both face the camera).
	 */
	mirror?: boolean;
	/**
	 * Keypoints less sure than this hand their bone back to the animated
	 * pose, fading over the next 0.2 of confidence. Default 0.3.
	 */
	minVisibility?: number;
	/** Overall blend over the animated pose, 0..1: a number, keys, function or signal. Default 1. */
	weight?: NumberTrack;
}

type Point = PoseKeypointName | readonly [PoseKeypointName, PoseKeypointName];

/** Each bone's segment in the picture, parents first. */
const SEGMENTS: ReadonlyArray<[RetargetBone, Point, Point]> = [
	["spine", ["leftHip", "rightHip"], ["leftShoulder", "rightShoulder"]],
	["neck", ["leftShoulder", "rightShoulder"], "nose"],
	["leftUpperArm", "leftShoulder", "leftElbow"],
	["leftLowerArm", "leftElbow", "leftWrist"],
	["rightUpperArm", "rightShoulder", "rightElbow"],
	["rightLowerArm", "rightElbow", "rightWrist"],
	["leftUpperLeg", "leftHip", "leftKnee"],
	["leftLowerLeg", "leftKnee", "leftAnkle"],
	["rightUpperLeg", "rightHip", "rightKnee"],
	["rightLowerLeg", "rightKnee", "rightAnkle"],
];

const mirrored = (name: PoseKeypointName): PoseKeypointName =>
	(name.startsWith("left")
		? `right${name.slice(4)}`
		: name.startsWith("right")
			? `left${name.slice(5)}`
			: name) as PoseKeypointName;

/** A keypoint, or the midpoint of two, with the lesser visibility. */
function read(source: PoseSource, p: Point, frame: number, mirror: boolean) {
	const name = (n: PoseKeypointName) => (mirror ? mirrored(n) : n);
	if (typeof p === "string") return source.point(name(p), frame);
	const a = source.point(name(p[0]), frame);
	const b = source.point(name(p[1]), frame);
	return {
		x: (a.x + b.x) / 2,
		y: (a.y + b.y) / 2,
		visibility: Math.min(a.visibility, b.visibility),
	};
}

const smoothstep = (lo: number, hi: number, v: number) => {
	const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
	return t * t * (3 - 2 * t);
};

/**
 * Aim constraints that make a character copy `source`'s pose: put them on
 * a glTF model's `aim`. Bones whose joints the rig map doesn't name, or
 * whose keypoints the vision isn't sure of, keep the animated pose.
 */
export function retargetPose(
	source: PoseSource,
	options: RetargetOptions = {},
): AimConstraint[] {
	const rig: RigMap =
		typeof options.rig === "object"
			? options.rig
			: RIG_PRESETS[options.rig ?? "mixamo"];
	const only = options.bones ? new Set(options.bones) : undefined;
	const mirror = options.mirror ?? false;
	const lo = options.minVisibility ?? 0.3;
	return SEGMENTS.filter(
		([bone]) => rig[bone] && (!only || only.has(bone)),
	).map(([bone, from, to]) => ({
		joint: rig[bone] as string,
		direction: (frame: number): [number, number, number] => {
			const a = read(source, from, frame, mirror);
			const b = read(source, to, frame, mirror);
			return [b.x - a.x, b.y - a.y, 0];
		},
		// A signal, so the user's weight reads with the render's own clock.
		weight: {
			get: (ctx?: unknown) => {
				const clock = ctx as TrackClock;
				const a = read(source, from, clock.frame, mirror);
				const b = read(source, to, clock.frame, mirror);
				const sure = smoothstep(
					lo,
					lo + 0.2,
					Math.min(a.visibility, b.visibility),
				);
				return sure * numberAt(options.weight, clock, 1);
			},
		},
	}));
}
