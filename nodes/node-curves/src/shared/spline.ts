import type { CurvePoint } from "./config.js";

/**
 * Solves the Fritsch-Carlson Monotonic Cubic Hermite Spline interpolation
 * for a set of control points. Returns an interpolation function.
 */
export function solveMonotonicSpline(
	points: CurvePoint[],
): (x: number) => number {
	const pts = [...points].sort((a, b) => a.x - b.x);

	// Remove duplicate X values to avoid division by zero
	const uniquePts: CurvePoint[] = [];
	for (const p of pts) {
		if (
			uniquePts.length === 0 ||
			Math.abs(p.x - uniquePts[uniquePts.length - 1].x) > 1e-6
		) {
			uniquePts.push(p);
		}
	}

	const n = uniquePts.length;
	if (n === 0) {
		return (x: number) => x;
	}
	if (n === 1) {
		return () => uniquePts[0].y;
	}

	const dx = new Float32Array(n - 1);
	const dy = new Float32Array(n - 1);
	const ms = new Float32Array(n - 1);
	for (let i = 0; i < n - 1; i++) {
		dx[i] = uniquePts[i + 1].x - uniquePts[i].x;
		dy[i] = uniquePts[i + 1].y - uniquePts[i].y;
		ms[i] = dy[i] / dx[i];
	}

	const tangents = new Float32Array(n);
	tangents[0] = ms[0];
	for (let i = 1; i < n - 1; i++) {
		tangents[i] = (ms[i - 1] + ms[i]) / 2;
	}
	tangents[n - 1] = ms[n - 2];

	for (let i = 0; i < n - 1; i++) {
		const m = ms[i];
		if (Math.abs(m) < 1e-9) {
			tangents[i] = 0;
			tangents[i + 1] = 0;
		} else {
			const alpha = tangents[i] / m;
			const beta = tangents[i + 1] / m;
			const alphaSq = alpha * alpha;
			const betaSq = beta * beta;
			if (alphaSq + betaSq > 9) {
				const tau = 3 / Math.sqrt(alphaSq + betaSq);
				tangents[i] = tau * alpha * m;
				tangents[i + 1] = tau * beta * m;
			}
		}
	}

	return (x: number): number => {
		if (x <= uniquePts[0].x) return uniquePts[0].y;
		if (x >= uniquePts[n - 1].x) return uniquePts[n - 1].y;

		// Binary search to find the correct interval
		let low = 0;
		let high = n - 2;
		let idx = 0;
		while (low <= high) {
			const mid = (low + high) >> 1;
			if (x >= uniquePts[mid].x && x <= uniquePts[mid + 1].x) {
				idx = mid;
				break;
			}
			if (x < uniquePts[mid].x) {
				high = mid - 1;
			} else {
				low = mid + 1;
			}
		}

		const h = dx[idx];
		const t = (x - uniquePts[idx].x) / h;
		const t2 = t * t;
		const t3 = t2 * t;

		const h00 = 2 * t3 - 3 * t2 + 1;
		const h10 = t3 - 2 * t2 + t;
		const h01 = -2 * t3 + 3 * t2;
		const h11 = t3 - t2;

		const y =
			uniquePts[idx].y * h00 +
			h * tangents[idx] * h10 +
			uniquePts[idx + 1].y * h01 +
			h * tangents[idx + 1] * h11;

		return Math.max(0, Math.min(1, y));
	};
}
