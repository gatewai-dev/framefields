/** COCO-17 keypoint indices for YOLO pose outputs (matches YOLO_POSE_KEYPOINTS order). */
export const POSE_LANDMARKS_YOLO = {
	NOSE: 0,
	LEFT_EYE: 1,
	RIGHT_EYE: 2,
	LEFT_EAR: 3,
	RIGHT_EAR: 4,
	LEFT_SHOULDER: 5,
	RIGHT_SHOULDER: 6,
	LEFT_ELBOW: 7,
	RIGHT_ELBOW: 8,
	LEFT_WRIST: 9,
	RIGHT_WRIST: 10,
	LEFT_HIP: 11,
	RIGHT_HIP: 12,
	LEFT_KNEE: 13,
	RIGHT_KNEE: 14,
	LEFT_ANKLE: 15,
	RIGHT_ANKLE: 16,
} as const;

export const YOLO_POSE_KEYPOINT_NAMES = [
	"nose",
	"leftEye",
	"rightEye",
	"leftEar",
	"rightEar",
	"leftShoulder",
	"rightShoulder",
	"leftElbow",
	"rightElbow",
	"leftWrist",
	"rightWrist",
	"leftHip",
	"rightHip",
	"leftKnee",
	"rightKnee",
	"leftAnkle",
	"rightAnkle",
] as const;

/** COCO-17 skeleton bones for the WebGPU skeleton renderer (indices above). */
export const YOLO_COCO17_BONES = [
	{
		from: POSE_LANDMARKS_YOLO.NOSE,
		to: POSE_LANDMARKS_YOLO.LEFT_SHOULDER,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.NOSE,
		to: POSE_LANDMARKS_YOLO.RIGHT_SHOULDER,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_SHOULDER,
		to: POSE_LANDMARKS_YOLO.RIGHT_SHOULDER,
		color: [1.0, 0.0, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_SHOULDER,
		to: POSE_LANDMARKS_YOLO.LEFT_ELBOW,
		color: [1.0, 0.333, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_ELBOW,
		to: POSE_LANDMARKS_YOLO.LEFT_WRIST,
		color: [1.0, 0.667, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.RIGHT_SHOULDER,
		to: POSE_LANDMARKS_YOLO.RIGHT_ELBOW,
		color: [1.0, 1.0, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.RIGHT_ELBOW,
		to: POSE_LANDMARKS_YOLO.RIGHT_WRIST,
		color: [0.667, 1.0, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_SHOULDER,
		to: POSE_LANDMARKS_YOLO.LEFT_HIP,
		color: [0.333, 1.0, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.RIGHT_SHOULDER,
		to: POSE_LANDMARKS_YOLO.RIGHT_HIP,
		color: [0.0, 1.0, 0.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_HIP,
		to: POSE_LANDMARKS_YOLO.RIGHT_HIP,
		color: [0.0, 1.0, 0.333, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_HIP,
		to: POSE_LANDMARKS_YOLO.LEFT_KNEE,
		color: [0.0, 1.0, 0.667, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.LEFT_KNEE,
		to: POSE_LANDMARKS_YOLO.LEFT_ANKLE,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.RIGHT_HIP,
		to: POSE_LANDMARKS_YOLO.RIGHT_KNEE,
		color: [0.0, 0.667, 1.0, 1.0] as const,
	},
	{
		from: POSE_LANDMARKS_YOLO.RIGHT_KNEE,
		to: POSE_LANDMARKS_YOLO.RIGHT_ANKLE,
		color: [0.0, 0.333, 1.0, 1.0] as const,
	},
] as const;

/** Mapping from MediaPipe 33-pose indices to YOLO COCO-17 (named props survive unchanged). */
export const MEDIAPIPE_TO_YOLO_POSE_INDEX: Readonly<Record<number, number>> = {
	0: 0, // nose
	11: 5, // leftShoulder
	12: 6, // rightShoulder
	13: 7, // leftElbow
	14: 8, // rightElbow
	15: 9, // leftWrist
	16: 10, // rightWrist
	23: 11, // leftHip
	24: 12, // rightHip
	25: 13, // leftKnee
	26: 14, // rightKnee
	27: 15, // leftAnkle
	28: 16, // rightAnkle
};
