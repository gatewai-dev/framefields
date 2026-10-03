/** COCO-17 keypoint indices (RTMO output order). */
export const COCO17_KEYPOINTS = {
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

export const COCO17_KEYPOINT_NAMES = [
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
export const COCO17_BONES = [
	{
		from: COCO17_KEYPOINTS.NOSE,
		to: COCO17_KEYPOINTS.LEFT_SHOULDER,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.NOSE,
		to: COCO17_KEYPOINTS.RIGHT_SHOULDER,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_SHOULDER,
		to: COCO17_KEYPOINTS.RIGHT_SHOULDER,
		color: [1.0, 0.0, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_SHOULDER,
		to: COCO17_KEYPOINTS.LEFT_ELBOW,
		color: [1.0, 0.333, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_ELBOW,
		to: COCO17_KEYPOINTS.LEFT_WRIST,
		color: [1.0, 0.667, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.RIGHT_SHOULDER,
		to: COCO17_KEYPOINTS.RIGHT_ELBOW,
		color: [1.0, 1.0, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.RIGHT_ELBOW,
		to: COCO17_KEYPOINTS.RIGHT_WRIST,
		color: [0.667, 1.0, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_SHOULDER,
		to: COCO17_KEYPOINTS.LEFT_HIP,
		color: [0.333, 1.0, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.RIGHT_SHOULDER,
		to: COCO17_KEYPOINTS.RIGHT_HIP,
		color: [0.0, 1.0, 0.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_HIP,
		to: COCO17_KEYPOINTS.RIGHT_HIP,
		color: [0.0, 1.0, 0.333, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_HIP,
		to: COCO17_KEYPOINTS.LEFT_KNEE,
		color: [0.0, 1.0, 0.667, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.LEFT_KNEE,
		to: COCO17_KEYPOINTS.LEFT_ANKLE,
		color: [0.0, 1.0, 1.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.RIGHT_HIP,
		to: COCO17_KEYPOINTS.RIGHT_KNEE,
		color: [0.0, 0.667, 1.0, 1.0] as const,
	},
	{
		from: COCO17_KEYPOINTS.RIGHT_KNEE,
		to: COCO17_KEYPOINTS.RIGHT_ANKLE,
		color: [0.0, 0.333, 1.0, 1.0] as const,
	},
] as const;
