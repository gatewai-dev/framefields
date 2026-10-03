/// <reference types="webgpu" />
import {
	programmaticSignal as coreProgrammaticSignal,
	type DetectedObject,
	type FrameContext,
	frameSignal,
	type Landmark3D,
	type ProgrammaticSignal,
	type TensorData,
	type TrackedObject,
} from "@gitframes/core";
import { POSE_LANDMARKS_YOLO } from "../extractors/canonical-indices.js";
import {
	createNeutralLandmarks,
	createNeutralObjectResult,
	createNeutralPoseResult,
} from "../runner/canonical-baselines.js";
import { SpatialLandmarkTransformer } from "../spatial/camera-space-transformer.js";
import { getPersonBoundingBox } from "../tracking/pose-track-matcher.js";
import { computeIoU } from "../tracking/temporal-object-tracker.js";
import type {
	LandmarkCoordinateSignals,
	YoloClassifyResult,
	YoloConfig,
	YoloInstanceMask,
	YoloOBBResult,
	YoloPosePerson,
	YoloPoseResult,
	YoloSummary,
} from "../types.js";

export interface YoloVisionBundleOptions {
	readonly totalFrames?: number;
	readonly fps?: number;
	readonly width?: number;
	readonly height?: number;
	readonly cameraFov?: number;
	readonly config?: YoloConfig;
}

// ── Signal surface types ────────────────────────────────────────────────────

/** Named pose landmarks (COCO-17) plus numeric proxy access to any of the 17 keypoints. */
export interface PoseLandmarkSignals {
	readonly shoulder: LandmarkCoordinateSignals;
	readonly leftShoulder: LandmarkCoordinateSignals;
	readonly rightShoulder: LandmarkCoordinateSignals;
	readonly leftElbow: LandmarkCoordinateSignals;
	readonly rightElbow: LandmarkCoordinateSignals;
	readonly leftWrist: LandmarkCoordinateSignals;
	readonly rightWrist: LandmarkCoordinateSignals;
	readonly leftHip: LandmarkCoordinateSignals;
	readonly rightHip: LandmarkCoordinateSignals;
	readonly leftKnee: LandmarkCoordinateSignals;
	readonly rightKnee: LandmarkCoordinateSignals;
	readonly leftAnkle: LandmarkCoordinateSignals;
	readonly rightAnkle: LandmarkCoordinateSignals;
	readonly nose: LandmarkCoordinateSignals;
	readonly leftEye: LandmarkCoordinateSignals;
	readonly rightEye: LandmarkCoordinateSignals;
	readonly leftEar: LandmarkCoordinateSignals;
	readonly rightEar: LandmarkCoordinateSignals;
	get(keypointIndex: number): LandmarkCoordinateSignals;
}

export interface TrackPoseSignals extends PoseLandmarkSignals {
	readonly hasPose: ProgrammaticSignal;
	readonly wristSpeed: ProgrammaticSignal;
	readonly handRaised: ProgrammaticSignal;
	readonly bodyTiltAngle: ProgrammaticSignal;
}

export interface ObjectBoundingBoxSignals {
	readonly x: ProgrammaticSignal;
	readonly y: ProgrammaticSignal;
	readonly width: ProgrammaticSignal;
	readonly height: ProgrammaticSignal;
	readonly screenX: ProgrammaticSignal;
	readonly screenY: ProgrammaticSignal;
	readonly screenWidth: ProgrammaticSignal;
	readonly screenHeight: ProgrammaticSignal;
	readonly aspectRatio: ProgrammaticSignal;
	readonly area: ProgrammaticSignal;
	/** Rotation of the matching OBB detection (radians, screen space); 0 when none. */
	readonly angle: ProgrammaticSignal;
}

export interface ObjectAnchorsSignals {
	readonly topLeft: LandmarkCoordinateSignals;
	readonly topCenter: LandmarkCoordinateSignals;
	readonly topRight: LandmarkCoordinateSignals;
	readonly centerLeft: LandmarkCoordinateSignals;
	readonly center: LandmarkCoordinateSignals;
	readonly centerRight: LandmarkCoordinateSignals;
	readonly bottomLeft: LandmarkCoordinateSignals;
	readonly bottomCenter: LandmarkCoordinateSignals;
	readonly bottomRight: LandmarkCoordinateSignals;
}

export interface ObjectKinematicsSignals {
	readonly vx: ProgrammaticSignal;
	readonly vy: ProgrammaticSignal;
	readonly speed: ProgrammaticSignal;
	readonly acceleration: ProgrammaticSignal;
	readonly headingRad: ProgrammaticSignal;
	readonly headingDeg: ProgrammaticSignal;
}

export interface ObjectTrackSignals {
	readonly trackId: number;
	readonly category: string;
	readonly bounds: ObjectBoundingBoxSignals;
	readonly anchors: ObjectAnchorsSignals;
	readonly kinematics: ObjectKinematicsSignals;
	readonly confidence: ProgrammaticSignal;
	readonly active: ProgrammaticSignal;
	readonly isCoasting: ProgrammaticSignal;
	readonly age: ProgrammaticSignal;
	readonly pose: TrackPoseSignals;

	// Anchor shortcuts (pinToObject compatibility)
	readonly center: LandmarkCoordinateSignals;
	readonly topCenter: LandmarkCoordinateSignals;
	readonly bottomCenter: LandmarkCoordinateSignals;
	readonly topLeft: LandmarkCoordinateSignals;
	readonly bottomLeft: LandmarkCoordinateSignals;

	// Extensible editing & isolating helpers (decorated by @gitframes/gitframes)
	readonly [key: string]: unknown;
}

export interface MaskTrackSignals {
	readonly trackId: number;
	readonly category: string;
	readonly area: ProgrammaticSignal; // px
	readonly coverage: ProgrammaticSignal; // area / frame area
	readonly solidity: ProgrammaticSignal; // area / bbox area
	readonly bboxFill: ProgrammaticSignal; // bbox area / frame area
	/** Frame-sized {0,255} mask for the current frame (renderer-populated). */
	data?: Uint8Array;
	/** GPU-resident silhouette texture (renderer-populated via SegmentationTexturePool). */
	texture?: GPUTexture;
}

export interface MaskCollectionSignals {
	get(trackId: number): MaskTrackSignals;
	/** Largest instance of the current frame (person preferred when present). */
	readonly subject: MaskTrackSignals;
	readonly count: ProgrammaticSignal;
}

export interface SegmentationSignals {
	readonly humanSilhouette: MaskTrackSignals;
	readonly subject: MaskTrackSignals;
	readonly instanceMasks: MaskCollectionSignals;
	readonly stencilTexture?: GPUTexture;
}

export interface ClassSignals {
	readonly count: ProgrammaticSignal;
	readonly maxConfidence: ProgrammaticSignal;
	readonly present: ProgrammaticSignal;
	readonly primary: ObjectTrackSignals;
}

export interface ClassCollectionSignals {
	/** Cached per-class signals (stable identity). */
	get(name: string): ClassSignals;
	/** Sorted active category names for the current frame. */
	readonly names: readonly string[];
	readonly histogram: {
		get(ctx?: FrameContext): TensorData;
		readonly value: TensorData;
	};
}

export interface ClassificationSignals {
	readonly top1: ProgrammaticSignal;
	readonly top1Confidence: ProgrammaticSignal;
	readonly top5: ReadonlyArray<{
		readonly index: number;
		readonly score: number;
	}>;
	readonly top5At: (
		frame: number,
	) => ReadonlyArray<{ index: number; score: number }>;
}

export interface ObjectCollectionSignals {
	get(trackId: number): ObjectTrackSignals;
	byCategory(category: string, rank?: number): ObjectTrackSignals;
	readonly primary: ObjectTrackSignals;
	readonly count: ProgrammaticSignal;
	hasCategory(category: string): ProgrammaticSignal;
	getActiveTracks(frame: number): readonly TrackedObject[];
	readonly detectedCategories: readonly string[];
}

// ── The bundle ──────────────────────────────────────────────────────────────

export class YoloVisionBundle {
	public readonly objects: ObjectCollectionSignals;
	public readonly poseLandmarks: PoseLandmarkSignals;
	public readonly masks: MaskCollectionSignals;
	public readonly segmentation: SegmentationSignals;
	public readonly classes: ClassCollectionSignals;
	public readonly classification: ClassificationSignals;

	public readonly poseLandmarksTensor: {
		get(ctx?: FrameContext): TensorData;
		readonly value: TensorData;
	};
	public readonly objectsTensor: {
		get(ctx?: FrameContext): TensorData;
		readonly value: TensorData;
	};
	public readonly masksTensor: {
		get(ctx?: FrameContext): TensorData;
		readonly value: TensorData;
	};
	/** Per-class detection histogram [nc] — top-level convenience mirror of `classes.histogram`. */
	public readonly histogramTensor: {
		get(ctx?: FrameContext): TensorData;
		readonly value: TensorData;
	};

	private _totalFrames: number;
	private _fps: number;
	private _width: number;
	private _height: number;
	private _transformer: SpatialLandmarkTransformer;
	private _stencilTexture?: GPUTexture;

	private _poseCache = new Map<number, YoloPoseResult>();
	private _objectCache = new Map<
		number,
		{
			objects: readonly TrackedObject[];
			rawDetections: readonly DetectedObject[];
		}
	>();
	private _maskCache = new Map<number, readonly YoloInstanceMask[]>();
	private _classifyCache = new Map<number, YoloClassifyResult>();
	private _obbCache = new Map<number, YoloOBBResult>();

	private _poseLmCache = new Map<number, LandmarkCoordinateSignals>();
	private _trackCache = new Map<number, ObjectTrackSignals>();
	private _categoryCache = new Map<string, ObjectTrackSignals>();
	private _classCache = new Map<string, ClassSignals>();
	private _maskTrackCache = new Map<number, MaskTrackSignals>();
	private _registeredSignals = new Set<ProgrammaticSignal>();

	constructor(options: YoloVisionBundleOptions = {}) {
		this._totalFrames = options.totalFrames ?? 120;
		this._fps = options.fps ?? 24;
		this._width = options.width ?? 1920;
		this._height = options.height ?? 1080;
		this._transformer = new SpatialLandmarkTransformer({
			width: this._width,
			height: this._height,
			fov: options.cameraFov ?? 60,
		});

		// `self` avoids `this` contextual-typing issues inside object literals below.
		const self: YoloVisionBundle = this;

		const programmaticSignal = (
			evaluator: (ctx: FrameContext) => number,
			sigOptions?: Parameters<typeof coreProgrammaticSignal>[1],
		): ProgrammaticSignal => {
			const sig = coreProgrammaticSignal(evaluator, sigOptions);
			this._registeredSignals.add(sig);
			return sig;
		};

		// ── Pose landmark signals (COCO-17, primary person) ──────────────
		const getPrimaryLandmarks = (frame: number): readonly Landmark3D[] => {
			const person = this.getPoseResult(frame).people[0];
			return (
				(person?.keypoints as unknown as Landmark3D[]) ??
				createNeutralLandmarks()
			);
		};

		const createPoseCoord = (
			index: number,
			label: string,
		): LandmarkCoordinateSignals => {
			const getLm = (frame: number): Landmark3D =>
				getPrimaryLandmarks(frame)[index] ?? { x: 0.5, y: 0.5, z: 0 };
			const x = programmaticSignal((ctx) => getLm(ctx.frame).x, {
				fps: this._fps,
				label: `${label}_x`,
			});
			const y = programmaticSignal((ctx) => getLm(ctx.frame).y, {
				fps: this._fps,
				label: `${label}_y`,
			});
			const z = programmaticSignal((ctx) => getLm(ctx.frame).z ?? 0, {
				fps: this._fps,
				label: `${label}_z`,
			});
			const screenX = programmaticSignal(
				(ctx) =>
					this._transformer.projectNormalizedLandmark(getLm(ctx.frame)).x,
				{ fps: this._fps, label: `${label}_screenX` },
			);
			const screenY = programmaticSignal(
				(ctx) =>
					this._transformer.projectNormalizedLandmark(getLm(ctx.frame)).y,
				{ fps: this._fps, label: `${label}_screenY` },
			);
			return { x, y, z, screenX, screenY };
		};

		const getOrCreatePoseLm = (index: number): LandmarkCoordinateSignals => {
			let sig = this._poseLmCache.get(index);
			if (!sig) {
				sig = createPoseCoord(
					index,
					POSE_KEYPOINT_NAMES[index] ?? `kpt_${index}`,
				);
				this._poseLmCache.set(index, sig);
			}
			return sig;
		};

		const poseNamed: PoseLandmarkSignals = {
			nose: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.NOSE),
			leftEye: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_EYE),
			rightEye: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_EYE),
			leftEar: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_EAR),
			rightEar: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_EAR),
			shoulder: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_SHOULDER),
			leftShoulder: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_SHOULDER),
			rightShoulder: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_SHOULDER),
			leftElbow: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_ELBOW),
			rightElbow: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_ELBOW),
			leftWrist: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_WRIST),
			rightWrist: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_WRIST),
			leftHip: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_HIP),
			rightHip: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_HIP),
			leftKnee: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_KNEE),
			rightKnee: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_KNEE),
			leftAnkle: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.LEFT_ANKLE),
			rightAnkle: getOrCreatePoseLm(POSE_LANDMARKS_YOLO.RIGHT_ANKLE),
			get: getOrCreatePoseLm,
		};
		this.poseLandmarks = new Proxy(poseNamed, {
			get(target, prop, receiver) {
				if (typeof prop === "string" && /^\d+$/.test(prop)) {
					return target.get(Number(prop));
				}
				if (typeof prop === "number") {
					return target.get(prop);
				}
				return Reflect.get(target, prop, receiver);
			},
		}) as PoseLandmarkSignals;

		// ── Object track signals (contract identical to the MediaPipe bundle) ──
		const neutralTrack = (
			trackId: number,
			category = "unknown",
		): TrackedObject => ({
			trackId,
			category,
			score: 0,
			boundingBox: {
				originX: this._width / 2,
				originY: this._height / 2,
				width: 0,
				height: 0,
				normalizedX: 0.5,
				normalizedY: 0.5,
				normalizedWidth: 0,
				normalizedHeight: 0,
			},
			centerX: this._width / 2,
			centerY: this._height / 2,
			normalizedCenterX: 0.5,
			normalizedCenterY: 0.5,
			velocity: { vx: 0, vy: 0 },
			speed: 0,
			age: 0,
			hits: 0,
			active: false,
			isCoasting: false,
		});

		const createAnchor = (
			getPos: (f: number) => { sx: number; sy: number },
			label: string,
		): LandmarkCoordinateSignals => {
			const screenX = programmaticSignal((ctx) => getPos(ctx.frame).sx, {
				fps: this._fps,
				label: `${label}_screenX`,
			});
			const screenY = programmaticSignal((ctx) => getPos(ctx.frame).sy, {
				fps: this._fps,
				label: `${label}_screenY`,
			});
			const x = programmaticSignal(
				(ctx) => (this._width > 0 ? getPos(ctx.frame).sx / this._width : 0),
				{ fps: this._fps, label: `${label}_x` },
			);
			const y = programmaticSignal(
				(ctx) => (this._height > 0 ? getPos(ctx.frame).sy / this._height : 0),
				{ fps: this._fps, label: `${label}_y` },
			);
			const z = programmaticSignal(() => 0, {
				fps: this._fps,
				label: `${label}_z`,
			});
			return { x, y, z, screenX, screenY };
		};

		const buildTrackPoseSignals = (
			resolveTrack: (frame: number) => TrackedObject,
			label: string,
			fixedId?: number,
		): TrackPoseSignals => {
			const resolvePerson = (frame: number): YoloPosePerson | undefined => {
				const poseRes = self.getPoseResult(frame);
				if (poseRes.people.length === 0) return undefined;

				const trk = resolveTrack(frame);
				const targetId = fixedId ?? trk.trackId;

				// 1. Direct match by trackId
				const byId = poseRes.people.find((p) => p.trackId === targetId);
				if (byId) return byId;

				// 2. Spatial IoU fallback against track's bounding box
				if (!trk.active && poseRes.people.length > 1) return undefined;

				if (poseRes.people.length === 1) {
					return poseRes.people[0];
				}

				let bestPerson: YoloPosePerson | undefined;
				let bestIoU = 0.1;
				for (const p of poseRes.people) {
					const pBox = getPersonBoundingBox(p);
					const isNormalized = pBox.width <= 1.05 && pBox.height <= 1.05;
					const targetBox =
						isNormalized && trk.boundingBox.normalizedWidth > 0
							? {
									originX: trk.boundingBox.normalizedX,
									originY: trk.boundingBox.normalizedY,
									width: trk.boundingBox.normalizedWidth,
									height: trk.boundingBox.normalizedHeight,
								}
							: trk.boundingBox;
					const iou = computeIoU(pBox, targetBox);
					if (iou > bestIoU) {
						bestIoU = iou;
						bestPerson = p;
					}
				}
				return bestPerson;
			};

			const hasPose = programmaticSignal(
				(ctx) => (resolvePerson(ctx.frame) ? 1.0 : 0.0),
				{ fps: this._fps, label: `${label}_hasPose` },
			);

			const createCoord = (
				index: number,
				kptName: string,
			): LandmarkCoordinateSignals => {
				const getLm = (frame: number): Landmark3D => {
					const person = resolvePerson(frame);
					const kp = person?.keypoints[index];
					if (kp && kp.visibility > 0.05) {
						return { x: kp.x, y: kp.y, z: 0 };
					}
					const trk = resolveTrack(frame);
					return {
						x: trk.normalizedCenterX,
						y: trk.normalizedCenterY,
						z: 0,
					};
				};

				const x = programmaticSignal((ctx) => getLm(ctx.frame).x, {
					fps: this._fps,
					label: `${label}_${kptName}_x`,
				});
				const y = programmaticSignal((ctx) => getLm(ctx.frame).y, {
					fps: this._fps,
					label: `${label}_${kptName}_y`,
				});
				const z = programmaticSignal((ctx) => getLm(ctx.frame).z ?? 0, {
					fps: this._fps,
					label: `${label}_${kptName}_z`,
				});
				const screenX = programmaticSignal(
					(ctx) =>
						self._transformer.projectNormalizedLandmark(getLm(ctx.frame)).x,
					{ fps: this._fps, label: `${label}_${kptName}_screenX` },
				);
				const screenY = programmaticSignal(
					(ctx) =>
						self._transformer.projectNormalizedLandmark(getLm(ctx.frame)).y,
					{ fps: this._fps, label: `${label}_${kptName}_screenY` },
				);
				return { x, y, z, screenX, screenY };
			};

			const coordsCache = new Map<number, LandmarkCoordinateSignals>();
			const getOrCreateCoord = (idx: number): LandmarkCoordinateSignals => {
				let c = coordsCache.get(idx);
				if (!c) {
					c = createCoord(idx, POSE_KEYPOINT_NAMES[idx] ?? `kpt_${idx}`);
					coordsCache.set(idx, c);
				}
				return c;
			};

			const wristSpeed = programmaticSignal(
				(ctx) => {
					const f = ctx.frame;
					const curr = resolvePerson(f);
					if (!curr) return 0;
					const prev = resolvePerson(Math.max(0, f - 1));
					const currKp = curr.keypoints;
					const prevKp = prev?.keypoints;

					const rwCurr = currKp[POSE_LANDMARKS_YOLO.RIGHT_WRIST];
					const rwPrev = prevKp?.[POSE_LANDMARKS_YOLO.RIGHT_WRIST];
					let rwSpeed = 0;
					if (
						rwCurr &&
						rwPrev &&
						rwCurr.visibility > 0.1 &&
						rwPrev.visibility > 0.1
					) {
						const dx = (rwCurr.x - rwPrev.x) * this._width;
						const dy = (rwCurr.y - rwPrev.y) * this._height;
						rwSpeed = Math.sqrt(dx * dx + dy * dy) * this._fps;
					}

					const lwCurr = currKp[POSE_LANDMARKS_YOLO.LEFT_WRIST];
					const lwPrev = prevKp?.[POSE_LANDMARKS_YOLO.LEFT_WRIST];
					let lwSpeed = 0;
					if (
						lwCurr &&
						lwPrev &&
						lwCurr.visibility > 0.1 &&
						lwPrev.visibility > 0.1
					) {
						const dx = (lwCurr.x - lwPrev.x) * this._width;
						const dy = (lwCurr.y - lwPrev.y) * this._height;
						lwSpeed = Math.sqrt(dx * dx + dy * dy) * this._fps;
					}

					return Math.max(rwSpeed, lwSpeed);
				},
				{ fps: this._fps, label: `${label}_wristSpeed` },
			);

			const handRaised = programmaticSignal(
				(ctx) => {
					const p = resolvePerson(ctx.frame);
					if (!p) return 0.0;
					const k = p.keypoints;
					const lw = k[POSE_LANDMARKS_YOLO.LEFT_WRIST];
					const ls = k[POSE_LANDMARKS_YOLO.LEFT_SHOULDER];
					const rw = k[POSE_LANDMARKS_YOLO.RIGHT_WRIST];
					const rs = k[POSE_LANDMARKS_YOLO.RIGHT_SHOULDER];

					const lRaised =
						lw &&
						ls &&
						lw.visibility > 0.1 &&
						ls.visibility > 0.1 &&
						lw.y < ls.y;
					const rRaised =
						rw &&
						rs &&
						rw.visibility > 0.1 &&
						rs.visibility > 0.1 &&
						rw.y < rs.y;
					return lRaised || rRaised ? 1.0 : 0.0;
				},
				{ fps: this._fps, label: `${label}_handRaised` },
			);

			const bodyTiltAngle = programmaticSignal(
				(ctx) => {
					const p = resolvePerson(ctx.frame);
					if (!p) return 0.0;
					const k = p.keypoints;
					const ls = k[POSE_LANDMARKS_YOLO.LEFT_SHOULDER];
					const rs = k[POSE_LANDMARKS_YOLO.RIGHT_SHOULDER];
					const lh = k[POSE_LANDMARKS_YOLO.LEFT_HIP];
					const rh = k[POSE_LANDMARKS_YOLO.RIGHT_HIP];
					if (!ls || !rs || !lh || !rh) return 0.0;

					const sx = ((ls.x + rs.x) / 2) * this._width;
					const sy = ((ls.y + rs.y) / 2) * this._height;
					const hx = ((lh.x + rh.x) / 2) * this._width;
					const hy = ((lh.y + rh.y) / 2) * this._height;

					const dx = sx - hx;
					const dy = sy - hy;
					if (dx === 0 && dy === 0) return 0.0;
					return Math.atan2(dx, -dy);
				},
				{ fps: this._fps, label: `${label}_bodyTiltAngle` },
			);

			const namedPose: TrackPoseSignals = {
				hasPose,
				wristSpeed,
				handRaised,
				bodyTiltAngle,
				nose: getOrCreateCoord(POSE_LANDMARKS_YOLO.NOSE),
				leftEye: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_EYE),
				rightEye: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_EYE),
				leftEar: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_EAR),
				rightEar: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_EAR),
				shoulder: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_SHOULDER),
				leftShoulder: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_SHOULDER),
				rightShoulder: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_SHOULDER),
				leftElbow: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_ELBOW),
				rightElbow: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_ELBOW),
				leftWrist: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_WRIST),
				rightWrist: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_WRIST),
				leftHip: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_HIP),
				rightHip: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_HIP),
				leftKnee: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_KNEE),
				rightKnee: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_KNEE),
				leftAnkle: getOrCreateCoord(POSE_LANDMARKS_YOLO.LEFT_ANKLE),
				rightAnkle: getOrCreateCoord(POSE_LANDMARKS_YOLO.RIGHT_ANKLE),
				get: getOrCreateCoord,
			};

			return new Proxy(namedPose, {
				get(target, prop, receiver) {
					if (typeof prop === "string" && /^\d+$/.test(prop)) {
						return target.get(Number(prop));
					}
					if (typeof prop === "number") {
						return target.get(prop);
					}
					return Reflect.get(target, prop, receiver);
				},
			});
		};

		const buildTrackSignals = (
			resolve: (frame: number) => TrackedObject,
			label: string,
			fixedCategory?: string,
			fixedId?: number,
		): ObjectTrackSignals => {
			const getBox = (f: number) => resolve(f).boundingBox;
			const pose = buildTrackPoseSignals(resolve, `${label}_pose`, fixedId);
			const anchor = (
				name: string,
				sx: (b: TrackedObject["boundingBox"]) => number,
				sy: (b: TrackedObject["boundingBox"]) => number,
			) =>
				createAnchor(
					(f) => ({ sx: sx(getBox(f)), sy: sy(getBox(f)) }),
					`${label}_${name}`,
				);

			const center = anchor(
				"center",
				(b) => b.originX + b.width / 2,
				(b) => b.originY + b.height / 2,
			);
			const speed = programmaticSignal((ctx) => resolve(ctx.frame).speed, {
				fps: this._fps,
				label: `${label}_speed`,
			});

			return {
				get trackId() {
					return fixedId ?? resolve(0).trackId;
				},
				get category() {
					return fixedCategory ?? resolve(0).category;
				},
				bounds: {
					x: programmaticSignal((ctx) => getBox(ctx.frame).normalizedX, {
						fps: this._fps,
						label: `${label}_normX`,
					}),
					y: programmaticSignal((ctx) => getBox(ctx.frame).normalizedY, {
						fps: this._fps,
						label: `${label}_normY`,
					}),
					width: programmaticSignal(
						(ctx) => getBox(ctx.frame).normalizedWidth,
						{ fps: this._fps, label: `${label}_normWidth` },
					),
					height: programmaticSignal(
						(ctx) => getBox(ctx.frame).normalizedHeight,
						{ fps: this._fps, label: `${label}_normHeight` },
					),
					screenX: programmaticSignal((ctx) => getBox(ctx.frame).originX, {
						fps: this._fps,
						label: `${label}_screenX`,
					}),
					screenY: programmaticSignal((ctx) => getBox(ctx.frame).originY, {
						fps: this._fps,
						label: `${label}_screenY`,
					}),
					screenWidth: programmaticSignal((ctx) => getBox(ctx.frame).width, {
						fps: this._fps,
						label: `${label}_screenWidth`,
					}),
					screenHeight: programmaticSignal((ctx) => getBox(ctx.frame).height, {
						fps: this._fps,
						label: `${label}_screenHeight`,
					}),
					aspectRatio: programmaticSignal(
						(ctx) => {
							const b = getBox(ctx.frame);
							return b.height > 0 ? b.width / b.height : 1.0;
						},
						{ fps: this._fps, label: `${label}_aspectRatio` },
					),
					area: programmaticSignal(
						(ctx) => {
							const b = getBox(ctx.frame);
							return b.width * b.height;
						},
						{ fps: this._fps, label: `${label}_area` },
					),
					angle: programmaticSignal(
						(ctx) => {
							const b = getBox(ctx.frame);
							const tcx = b.originX + b.width / 2;
							const tcy = b.originY + b.height / 2;
							let bestAngle = 0;
							let bestDist = Infinity;
							for (const d of self.getObbResult(ctx.frame).detections) {
								const cx = d.boundingBox.originX + d.boundingBox.width / 2;
								const cy = d.boundingBox.originY + d.boundingBox.height / 2;
								const dist = (cx - tcx) * (cx - tcx) + (cy - tcy) * (cy - tcy);
								if (dist < bestDist) {
									bestDist = dist;
									bestAngle = d.boundingBox.angle;
								}
							}
							return bestAngle;
						},
						{ fps: this._fps, label: `${label}_angle` },
					),
				},
				anchors: {
					topLeft: anchor(
						"topLeft",
						(b) => b.originX,
						(b) => b.originY,
					),
					topCenter: anchor(
						"topCenter",
						(b) => b.originX + b.width / 2,
						(b) => b.originY,
					),
					topRight: anchor(
						"topRight",
						(b) => b.originX + b.width,
						(b) => b.originY,
					),
					centerLeft: anchor(
						"centerLeft",
						(b) => b.originX,
						(b) => b.originY + b.height / 2,
					),
					center,
					centerRight: anchor(
						"centerRight",
						(b) => b.originX + b.width,
						(b) => b.originY + b.height / 2,
					),
					bottomLeft: anchor(
						"bottomLeft",
						(b) => b.originX,
						(b) => b.originY + b.height,
					),
					bottomCenter: anchor(
						"bottomCenter",
						(b) => b.originX + b.width / 2,
						(b) => b.originY + b.height,
					),
					bottomRight: anchor(
						"bottomRight",
						(b) => b.originX + b.width,
						(b) => b.originY + b.height,
					),
				},
				kinematics: {
					vx: programmaticSignal((ctx) => resolve(ctx.frame).velocity.vx, {
						fps: this._fps,
						label: `${label}_vx`,
					}),
					vy: programmaticSignal((ctx) => resolve(ctx.frame).velocity.vy, {
						fps: this._fps,
						label: `${label}_vy`,
					}),
					speed,
					acceleration: speed.velocity(1),
					headingRad: programmaticSignal(
						(ctx) => {
							const v = resolve(ctx.frame).velocity;
							return Math.atan2(v.vy, v.vx);
						},
						{ fps: this._fps, label: `${label}_headingRad` },
					),
					headingDeg: programmaticSignal(
						(ctx) => {
							const v = resolve(ctx.frame).velocity;
							return (Math.atan2(v.vy, v.vx) * 180) / Math.PI;
						},
						{ fps: this._fps, label: `${label}_headingDeg` },
					),
				},
				confidence: programmaticSignal((ctx) => resolve(ctx.frame).score, {
					fps: this._fps,
					label: `${label}_score`,
				}),
				active: programmaticSignal(
					(ctx) => (resolve(ctx.frame).active ? 1.0 : 0.0),
					{ fps: this._fps, label: `${label}_active` },
				),
				isCoasting: programmaticSignal(
					(ctx) => (resolve(ctx.frame).isCoasting ? 1.0 : 0.0),
					{ fps: this._fps, label: `${label}_isCoasting` },
				),
				age: programmaticSignal((ctx) => resolve(ctx.frame).age, {
					fps: this._fps,
					label: `${label}_age`,
				}),
				pose,
				center,
				topCenter: (this as unknown as Record<string, unknown>)[
					`__pending`
				] as never,
				bottomCenter: center,
				topLeft: center,
				bottomLeft: center,
			} as ObjectTrackSignals;
		};

		// NOTE: shortcuts are patched below from the anchors map (kept readable)
		const buildTrack = (
			resolve: (frame: number) => TrackedObject,
			label: string,
			fixedCategory?: string,
			fixedId?: number,
		): ObjectTrackSignals => {
			const sig = buildTrackSignals(resolve, label, fixedCategory, fixedId);
			const anchors = sig.anchors;
			Object.assign(sig, {
				topCenter: anchors.topCenter,
				bottomCenter: anchors.bottomCenter,
				topLeft: anchors.topLeft,
				bottomLeft: anchors.bottomLeft,
			});
			return sig;
		};

		const getTrackById = (trackId: number): ObjectTrackSignals => {
			let sig = this._trackCache.get(trackId);
			if (!sig) {
				sig = buildTrack(
					(frame) =>
						this.getObjectResult(frame).objects.find(
							(o) => o.trackId === trackId,
						) ?? neutralTrack(trackId),
					`track_${trackId}`,
					undefined,
					trackId,
				);
				this._trackCache.set(trackId, sig);
			}
			return sig;
		};

		const getTrackByCategory = (
			category: string,
			rank = 0,
		): ObjectTrackSignals => {
			const cacheKey = `${category.toLowerCase()}_${rank}`;
			let sig = this._categoryCache.get(cacheKey);
			if (!sig) {
				sig = buildTrack(
					(frame) => {
						const res = this.getObjectResult(frame);
						const matches = res.objects.filter(
							(o) =>
								o.category.toLowerCase() === category.toLowerCase() && o.active,
						);
						return matches[rank] ?? neutralTrack(0, category);
					},
					`cat_${category}_${rank}`,
					category,
				);
				this._categoryCache.set(cacheKey, sig);
			}
			return sig;
		};

		const primaryTrack = buildTrack((frame) => {
			const res = this.getObjectResult(frame);
			if (res.objects.length === 0) return neutralTrack(0);
			let best = res.objects[0];
			for (let i = 1; i < res.objects.length; i++) {
				if (res.objects[i].score > best.score) best = res.objects[i];
			}
			return best;
		}, "primary_object");

		const activeCategories = (frame: number): string[] => {
			const set = new Set<string>();
			for (const o of this.getObjectResult(frame).objects) {
				if (o.active) set.add(o.category);
			}
			return Array.from(set).sort();
		};

		// ── Class signals (per COCO class, cached stable identity) ────────
		const buildClassSignals = (category: string): ClassSignals => {
			const lower = category.toLowerCase();
			let sig = this._classCache.get(lower);
			if (sig) return sig;
			sig = {
				count: programmaticSignal(
					(ctx) =>
						this.getObjectResult(ctx.frame).objects.filter(
							(o) => o.active && o.category.toLowerCase() === lower,
						).length,
					{ fps: this._fps, label: `class_${lower}_count` },
				),
				maxConfidence: programmaticSignal(
					(ctx) => {
						let max = 0;
						for (const o of this.getObjectResult(ctx.frame).objects) {
							if (
								o.active &&
								o.category.toLowerCase() === lower &&
								o.score > max
							)
								max = o.score;
						}
						return max;
					},
					{ fps: this._fps, label: `class_${lower}_maxConf` },
				),
				present: programmaticSignal(
					(ctx) =>
						this.getObjectResult(ctx.frame).objects.some(
							(o) => o.active && o.category.toLowerCase() === lower,
						)
							? 1.0
							: 0.0,
					{ fps: this._fps, label: `class_${lower}_present` },
				),
				primary: getTrackByCategory(category),
			};
			this._classCache.set(lower, sig);
			return sig;
		};

		this.classes = {
			get: buildClassSignals,
			get names() {
				return activeCategories(frameSignal.value);
			},
			histogram: {
				get: (ctx?: FrameContext) =>
					self.getClassHistogramTensor(ctx?.frame ?? frameSignal.value),
				get value() {
					return self.getClassHistogramTensor(frameSignal.value);
				},
			},
		};

		this.objects = {
			get: getTrackById,
			byCategory: getTrackByCategory,
			primary: primaryTrack,
			count: programmaticSignal(
				(ctx) =>
					this.getObjectResult(ctx.frame).objects.filter((o) => o.active)
						.length,
				{ fps: this._fps, label: "tracked_objects_count" },
			),
			hasCategory: (category: string) => buildClassSignals(category).present,
			getActiveTracks: (frame: number) =>
				this.getObjectResult(frame).objects.filter((o) => o.active),
			get detectedCategories() {
				return activeCategories(frameSignal.value);
			},
		};

		// ── Mask signals ──────────────────────────────────────────────────
		const maskForTrack = (
			frame: number,
			trackId: number,
		): YoloInstanceMask | undefined =>
			this.getMaskResult(frame).find((m) => m.trackId === trackId);

		const largestMask = (frame: number): YoloInstanceMask | undefined => {
			const masks = this.getMaskResult(frame);
			if (masks.length === 0) return undefined;
			let best = masks[0];
			for (const m of masks) {
				const bestIsPerson = best.category.toLowerCase() === "person";
				const mIsPerson = m.category.toLowerCase() === "person";
				if (mIsPerson && !bestIsPerson) {
					best = m;
					continue;
				}
				if (mIsPerson === bestIsPerson && m.area > best.area) {
					best = m;
				}
			}
			return best;
		};

		const buildMaskTrackSignals = (
			resolve: (frame: number) => YoloInstanceMask | undefined,
			label: string,
		): MaskTrackSignals => {
			const boxFor = (frame: number) => {
				const mask = resolve(frame);
				if (!mask || mask.trackId === undefined) return undefined;
				return this.getObjectResult(frame).objects.find(
					(o) => o.trackId === mask.trackId,
				);
			};
			return {
				get trackId() {
					return resolve(frameSignal.value)?.trackId ?? 0;
				},
				get category() {
					return resolve(frameSignal.value)?.category ?? "unknown";
				},
				area: programmaticSignal((ctx) => resolve(ctx.frame)?.area ?? 0, {
					fps: this._fps,
					label: `${label}_area`,
				}),
				coverage: programmaticSignal(
					(ctx) => resolve(ctx.frame)?.coverage ?? 0,
					{
						fps: this._fps,
						label: `${label}_coverage`,
					},
				),
				solidity: programmaticSignal(
					(ctx) => {
						const mask = resolve(ctx.frame);
						const box = boxFor(ctx.frame);
						if (!mask || !box) return 0;
						const bboxArea = box.boundingBox.width * box.boundingBox.height;
						return bboxArea > 0 ? mask.area / bboxArea : 0;
					},
					{ fps: this._fps, label: `${label}_solidity` },
				),
				bboxFill: programmaticSignal(
					(ctx) => {
						const mask = resolve(ctx.frame);
						if (!mask || mask.width * mask.height === 0) return 0;
						const box = boxFor(ctx.frame);
						if (!box) return 0;
						return (
							(box.boundingBox.width * box.boundingBox.height) /
							(mask.width * mask.height)
						);
					},
					{ fps: this._fps, label: `${label}_bboxFill` },
				),
			};
		};

		this.masks = {
			get: (trackId: number) => {
				let sig = this._maskTrackCache.get(trackId);
				if (!sig) {
					sig = buildMaskTrackSignals(
						(frame) => maskForTrack(frame, trackId),
						`mask_${trackId}`,
					);
					this._maskTrackCache.set(trackId, sig);
				}
				return sig;
			},
			subject: buildMaskTrackSignals(largestMask, "subject"),
			count: programmaticSignal(
				(ctx) =>
					new Set(this.getMaskResult(ctx.frame).map((m) => m.trackId ?? -1))
						.size,
				{ fps: this._fps, label: "mask_count" },
			),
		};

		this.segmentation = {
			humanSilhouette: this.masks.subject,
			subject: this.masks.subject,
			instanceMasks: this.masks,
			get stencilTexture() {
				return self._stencilTexture;
			},
		};

		// ── Classification signals ────────────────────────────────────────
		this.classification = {
			top1: programmaticSignal(
				(ctx) => self.getClassifyResult(ctx.frame).top1,
				{
					fps: this._fps,
					label: "classify_top1",
				},
			),
			top1Confidence: programmaticSignal(
				(ctx) => self.getClassifyResult(ctx.frame).top1Score,
				{
					fps: this._fps,
					label: "classify_top1_conf",
				},
			),
			get top5() {
				return self.getClassifyResult(frameSignal.value).top5;
			},
			top5At: (frame: number) => self.getClassifyResult(frame).top5,
		};

		// ── Tensor views ──────────────────────────────────────────────────
		this.poseLandmarksTensor = {
			get: (ctx?: FrameContext) =>
				self.getPoseLandmarksTensor(ctx?.frame ?? frameSignal.value),
			get value() {
				return self.getPoseLandmarksTensor(frameSignal.value);
			},
		};
		this.objectsTensor = {
			get: (ctx?: FrameContext) =>
				self.getObjectsTensor(ctx?.frame ?? frameSignal.value),
			get value() {
				return self.getObjectsTensor(frameSignal.value);
			},
		};
		this.masksTensor = {
			get: (ctx?: FrameContext) =>
				self.getMasksTensor(ctx?.frame ?? frameSignal.value),
			get value() {
				return self.getMasksTensor(frameSignal.value);
			},
		};
		this.histogramTensor = {
			get: (ctx?: FrameContext) =>
				self.getClassHistogramTensor(ctx?.frame ?? frameSignal.value),
			get value() {
				return self.getClassHistogramTensor(frameSignal.value);
			},
		};
	}

	public setStencilTexture(texture: GPUTexture): void {
		this._stencilTexture = texture;
	}

	public get stencilTexture(): GPUTexture | undefined {
		return this._stencilTexture;
	}

	// ── Per-frame result caches (async writes → sync signal reads) ───────

	/**
	 * Reads the most recent result at or before `frame`. Vision results are written one
	 * frame behind the plate (the node renderer reads back the previous frame to infer),
	 * and pinned-signal layout runs before the current frame's inference, so a strict
	 * per-frame lookup would always miss. Walking back a few frames keeps signals live at
	 * a stable one-frame lag instead of snapping to neutral defaults.
	 */
	private latestAtOrBefore<T>(
		cache: Map<number, T>,
		frame: number,
		maxBack = 8,
	): T | undefined {
		const start = this.clamp(frame);
		const floor = Math.max(0, start - maxBack);
		for (let f = start; f >= floor; f--) {
			const value = cache.get(f);
			if (value !== undefined) return value;
		}
		return undefined;
	}

	public invalidateSignals(): void {
		for (const sig of this._registeredSignals) {
			sig.invalidate();
		}
	}

	public setPoseResult(frame: number, result: YoloPoseResult): void {
		this._poseCache.set(this.clamp(frame), result);
		this.invalidateSignals();
	}

	public getPoseResult(frame: number): YoloPoseResult {
		return (
			this.latestAtOrBefore(this._poseCache, frame) ?? createNeutralPoseResult()
		);
	}

	public setObjectResult(
		frame: number,
		result:
			| {
					objects: readonly TrackedObject[];
					rawDetections?: readonly DetectedObject[];
			  }
			| readonly TrackedObject[],
	): void {
		// `in`-narrowing instead of Array.isArray: the guard can't discriminate
		// readonly tuple-ish arrays, which keeps the union open.
		const normalized =
			"objects" in result ? result : { objects: result, rawDetections: [] };
		this._objectCache.set(this.clamp(frame), {
			objects: normalized.objects,
			rawDetections: normalized.rawDetections ?? [],
		});
		this.invalidateSignals();
	}

	public getObjectResult(frame: number): {
		objects: readonly TrackedObject[];
		rawDetections: readonly DetectedObject[];
	} {
		return (
			this.latestAtOrBefore(this._objectCache, frame) ??
			createNeutralObjectResult()
		);
	}

	public setMaskResult(
		frame: number,
		masks: readonly YoloInstanceMask[],
	): void {
		this._maskCache.set(this.clamp(frame), masks);
		this.invalidateSignals();
	}

	public getMaskResult(frame: number): readonly YoloInstanceMask[] {
		return this.latestAtOrBefore(this._maskCache, frame) ?? [];
	}

	public setClassifyResult(frame: number, result: YoloClassifyResult): void {
		this._classifyCache.set(this.clamp(frame), result);
		this.invalidateSignals();
	}

	public getClassifyResult(frame: number): YoloClassifyResult {
		return (
			this.latestAtOrBefore(this._classifyCache, frame) ?? {
				top1: 0,
				top1Score: 0,
				top5: [],
			}
		);
	}

	public setObbResult(frame: number, result: YoloOBBResult): void {
		this._obbCache.set(this.clamp(frame), result);
		this.invalidateSignals();
	}

	public getObbResult(frame: number): YoloOBBResult {
		return this.latestAtOrBefore(this._obbCache, frame) ?? { detections: [] };
	}

	// ── Agent DX snapshot ─────────────────────────────────────────────────

	/**
	 * Serializable snapshot of one frame's object / class / mask signals (specs/yolov4plan.ts
	 * §Phase A). Synchronous — reads only the per-frame caches, never triggers inference.
	 */
	public summary(frame: number = frameSignal.value): YoloSummary {
		const f = this.clamp(frame);
		const res = this.getObjectResult(f);

		const objects = res.objects.map((o) => ({
			trackId: o.trackId,
			category: o.category,
			score: o.score,
			center: [o.centerX, o.centerY] as [number, number],
			speed: o.speed,
			active: o.active,
		}));

		const classSet = new Set<string>();
		for (const o of res.objects) {
			if (o.active) classSet.add(o.category);
		}

		const masks: Record<string, number> = {};
		for (const m of this.getMaskResult(f)) {
			masks[m.category] = (masks[m.category] ?? 0) + 1;
		}

		return { frame: f, objects, classes: Array.from(classSet).sort(), masks };
	}

	// ── Tensor builders ───────────────────────────────────────────────────

	/** Primary person's 17 keypoints as a [17, 3] float32 tensor. */
	public getPoseLandmarksTensor(frame: number): TensorData {
		const person = this.getPoseResult(frame).people[0];
		const kpts = person?.keypoints ?? [];
		const data = new Float32Array(17 * 3);
		for (let i = 0; i < 17; i++) {
			data[i * 3] = kpts[i]?.x ?? 0.5;
			data[i * 3 + 1] = kpts[i]?.y ?? 0.5;
			data[i * 3 + 2] = kpts[i]?.visibility ?? 0;
		}
		return { data, shape: [17, 3], dtype: "float32" };
	}

	/** Up to 16 active tracks as [16, 8]: [active, categoryHash, x, y, w, h, vx, vy]. */
	public getObjectsTensor(frame: number, maxObjects = 16): TensorData {
		const res = this.getObjectResult(frame);
		const data = new Float32Array(maxObjects * 8);
		const count = Math.min(maxObjects, res.objects.length);
		for (let i = 0; i < count; i++) {
			const obj = res.objects[i];
			const off = i * 8;
			let catHash = 0;
			for (let c = 0; c < obj.category.length; c++) {
				catHash = (catHash * 31 + obj.category.charCodeAt(c)) & 0xffff;
			}
			data[off] = obj.active ? 1.0 : 0.0;
			data[off + 1] = catHash;
			data[off + 2] = obj.centerX;
			data[off + 3] = obj.centerY;
			data[off + 4] = obj.boundingBox.width;
			data[off + 5] = obj.boundingBox.height;
			data[off + 6] = obj.velocity.vx;
			data[off + 7] = obj.velocity.vy;
		}
		return { data, shape: [maxObjects, 8], dtype: "float32" };
	}

	/** Per-mask coverage + solidity as [16, 2]. */
	public getMasksTensor(frame: number, maxMasks = 16): TensorData {
		const masks = this.getMaskResult(frame);
		const data = new Float32Array(maxMasks * 2);
		const count = Math.min(maxMasks, masks.length);
		for (let i = 0; i < count; i++) {
			const m = masks[i];
			data[i * 2] = m.coverage;
			const box = this.getObjectResult(frame).objects.find(
				(o) => o.trackId === m.trackId,
			);
			const bboxArea = box ? box.boundingBox.width * box.boundingBox.height : 0;
			data[i * 2 + 1] = bboxArea > 0 ? m.area / bboxArea : 0;
		}
		return { data, shape: [maxMasks, 2], dtype: "float32" };
	}

	/** Per-class detection histogram for the frame as [nc] float32 (COCO 80 by default). */
	public getClassHistogramTensor(frame: number, nc = 80): TensorData {
		const data = new Float32Array(nc);
		for (const o of this.getObjectResult(frame).objects) {
			if (o.active) {
				const idx = YOLO_CLASS_INDEX_BY_NAME.get(o.category.toLowerCase());
				if (idx !== undefined) data[idx] += 1;
			}
		}
		return { data, shape: [nc], dtype: "float32" };
	}

	private clamp(frame: number): number {
		return Math.max(0, Math.min(this._totalFrames - 1, Math.round(frame)));
	}
}

export function createYoloVisionBundle(
	options?: YoloVisionBundleOptions,
): YoloVisionBundle {
	return new YoloVisionBundle(options);
}

// ── Module-local constants ──────────────────────────────────────────────────

const POSE_KEYPOINT_NAMES = [
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

const YOLO_CLASS_INDEX_BY_NAME = new Map<string, number>(
	[
		"person",
		"bicycle",
		"car",
		"motorcycle",
		"airplane",
		"bus",
		"train",
		"truck",
		"boat",
		"traffic light",
		"fire hydrant",
		"stop sign",
		"parking meter",
		"bench",
		"bird",
		"cat",
		"dog",
		"horse",
		"sheep",
		"cow",
		"elephant",
		"bear",
		"zebra",
		"giraffe",
		"backpack",
		"umbrella",
		"handbag",
		"tie",
		"suitcase",
		"frisbee",
		"skis",
		"snowboard",
		"sports ball",
		"kite",
		"baseball bat",
		"baseball glove",
		"skateboard",
		"surfboard",
		"tennis racket",
		"bottle",
		"wine glass",
		"cup",
		"fork",
		"knife",
		"spoon",
		"bowl",
		"banana",
		"apple",
		"sandwich",
		"orange",
		"broccoli",
		"carrot",
		"hot dog",
		"pizza",
		"donut",
		"cake",
		"chair",
		"couch",
		"potted plant",
		"bed",
		"dining table",
		"toilet",
		"tv",
		"laptop",
		"mouse",
		"remote",
		"keyboard",
		"cell phone",
		"microwave",
		"oven",
		"toaster",
		"sink",
		"refrigerator",
		"book",
		"clock",
		"vase",
		"scissors",
		"teddy bear",
		"hair drier",
		"toothbrush",
	].map((name, index) => [name, index]),
);
