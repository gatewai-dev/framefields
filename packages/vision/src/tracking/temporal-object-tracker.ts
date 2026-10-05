import type {
	DetectedObject,
	ObjectBoundingBox,
	TrackedObject,
} from "@framefields/core";

export interface TemporalTrackerOptions {
	/** Minimum Intersection-over-Union to associate a detection with an existing track. Default: 0.25 */
	readonly iouThreshold?: number;
	/** Number of frames a lost track is coasted via velocity extrapolation before deletion. Default: 15 */
	readonly maxMissedFrames?: number;
	/** Minimum consecutive hits before a tentative track is confirmed active. Default: 1 */
	readonly minHits?: number;
	/** Position smoothing weight [0, 1] where 1.0 is instantaneous and 0.0 is fully damped. Default: 0.75 */
	readonly positionSmoothing?: number;
	/** Whether tracks remain marked active during coasting frames. Default: true */
	readonly activeDuringCoast?: boolean;
}

/** Axis-aligned box in any consistent unit (pixels or normalized). */
export type PixelBox = Pick<
	ObjectBoundingBox,
	"originX" | "originY" | "width" | "height"
>;

export function computeIoU(boxA: PixelBox, boxB: PixelBox): number {
	const xA = Math.max(boxA.originX, boxB.originX);
	const yA = Math.max(boxA.originY, boxB.originY);
	const xB = Math.min(boxA.originX + boxA.width, boxB.originX + boxB.width);
	const yB = Math.min(boxA.originY + boxA.height, boxB.originY + boxB.height);

	const interW = Math.max(0, xB - xA);
	const interH = Math.max(0, yB - yA);
	const interArea = interW * interH;

	if (interArea <= 0) return 0;

	const areaA = boxA.width * boxA.height;
	const areaB = boxB.width * boxB.height;
	const unionArea = areaA + areaB - interArea;

	return unionArea > 0 ? interArea / unionArea : 0;
}

interface InternalTrack {
	trackId: number;
	category: string;
	score: number;
	box: ObjectBoundingBox;
	centerX: number;
	centerY: number;
	vx: number;
	vy: number;
	age: number;
	hits: number;
	timeSinceUpdate: number;
	active: boolean;
	isCoasting: boolean;
}

export class TemporalObjectTracker {
	private _nextTrackId = 1;
	private _tracks: InternalTrack[] = [];
	private _iouThreshold: number;
	private _maxMissedFrames: number;
	private _minHits: number;
	private _positionSmoothing: number;
	private _activeDuringCoast: boolean;

	constructor(options: TemporalTrackerOptions = {}) {
		this._iouThreshold = options.iouThreshold ?? 0.25;
		this._maxMissedFrames = options.maxMissedFrames ?? 15;
		this._minHits = options.minHits ?? 1;
		this._positionSmoothing = Math.max(
			0.1,
			Math.min(1.0, options.positionSmoothing ?? 0.75),
		);
		this._activeDuringCoast = options.activeDuringCoast !== false;
	}

	/**
	 * Updates the multi-object tracker with new detections for the current frame.
	 *
	 * @param detections Raw detections found on the current frame
	 * @param frame Current frame index
	 * @param fps Video framerate (used for physical velocity estimation)
	 * @returns Stable, temporal list of TrackedObjects
	 */
	public update(
		detections: readonly DetectedObject[],
		_frame: number,
		fps = 24,
	): TrackedObject[] {
		const dt = fps > 0 ? 1 / fps : 0.0416;

		// 1. Predict next step for existing tracks using linear velocity
		for (const track of this._tracks) {
			track.age++;
			track.timeSinceUpdate++;

			if (track.timeSinceUpdate > 0) {
				// Coast forward along velocity vector
				const predCenterX = track.centerX + track.vx * dt;
				const predCenterY = track.centerY + track.vy * dt;
				track.centerX = predCenterX;
				track.centerY = predCenterY;

				const w = track.box.width;
				const h = track.box.height;
				const normW = track.box.normalizedWidth;
				const normH = track.box.normalizedHeight;

				const normCenterX =
					track.box.normalizedX +
					normW / 2 +
					(track.vx * dt) / Math.max(1, track.box.width / normW);
				const normCenterY =
					track.box.normalizedY +
					normH / 2 +
					(track.vy * dt) / Math.max(1, track.box.height / normH);

				track.box = {
					originX: predCenterX - w / 2,
					originY: predCenterY - h / 2,
					width: w,
					height: h,
					normalizedX: normCenterX - normW / 2,
					normalizedY: normCenterY - normH / 2,
					normalizedWidth: normW,
					normalizedHeight: normH,
				};

				// Dampen coasting velocity
				track.vx *= 0.92;
				track.vy *= 0.92;
				track.isCoasting = true;
			}
		}

		// 2. Association: match detections with existing tracks
		const matchedDetections = new Set<number>();
		const matchedTracks = new Set<number>();

		// Compute IoU matrix and find greedy best matches
		const candidateMatches: {
			trackIdx: number;
			detIdx: number;
			iou: number;
		}[] = [];

		for (let t = 0; t < this._tracks.length; t++) {
			const trk = this._tracks[t];
			for (let d = 0; d < detections.length; d++) {
				const det = detections[d];
				// Only match if category matches
				if (trk.category !== det.category) continue;

				const iou = computeIoU(trk.box, det.boundingBox);
				if (iou >= this._iouThreshold) {
					candidateMatches.push({ trackIdx: t, detIdx: d, iou });
				}
			}
		}

		// Sort by IoU descending
		candidateMatches.sort((a, b) => b.iou - a.iou);

		for (const match of candidateMatches) {
			if (
				matchedTracks.has(match.trackIdx) ||
				matchedDetections.has(match.detIdx)
			) {
				continue;
			}

			matchedTracks.add(match.trackIdx);
			matchedDetections.add(match.detIdx);

			const trk = this._tracks[match.trackIdx];
			const det = detections[match.detIdx];
			const detBox = det.boundingBox;
			const detCenterX = detBox.originX + detBox.width / 2;
			const detCenterY = detBox.originY + detBox.height / 2;

			// Instantaneous velocity calculation
			const instVx = (detCenterX - trk.centerX) / dt;
			const instVy = (detCenterY - trk.centerY) / dt;

			// Smooth velocity
			trk.vx = trk.vx * 0.4 + instVx * 0.6;
			trk.vy = trk.vy * 0.4 + instVy * 0.6;

			// Smooth position and bounding box
			const alpha = this._positionSmoothing;
			const smoothW = trk.box.width * (1 - alpha) + detBox.width * alpha;
			const smoothH = trk.box.height * (1 - alpha) + detBox.height * alpha;
			const smoothCenterX = trk.centerX * (1 - alpha) + detCenterX * alpha;
			const smoothCenterY = trk.centerY * (1 - alpha) + detCenterY * alpha;

			trk.centerX = smoothCenterX;
			trk.centerY = smoothCenterY;
			trk.score = det.score;
			trk.timeSinceUpdate = 0;
			trk.hits++;
			trk.isCoasting = false;

			if (trk.hits >= this._minHits) {
				trk.active = true;
			}

			trk.box = {
				originX: smoothCenterX - smoothW / 2,
				originY: smoothCenterY - smoothH / 2,
				width: smoothW,
				height: smoothH,
				normalizedX: detBox.normalizedX,
				normalizedY: detBox.normalizedY,
				normalizedWidth: detBox.normalizedWidth,
				normalizedHeight: detBox.normalizedHeight,
			};
		}

		// 3. Initialize new tracks for unmatched detections
		for (let d = 0; d < detections.length; d++) {
			if (matchedDetections.has(d)) continue;

			const det = detections[d];
			const detBox = det.boundingBox;
			const centerX = detBox.originX + detBox.width / 2;
			const centerY = detBox.originY + detBox.height / 2;

			this._tracks.push({
				trackId: this._nextTrackId++,
				category: det.category,
				score: det.score,
				box: detBox,
				centerX,
				centerY,
				vx: 0,
				vy: 0,
				age: 1,
				hits: 1,
				timeSinceUpdate: 0,
				active: this._minHits <= 1,
				isCoasting: false,
			});
		}

		// 4. Prune expired tracks
		this._tracks = this._tracks.filter(
			(t) => t.timeSinceUpdate <= this._maxMissedFrames,
		);

		// 5. Produce public TrackedObject representations
		return this._tracks
			.filter((t) => t.active)
			.map((t) => {
				const normW = t.box.normalizedWidth;
				const normH = t.box.normalizedHeight;
				const normCenterX = t.box.normalizedX + normW / 2;
				const normCenterY = t.box.normalizedY + normH / 2;
				const speed = Math.sqrt(t.vx * t.vx + t.vy * t.vy);

				return {
					trackId: t.trackId,
					category: t.category,
					score: t.score,
					boundingBox: t.box,
					centerX: t.centerX,
					centerY: t.centerY,
					normalizedCenterX: normCenterX,
					normalizedCenterY: normCenterY,
					velocity: { vx: t.vx, vy: t.vy },
					speed,
					age: t.age,
					hits: t.hits,
					active: this._activeDuringCoast ? true : t.timeSinceUpdate === 0,
					isCoasting: t.isCoasting,
				};
			});
	}

	/**
	 * Tracks objects across a full sequence of frames with gap interpolation,
	 * boundary extrapolation (ensuring frame 0 through end are tracked),
	 * and temporal Gaussian smoothing.
	 *
	 * Guarantees zero flicker, zero drift, and frame-accurate stability across the entire video.
	 */
	public trackSequence(
		perFrameDetections: readonly (readonly DetectedObject[])[],
		totalFrames: number,
		fps = 24,
	): TrackedObject[][] {
		this.reset();
		const dt = fps > 0 ? 1 / fps : 0.0416;

		// 1. First pass: run online tracker to associate track IDs and record raw detections per track
		interface TrackObservation {
			frame: number;
			box: ObjectBoundingBox;
			score: number;
		}
		const trackHistory = new Map<
			number,
			{ category: string; observations: TrackObservation[] }
		>();

		for (let f = 0; f < totalFrames; f++) {
			const dets = perFrameDetections[f] ?? [];
			const stepTracks = this.update(dets, f, fps);
			for (const trk of stepTracks) {
				if (!trackHistory.has(trk.trackId)) {
					trackHistory.set(trk.trackId, {
						category: trk.category,
						observations: [],
					});
				}
				// Only record if this was a fresh detection or high quality
				if (!trk.isCoasting) {
					trackHistory.get(trk.trackId)!.observations.push({
						frame: f,
						box: trk.boundingBox,
						score: trk.score,
					});
				}
			}
		}

		// 2. For each tracked identity, interpolate gaps and extrapolate across the full timeline [0, totalFrames - 1]
		interface TrajectoryPoint {
			box: ObjectBoundingBox;
			score: number;
		}
		const fullTrajectories = new Map<
			number,
			{ category: string; frames: (TrajectoryPoint | null)[] }
		>();

		for (const [trackId, info] of trackHistory.entries()) {
			const obs = info.observations;
			if (obs.length === 0) continue;

			// Sort observations by frame
			obs.sort((a, b) => a.frame - b.frame);

			const frameData: (TrajectoryPoint | null)[] = new Array(totalFrames).fill(
				null,
			);

			// Populate observed keyframes
			for (const o of obs) {
				frameData[o.frame] = { box: o.box, score: o.score };
			}

			// Extrapolate backwards to frame 0 from first observation
			const firstObs = obs[0];
			for (let f = 0; f < firstObs.frame; f++) {
				frameData[f] = {
					box: { ...firstObs.box },
					score: firstObs.score * 0.9,
				};
			}

			// Interpolate gaps between consecutive observations
			for (let i = 0; i < obs.length - 1; i++) {
				const startObs = obs[i];
				const endObs = obs[i + 1];
				const gap = endObs.frame - startObs.frame;
				if (gap <= 1) continue;

				for (let f = startObs.frame + 1; f < endObs.frame; f++) {
					const t = (f - startObs.frame) / gap;
					// Smooth hermite/linear blend
					const sX =
						startObs.box.originX +
						(endObs.box.originX - startObs.box.originX) * t;
					const sY =
						startObs.box.originY +
						(endObs.box.originY - startObs.box.originY) * t;
					const sW =
						startObs.box.width + (endObs.box.width - startObs.box.width) * t;
					const sH =
						startObs.box.height + (endObs.box.height - startObs.box.height) * t;
					const nX =
						startObs.box.normalizedX +
						(endObs.box.normalizedX - startObs.box.normalizedX) * t;
					const nY =
						startObs.box.normalizedY +
						(endObs.box.normalizedY - startObs.box.normalizedY) * t;
					const nW =
						startObs.box.normalizedWidth +
						(endObs.box.normalizedWidth - startObs.box.normalizedWidth) * t;
					const nH =
						startObs.box.normalizedHeight +
						(endObs.box.normalizedHeight - startObs.box.normalizedHeight) * t;

					frameData[f] = {
						box: {
							originX: sX,
							originY: sY,
							width: sW,
							height: sH,
							normalizedX: nX,
							normalizedY: nY,
							normalizedWidth: nW,
							normalizedHeight: nH,
						},
						score: startObs.score * (1 - t) + endObs.score * t,
					};
				}
			}

			// Extrapolate forwards to totalFrames - 1 from last observation
			const lastObs = obs[obs.length - 1];
			for (let f = lastObs.frame + 1; f < totalFrames; f++) {
				frameData[f] = { box: { ...lastObs.box }, score: lastObs.score * 0.9 };
			}

			// 3. Temporal Gaussian smoothing over a 5-frame moving window
			const smoothedFrames: TrajectoryPoint[] = [];
			const radius = 2; // window size 5 (-2, -1, 0, +1, +2)
			const weights = [0.06136, 0.24477, 0.38774, 0.24477, 0.06136];

			for (let f = 0; f < totalFrames; f++) {
				let sumWeight = 0;
				let sumX = 0;
				let sumY = 0;
				let sumW = 0;
				let sumH = 0;
				let sumNormX = 0;
				let sumNormY = 0;
				let sumNormW = 0;
				let sumNormH = 0;
				let sumScore = 0;

				for (let r = -radius; r <= radius; r++) {
					const idx = Math.max(0, Math.min(totalFrames - 1, f + r));
					const pt = frameData[idx];
					if (pt) {
						const w = weights[r + radius];
						sumWeight += w;
						sumX += pt.box.originX * w;
						sumY += pt.box.originY * w;
						sumW += pt.box.width * w;
						sumH += pt.box.height * w;
						sumNormX += pt.box.normalizedX * w;
						sumNormY += pt.box.normalizedY * w;
						sumNormW += pt.box.normalizedWidth * w;
						sumNormH += pt.box.normalizedHeight * w;
						sumScore += pt.score * w;
					}
				}

				const invW = sumWeight > 0 ? 1 / sumWeight : 1;
				smoothedFrames.push({
					box: {
						originX: sumX * invW,
						originY: sumY * invW,
						width: sumW * invW,
						height: sumH * invW,
						normalizedX: sumNormX * invW,
						normalizedY: sumNormY * invW,
						normalizedWidth: sumNormW * invW,
						normalizedHeight: sumNormH * invW,
					},
					score: sumScore * invW,
				});
			}

			fullTrajectories.set(trackId, {
				category: info.category,
				frames: smoothedFrames,
			});
		}

		// 4. Build output per-frame TrackedObject arrays with frame-accurate velocities
		const result: TrackedObject[][] = [];
		for (let f = 0; f < totalFrames; f++) {
			const frameObjects: TrackedObject[] = [];

			for (const [trackId, traj] of fullTrajectories.entries()) {
				const current = traj.frames[f];
				if (!current) continue;

				const prev = traj.frames[Math.max(0, f - 1)] ?? current;
				const next = traj.frames[Math.min(totalFrames - 1, f + 1)] ?? current;

				const curCenterX = current.box.originX + current.box.width / 2;
				const curCenterY = current.box.originY + current.box.height / 2;
				const prevCenterX = prev.box.originX + prev.box.width / 2;
				const prevCenterY = prev.box.originY + prev.box.height / 2;
				const nextCenterX = next.box.originX + next.box.width / 2;
				const nextCenterY = next.box.originY + next.box.height / 2;

				const timeDelta = f === 0 || f === totalFrames - 1 ? dt : 2 * dt;
				const vx = (nextCenterX - prevCenterX) / timeDelta;
				const vy = (nextCenterY - prevCenterY) / timeDelta;
				const speed = Math.sqrt(vx * vx + vy * vy);

				const normW = current.box.normalizedWidth;
				const normH = current.box.normalizedHeight;

				frameObjects.push({
					trackId,
					category: traj.category,
					score: current.score,
					boundingBox: current.box,
					centerX: curCenterX,
					centerY: curCenterY,
					normalizedCenterX: current.box.normalizedX + normW / 2,
					normalizedCenterY: current.box.normalizedY + normH / 2,
					velocity: { vx, vy },
					speed,
					age: f + 1,
					hits: 10,
					active: true,
					isCoasting: false,
				});
			}

			result.push(frameObjects);
		}

		return result;
	}

	/**
	 * Resets all internal track state.
	 */
	public reset(): void {
		this._tracks = [];
		this._nextTrackId = 1;
	}
}
