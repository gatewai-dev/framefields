/**
 * Minimal pure 2D affine matrix (same 6-number layout as DOMMatrix:
 * [a, b, c, d, e, f] with x' = a·x + c·y + e, y' = b·x + d·y + f).
 *
 * DOM-free on purpose — WebGPU node renderers build DOMMatrix chains before
 * pushing transforms, but DOMMatrix is not available in Node (unit tests /
 * headless layout), so the anchor math that decides WHERE a layer pivots is
 * implemented here as pure functions and only materialized into a DOMMatrix
 * at the render boundary via `toDOMMatrix`.
 */
export interface Matrix2D {
	a: number;
	b: number;
	c: number;
	d: number;
	e: number;
	f: number;
}

export const IDENTITY: Matrix2D = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function translate(tx: number, ty: number): Matrix2D {
	return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** Rotation in degrees (screen convention: positive = clockwise, y-down). */
export function rotate(degrees: number): Matrix2D {
	const rad = (degrees * Math.PI) / 180;
	const cos = Math.cos(rad);
	const sin = Math.sin(rad);
	return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

export function scale(sx: number, sy: number = sx): Matrix2D {
	return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** m1 ∘ m2 (m2 applied first — matches DOMMatrix.multiply ordering). */
export function multiply(m1: Matrix2D, m2: Matrix2D): Matrix2D {
	return {
		a: m1.a * m2.a + m1.c * m2.b,
		b: m1.b * m2.a + m1.d * m2.b,
		c: m1.a * m2.c + m1.c * m2.d,
		d: m1.b * m2.c + m1.d * m2.d,
		e: m1.a * m2.e + m1.c * m2.f + m1.e,
		f: m1.b * m2.e + m1.d * m2.f + m1.f,
	};
}

export function transformPoint(
	m: Matrix2D,
	x: number,
	y: number,
): { x: number; y: number } {
	return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** Materialize into a DOMMatrix for the renderer's transform stack. */
export function toDOMMatrix(m: Matrix2D): DOMMatrix {
	return new DOMMatrix([m.a, m.b, m.c, m.d, m.e, m.f]);
}

/**
 * Layer transform matrix with anchor-aware pivot semantics.
 *
 * The composition node box is drawn at (0, 0, width, height) in local space
 * and positioned at `x`/`y`. `anchorX`/`anchorY` (0–1 fractions of the box)
 * select the pivot point that scale/rotation are applied AROUND:
 *
 *   position → pivot → rotate → scale → un-pivot
 *
 * With the default center anchor (0.5, 0.5) a `scale: 2` animation grows the
 * node symmetrically from its middle instead of from its top-left corner.
 * The pivot point itself is invariant under rotation and scale.
 */
export function buildLayerMatrix(params: {
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	scale: number;
	anchorX?: number;
	anchorY?: number;
}): Matrix2D {
	const ax = params.anchorX ?? 0.5;
	const ay = params.anchorY ?? 0.5;
	const px = ax * params.width;
	const py = ay * params.height;

	return multiply(
		translate(params.x, params.y),
		multiply(
			translate(px, py),
			multiply(
				rotate(params.rotation),
				multiply(scale(params.scale), translate(-px, -py)),
			),
		),
	);
}
