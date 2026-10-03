export function getDefaultPoints(): { x: number; y: number }[] {
	return [
		{ x: 0, y: 0 }, // Top-Left (TL)
		{ x: 100, y: 0 }, // Top-Right (TR)
		{ x: 0, y: 100 }, // Bottom-Left (BL)
		{ x: 100, y: 100 }, // Bottom-Right (BR)
	];
}

/**
 * Computes a 3x3 homography matrix mapping normalized destination/target points (quad)
 * to normalized source points (unit square [0,1]^2).
 *
 * Target corners are input as percent coordinates (0-100) and normalized internally to [0,1].
 *
 * The homography H maps target (x, y) to source (u, v):
 *   u = (h00*x + h01*y + h02) / (h20*x + h21*y + h22)
 *   v = (h10*x + h11*y + h12) / (h20*x + h21*y + h22)
 *
 * We set h22 = 1.0.
 */
export function solveHomography(
	targetPoints: { x: number; y: number }[],
): number[] {
	const pts =
		targetPoints && targetPoints.length === 4
			? targetPoints
			: getDefaultPoints();

	// Source points: unit square corners matching TL, TR, BL, BR
	const src = [
		{ x: 0.0, y: 0.0 }, // TL
		{ x: 1.0, y: 0.0 }, // TR
		{ x: 0.0, y: 1.0 }, // BL
		{ x: 1.0, y: 1.0 }, // BR
	];

	// Destination points normalized to [0,1]
	const dst = pts.map((p) => ({
		x: p.x / 100.0,
		y: p.y / 100.0,
	}));

	// Solve A * h = B where A is 8x8, B is 8x1
	const A: number[][] = [];
	const B: number[] = [];

	for (let i = 0; i < 4; i++) {
		const xi = dst[i].x;
		const yi = dst[i].y;
		const ui = src[i].x;
		const vi = src[i].y;

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
			// Singular or near-singular matrix. Continue with small fallback pivot.
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

	// Returns h00, h01, h02, h10, h11, h12, h20, h21, h22=1.0
	return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1.0];
}
