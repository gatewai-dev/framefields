/**
 * The framefields mark as places for frames to stand: every stroke of the
 * logo becomes a row of upright frames across it, like the frames of a move
 * laid along its path. Geometry is the brand SVG's (512 units).
 */

/** One frame's place in the mark, in logo units (y down). */
export interface MarkSlot {
	u: number;
	v: number;
	/** Unit tangent of the stroke here: the frame faces along it. */
	tu: number;
	tv: number;
	/** The frame's width here, logo units. */
	width: number;
	/** Which stroke, and how far along it (0..1): the order frames land in. */
	stroke: number;
	along: number;
}

type Point = [number, number];

const quad = (a: Point, c: Point, b: Point, t: number): Point => [
	(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0],
	(1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1],
];
const cubic = (a: Point, c1: Point, c2: Point, b: Point, t: number): Point => {
	const m = 1 - t;
	return [
		m ** 3 * a[0] +
			3 * m * m * t * c1[0] +
			3 * m * t * t * c2[0] +
			t ** 3 * b[0],
		m ** 3 * a[1] +
			3 * m * m * t * c1[1] +
			3 * m * t * t * c2[1] +
			t ** 3 * b[1],
	];
};

/** A dense polyline through the pieces, for arc-length sampling. */
function polyline(pieces: Array<(t: number) => Point>, steps = 48): Point[] {
	const out: Point[] = [];
	for (const piece of pieces)
		for (let i = 0; i <= steps; i++) out.push(piece(i / steps));
	return out;
}
const line =
	(a: Point, b: Point) =>
	(t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

/** Points every `pitch` units along a polyline, with tangents. */
function walk(
	points: Point[],
	pitch: number,
): Array<{ p: Point; t: Point; s: number }> {
	const lengths = [0];
	for (let i = 1; i < points.length; i++) {
		const [ax, ay] = points[i - 1] as Point;
		const [bx, by] = points[i] as Point;
		lengths.push((lengths[i - 1] as number) + Math.hypot(bx - ax, by - ay));
	}
	const total = lengths[lengths.length - 1] as number;
	const count = Math.max(2, Math.round(total / pitch) + 1);
	const out: Array<{ p: Point; t: Point; s: number }> = [];
	let seg = 1;
	for (let k = 0; k < count; k++) {
		const at = (k / (count - 1)) * total;
		while (seg < points.length - 1 && (lengths[seg] as number) < at) seg++;
		const [ax, ay] = points[seg - 1] as Point;
		const [bx, by] = points[seg] as Point;
		const span = (lengths[seg] as number) - (lengths[seg - 1] as number) || 1;
		const f = (at - (lengths[seg - 1] as number)) / span;
		const len = Math.hypot(bx - ax, by - ay) || 1;
		out.push({
			p: [ax + (bx - ax) * f, ay + (by - ay) * f],
			t: [(bx - ax) / len, (by - ay) / len],
			s: at / total,
		});
	}
	return out;
}

const BRACKET = 34;
const CURVE = 28;
const NODE = 32;

/** A corner bracket: in along one edge, round the corner, out along the other. */
function bracket(a: Point, b: Point, corner: Point, c: Point, d: Point) {
	return polyline([line(a, b), (t) => quad(b, corner, c, t), line(c, d)]);
}

/** Half-width of the play triangle (with its rounded stroke) at `u`. */
function playHalf(u: number): number {
	const R = 17;
	let lo = 0;
	let hi = 90;
	const inside = (v: number) => {
		// Distance from (u, 256 + v) to the triangle 284,200 / 362,256 / 284,312.
		const p: Point = [u, 256 + v];
		const tri: Point[] = [
			[284, 200],
			[362, 256],
			[284, 312],
		];
		let within = true;
		let nearest = Number.POSITIVE_INFINITY;
		for (let i = 0; i < 3; i++) {
			const a = tri[i] as Point;
			const b = tri[(i + 1) % 3] as Point;
			const ex = b[0] - a[0];
			const ey = b[1] - a[1];
			const cross = ex * (p[1] - a[1]) - ey * (p[0] - a[0]);
			if (cross < 0) within = false;
			const h = Math.max(
				0,
				Math.min(
					1,
					((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (ex * ex + ey * ey),
				),
			);
			nearest = Math.min(
				nearest,
				Math.hypot(p[0] - a[0] - ex * h, p[1] - a[1] - ey * h),
			);
		}
		return within || nearest <= R;
	};
	if (!inside(0)) return 0;
	for (let i = 0; i < 24; i++) {
		const mid = (lo + hi) / 2;
		if (inside(mid)) lo = mid;
		else hi = mid;
	}
	return lo;
}

/**
 * Every frame's place: rows `pitch` logo units apart along the strokes,
 * each row as many frames of about `module` units as fit across the stroke
 * there, so the mark is built from one size of frame.
 */
export function markSlots(pitch: number, module: number): MarkSlot[] {
	const slots: MarkSlot[] = [];
	const add = (
		stroke: number,
		points: Point[],
		width: (p: Point, s: number) => number,
	) => {
		for (const { p, t, s } of walk(points, pitch)) {
			const w = width(p, s);
			if (w < module * 0.3) continue;
			const across = Math.max(1, Math.round(w / module));
			const each = w / across;
			for (let j = 0; j < across; j++) {
				const offset = (j - (across - 1) / 2) * each;
				slots.push({
					u: p[0] - t[1] * offset,
					v: p[1] + t[0] * offset,
					tu: t[0],
					tv: t[1],
					width: each,
					stroke,
					along: s,
				});
			}
		}
	};

	// The four corners of the frame.
	const corners: Point[][] = [
		bracket([184, 56], [86, 56], [56, 56], [56, 86], [56, 184]),
		bracket([328, 56], [426, 56], [456, 56], [456, 86], [456, 184]),
		bracket([184, 456], [86, 456], [56, 456], [56, 426], [56, 328]),
		bracket([328, 456], [426, 456], [456, 456], [456, 426], [456, 328]),
	];
	corners.forEach((points, i) => {
		add(i, points, () => BRACKET);
	});

	// The stem with its two nodes: the row of frames swells into each circle.
	const node = (v: number, at: number) => {
		const d = Math.abs(v - at);
		return d < NODE ? 2 * Math.sqrt(NODE * NODE - d * d) : 0;
	};
	add(
		4,
		polyline([line([176, 172 - NODE + 3], [176, 340 + NODE - 3])]),
		([, v]) =>
			Math.max(v >= 182 && v <= 330 ? CURVE : 0, node(v, 172), node(v, 340)),
	);
	// The easing curve out of the upper node.
	add(
		5,
		polyline([(t) => cubic([176, 182], [176, 256], [236, 256], [276, 256], t)]),
		([u, v]) => (Math.hypot(u - 176, v - 172) < NODE + 4 ? 0 : CURVE),
	);
	// Play: frames across the triangle, narrowing to its point.
	add(6, polyline([line([270, 256], [376, 256])]), ([u]) => 2 * playHalf(u));
	return slots;
}
