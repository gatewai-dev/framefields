import earcut from "earcut";
import type * as fontkit from "fontkit";
import { Path2D } from "skia-canvas";
import type { Material3D, Mesh3DData, Model3DData } from "../loaders/types.js";

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
	/** "start"/"end" read as left/right (the text runs left to right) */
	align?: "left" | "center" | "right" | "start" | "end";
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
function organizeGlyphPolygons({
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

/**
 * For outlines that may overlap: fonts wind filled contours one way and holes
 * the other, so the winding of the largest contour marks the outlines; each
 * hole goes to the smallest outline around it. Overlapping outlines become
 * separate solids, which look the same once extruded.
 */
function organizeByWinding(glyphContours: Contour[]): PolygonHierarchy[] {
	const contours = glyphContours.map((contour) => {
		const signed = computeContourSignedArea(contour);
		return { contour, signed, area: Math.abs(signed) };
	});
	if (contours.length === 0) return [];
	contours.sort((a, b) => b.area - a.area);
	const filled = Math.sign(contours[0]!.signed);
	const polygons: PolygonHierarchy[] = [];
	for (const c of contours) {
		if (Math.sign(c.signed) === filled)
			polygons.push({ outer: c.contour, holes: [] });
	}
	for (const c of contours) {
		if (Math.sign(c.signed) === filled) continue;
		const probe = c.contour[0]!;
		const mid = c.contour[Math.floor(c.contour.length / 2)]!;
		let home: PolygonHierarchy | undefined;
		let homeArea = Number.POSITIVE_INFINITY;
		for (const poly of polygons) {
			const area = Math.abs(computeContourSignedArea(poly.outer));
			if (
				area > c.area &&
				area < homeArea &&
				(isPointInsidePolygon(probe, poly.outer) ||
					isPointInsidePolygon(mid, poly.outer))
			) {
				home = poly;
				homeArea = area;
			}
		}
		home?.holes.push(c.contour);
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

	const run = font.layout(options.text);
	let cursorX = 0;
	const polygons: PolygonHierarchy[] = [];

	for (let i = 0; i < run.glyphs.length; i++) {
		const glyph = run.glyphs[i]!;
		const pos = run.positions[i]!;
		const glyphX = cursorX + (pos.xOffset ?? 0);
		const glyphY = pos.yOffset ?? 0;

		const glyphPolys = glyphPolygonsAt(
			font,
			glyph,
			glyphX,
			glyphY,
			scale,
			flattening,
		);
		for (const gp of glyphPolys) {
			polygons.push(gp);
		}

		cursorX +=
			(pos.xAdvance ?? glyph.advanceWidth ?? 0) +
			(options.letterSpacing ? options.letterSpacing / scale : 0);
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

	let alignOffsetX = (minX + maxX) / 2;
	if (options.align === "left" || options.align === "start")
		alignOffsetX = minX;
	if (options.align === "right" || options.align === "end") alignOffsetX = maxX;

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
