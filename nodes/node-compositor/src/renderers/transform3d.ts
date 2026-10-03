/**
 * Pure 4x4 matrix and perspective projection mathematics for 3D layout containers.
 * Column-major 4x4 representation matching WebGPU standard conventions.
 */

export type Matrix4x4 = [
	number,
	number,
	number,
	number, // col 0
	number,
	number,
	number,
	number, // col 1
	number,
	number,
	number,
	number, // col 2
	number,
	number,
	number,
	number, // col 3
];

export interface Point2D {
	x: number;
	y: number;
}

export interface Point3D {
	x: number;
	y: number;
	z: number;
}

export interface Quad2D {
	topLeft: Point2D;
	topRight: Point2D;
	bottomLeft: Point2D;
	bottomRight: Point2D;
}

export interface Layer3DMatrixConfig {
	x: number;
	y: number;
	width: number;
	height: number;
	rotateXDeg?: number;
	rotateYDeg?: number;
	rotateZDeg?: number;
	scaleX?: number;
	scaleY?: number;
	perspectivePx?: number;
	originXRatio?: number;
	originYRatio?: number;
	translateZPx?: number;
}

export const Transform3DMath = {
	/**
	 * Creates a 4x4 identity matrix.
	 */
	identity(): Matrix4x4 {
		return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	},

	/**
	 * Multiplies two 4x4 matrices: out = A x B.
	 */
	multiply(a: Matrix4x4, b: Matrix4x4): Matrix4x4 {
		const out = new Array(16) as Matrix4x4;
		for (let row = 0; row < 4; row++) {
			for (let col = 0; col < 4; col++) {
				out[col * 4 + row] =
					a[0 * 4 + row] * b[col * 4 + 0] +
					a[1 * 4 + row] * b[col * 4 + 1] +
					a[2 * 4 + row] * b[col * 4 + 2] +
					a[3 * 4 + row] * b[col * 4 + 3];
			}
		}
		return out;
	},

	/**
	 * Translation matrix in 3D.
	 */
	translate(tx: number, ty: number, tz = 0): Matrix4x4 {
		return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, tx, ty, tz, 1];
	},

	/**
	 * Scale matrix in 3D.
	 */
	scale(sx: number, sy: number, sz = 1): Matrix4x4 {
		return [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0, 0, 0, 0, 1];
	},

	/**
	 * Rotation around X axis (pitch) in radians.
	 */
	rotateX(rad: number): Matrix4x4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
	},

	/**
	 * Rotation around Y axis (yaw) in radians.
	 */
	rotateY(rad: number): Matrix4x4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
	},

	/**
	 * Rotation around Z axis (roll) in radians.
	 */
	rotateZ(rad: number): Matrix4x4 {
		const c = Math.cos(rad);
		const s = Math.sin(rad);
		return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	},

	/**
	 * Perspective projection matrix.
	 * If `d <= 0`, returns identity (orthographic projection).
	 * In standard CSS/computer graphics coordinate system:
	 * M[11] = -1 / d (in column-major index 11 is row 3, col 2).
	 */
	perspective(d: number): Matrix4x4 {
		if (d <= 0) return Transform3DMath.identity();
		const m = Transform3DMath.identity();
		m[11] = -1 / d;
		return m;
	},

	/**
	 * Computes the complete 3D composite transform for a layer.
	 *
	 * Order of operations:
	 * 1. Move origin to perspective origin / pivot anchor.
	 * 2. Apply perspective projection matrix P(d).
	 * 3. Apply translation (translateZ).
	 * 4. Apply 3D rotations: RotateZ * RotateY * RotateX (Euler angle order).
	 * 5. Move origin back from pivot anchor.
	 * 6. Apply scale (scaleX, scaleY).
	 */
	buildLayer3DMatrix(config: Layer3DMatrixConfig): Matrix4x4 {
		const {
			x,
			y,
			width,
			height,
			rotateXDeg = 0,
			rotateYDeg = 0,
			rotateZDeg = 0,
			scaleX = 1,
			scaleY = 1,
			perspectivePx = 0,
			originXRatio = 0.5,
			originYRatio = 0.5,
			translateZPx = 0,
		} = config;

		const pivotX = x + width * originXRatio;
		const pivotY = y + height * originYRatio;

		const rxRad = (rotateXDeg * Math.PI) / 180;
		const ryRad = (rotateYDeg * Math.PI) / 180;
		const rzRad = (rotateZDeg * Math.PI) / 180;

		let m = Transform3DMath.identity();

		// 1. Move to pivot center
		m = Transform3DMath.multiply(
			m,
			Transform3DMath.translate(pivotX, pivotY, 0),
		);

		// 2. Perspective
		if (perspectivePx > 0) {
			m = Transform3DMath.multiply(
				m,
				Transform3DMath.perspective(perspectivePx),
			);
		}

		// 3. Depth translation
		if (translateZPx !== 0) {
			m = Transform3DMath.multiply(
				m,
				Transform3DMath.translate(0, 0, translateZPx),
			);
		}

		// 4. Rotations (Z, Y, X)
		if (rzRad !== 0) {
			m = Transform3DMath.multiply(m, Transform3DMath.rotateZ(rzRad));
		}
		if (ryRad !== 0) {
			m = Transform3DMath.multiply(m, Transform3DMath.rotateY(ryRad));
		}
		if (rxRad !== 0) {
			m = Transform3DMath.multiply(m, Transform3DMath.rotateX(rxRad));
		}

		// 5. Un-pivot relative to layer top-left
		m = Transform3DMath.multiply(
			m,
			Transform3DMath.translate(
				-width * originXRatio,
				-height * originYRatio,
				0,
			),
		);

		// 6. Scale
		if (scaleX !== 1 || scaleY !== 1) {
			m = Transform3DMath.multiply(m, Transform3DMath.scale(scaleX, scaleY, 1));
		}

		return m;
	},

	/**
	 * Projects a 3D point (x, y, z, 1) through a 4x4 matrix, including perspective division by W.
	 */
	projectPoint(m: Matrix4x4, p: Point3D): Point2D {
		const x = p.x;
		const y = p.y;
		const z = p.z;

		const X = m[0] * x + m[4] * y + m[8] * z + m[12];
		const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
		const W = m[3] * x + m[7] * y + m[11] * z + m[15];

		const wInv = Math.abs(W) > 1e-6 ? 1 / W : 1.0;
		return {
			x: X * wInv,
			y: Y * wInv,
		};
	},

	/**
	 * Projects the 4 corner vertices of a flat 2D rectangle (0,0, w, h) through the 3D matrix.
	 * Produces the target Quad2D for the WebGPU homography/corner-pin renderer.
	 */
	projectRectangleCorners(
		matrix: Matrix4x4,
		width: number,
		height: number,
	): Quad2D {
		return {
			topLeft: Transform3DMath.projectPoint(matrix, { x: 0, y: 0, z: 0 }),
			topRight: Transform3DMath.projectPoint(matrix, { x: width, y: 0, z: 0 }),
			bottomLeft: Transform3DMath.projectPoint(matrix, {
				x: 0,
				y: height,
				z: 0,
			}),
			bottomRight: Transform3DMath.projectPoint(matrix, {
				x: width,
				y: height,
				z: 0,
			}),
		};
	},

	/**
	 * Computes the signed area of the projected quad to check whether the layer is facing away
	 * (backface culling).
	 * If signedArea < 0 in screen space (y-down), the surface normal points away from the camera.
	 */
	computeSignedArea(quad: Quad2D): number {
		const { topLeft: p0, topRight: p1, bottomRight: p2, bottomLeft: p3 } = quad;
		return (
			0.5 *
			(p0.x * p1.y -
				p1.x * p0.y +
				(p1.x * p2.y - p2.x * p1.y) +
				(p2.x * p3.y - p3.x * p2.y) +
				(p3.x * p0.y - p0.x * p3.y))
		);
	},
};

/**
 * Computes an 8-parameter 3x3 homography matrix mapping destination coordinates (quad)
 * to normalized source coordinates (unit square [0, 1]^2).
 *
 * The homography H maps destination (x, y) to source (u, v):
 *   u = (h00*x + h01*y + h02) / (h20*x + h21*y + h22)
 *   v = (h10*x + h11*y + h12) / (h20*x + h21*y + h22)
 *
 * Resulting array: [h00, h01, h02, h10, h11, h12, h20, h21, 1.0]
 */
export function solveHomography(
	dstPoints: Point2D[],
	srcPoints: Point2D[] = [
		{ x: 0.0, y: 0.0 }, // TL
		{ x: 1.0, y: 0.0 }, // TR
		{ x: 0.0, y: 1.0 }, // BL
		{ x: 1.0, y: 1.0 }, // BR
	],
): number[] {
	const A: number[][] = [];
	const B: number[] = [];

	for (let i = 0; i < 4; i++) {
		const xi = dstPoints[i]?.x ?? 0;
		const yi = dstPoints[i]?.y ?? 0;
		const ui = srcPoints[i]?.x ?? 0;
		const vi = srcPoints[i]?.y ?? 0;

		A.push([xi, yi, 1.0, 0.0, 0.0, 0.0, -xi * ui, -yi * ui]);
		B.push(ui);

		A.push([0.0, 0.0, 0.0, xi, yi, 1.0, -xi * vi, -yi * vi]);
		B.push(vi);
	}

	const n = 8;
	for (let i = 0; i < n; i++) {
		// Find pivot row
		let maxRow = i;
		let maxVal = Math.abs(A[i][i]);
		for (let k = i + 1; k < n; k++) {
			if (Math.abs(A[k][i]) > maxVal) {
				maxVal = Math.abs(A[k][i]);
				maxRow = k;
			}
		}

		// Swap rows in A and B
		const tempRow = A[i];
		A[i] = A[maxRow];
		A[maxRow] = tempRow;

		const tempB = B[i];
		B[i] = B[maxRow];
		B[maxRow] = tempB;

		const pivot = A[i][i];
		if (Math.abs(pivot) < 1e-12) {
			A[i][i] = pivot < 0 ? -1e-12 : 1e-12;
		}

		for (let k = i + 1; k < n; k++) {
			const factor = A[k][i] / A[i][i];
			for (let j = i; j < n; j++) {
				A[k][j] -= factor * A[i][j];
			}
			B[k] -= factor * B[i];
		}
	}

	// Back-substitution
	const h = new Array(8).fill(0.0);
	for (let i = n - 1; i >= 0; i--) {
		let sum = B[i];
		for (let j = i + 1; j < n; j++) {
			sum -= A[i][j] * h[j];
		}
		h[i] = sum / A[i][i];
	}

	return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0];
}

export interface Transform3DPropsLike {
	rotateX?: number;
	rotateY?: number;
	rotateZ?: number;
	translateZ?: number;
	perspective?: number;
	perspectiveOriginX?: number;
	perspectiveOriginY?: number;
	animation?: { tracks?: Array<{ prop: string }> };
	[key: string]: unknown;
}

/**
 * Checks whether a layer operation or compiled stub activates the 3D perspective path.
 */
export function has3DTransform(
	target?: Transform3DPropsLike,
	lop?: Transform3DPropsLike,
): boolean {
	const rx = target?.rotateX ?? lop?.rotateX ?? 0;
	const ry = target?.rotateY ?? lop?.rotateY ?? 0;
	const rz = target?.rotateZ ?? lop?.rotateZ ?? 0;
	const tz = target?.translateZ ?? lop?.translateZ ?? 0;
	const p = target?.perspective ?? lop?.perspective ?? 0;

	if (
		rx !== 0 ||
		ry !== 0 ||
		tz !== 0 ||
		(p > 0 && (rx !== 0 || ry !== 0 || tz !== 0 || rz !== 0))
	) {
		return true;
	}

	if (
		(target?.rotateZ !== undefined && target.rotateZ !== 0) ||
		(lop?.rotateZ !== undefined && lop.rotateZ !== 0)
	) {
		return true;
	}

	const tracks = lop?.animation?.tracks;
	if (tracks && tracks.length > 0) {
		for (const t of tracks) {
			if (
				t.prop === "rotateX" ||
				t.prop === "rotateY" ||
				t.prop === "rotateZ" ||
				t.prop === "translateZ" ||
				t.prop === "perspective"
			) {
				return true;
			}
		}
	}

	return false;
}
