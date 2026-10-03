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
	curveSegments?: number;
	align?: "left" | "center" | "right";
	verticalAlign?: "top" | "middle" | "bottom";
	letterSpacing?: number;
	fill?: string;
	bevelColor?: string;
	material?: "lit" | "unlit" | "toon";
	shininess?: number;
	roughness?: number;
	specularIntensity?: number;
	ambientIntensity?: number;
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

function processCurveQuadratic(
	p0: Point2D,
	cp: Point2D,
	end: Point2D,
	segments: number,
	out: Contour,
): void {
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
	segments: number,
	out: Contour,
): void {
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

function extractGlyphContours(
	glyph: fontkit.Glyph,
	glyphX: number,
	glyphY: number,
	scale: number,
	curveSegments: number,
): Contour[] {
	const svg = glyph.path?.toSVG();
	if (!svg) return [];

	let edges: [string, ...number[]][];
	try {
		const p2d = new Path2D(svg).simplify();
		edges = p2d.edges as [string, ...number[]][];
	} catch {
		return [];
	}

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
		const args = edge.slice(1);

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
			processCurveQuadratic(curr, cp, end, curveSegments, current);
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
			processCurveCubic(curr, cp1, cp2, end, curveSegments, current);
			curr = end;
		} else if (name === "closePath") {
			finishCurrent();
		}
	}
	finishCurrent();
	return contours;
}

interface PolygonHierarchy {
	outer: Contour;
	holes: Contour[];
}

function organizeGlyphPolygons(glyphContours: Contour[]): PolygonHierarchy[] {
	if (glyphContours.length === 0) return [];

	const sorted = [...glyphContours].sort(
		(a, b) =>
			Math.abs(computeContourSignedArea(b)) -
			Math.abs(computeContourSignedArea(a)),
	);

	const outers: PolygonHierarchy[] = [];

	for (const contour of sorted) {
		const area = Math.abs(computeContourSignedArea(contour));
		let parent: PolygonHierarchy | null = null;

		for (const out of outers) {
			const parentArea = Math.abs(computeContourSignedArea(out.outer));
			if (area < parentArea) {
				// Check sample point or mid-point
				const sample = contour[0]!;
				const mid = {
					x: (contour[0]!.x + contour[Math.floor(contour.length / 2)]!.x) / 2,
					y: (contour[0]!.y + contour[Math.floor(contour.length / 2)]!.y) / 2,
				};
				if (
					isPointInsidePolygon(sample, out.outer) ||
					isPointInsidePolygon(mid, out.outer)
				) {
					parent = out;
					break;
				}
			}
		}

		if (parent) {
			parent.holes.push(contour);
		} else {
			outers.push({ outer: contour, holes: [] });
		}
	}

	return outers;
}

export function generateExtrudedTextGeometry(
	options: ExtrudedTextGeometryOptions,
): ExtrudedTextResult {
	const font = options.font;
	const fontSize = options.fontSize ?? 48;
	const depth = options.depth ?? 20;
	const halfDepth = depth / 2;
	const curveSegments = Math.max(2, options.curveSegments ?? 5);
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

		const glyphContours = extractGlyphContours(
			glyph,
			glyphX,
			glyphY,
			scale,
			curveSegments,
		);

		const glyphPolys = organizeGlyphPolygons(glyphContours);
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
	if (options.align === "left") alignOffsetX = minX;
	if (options.align === "right") alignOffsetX = maxX;

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

	const frontPositions: number[] = [];
	const frontNormals: number[] = [];
	const frontUvs: number[] = [];
	const frontIndices: number[] = [];

	const sidePositions: number[] = [];
	const sideNormals: number[] = [];
	const sideUvs: number[] = [];
	const sideIndices: number[] = [];

	const addSideQuad = (p0: Point2D, p1: Point2D): void => {
		const dx = p1.x - p0.x;
		const dy = p1.y - p0.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-6) return;

		const nx = dy / len;
		const ny = -dx / len;

		const baseIdx = sidePositions.length / 3;

		sidePositions.push(p0.x, p0.y, halfDepth);
		sideNormals.push(nx, ny, 0);
		sideUvs.push(0, 0);

		sidePositions.push(p1.x, p1.y, halfDepth);
		sideNormals.push(nx, ny, 0);
		sideUvs.push(1, 0);

		sidePositions.push(p1.x, p1.y, -halfDepth);
		sideNormals.push(nx, ny, 0);
		sideUvs.push(1, 1);

		sidePositions.push(p0.x, p0.y, -halfDepth);
		sideNormals.push(nx, ny, 0);
		sideUvs.push(0, 1);

		sideIndices.push(baseIdx, baseIdx + 2, baseIdx + 1);
		sideIndices.push(baseIdx, baseIdx + 3, baseIdx + 2);
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

		const frontBaseIdx = frontPositions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			frontPositions.push(vx, vy, halfDepth);
			frontNormals.push(0, 0, 1);
			frontUvs.push((vx - minX) / (w || 1), (vy - minY) / (h || 1));
		}
		for (let t = 0; t < triangles.length; t += 3) {
			frontIndices.push(
				frontBaseIdx + triangles[t]!,
				frontBaseIdx + triangles[t + 1]!,
				frontBaseIdx + triangles[t + 2]!,
			);
		}

		const backBaseIdx = sidePositions.length / 3;
		for (let v = 0; v < vertCount; v++) {
			const vx = earcutCoords[v * 2]!;
			const vy = earcutCoords[v * 2 + 1]!;
			sidePositions.push(vx, vy, -halfDepth);
			sideNormals.push(0, 0, -1);
			sideUvs.push((vx - minX) / (w || 1), (vy - minY) / (h || 1));
		}
		for (let t = 0; t < triangles.length; t += 3) {
			sideIndices.push(
				backBaseIdx + triangles[t]!,
				backBaseIdx + triangles[t + 2]!,
				backBaseIdx + triangles[t + 1]!,
			);
		}

		for (let k = 0; k < outer.length; k++) {
			const next = (k + 1) % outer.length;
			addSideQuad(outer[k]!, outer[next]!);
		}

		for (const hole of poly.holes) {
			for (let k = 0; k < hole.length; k++) {
				const next = (k + 1) % hole.length;
				addSideQuad(hole[k]!, hole[next]!);
			}
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
		specularIntensity: options.specularIntensity ?? 0.8,
		ambientIntensity: options.ambientIntensity ?? 1.0,
		metallic: options.metallic,
		twoSided: true,
	};

	const sideMaterial: Material3D = {
		name: "side-material",
		diffuseColor: sideColor,
		shading: options.material ?? "lit",
		shininess: options.shininess ?? 32,
		roughness: options.roughness,
		specularIntensity: options.specularIntensity ?? 0.8,
		ambientIntensity: options.ambientIntensity ?? 1.0,
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
