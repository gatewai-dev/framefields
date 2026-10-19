import earcut from "earcut";
import type * as fontkit from "fontkit";
import { Path2D } from "skia-canvas";
import type { Material3D, Mesh3DData, Model3DData } from "../loaders/types.js";
import type { FontkitFont } from "../slug/slug-generator.js";
import { shapeLineFromFont } from "../slug/text-shaping.js";

export interface Point2D {
	x: number;
	y: number;
}

export type Contour = Point2D[];

export interface ExtrudedTextGeometryOptions {
	text: string;
	font: fontkit.Font;
	fontSize?: number;
	depth?: number;
	/** Fixed straight segments per curve; overrides `curveTolerance`. */
	curveSegments?: number;
	/**
	 * Most a flattened curve may stray from the true outline, in px at
	 * `fontSize`. Each curve gets as many segments as its bend needs, so big
	 * text and tight bowls stay round while straight stems stay cheap.
	 */
	curveTolerance?: number;
	/** "start"/"end" follow the text direction (left/right for LTR text) */
	align?: "left" | "center" | "right" | "start" | "end";
	/** Base direction; "auto" (default) takes it from the first strong character. */
	direction?: "ltr" | "rtl" | "auto";
	verticalAlign?: "top" | "middle" | "bottom";
	letterSpacing?: number;
	/** Letter faces: the front cap (toward a default camera, -z) and the back cap */
	fill?: string;
	/** Side walls; defaults to `fill` */
	bevelColor?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	metallic?: number;
}

export interface ExtrudedTextResult {
	modelData: Model3DData;
	bounds: {
		minX: number;
		maxX: number;
		minY: number;
		maxY: number;
		width: number;
		height: number;
		depth: number;
	};
}

export function parseHexOrRgbColor(
	colorStr: string,
): [number, number, number, number] {
	const c = colorStr.trim();
	if (c.startsWith("#")) {
		const hex = c.slice(1);
		if (hex.length === 3) {
			const r = Number.parseInt(hex[0]! + hex[0]!, 16) / 255;
			const g = Number.parseInt(hex[1]! + hex[1]!, 16) / 255;
			const b = Number.parseInt(hex[2]! + hex[2]!, 16) / 255;
			return [r, g, b, 1];
		}
		if (hex.length === 6) {
			const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
			const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
			const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
			return [r, g, b, 1];
		}
		if (hex.length === 8) {
			const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
			const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
			const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
			const a = Number.parseInt(hex.slice(6, 8), 16) / 255;
			return [r, g, b, a];
		}
	}
	if (c.startsWith("rgb")) {
		const parts = c
			.replace(/rgba?\(/, "")
			.replace(/\)/, "")
			.split(",")
			.map((p) => Number.parseFloat(p.trim()));
		const r = (parts[0] ?? 0) / 255;
		const g = (parts[1] ?? 0) / 255;
		const b = (parts[2] ?? 0) / 255;
		const a = parts[3] !== undefined ? parts[3] : 1;
		return [r, g, b, a];
	}
	return [1, 1, 1, 1];
}

export function computeContourSignedArea(contour: Contour): number {
	let area = 0;
	const len = contour.length;
	for (let i = 0; i < len; i++) {
		const j = (i + 1) % len;
		area += contour[i]!.x * contour[j]!.y - contour[j]!.x * contour[i]!.y;
	}
	return area / 2;
}

export function isPointInsidePolygon(p: Point2D, poly: Contour): boolean {
	let inside = false;
	const len = poly.length;
	for (let i = 0, j = len - 1; i < len; j = i++) {
		const xi = poly[i]!.x;
		const yi = poly[i]!.y;
		const xj = poly[j]!.x;
		const yj = poly[j]!.y;
		const intersect =
			yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
		if (intersect) inside = !inside;
	}
	return inside;
}

export interface CurveFlattening {
	/** Fixed segment count per curve, if set */
	segments?: number;
	/** Max distance between curve and polyline, in output units */
	tolerance: number;
}

const DEFAULT_CURVE_TOLERANCE = 0.1;
const MAX_CURVE_SEGMENTS = 64;

/**
 * Segments needed for a polyline through n uniform steps of a curve to stay
 * within `tolerance`: the chord error is at most max|B''| / (8 n^2).
 */
function curveSegmentCount(
	maxSecondDerivative: number,
	flattening: CurveFlattening,
): number {
	if (flattening.segments !== undefined) return flattening.segments;
	const n = Math.ceil(
		Math.sqrt(maxSecondDerivative / (8 * flattening.tolerance)),
	);
	return Math.min(MAX_CURVE_SEGMENTS, Math.max(1, n));
}

function processCurveQuadratic(
	p0: Point2D,
	cp: Point2D,
	end: Point2D,
	flattening: CurveFlattening,
	out: Contour,
): void {
	// B'' = 2 (p0 - 2 cp + end), constant along the curve.
	const segments = curveSegmentCount(
		2 * Math.hypot(p0.x - 2 * cp.x + end.x, p0.y - 2 * cp.y + end.y),
		flattening,
	);
	for (let s = 1; s <= segments; s++) {
		const t = s / segments;
		const mt = 1 - t;
		out.push({
			x: mt * mt * p0.x + 2 * mt * t * cp.x + t * t * end.x,
			y: mt * mt * p0.y + 2 * mt * t * cp.y + t * t * end.y,
		});
	}
}

function processCurveCubic(
	p0: Point2D,
	cp1: Point2D,
	cp2: Point2D,
	end: Point2D,
	flattening: CurveFlattening,
	out: Contour,
): void {
	// B'' is linear in t, so its largest magnitude is at an end: 6 x the larger second difference.
	const segments = curveSegmentCount(
		6 *
			Math.max(
				Math.hypot(p0.x - 2 * cp1.x + cp2.x, p0.y - 2 * cp1.y + cp2.y),
				Math.hypot(cp1.x - 2 * cp2.x + end.x, cp1.y - 2 * cp2.y + end.y),
			),
		flattening,
	);
	for (let s = 1; s <= segments; s++) {
		const t = s / segments;
		const mt = 1 - t;
		out.push({
			x:
				mt * mt * mt * p0.x +
				3 * mt * mt * t * cp1.x +
				3 * mt * t * t * cp2.x +
				t * t * t * end.x,
			y:
				mt * mt * mt * p0.y +
				3 * mt * mt * t * cp1.y +
				3 * mt * t * t * cp2.y +
				t * t * t * end.y,
		});
	}
}

type Edge = [string, ...number[]];

/**
 * The glyph outline with overlaps merged (skia's `simplify`), or null where
 * skia isn't available, as in the browser.
 */
function simplifiedEdges(svg: string): Edge[] | null {
	try {
		const edges = new Path2D(svg).simplify().edges as unknown;
		return Array.isArray(edges) ? (edges as Edge[]) : null;
	} catch {
		return null;
	}
}

interface GlyphContours {
	contours: Contour[];
	/** Overlaps merged, so contours never cross. */
	simplified: boolean;
}

function extractGlyphContours(
	glyph: fontkit.Glyph,
	glyphX: number,
	glyphY: number,
	scale: number,
	flattening: CurveFlattening,
): GlyphContours {
	const svg = glyph.path?.toSVG();
	if (!svg) return { contours: [], simplified: true };

	// Without skia, read fontkit's own outline: same verbs, but overlapping
	// contours (common in variable fonts) stay as they are.
	let edges = simplifiedEdges(svg);
	const simplified = edges !== null;
	edges ??= (glyph.path?.commands ?? []).map(
		(c) => [c.command, ...c.args] as Edge,
	);

	const contours: Contour[] = [];
	let curr: Point2D = { x: 0, y: 0 };
	let current: Contour = [];

	const finishCurrent = () => {
		if (current.length >= 3) {
			const first = current[0]!;
			const last = current[current.length - 1]!;
			if (Math.hypot(last.x - first.x, last.y - first.y) < 1e-4) {
				current.pop();
			}
			if (current.length >= 3) {
				contours.push(current);
			}
		}
		current = [];
	};

	for (const edge of edges) {
		const name = edge[0];
		// skia's edges are [verb, ...coordinates]
		const args = edge.slice(1) as number[];

		if (name === "moveTo") {
			finishCurrent();
			curr = {
				x: (glyphX + args[0]!) * scale,
				y: -(glyphY + args[1]!) * scale,
			};
			current = [curr];
		} else if (name === "lineTo") {
			curr = {
				x: (glyphX + args[0]!) * scale,
				y: -(glyphY + args[1]!) * scale,
			};
			current.push(curr);
		} else if (name === "quadraticCurveTo") {
			const cp: Point2D = {
				x: (glyphX + args[0]!) * scale,
				y: -(glyphY + args[1]!) * scale,
			};
			const end: Point2D = {
				x: (glyphX + args[2]!) * scale,
				y: -(glyphY + args[3]!) * scale,
			};
			processCurveQuadratic(curr, cp, end, flattening, current);
			curr = end;
		} else if (name === "bezierCurveTo") {
			const cp1: Point2D = {
				x: (glyphX + args[0]!) * scale,
				y: -(glyphY + args[1]!) * scale,
			};
			const cp2: Point2D = {
				x: (glyphX + args[2]!) * scale,
				y: -(glyphY + args[3]!) * scale,
			};
			const end: Point2D = {
				x: (glyphX + args[4]!) * scale,
				y: -(glyphY + args[5]!) * scale,
			};
			processCurveCubic(curr, cp1, cp2, end, flattening, current);
			curr = end;
		} else if (name === "closePath") {
			finishCurrent();
		}
	}
	finishCurrent();
	return { contours, simplified };
}

/** Side-wall segments meeting at more than this angle (30°) keep a hard edge. */
const SIDE_CREASE_COS = Math.cos((30 * Math.PI) / 180);

interface PolygonHierarchy {
	outer: Contour;
	holes: Contour[];
}

/**
 * Group a glyph's contours into filled outlines and their holes by nesting
 * depth: a contour inside an even number of others is an outline (the ring
 * of "O", or the "R" sitting in the counter of "®"), one inside an odd number
 * is a hole of the smallest outline around it.
 */
export function organizeGlyphPolygons({
	contours: glyphContours,
	simplified,
}: GlyphContours): PolygonHierarchy[] {
	if (!simplified) return organizeByWinding(glyphContours);
	const contours = glyphContours.map((contour) => ({
		contour,
		area: Math.abs(computeContourSignedArea(contour)),
	}));
	// Outermost first, so every contour's container is handled before it.
	contours.sort((a, b) => b.area - a.area);

	const containers: number[][] = contours.map(() => []);
	for (let i = 0; i < contours.length; i++) {
		const inner = contours[i]!.contour;
		const mid = inner[Math.floor(inner.length / 2)]!;
		for (let j = 0; j < i; j++) {
			if (contours[j]!.area <= contours[i]!.area) continue;
			const outer = contours[j]!.contour;
			// Contours do not cross (the path is simplified), so a vertex
			// decides; a second guards a vertex lying on the other outline.
			if (
				isPointInsidePolygon(inner[0]!, outer) ||
				isPointInsidePolygon(mid, outer)
			) {
				containers[i]!.push(j);
			}
		}
	}

	const polygons: PolygonHierarchy[] = [];
	const polygonOf = new Map<number, PolygonHierarchy>();
	for (let i = 0; i < contours.length; i++) {
		const around = containers[i]!;
		if (around.length % 2 === 0) {
			const poly = { outer: contours[i]!.contour, holes: [] };
			polygons.push(poly);
			polygonOf.set(i, poly);
		} else {
			// The innermost container is the latest (smallest) one.
			polygonOf
				.get(around[around.length - 1]!)
				?.holes.push(contours[i]!.contour);
		}
	}
	return polygons;
}

/** Where segments ab and cd cross strictly inside both, or null. */
function segmentCrossing(
	a: Point2D,
	b: Point2D,
	c: Point2D,
	d: Point2D,
): Point2D | null {
	const rx = b.x - a.x;
	const ry = b.y - a.y;
	const sx = d.x - c.x;
	const sy = d.y - c.y;
	const den = rx * sy - ry * sx;
	if (Math.abs(den) < 1e-12) return null;
	const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
	const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
	const eps = 1e-9;
	if (t <= eps || t >= 1 - eps || u <= eps || u >= 1 - eps) return null;
	return { x: a.x + rx * t, y: a.y + ry * t };
}

/**
 * Splits a contour that crosses itself into simple loops: at each crossing
 * the contour is cut into the part between the two crossing edges and the
 * rest. Font outlines meant to be filled with the nonzero rule (variable
 * fonts, overlapping strokes) often cross themselves, and a triangulator
 * given such a contour fills the wrong areas (a "V" with its notch filled).
 */
export function untangleContour(contour: Contour, depth = 0): Contour[] {
	const n = contour.length;
	if (n < 3) return [];
	if (depth > 64) return [contour];
	for (let i = 0; i < n; i++) {
		const a = contour[i]!;
		const b = contour[(i + 1) % n]!;
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) continue;
			const x = segmentCrossing(a, b, contour[j]!, contour[(j + 1) % n]!);
			if (!x) continue;
			const inner = [x, ...contour.slice(i + 1, j + 1)];
			const outer = [x, ...contour.slice(j + 1), ...contour.slice(0, i + 1)];
			return [
				...untangleContour(inner, depth + 1),
				...untangleContour(outer, depth + 1),
			];
		}
	}
	return Math.abs(computeContourSignedArea(contour)) > 1e-9 ? [contour] : [];
}

/** Nonzero winding number of a set of contours around a point. */
function windingNumber(p: Point2D, contours: Contour[]): number {
	let w = 0;
	for (const c of contours) {
		for (let i = 0; i < c.length; i++) {
			const a = c[i]!;
			const b = c[(i + 1) % c.length]!;
			const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
			if (a.y <= p.y) {
				if (b.y > p.y && side > 0) w++;
			} else if (b.y <= p.y && side < 0) {
				w--;
			}
		}
	}
	return w;
}

/** A point just inside a simple loop, next to its longest edge. */
function pointJustInside(loop: Contour): Point2D {
	let best = 0;
	let bestLen = -1;
	for (let i = 0; i < loop.length; i++) {
		const a = loop[i]!;
		const b = loop[(i + 1) % loop.length]!;
		const len = Math.hypot(b.x - a.x, b.y - a.y);
		if (len > bestLen) {
			bestLen = len;
			best = i;
		}
	}
	const a = loop[best]!;
	const b = loop[(best + 1) % loop.length]!;
	const mx = (a.x + b.x) / 2;
	const my = (a.y + b.y) / 2;
	const eps = Math.max(1e-4, Math.min(0.01, bestLen * 1e-3));
	const nx = (-(b.y - a.y) / bestLen) * eps;
	const ny = ((b.x - a.x) / bestLen) * eps;
	const p = { x: mx + nx, y: my + ny };
	return isPointInsidePolygon(p, loop) ? p : { x: mx - nx, y: my - ny };
}

/**
 * For outlines that were not simplified (no skia, as in the browser):
 * contours may cross themselves and each other, and are meant to be filled
 * with the nonzero rule. Self-crossings are split into simple loops; a loop
 * whose inside is filled under the nonzero rule becomes an outline, and one
 * that is empty (a counter) becomes a hole of the smallest outline around it.
 * Overlapping outlines become separate solids, which look the same once
 * extruded.
 */
function organizeByWinding(glyphContours: Contour[]): PolygonHierarchy[] {
	const loops = glyphContours.flatMap((c) => untangleContour(c));
	const polygons: PolygonHierarchy[] = [];
	const holes: Contour[] = [];
	for (const loop of loops) {
		if (windingNumber(pointJustInside(loop), glyphContours) !== 0) {
			polygons.push({ outer: loop, holes: [] });
		} else {
			holes.push(loop);
		}
	}
	for (const hole of holes) {
		const area = Math.abs(computeContourSignedArea(hole));
		const probe = pointJustInside(hole);
		let home: PolygonHierarchy | undefined;
		let homeArea = Number.POSITIVE_INFINITY;
		for (const poly of polygons) {
			const outerArea = Math.abs(computeContourSignedArea(poly.outer));
			if (
				outerArea > area &&
				outerArea < homeArea &&
				isPointInsidePolygon(probe, poly.outer)
			) {
				home = poly;
				homeArea = outerArea;
			}
		}
		home?.holes.push(hole);
	}
	return polygons;
}

/**
 * A glyph's outlines are flattened and sorted into outlines and holes once per
 * font, size and flattening, at the glyph origin; each use gets a translated
 * copy (callers reorder and move the points they are given).
 */
const glyphOutlineCache = new WeakMap<
	object,
	Map<string, PolygonHierarchy[]>
>();

function glyphPolygonsAt(
	font: fontkit.Font,
	glyph: fontkit.Glyph,
	glyphX: number,
	glyphY: number,
	scale: number,
	flattening: CurveFlattening,
): PolygonHierarchy[] {
	let byGlyph = glyphOutlineCache.get(font);
	if (!byGlyph) {
		byGlyph = new Map();
		glyphOutlineCache.set(font, byGlyph);
	}
	const key = `${glyph.id}|${scale}|${flattening.segments ?? ""}|${flattening.tolerance}`;
	let atOrigin = byGlyph.get(key);
	if (!atOrigin) {
		atOrigin = organizeGlyphPolygons(
			extractGlyphContours(glyph, 0, 0, scale, flattening),
		);
		byGlyph.set(key, atOrigin);
	}
	const dx = glyphX * scale;
	const dy = -glyphY * scale;
	const moved = (c: Contour): Contour =>
		c.map((p) => ({ x: p.x + dx, y: p.y + dy }));
	return atOrigin.map((poly) => ({
		outer: moved(poly.outer),
		holes: poly.holes.map(moved),
	}));
}

export function generateExtrudedTextGeometry(
	options: ExtrudedTextGeometryOptions,
): ExtrudedTextResult {
	const font = options.font;
	const fontSize = options.fontSize ?? 48;
	const depth = options.depth ?? 20;
	const halfDepth = depth / 2;
	const flattening: CurveFlattening = {
		segments:
			options.curveSegments !== undefined
				? Math.max(2, options.curveSegments)
				: undefined,
		tolerance: Math.max(
			1e-3,
			options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE,
		),
	};
	const unitsPerEm = font.unitsPerEm || 1000;
	const scale = fontSize / unitsPerEm;

	// Shaped and ordered like 2D text: joining forms, ligatures and marks,
	// and right-to-left runs laid out right to left.
	const line = shapeLineFromFont(
		font as unknown as FontkitFont,
		options.text.replace(/\n/g, " "),
		{
			direction: options.direction,
			letterSpacing: options.letterSpacing ? options.letterSpacing / scale : 0,
		},
	);
	const polygons: PolygonHierarchy[] = [];

	for (const placed of line.glyphs) {
		const glyph = font.getGlyph(placed.glyphId);
		const glyphPolys = glyphPolygonsAt(
			font,
			glyph,
			placed.x,
			placed.y,
			scale,
			flattening,
		);
		for (const gp of glyphPolys) {
			polygons.push(gp);
		}
	}

	let minX = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const poly of polygons) {
		for (const p of poly.outer) {
			if (p.x < minX) minX = p.x;
			if (p.x > maxX) maxX = p.x;
			if (p.y < minY) minY = p.y;
			if (p.y > maxY) maxY = p.y;
		}
		for (const hole of poly.holes) {
			for (const p of hole) {
				if (p.x < minX) minX = p.x;
				if (p.x > maxX) maxX = p.x;
				if (p.y < minY) minY = p.y;
				if (p.y > maxY) maxY = p.y;
			}
		}
	}

	if (!Number.isFinite(minX)) {
		minX = 0;
		maxX = 0;
		minY = 0;
		maxY = 0;
	}

	const w = maxX - minX;
	const h = maxY - minY;

	// "start"/"end" follow the text's direction.
	const rtl = (line.baseLevel & 1) === 1;
	const align =
		options.align === "start"
			? rtl
				? "right"
				: "left"
			: options.align === "end"
				? rtl
					? "left"
					: "right"
				: options.align;
	let alignOffsetX = (minX + maxX) / 2;
	if (align === "left") alignOffsetX = minX;
	if (align === "right") alignOffsetX = maxX;

	let alignOffsetY = (minY + maxY) / 2;
	if (options.verticalAlign === "top") alignOffsetY = minY;
	if (options.verticalAlign === "bottom") alignOffsetY = maxY;

	for (const poly of polygons) {
		for (const p of poly.outer) {
			p.x -= alignOffsetX;
			p.y -= alignOffsetY;
		}
		for (const hole of poly.holes) {
			for (const p of hole) {
				p.x -= alignOffsetX;
				p.y -= alignOffsetY;
			}
		}
	}
	// Bounds (and the UVs built from them) describe the aligned geometry.
	minX -= alignOffsetX;
	maxX -= alignOffsetX;
	minY -= alignOffsetY;
	maxY -= alignOffsetY;

	const frontPositions: number[] = [];
	const frontNormals: number[] = [];
	const frontUvs: number[] = [];
	const frontIndices: number[] = [];

	const sidePositions: number[] = [];
	const sideNormals: number[] = [];
	const sideUvs: number[] = [];
	const sideIndices: number[] = [];

	// Side walls are columns of vertex pairs (top at +z, bottom at -z) joined
	// by quads. Along a smooth run neighbouring quads share their column, so
	// a flattened curve shades as one surface (averaged normals) at half the
	// vertices; a corner sharper than the crease angle gets one column per
	// side and stays crisp. u runs along the outline, v front to back.
	const addColumn = (p: Point2D, n: Point2D, u: number): number => {
		const index = sidePositions.length / 3;
		sidePositions.push(p.x, p.y, halfDepth, p.x, p.y, -halfDepth);
		sideNormals.push(n.x, n.y, 0, n.x, n.y, 0);
		sideUvs.push(u, 0, u, 1);
		return index;
	};

	const addSideWall = (contour: Contour): void => {
		const pts = contour.filter((p, k) => {
			const next = contour[(k + 1) % contour.length]!;
			return Math.hypot(next.x - p.x, next.y - p.y) >= 1e-6;
		});
		const count = pts.length;
		if (count < 2) return;
		const edgeLengths: number[] = [];
		const faceNormals = pts.map((p, k) => {
			const next = pts[(k + 1) % count]!;
			const len = Math.hypot(next.x - p.x, next.y - p.y);
			edgeLengths.push(len);
			return { x: (next.y - p.y) / len, y: -(next.x - p.x) / len };
		});
		const perimeter = edgeLengths.reduce((a, b) => a + b, 0);

		// Column each edge starts from, and column the previous edge ends on.
		const startColumn: number[] = [];
		const endColumn: number[] = [];
		let along = 0;
		for (let k = 0; k < count; k++) {
			const incoming = faceNormals[(k - 1 + count) % count]!;
			const outgoing = faceNormals[k]!;
			const u = along / perimeter;
			const sx = incoming.x + outgoing.x;
			const sy = incoming.y + outgoing.y;
			const smooth =
				incoming.x * outgoing.x + incoming.y * outgoing.y >= SIDE_CREASE_COS;
			const averaged = smooth
				? { x: sx / Math.hypot(sx, sy), y: sy / Math.hypot(sx, sy) }
				: null;
			if (averaged && k > 0) {
				startColumn[k] = endColumn[k] = addColumn(pts[k]!, averaged, u);
			} else {
				// Vertex 0 always splits, smooth or not: its end column closes the outline at u = 1.
				endColumn[k] = addColumn(
					pts[k]!,
					averaged ?? incoming,
					k === 0 ? 1 : u,
				);
				startColumn[k] = addColumn(pts[k]!, averaged ?? outgoing, u);
			}
			along += edgeLengths[k]!;
		}

		for (let k = 0; k < count; k++) {
			const a = startColumn[k]!; // top; a + 1 is its bottom
			const b = endColumn[(k + 1) % count]!;
			sideIndices.push(a, b + 1, b);
			sideIndices.push(a, a + 1, b + 1);
		}
	};

	for (const poly of polygons) {
		const outer = poly.outer;
		if (computeContourSignedArea(outer) < 0) {
			outer.reverse();
		}
		for (const hole of poly.holes) {
			if (computeContourSignedArea(hole) > 0) {
				hole.reverse();
			}
		}

		const earcutCoords: number[] = [];
		const holeIndices: number[] = [];

		for (const p of outer) {
			earcutCoords.push(p.x, p.y);
		}
		for (const hole of poly.holes) {
			holeIndices.push(earcutCoords.length / 2);
			for (const p of hole) {
				earcutCoords.push(p.x, p.y);
			}
		}

		const triangles = earcut(earcutCoords, holeIndices, 2);
		const vertCount = earcutCoords.length / 2;

		// The front cap faces the default camera, which looks along +z (as
		// planar layers do, normal -z).
		const frontBaseIdx = frontPositions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			frontPositions.push(vx, vy, -halfDepth);
			frontNormals.push(0, 0, -1);
			frontUvs.push((vx - minX) / (w || 1), (vy - minY) / (h || 1));
		}
		for (let t = 0; t < triangles.length; t += 3) {
			frontIndices.push(
				frontBaseIdx + triangles[t]!,
				frontBaseIdx + triangles[t + 2]!,
				frontBaseIdx + triangles[t + 1]!,
			);
		}

		// The back cap is a face of the letter like the front: it takes the
		// fill, so text seen from behind is not painted in the bevel color.
		const backBaseIdx = frontPositions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			frontPositions.push(vx, vy, halfDepth);
			frontNormals.push(0, 0, 1);
			frontUvs.push((vx - minX) / (w || 1), (vy - minY) / (h || 1));
		}
		for (let t = 0; t < triangles.length; t += 3) {
			frontIndices.push(
				backBaseIdx + triangles[t]!,
				backBaseIdx + triangles[t + 1]!,
				backBaseIdx + triangles[t + 2]!,
			);
		}

		addSideWall(outer);
		for (const hole of poly.holes) {
			addSideWall(hole);
		}
	}

	const frontColor = parseHexOrRgbColor(options.fill ?? "#ffffff");
	const sideColor = parseHexOrRgbColor(
		options.bevelColor ?? options.fill ?? "#ffffff",
	);

	const frontMaterial: Material3D = {
		name: "front-material",
		diffuseColor: frontColor,
		shading: options.material ?? "lit",
		shininess: options.shininess ?? 32,
		roughness: options.roughness,
		metallic: options.metallic,
		twoSided: true,
	};

	const sideMaterial: Material3D = {
		name: "side-material",
		diffuseColor: sideColor,
		shading: options.material ?? "lit",
		shininess: options.shininess ?? 32,
		roughness: options.roughness,
		metallic: options.metallic,
		twoSided: true,
	};

	const meshes: Mesh3DData[] = [];

	if (frontIndices.length > 0) {
		meshes.push({
			id: "text-front-mesh",
			name: "front",
			positions: new Float32Array(frontPositions),
			normals: new Float32Array(frontNormals),
			uvs: new Float32Array(frontUvs),
			indices:
				frontPositions.length / 3 > 65535
					? new Uint32Array(frontIndices)
					: new Uint16Array(frontIndices),
			materialName: "front-material",
		});
	}

	if (sideIndices.length > 0) {
		meshes.push({
			id: "text-side-mesh",
			name: "side",
			positions: new Float32Array(sidePositions),
			normals: new Float32Array(sideNormals),
			uvs: new Float32Array(sideUvs),
			indices:
				sidePositions.length / 3 > 65535
					? new Uint32Array(sideIndices)
					: new Uint16Array(sideIndices),
			materialName: "side-material",
		});
	}

	const modelData: Model3DData = {
		name: `extruded-text-${options.text}`,
		meshes,
		materials: {
			"front-material": frontMaterial,
			"side-material": sideMaterial,
		},
		animations: [],
		bounds: {
			min: [minX, minY, -halfDepth],
			max: [maxX, maxY, halfDepth],
			center: [(minX + maxX) / 2, (minY + maxY) / 2, 0],
			size: [w, h, depth],
			boundingSphereRadius: Math.hypot(w, h, depth) / 2,
		},
	};

	return {
		modelData,
		bounds: {
			minX,
			maxX,
			minY,
			maxY,
			width: w,
			height: h,
			depth,
		},
	};
}
