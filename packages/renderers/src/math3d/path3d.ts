/**
 * 3D Path Mathematical Curves, Arc-Length Lookup Tables, and Rotation-Minimizing Frames (RMF).
 * Provides uniform-velocity parameterization and smooth tangent/normal kinematics along 3D curves.
 */

import { type Vec3, Vector3Math } from "./vector3.js";

export interface Path3DPoint {
	/** Position in 3D world space [x, y, z] */
	position: Vec3;
	/** Normalized unit tangent forward vector */
	tangent: Vec3;
	/** Normalized unit normal vector (orthogonal to tangent) */
	normal: Vec3;
	/** Normalized unit binormal vector: cross(tangent, normal) */
	binormal: Vec3;
	/** Cumulative arc length distance in pixels from path origin */
	distance: number;
	/** Normalized progress along path in [0, 1] */
	t: number;
	/** Euler orientation angles in degrees [pitch, yaw, roll] */
	rotation: Vec3;
}

export interface Path3DSample {
	position: Vec3;
	tangent: Vec3;
	distance: number;
}

export interface CatmullRomOptions {
	/** Tension factor between 0 (loose) and 1 (tight); defaults to 0.5 (centripetal-like) */
	tension?: number;
	/** Whether path closes in a continuous loop */
	closed?: boolean;
	/** Samples per segment for arc-length integration (default 40) */
	samplesPerSegment?: number;
}

export interface BezierSegment3D {
	p0: Vec3;
	p1: Vec3;
	p2: Vec3;
	p3: Vec3;
}

export interface HelixOptions {
	center: Vec3;
	radius: number;
	pitch: number;
	turns: number;
	axis?: "x" | "y" | "z";
	samplesPerTurn?: number;
}

export interface CirclePathOptions {
	center: Vec3;
	radius: number;
	normal?: Vec3;
	startAngleDeg?: number;
	endAngleDeg?: number;
	samples?: number;
}

export class Path3D {
	private samples: Path3DSample[] = [];
	private frames: Array<{ normal: Vec3; binormal: Vec3; rotation: Vec3 }> = [];
	public totalLength = 0;

	constructor(samples: Path3DSample[]) {
		if (samples.length < 2) {
			throw new Error("Path3D requires at least 2 coordinate samples");
		}
		this.samples = samples;
		this.totalLength = samples[samples.length - 1].distance;
		this.computeRotationMinimizingFrames();
	}

	/**
	 * Computes continuous Rotation-Minimizing Frames (RMF) along the path
	 * using the Double Reflection Method (Wang et al. 2008), preventing gimbal flips.
	 */
	private computeRotationMinimizingFrames(): void {
		const count = this.samples.length;
		this.frames = new Array(count);

		// Initial normal: pick arbitrary vector perpendicular to initial tangent T0
		const t0 = this.samples[0].tangent;
		let upRef: Vec3 = [0, -1, 0];
		if (Math.abs(Vector3Math.dot(t0, upRef)) > 0.95) {
			upRef = [0, 0, 1];
		}
		let n0 = Vector3Math.normalize(
			Vector3Math.subtract(
				upRef,
				Vector3Math.multiplyScalar(t0, Vector3Math.dot(upRef, t0)),
			),
		);
		if (Vector3Math.lengthSq(n0) < 1e-4) {
			n0 = [1, 0, 0];
		}
		const b0 = Vector3Math.normalize(Vector3Math.cross(t0, n0));
		this.frames[0] = {
			normal: n0,
			binormal: b0,
			rotation: this.eulerFromFrame(t0, n0, b0),
		};

		// Double reflection across successive tangents
		for (let i = 0; i < count - 1; i++) {
			const x0 = this.samples[i].position;
			const x1 = this.samples[i + 1].position;
			const t_i = this.samples[i].tangent;
			const t_next = this.samples[i + 1].tangent;
			const n_i = this.frames[i].normal;

			const v1 = Vector3Math.subtract(x1, x0);
			const c1 = Vector3Math.dot(v1, v1);

			let n_next: Vec3;
			if (c1 > 1e-8) {
				// Reflection 1
				const t_i_L = Vector3Math.subtract(
					t_i,
					Vector3Math.multiplyScalar(v1, (2 * Vector3Math.dot(v1, t_i)) / c1),
				);
				const n_i_L = Vector3Math.subtract(
					n_i,
					Vector3Math.multiplyScalar(v1, (2 * Vector3Math.dot(v1, n_i)) / c1),
				);

				// Reflection 2
				const v2 = Vector3Math.subtract(t_next, t_i_L);
				const c2 = Vector3Math.dot(v2, v2);
				if (c2 > 1e-8) {
					n_next = Vector3Math.subtract(
						n_i_L,
						Vector3Math.multiplyScalar(
							v2,
							(2 * Vector3Math.dot(v2, n_i_L)) / c2,
						),
					);
				} else {
					n_next = n_i_L;
				}
			} else {
				n_next = n_i;
			}

			n_next = Vector3Math.normalize(
				Vector3Math.subtract(
					n_next,
					Vector3Math.multiplyScalar(t_next, Vector3Math.dot(t_next, n_next)),
				),
			);
			const b_next = Vector3Math.normalize(Vector3Math.cross(t_next, n_next));

			this.frames[i + 1] = {
				normal: n_next,
				binormal: b_next,
				rotation: this.eulerFromFrame(t_next, n_next, b_next),
			};
		}
	}

	/**
	 * Extracts pitch, yaw, roll Euler angles in degrees from the orthonormal frame.
	 */
	private eulerFromFrame(tangent: Vec3, normal: Vec3, binormal: Vec3): Vec3 {
		// Tangent is the forward viewing axis Z_fwd or X_fwd
		const pitch =
			Math.asin(Math.max(-1, Math.min(1, -tangent[1]))) * (180 / Math.PI);
		const yaw = Math.atan2(tangent[0], tangent[2]) * (180 / Math.PI);
		const roll = Math.atan2(normal[0], normal[1]) * (180 / Math.PI);
		return [pitch, yaw, roll];
	}

	/**
	 * Evaluates point, tangent, normal, binormal, and rotation at normalized progress u in [0, 1].
	 * Progression moves with constant velocity along the arc length of the path.
	 */
	public getPointAt(u: number): Path3DPoint {
		const clampedU = Math.max(0, Math.min(1, u));
		const targetDist = clampedU * this.totalLength;
		return this.getPointAtDistance(targetDist);
	}

	/**
	 * Evaluates point along path by absolute arc-length distance in pixels.
	 */
	public getPointAtDistance(distance: number): Path3DPoint {
		const d = Math.max(0, Math.min(this.totalLength, distance));
		const count = this.samples.length;

		// Binary search in cumulative distance LUT
		let low = 0;
		let high = count - 1;
		while (low < high) {
			const mid = (low + high) >> 1;
			if (this.samples[mid].distance < d) {
				low = mid + 1;
			} else {
				high = mid;
			}
		}

		const idx1 = Math.max(1, low);
		const idx0 = idx1 - 1;
		const s0 = this.samples[idx0];
		const s1 = this.samples[idx1];
		const segLen = s1.distance - s0.distance;
		const alpha = segLen > 1e-6 ? (d - s0.distance) / segLen : 0;

		const position = Vector3Math.lerp(s0.position, s1.position, alpha);
		const tangent = Vector3Math.normalize(
			Vector3Math.lerp(s0.tangent, s1.tangent, alpha),
		);

		const f0 = this.frames[idx0];
		const f1 = this.frames[idx1];
		const normal = Vector3Math.normalize(
			Vector3Math.lerp(f0.normal, f1.normal, alpha),
		);
		const binormal = Vector3Math.normalize(Vector3Math.cross(tangent, normal));
		const rotation: Vec3 = [
			f0.rotation[0] + (f1.rotation[0] - f0.rotation[0]) * alpha,
			f0.rotation[1] + (f1.rotation[1] - f0.rotation[1]) * alpha,
			f0.rotation[2] + (f1.rotation[2] - f0.rotation[2]) * alpha,
		];

		return {
			position,
			tangent,
			normal,
			binormal,
			distance: d,
			t: this.totalLength > 0 ? d / this.totalLength : 0,
			rotation,
		};
	}

	// =========================================================================
	// Path Factory Constructors
	// =========================================================================

	/**
	 * Creates a smooth Catmull-Rom spline path interpolating through 3D waypoints.
	 */
	public static catmullRom(
		waypoints: Vec3[],
		options: CatmullRomOptions = {},
	): Path3D {
		if (waypoints.length < 2) {
			throw new Error("Catmull-Rom spline requires at least 2 waypoints");
		}
		const closed = Boolean(options.closed);
		const samplesPerSegment = options.samplesPerSegment ?? 40;

		// Build extended control point array
		const pts: Vec3[] = [];
		if (closed) {
			pts.push(waypoints[waypoints.length - 1]);
			pts.push(...waypoints);
			pts.push(waypoints[0]);
			pts.push(waypoints[1]);
		} else {
			// Extrapolate virtual endpoints for boundary tangents
			const pFirst = waypoints[0];
			const pSecond = waypoints[1];
			const pLast = waypoints[waypoints.length - 1];
			const pPrevLast = waypoints[waypoints.length - 2];
			pts.push(
				Vector3Math.subtract(pFirst, Vector3Math.subtract(pSecond, pFirst)),
			);
			pts.push(...waypoints);
			pts.push(Vector3Math.add(pLast, Vector3Math.subtract(pLast, pPrevLast)));
		}

		const numSegments = closed ? waypoints.length : waypoints.length - 1;
		const rawSamples: Array<{ position: Vec3; tangent: Vec3 }> = [];

		for (let s = 0; s < numSegments; s++) {
			const p0 = pts[s];
			const p1 = pts[s + 1];
			const p2 = pts[s + 2];
			const p3 = pts[s + 3];

			const steps =
				s === numSegments - 1 ? samplesPerSegment : samplesPerSegment - 1;
			for (let step = 0; step <= steps; step++) {
				const t = step / samplesPerSegment;
				const t2 = t * t;
				const t3 = t2 * t;

				// Standard Catmull-Rom polynomial basis
				const a0 = -0.5 * t3 + t2 - 0.5 * t;
				const a1 = 1.5 * t3 - 2.5 * t2 + 1.0;
				const a2 = -1.5 * t3 + 2.0 * t2 + 0.5 * t;
				const a3 = 0.5 * t3 - 0.5 * t2;

				const pos: Vec3 = [
					a0 * p0[0] + a1 * p1[0] + a2 * p2[0] + a3 * p3[0],
					a0 * p0[1] + a1 * p1[1] + a2 * p2[1] + a3 * p3[1],
					a0 * p0[2] + a1 * p1[2] + a2 * p2[2] + a3 * p3[2],
				];

				// Velocity derivative for exact tangent
				const da0 = -1.5 * t2 + 2.0 * t - 0.5;
				const da1 = 4.5 * t2 - 5.0 * t;
				const da2 = -4.5 * t2 + 4.0 * t + 0.5;
				const da3 = 1.5 * t2 - 1.0 * t;

				const tanVel: Vec3 = [
					da0 * p0[0] + da1 * p1[0] + da2 * p2[0] + da3 * p3[0],
					da0 * p0[1] + da1 * p1[1] + da2 * p2[1] + da3 * p3[1],
					da0 * p0[2] + da1 * p1[2] + da2 * p2[2] + da3 * p3[2],
				];
				const tangent = Vector3Math.normalize(tanVel);

				rawSamples.push({ position: pos, tangent });
			}
		}

		// Compute cumulative arc-length distances
		let cumulativeDist = 0;
		const samples: Path3DSample[] = [
			{
				position: rawSamples[0].position,
				tangent: rawSamples[0].tangent,
				distance: 0,
			},
		];

		for (let i = 1; i < rawSamples.length; i++) {
			const d = Vector3Math.distance(
				rawSamples[i].position,
				rawSamples[i - 1].position,
			);
			cumulativeDist += d;
			samples.push({
				position: rawSamples[i].position,
				tangent: rawSamples[i].tangent,
				distance: cumulativeDist,
			});
		}

		return new Path3D(samples);
	}

	/**
	 * Creates a continuous 3D path from a chain of cubic Bezier segments.
	 */
	public static bezier(
		segments: BezierSegment3D[],
		samplesPerSegment = 50,
	): Path3D {
		if (segments.length === 0) {
			throw new Error("Bezier path requires at least 1 segment");
		}
		const rawSamples: Array<{ position: Vec3; tangent: Vec3 }> = [];

		for (let s = 0; s < segments.length; s++) {
			const seg = segments[s];
			const steps =
				s === segments.length - 1 ? samplesPerSegment : samplesPerSegment - 1;

			for (let step = 0; step <= steps; step++) {
				const t = step / samplesPerSegment;
				const u = 1 - t;
				const uu = u * u;
				const uuu = uu * u;
				const tt = t * t;
				const ttt = tt * t;

				const pos: Vec3 = [
					uuu * seg.p0[0] +
						3 * uu * t * seg.p1[0] +
						3 * u * tt * seg.p2[0] +
						ttt * seg.p3[0],
					uuu * seg.p0[1] +
						3 * uu * t * seg.p1[1] +
						3 * u * tt * seg.p2[1] +
						ttt * seg.p3[1],
					uuu * seg.p0[2] +
						3 * uu * t * seg.p1[2] +
						3 * u * tt * seg.p2[2] +
						ttt * seg.p3[2],
				];

				const tanVel: Vec3 = [
					3 * uu * (seg.p1[0] - seg.p0[0]) +
						6 * u * t * (seg.p2[0] - seg.p1[0]) +
						3 * tt * (seg.p3[0] - seg.p2[0]),
					3 * uu * (seg.p1[1] - seg.p0[1]) +
						6 * u * t * (seg.p2[1] - seg.p1[1]) +
						3 * tt * (seg.p3[1] - seg.p2[1]),
					3 * uu * (seg.p1[2] - seg.p0[2]) +
						6 * u * t * (seg.p2[2] - seg.p1[2]) +
						3 * tt * (seg.p3[2] - seg.p2[2]),
				];
				const tangent = Vector3Math.normalize(tanVel);
				rawSamples.push({ position: pos, tangent });
			}
		}

		let cumulativeDist = 0;
		const samples: Path3DSample[] = [
			{
				position: rawSamples[0].position,
				tangent: rawSamples[0].tangent,
				distance: 0,
			},
		];

		for (let i = 1; i < rawSamples.length; i++) {
			cumulativeDist += Vector3Math.distance(
				rawSamples[i].position,
				rawSamples[i - 1].position,
			);
			samples.push({
				position: rawSamples[i].position,
				tangent: rawSamples[i].tangent,
				distance: cumulativeDist,
			});
		}

		return new Path3D(samples);
	}

	/**
	 * Creates a 3D volumetric helix / spiral path.
	 */
	public static helix(options: HelixOptions): Path3D {
		const {
			center,
			radius,
			pitch,
			turns,
			axis = "z",
			samplesPerTurn = 60,
		} = options;
		const totalSamples = Math.max(10, Math.round(turns * samplesPerTurn));
		const rawSamples: Array<{ position: Vec3; tangent: Vec3 }> = [];

		for (let i = 0; i <= totalSamples; i++) {
			const progress = i / totalSamples;
			const theta = progress * turns * Math.PI * 2;
			const axial = (progress - 0.5) * pitch * turns;

			const c = Math.cos(theta);
			const s = Math.sin(theta);

			let pos: Vec3;
			let tanVel: Vec3;

			if (axis === "z") {
				pos = [
					center[0] + radius * c,
					center[1] + radius * s,
					center[2] + axial,
				];
				tanVel = [
					-radius * s,
					radius * c,
					(pitch * turns) / (turns * Math.PI * 2),
				];
			} else if (axis === "y") {
				pos = [
					center[0] + radius * c,
					center[1] + axial,
					center[2] + radius * s,
				];
				tanVel = [
					-radius * s,
					(pitch * turns) / (turns * Math.PI * 2),
					radius * c,
				];
			} else {
				pos = [
					center[0] + axial,
					center[1] + radius * c,
					center[2] + radius * s,
				];
				tanVel = [
					(pitch * turns) / (turns * Math.PI * 2),
					-radius * s,
					radius * c,
				];
			}

			rawSamples.push({
				position: pos,
				tangent: Vector3Math.normalize(tanVel),
			});
		}

		let cumulativeDist = 0;
		const samples: Path3DSample[] = [
			{
				position: rawSamples[0].position,
				tangent: rawSamples[0].tangent,
				distance: 0,
			},
		];

		for (let i = 1; i < rawSamples.length; i++) {
			cumulativeDist += Vector3Math.distance(
				rawSamples[i].position,
				rawSamples[i - 1].position,
			);
			samples.push({
				position: rawSamples[i].position,
				tangent: rawSamples[i].tangent,
				distance: cumulativeDist,
			});
		}

		return new Path3D(samples);
	}

	/**
	 * Creates a 3D circular or arc orbit path.
	 */
	public static circle(options: CirclePathOptions): Path3D {
		const {
			center,
			radius,
			startAngleDeg = 0,
			endAngleDeg = 360,
			samples = 128,
		} = options;
		const startRad = (startAngleDeg * Math.PI) / 180;
		const endRad = (endAngleDeg * Math.PI) / 180;
		const rawSamples: Array<{ position: Vec3; tangent: Vec3 }> = [];

		for (let i = 0; i <= samples; i++) {
			const theta = startRad + (endRad - startRad) * (i / samples);
			const c = Math.cos(theta);
			const s = Math.sin(theta);
			const pos: Vec3 = [
				center[0] + radius * c,
				center[1],
				center[2] + radius * s,
			];
			const tanVel: Vec3 = [-radius * s, 0, radius * c];
			rawSamples.push({
				position: pos,
				tangent: Vector3Math.normalize(tanVel),
			});
		}

		let cumulativeDist = 0;
		const pathSamples: Path3DSample[] = [
			{
				position: rawSamples[0].position,
				tangent: rawSamples[0].tangent,
				distance: 0,
			},
		];

		for (let i = 1; i < rawSamples.length; i++) {
			cumulativeDist += Vector3Math.distance(
				rawSamples[i].position,
				rawSamples[i - 1].position,
			);
			pathSamples.push({
				position: rawSamples[i].position,
				tangent: rawSamples[i].tangent,
				distance: cumulativeDist,
			});
		}

		return new Path3D(pathSamples);
	}
}
