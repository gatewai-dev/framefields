import type { SlugCodePoint, SlugFont } from "./slug-loader.js";

export interface FontkitGlyph {
	codePoints: number[];
	advanceWidth: number;
	bbox: {
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	};
	path: {
		commands: Array<{
			command:
				| "moveTo"
				| "lineTo"
				| "quadraticCurveTo"
				| "bezierCurveTo"
				| "closePath";
			args: number[];
		}>;
	};
}

export interface FontkitFont {
	numGlyphs: number;
	getGlyph?(id: number): FontkitGlyph;
	glyphForCodePoint?(codePoint: number): FontkitGlyph;
	characterSet: number[] | Iterable<number>;
	ascent: number;
	descent: number;
	lineGap: number;
	unitsPerEm: number;
	variationAxes?: Record<string, unknown>;
	getVariation?(settings: Record<string, number>): FontkitFont;
	/** Shapes a string (kerning, ligatures); fontkit fonts always have it. */
	layout?(text: string): {
		glyphs: unknown[];
		positions: Array<{ xAdvance: number }>;
	};
}

const TEXTURE_WIDTH = 4096;
const SLUGGISH_HEADER_DATA = "SLUGGISH";

export interface SlugGeneratorOptions {
	bandCount?: number;
	fullRange?: boolean;
	whitelist?: number[] | null;
	strokeWidth?: number;
}

export interface SlugGeneratorOutput extends SlugFont {
	_raw: {
		codePoints: SlugCodePoint[];
		curvesList: number[];
		bandOffsets: number[];
		curveOffsets: number[];
		metrics: {
			ascender: number;
			descender: number;
			lineGap: number;
			unitsPerEm: number;
		};
	};
}

interface TempCurve {
	first: boolean;
	x1: number;
	y1: number;
	x2: number;
	y2: number;
	x3: number;
	y3: number;
	texelIndex?: number;
}

interface Point {
	x: number;
	y: number;
}

function getContours(commands: any[]): Point[][] {
	const contours: Point[][] = [];
	let currentContour: Point[] = [];
	let cx = 0;
	let cy = 0;

	for (const cmd of commands) {
		const type = cmd.command || cmd.type;
		const args = cmd.args || [];

		if (type === "moveTo") {
			if (currentContour.length > 0) {
				contours.push(currentContour);
			}
			cx = args.length >= 2 ? args[0] : (cmd.x ?? 0);
			cy = args.length >= 2 ? args[1] : (cmd.y ?? 0);
			currentContour = [{ x: cx, y: cy }];
		} else if (type === "lineTo") {
			const x = args.length >= 2 ? args[0] : (cmd.x ?? 0);
			const y = args.length >= 2 ? args[1] : (cmd.y ?? 0);
			cx = x;
			cy = y;
			currentContour.push({ x: cx, y: cy });
		} else if (type === "quadraticCurveTo") {
			const cpx = args.length >= 4 ? args[0] : (cmd.cpx ?? cmd.x1 ?? 0);
			const cpy = args.length >= 4 ? args[1] : (cmd.cpy ?? cmd.y1 ?? 0);
			const x = args.length >= 4 ? args[2] : (cmd.x ?? 0);
			const y = args.length >= 4 ? args[3] : (cmd.y ?? 0);

			// Subdivide quadratic curve into 4 segments
			const steps = 4;
			const p0x = cx;
			const p0y = cy;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const mt = 1.0 - t;
				const x_t = mt * mt * p0x + 2.0 * mt * t * cpx + t * t * x;
				const y_t = mt * mt * p0y + 2.0 * mt * t * cpy + t * t * y;
				currentContour.push({ x: x_t, y: y_t });
			}
			cx = x;
			cy = y;
		} else if (type === "bezierCurveTo") {
			const cp1x = args.length >= 6 ? args[0] : (cmd.cp1x ?? 0);
			const cp1y = args.length >= 6 ? args[1] : (cmd.cp1y ?? 0);
			const cp2x = args.length >= 6 ? args[2] : (cmd.cp2x ?? 0);
			const cp2y = args.length >= 6 ? args[3] : (cmd.cp2y ?? 0);
			const x = args.length >= 6 ? args[4] : (cmd.x ?? 0);
			const y = args.length >= 6 ? args[5] : (cmd.y ?? 0);

			// Subdivide cubic curve into 6 segments
			const steps = 6;
			const p0x = cx;
			const p0y = cy;
			for (let i = 1; i <= steps; i++) {
				const t = i / steps;
				const mt = 1.0 - t;
				const mt2 = mt * mt;
				const mt3 = mt2 * mt;
				const t2 = t * t;
				const t3 = t2 * t;
				const x_t =
					mt3 * p0x + 3.0 * mt2 * t * cp1x + 3.0 * mt * t2 * cp2x + t3 * x;
				const y_t =
					mt3 * p0y + 3.0 * mt2 * t * cp1y + 3.0 * mt * t2 * cp2y + t3 * y;
				currentContour.push({ x: x_t, y: y_t });
			}
			cx = x;
			cy = y;
		}
	}
	if (currentContour.length > 0) {
		contours.push(currentContour);
	}
	return contours;
}

function cleanPolygon(poly: Point[]): Point[] {
	if (poly.length < 3) return poly;

	// 1. Remove duplicate or extremely close points
	const noDuplicates: Point[] = [];
	for (const pt of poly) {
		if (noDuplicates.length === 0) {
			noDuplicates.push(pt);
		} else {
			const prev = noDuplicates[noDuplicates.length - 1];
			const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
			if (dist > 1e-2) {
				noDuplicates.push(pt);
			}
		}
	}

	// Check if last point is close to first point
	if (noDuplicates.length >= 3) {
		const first = noDuplicates[0];
		const last = noDuplicates[noDuplicates.length - 1];
		if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-2) {
			noDuplicates.pop();
		}
	}

	if (noDuplicates.length < 3) return noDuplicates;

	// 2. Remove collinear points
	const cleaned: Point[] = [];
	const n = noDuplicates.length;
	for (let i = 0; i < n; i++) {
		const prev = noDuplicates[(i - 1 + n) % n];
		const curr = noDuplicates[i];
		const next = noDuplicates[(i + 1) % n];

		const dx1 = curr.x - prev.x;
		const dy1 = curr.y - prev.y;
		const len1 = Math.hypot(dx1, dy1);

		const dx2 = next.x - curr.x;
		const dy2 = next.y - curr.y;
		const len2 = Math.hypot(dx2, dy2);

		if (len1 < 1e-5 || len2 < 1e-5) {
			continue;
		}

		// cross product: dx1 * dy2 - dy1 * dx2
		const cross = dx1 * dy2 - dy1 * dx2;
		const sinTheta = Math.abs(cross) / (len1 * len2);

		// If the vectors are almost collinear (sine of angle < 1e-4), skip the middle point
		if (sinTheta < 1e-4) {
			continue;
		}

		cleaned.push(curr);
	}

	return cleaned;
}

function getSignedArea(poly: Point[]): number {
	let area = 0;
	const n = poly.length;
	if (n < 3) return 0;
	for (let i = 0; i < n; i++) {
		const curr = poly[i];
		const next = poly[(i + 1) % n];
		area += curr.x * next.y - next.x * curr.y;
	}
	return area * 0.5;
}

function isPointInPolygon(pt: Point, poly: Point[]): boolean {
	let inside = false;
	const n = poly.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const pi = poly[i];
		const pj = poly[j];
		const intersect =
			pi.y > pt.y !== pj.y > pt.y &&
			pt.x < ((pj.x - pi.x) * (pt.y - pi.y)) / (pj.y - pi.y) + pi.x;
		if (intersect) inside = !inside;
	}
	return inside;
}

function offsetPolygon(poly: Point[], d: number): Point[] {
	const n = poly.length;
	if (n < 3) return poly;
	const offsetPoly: Point[] = [];

	for (let i = 0; i < n; i++) {
		const prev = poly[(i - 1 + n) % n];
		const curr = poly[i];
		const next = poly[(i + 1) % n];

		const v1x = curr.x - prev.x;
		const v1y = curr.y - prev.y;
		const len1 = Math.sqrt(v1x * v1x + v1y * v1y);

		const v2x = next.x - curr.x;
		const v2y = next.y - curr.y;
		const len2 = Math.sqrt(v2x * v2x + v2y * v2y);

		if (len1 < 1e-6 || len2 < 1e-6) {
			offsetPoly.push({ x: curr.x, y: curr.y });
			continue;
		}

		const u1x = v1x / len1;
		const u1y = v1y / len1;
		const u2x = v2x / len2;
		const u2y = v2y / len2;

		const n1x = -u1y;
		const n1y = u1x;

		const n2x = -u2y;
		const n2y = u2x;

		const nx = n1x + n2x;
		const ny = n1y + n2y;
		const lenN = Math.sqrt(nx * nx + ny * ny);

		let unx = n1x;
		let uny = n1y;

		if (lenN > 1e-6) {
			unx = nx / lenN;
			uny = ny / lenN;
		} else {
			// Fallback for sharp 180-degree corners:
			// The outward normal points in the direction of the incoming edge u1.
			unx = u1x;
			uny = u1y;
		}

		const dotU = u1x * u2x + u1y * u2y;
		const cosHalfTheta = Math.sqrt(Math.max(0.0, (1.0 + dotU) * 0.5));

		let dist = d;
		if (cosHalfTheta > 0.05) {
			dist = d / cosHalfTheta;
		}
		dist = Math.min(dist, d * 4.0);

		offsetPoly.push({
			x: curr.x + unx * dist,
			y: curr.y + uny * dist,
		});
	}

	return offsetPoly;
}

function isBBoxContained(polyA: Point[], polyB: Point[]): boolean {
	let minXA = Infinity,
		maxXA = -Infinity,
		minYA = Infinity,
		maxYA = -Infinity;
	for (const p of polyA) {
		if (p.x < minXA) minXA = p.x;
		if (p.x > maxXA) maxXA = p.x;
		if (p.y < minYA) minYA = p.y;
		if (p.y > maxYA) maxYA = p.y;
	}
	let minXB = Infinity,
		maxXB = -Infinity,
		minYB = Infinity,
		maxYB = -Infinity;
	for (const p of polyB) {
		if (p.x < minXB) minXB = p.x;
		if (p.x > maxXB) maxXB = p.x;
		if (p.y < minYB) minYB = p.y;
		if (p.y > maxYB) maxYB = p.y;
	}
	return minXA >= minXB && maxXA <= maxXB && minYA >= minYB && maxYA <= maxYB;
}

function offsetGlyphPath(
	path: FontkitGlyph["path"],
	strokeOffset: number,
): FontkitGlyph["path"] {
	if (!path || !path.commands || path.commands.length === 0) return path;

	const rawContours = getContours(path.commands);
	const polygons = rawContours.map(cleanPolygon).filter((p) => p.length >= 3);
	const n = polygons.length;
	if (n === 0) return path;

	const nestingLevels = new Array(n).fill(0);
	for (let i = 0; i < n; i++) {
		const polyA = polygons[i];
		const pt = polyA[0];
		for (let j = 0; j < n; j++) {
			if (i === j) continue;
			if (
				isBBoxContained(polyA, polygons[j]) &&
				isPointInPolygon(pt, polygons[j])
			) {
				nestingLevels[i]++;
			}
		}
	}

	for (let i = 0; i < n; i++) {
		const poly = polygons[i];
		const area = getSignedArea(poly);
		const shouldBeClockwise = nestingLevels[i] % 2 === 0;
		if (shouldBeClockwise && area > 0) {
			poly.reverse();
		} else if (!shouldBeClockwise && area < 0) {
			poly.reverse();
		}
	}

	const offsetPolys = polygons.map((p) => offsetPolygon(p, strokeOffset));

	const commands: any[] = [];
	for (const poly of offsetPolys) {
		if (poly.length === 0) continue;
		commands.push({
			command: "moveTo",
			args: [poly[0].x, poly[0].y],
		});
		for (let i = 1; i < poly.length; i++) {
			commands.push({
				command: "lineTo",
				args: [poly[i].x, poly[i].y],
			});
		}
		commands.push({
			command: "closePath",
			args: [],
		});
	}
	return { commands };
}

export class SlugGenerator {
	private bandCount = 16;
	private fullRange = false;
	private whitelist: number[] | null = null;
	private strokeWidth?: number;

	constructor(options: SlugGeneratorOptions = {}) {
		this.bandCount = options.bandCount !== undefined ? options.bandCount : 16;
		this.fullRange =
			options.fullRange !== undefined ? options.fullRange : false;
		this.whitelist = options.whitelist || null;
		this.strokeWidth = options.strokeWidth;
	}

	generate(device: GPUDevice | null, font: FontkitFont): SlugGeneratorOutput {
		if (!font) {
			throw new Error(
				"[SlugGenerator] Cannot generate slug font: font is null or undefined",
			);
		}
		const curvesTexData: number[] = [];
		const bandsTexBandOffsets: number[] = [];
		const bandsTexCurveOffsets: number[] = [];
		const codePointsData: SlugCodePoint[] = [];

		const charSet = Array.isArray(font.characterSet)
			? font.characterSet
			: Array.from(font.characterSet || []);
		const charSetSet = new Set(charSet);

		const getGlyphFn =
			typeof font.getGlyph === "function"
				? font.getGlyph.bind(font)
				: typeof font.glyphForCodePoint === "function"
					? font.glyphForCodePoint.bind(font)
					: null;
		const glyphForCodePointFn =
			typeof font.glyphForCodePoint === "function"
				? font.glyphForCodePoint.bind(font)
				: typeof font.getGlyph === "function"
					? font.getGlyph.bind(font)
					: null;

		const codePointsToProcess: number[] = [-1]; // Start with .notdef fallback
		if (this.fullRange) {
			for (const cp of charSet) {
				if (cp !== -1) {
					codePointsToProcess.push(cp);
				}
			}
		} else {
			if (this.whitelist) {
				for (const cp of this.whitelist) {
					if (charSetSet.has(cp)) {
						codePointsToProcess.push(cp);
					}
				}
			} else {
				for (const cp of charSet) {
					if (cp === -1) continue;
					if (
						(cp >= 32 && cp <= 126) || // ASCII Printable
						(cp >= 160 && cp <= 255) || // Latin-1 Supplement (é, ü, ©, ®, etc.)
						(cp >= 0x0100 && cp <= 0x024f) || // Latin Extended-A & B
						(cp >= 0x2000 && cp <= 0x206f) || // General Punctuation (• bullet U+2022, —, –, ‘, ’, “, ”, …, etc.)
						(cp >= 0x20a0 && cp <= 0x20cf) || // Currency Symbols (€, £, etc.)
						(cp >= 0x2100 && cp <= 0x214f) || // Letterlike Symbols (™, etc.)
						(cp >= 0x2190 && cp <= 0x21ff) || // Arrows (←, ↑, →, ↓, etc.)
						(cp >= 0x2200 && cp <= 0x22ff) || // Mathematical Operators (≠, ≤, ≥, etc.)
						(cp >= 0x2600 && cp <= 0x27bf) // Misc Symbols & Dingbats (✦, ★, ⚡, etc.)
					) {
						codePointsToProcess.push(cp);
					}
				}
			}
		}

		for (const cp of codePointsToProcess) {
			let glyph: FontkitGlyph | null = null;
			try {
				glyph =
					cp === -1
						? getGlyphFn
							? getGlyphFn(0)
							: null
						: glyphForCodePointFn
							? glyphForCodePointFn(cp)
							: null;
			} catch {
				continue;
			}
			if (!glyph) {
				continue;
			}

			let path: any;
			let bbox: any;
			let advanceWidth = 0;
			try {
				path = glyph.path;
				bbox = glyph.bbox;
				try {
					advanceWidth = Math.floor(glyph.advanceWidth || 0);
				} catch {
					advanceWidth = 0;
				}
			} catch {
				continue;
			}

			if (
				!bbox ||
				bbox.minX === bbox.maxX ||
				bbox.minY === bbox.maxY ||
				bbox.minX === Infinity ||
				bbox.minY === Infinity ||
				!path ||
				!path.commands ||
				path.commands.length === 0
			) {
				// Empty glyph (e.g. space) or missing
				codePointsData.push({
					codePoint: cp,
					width: 0,
					height: 0,
					advanceWidth,
					bearingX: 0,
					bearingY: 0,
					bandCount: 0,
					bandDimX: 0,
					bandDimY: 0,
					bandsTexCoordX: 0,
					bandsTexCoordY: 0,
				});
				continue;
			}

			const strokeOffset = this.strokeWidth ? this.strokeWidth / 2 : 0;
			const pathCommands =
				this.strokeWidth && this.strokeWidth > 0
					? offsetGlyphPath(path, strokeOffset)
					: path;

			const gx1 = bbox.minX - strokeOffset;
			const gy1 = bbox.minY - strokeOffset;
			const gx2 = bbox.maxX + strokeOffset;
			const gy2 = bbox.maxY + strokeOffset;

			// 1. Build Temporary Curve List
			const curves: TempCurve[] | null = [];
			let currentX = 0;
			let currentY = 0;
			let firstCurve = false;
			let startOfShapeX = 0;
			let startOfShapeY = 0;

			for (let j = 0; j < pathCommands.commands.length; j++) {
				const cmd = pathCommands.commands[j];
				const commandType = cmd.command || (cmd as any).type;
				const args = cmd.args || [];

				if (commandType === "moveTo") {
					firstCurve = true;
					const x = args.length >= 2 ? args[0] : (cmd as any).x;
					const y = args.length >= 2 ? args[1] : (cmd as any).y;
					currentX = x - gx1;
					currentY = y - gy1;
					startOfShapeX = currentX;
					startOfShapeY = currentY;
				} else if (commandType === "lineTo") {
					const x = args.length >= 2 ? args[0] : (cmd as any).x;
					const y = args.length >= 2 ? args[1] : (cmd as any).y;
					const nextX = x - gx1;
					const nextY = y - gy1;
					const c: TempCurve = {
						first: firstCurve,
						x1: currentX,
						y1: currentY,
						x3: nextX,
						y3: nextY,
						x2: (currentX + nextX) / 2.0,
						y2: (currentY + nextY) / 2.0,
					};
					curves.push(c);
					firstCurve = false;
					currentX = nextX;
					currentY = nextY;
				} else if (commandType === "quadraticCurveTo") {
					const cpx =
						args.length >= 4 ? args[0] : ((cmd as any).cpx ?? (cmd as any).x1);
					const cpy =
						args.length >= 4 ? args[1] : ((cmd as any).cpy ?? (cmd as any).y1);
					const x = args.length >= 4 ? args[2] : (cmd as any).x;
					const y = args.length >= 4 ? args[3] : (cmd as any).y;
					const nextX = x - gx1;
					const nextY = y - gy1;
					const c: TempCurve = {
						first: firstCurve,
						x1: currentX,
						y1: currentY,
						x2: cpx - gx1,
						y2: cpy - gy1,
						x3: nextX,
						y3: nextY,
					};
					curves.push(c);
					firstCurve = false;
					currentX = nextX;
					currentY = nextY;
				} else if (commandType === "bezierCurveTo") {
					const cp1x = args.length >= 6 ? args[0] : (cmd as any).cp1x;
					const cp1y = args.length >= 6 ? args[1] : (cmd as any).cp1y;
					const cp2x = args.length >= 6 ? args[2] : (cmd as any).cp2x;
					const cp2y = args.length >= 6 ? args[3] : (cmd as any).cp2y;
					const x = args.length >= 6 ? args[4] : (cmd as any).x;
					const y = args.length >= 6 ? args[5] : (cmd as any).y;
					const nextX = x - gx1;
					const nextY = y - gy1;

					// Approximate cubic Bezier with 4 quadratic Bezier segments
					const segments = 4;
					let prevX = currentX;
					let prevY = currentY;

					for (let k = 1; k <= segments; k++) {
						const t = k / segments;
						const mt = 1.0 - t;
						const mt2 = mt * mt;
						const mt3 = mt2 * mt;
						const t2 = t * t;
						const t3 = t2 * t;

						const posX =
							mt3 * currentX +
							3.0 * mt2 * t * (cp1x - gx1) +
							3.0 * mt * t2 * (cp2x - gx1) +
							t3 * nextX;
						const posY =
							mt3 * currentY +
							3.0 * mt2 * t * (cp1y - gy1) +
							3.0 * mt * t2 * (cp2y - gy1) +
							t3 * nextY;

						const c: TempCurve = {
							first: firstCurve && k === 1,
							x1: prevX,
							y1: prevY,
							x2: (prevX + posX) / 2.0,
							y2: (prevY + posY) / 2.0,
							x3: posX,
							y3: posY,
						};
						curves.push(c);
						prevX = posX;
						prevY = posY;
					}

					firstCurve = false;
					currentX = nextX;
					currentY = nextY;
				} else if (commandType === "closePath") {
					if (currentX !== startOfShapeX || currentY !== startOfShapeY) {
						const c: TempCurve = {
							first: firstCurve,
							x1: currentX,
							y1: currentY,
							x3: startOfShapeX,
							y3: startOfShapeY,
							x2: (currentX + startOfShapeX) / 2.0,
							y2: (currentY + startOfShapeY) / 2.0,
						};
						curves.push(c);
						firstCurve = false;
					}
					currentX = startOfShapeX;
					currentY = startOfShapeY;
				}
			}

			if (!curves || curves.length === 0) {
				continue;
			}

			// Fix up curves where the control point is one of the endpoints
			for (const c of curves) {
				if (
					(c.x2 === c.x1 && c.y2 === c.y1) ||
					(c.x2 === c.x3 && c.y2 === c.y3)
				) {
					c.x2 = (c.x1 + c.x3) / 2.0;
					c.y2 = (c.y1 + c.y3) / 2.0;
				}
			}

			const bandsTexelIndex = Math.floor(bandsTexBandOffsets.length / 2);

			// 2. Write Curves Texture
			for (const c of curves) {
				if (c.first && curvesTexData.length % 4 !== 0) {
					const toAdd = 4 - (curvesTexData.length % 4);
					for (let k = 0; k < toAdd; k++) {
						curvesTexData.push(-1.0);
					}
				}

				const texelCount = Math.floor(curvesTexData.length / 4);
				const col = texelCount % TEXTURE_WIDTH;
				const newRow = col === TEXTURE_WIDTH - 1;
				if (newRow) {
					const toAdd = 8 - (curvesTexData.length % 4);
					for (let k = 0; k < toAdd; k++) {
						curvesTexData.push(-1.0);
					}
				}

				if (c.first || newRow) {
					c.texelIndex = Math.floor(curvesTexData.length / 4);
					curvesTexData.push(c.x1, c.y1);
				} else {
					c.texelIndex = Math.floor(
						(Math.floor(curvesTexData.length / 2) - 1) / 2,
					);
				}

				curvesTexData.push(c.x2, c.y2);
				curvesTexData.push(c.x3, c.y3);
			}

			const sizeX = 1 + (gx2 - gx1);
			const sizeY = 1 + (gy2 - gy1);
			let bCount = this.bandCount;
			if (sizeX < bCount || sizeY < bCount) {
				bCount = Math.floor(Math.min(sizeX, sizeY) / 2);
				if (bCount < 1) {
					bCount = 1;
				}
			}

			const bandDimY = Math.ceil(sizeY / bCount);
			let bandMinY = 0;
			let bandMaxY = bandDimY;

			// Sort curves by highest Y (max of y1,y2,y3) descending
			curves.sort(
				(a, b) => Math.max(b.x1, b.x2, b.x3) - Math.max(a.x1, a.x2, a.x3),
			);

			for (let b = 0; b < bCount; b++) {
				const bandTexelOffset = Math.floor(bandsTexCurveOffsets.length / 2);
				let curveCount = 0;

				for (const c of curves) {
					if (c.y1 === c.y2 && c.y2 === c.y3) {
						continue; // perfectly horizontal
					}
					const curveMinY = Math.min(c.y1, c.y2, c.y3);
					const curveMaxY = Math.max(c.y1, c.y2, c.y3);
					if (curveMinY > bandMaxY || curveMaxY < bandMinY) {
						continue; // doesn't cross band
					}

					const texelIndex = c.texelIndex ?? 0;
					const curveOffsetX = texelIndex % TEXTURE_WIDTH;
					const curveOffsetY = Math.floor(texelIndex / TEXTURE_WIDTH);
					bandsTexCurveOffsets.push(curveOffsetX, curveOffsetY);
					curveCount++;
				}
				bandsTexBandOffsets.push(curveCount, bandTexelOffset);
				bandMinY += bandDimY;
				bandMaxY += bandDimY;
			}

			// For vertical bands, sort by max Y descending
			const bandDimX = Math.ceil(sizeX / bCount);
			let bandMinX = 0;
			let bandMaxX = bandDimX;

			curves.sort(
				(a, b) => Math.max(b.y1, b.y2, b.y3) - Math.max(a.y1, a.y2, a.y3),
			);

			for (let b = 0; b < bCount; b++) {
				const bandTexelOffset = Math.floor(bandsTexCurveOffsets.length / 2);
				let curveCount = 0;

				for (const c of curves) {
					if (c.x1 === c.x2 && c.x2 === c.x3) {
						continue; // perfectly vertical
					}
					const curveMinX = Math.min(c.x1, c.x2, c.x3);
					const curveMaxX = Math.max(c.x1, c.x2, c.x3);
					if (curveMinX > bandMaxX || curveMaxX < bandMinX) {
						continue; // doesn't cross band
					}

					const texelIndex = c.texelIndex ?? 0;
					const curveOffsetX = texelIndex % TEXTURE_WIDTH;
					const curveOffsetY = Math.floor(texelIndex / TEXTURE_WIDTH);
					bandsTexCurveOffsets.push(curveOffsetX, curveOffsetY);
					curveCount++;
				}
				bandsTexBandOffsets.push(curveCount, bandTexelOffset);
				bandMinX += bandDimX;
				bandMaxX += bandDimX;
			}

			codePointsData.push({
				codePoint: cp,
				width: Math.floor(gx2 - gx1),
				height: Math.floor(gy2 - gy1),
				advanceWidth: Math.floor(glyph.advanceWidth || 0),
				bearingX: Math.floor(gx1),
				bearingY: Math.floor(gy2),
				bandCount: bCount,
				bandDimX,
				bandDimY,
				bandsTexCoordX: bandsTexelIndex % TEXTURE_WIDTH,
				bandsTexCoordY: Math.floor(bandsTexelIndex / TEXTURE_WIDTH),
			});
		}

		// Post-processing
		const bandHeaderTexels = Math.floor(bandsTexBandOffsets.length / 2);
		for (let k = 1; k < bandsTexBandOffsets.length; k += 2) {
			bandsTexBandOffsets[k] += bandHeaderTexels;
		}

		return this.buildOutput(
			device,
			codePointsData,
			curvesTexData,
			bandsTexBandOffsets,
			bandsTexCurveOffsets,
			font,
		);
	}

	private buildOutput(
		device: GPUDevice | null,
		codePoints: SlugCodePoint[],
		curvesList: number[],
		bandOffsets: number[],
		curveOffsets: number[],
		font: FontkitFont,
	): SlugGeneratorOutput {
		const map = new Map<number, SlugCodePoint>();
		for (const cp of codePoints) {
			map.set(cp.codePoint, cp);
		}

		let curvesTex: GPUTexture = null as any;
		let bandsTex: GPUTexture = null as any;

		if (device) {
			const curvesTexels = Math.ceil(curvesList.length / 4);
			const curvesTexHeight = Math.max(
				1,
				Math.ceil(curvesTexels / TEXTURE_WIDTH),
			);

			const curvesFloatArray = new Float32Array(
				TEXTURE_WIDTH * curvesTexHeight * 4,
			);
			curvesFloatArray.fill(-1.0);
			curvesFloatArray.set(curvesList);

			curvesTex = device.createTexture({
				label: "SlugGeneratedCurvesTexture",
				size: [TEXTURE_WIDTH, curvesTexHeight],
				format: "rgba32float",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			device.queue.writeTexture(
				{ texture: curvesTex },
				curvesFloatArray,
				{ bytesPerRow: TEXTURE_WIDTH * 16 },
				[TEXTURE_WIDTH, curvesTexHeight],
			);

			const bandsTexels =
				Math.floor(bandOffsets.length / 2) +
				Math.floor(curveOffsets.length / 2);
			const bandsTexHeight = Math.max(
				1,
				Math.ceil(bandsTexels / TEXTURE_WIDTH),
			);

			const bandsUintArray = new Uint32Array(
				TEXTURE_WIDTH * bandsTexHeight * 2,
			);
			bandsUintArray.set(bandOffsets, 0);
			bandsUintArray.set(curveOffsets, bandOffsets.length);

			bandsTex = device.createTexture({
				label: "SlugGeneratedBandsTexture",
				size: [TEXTURE_WIDTH, bandsTexHeight],
				format: "rg32uint",
				usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
			});
			device.queue.writeTexture(
				{ texture: bandsTex },
				bandsUintArray,
				{ bytesPerRow: TEXTURE_WIDTH * 8 },
				[TEXTURE_WIDTH, bandsTexHeight],
			);
		}

		return {
			codePoints: map,
			curvesTex,
			bandsTex,
			ascender: font.ascent || 0,
			descender: font.descent || 0,
			lineGap: font.lineGap || 0,
			unitsPerEm: font.unitsPerEm || 0,
			_raw: {
				codePoints,
				curvesList,
				bandOffsets,
				curveOffsets,
				metrics: {
					ascender: font.ascent || 0,
					descender: font.descent || 0,
					lineGap: font.lineGap || 0,
					unitsPerEm: font.unitsPerEm || 0,
				},
			},
		};
	}

	exportSluggish(generatedData: SlugGeneratorOutput): ArrayBuffer {
		const { codePoints, curvesList, bandOffsets, curveOffsets } =
			generatedData._raw;

		const curvesTexels = Math.ceil(curvesList.length / 4);
		const curvesTexHeight = Math.ceil(curvesTexels / TEXTURE_WIDTH);
		const curvesFloatArray = new Float32Array(
			TEXTURE_WIDTH * curvesTexHeight * 4,
		);
		curvesFloatArray.fill(0);
		curvesFloatArray.set(curvesList);

		const bandsTexels =
			Math.floor(bandOffsets.length / 2) + Math.floor(curveOffsets.length / 2);
		const bandsTexHeight = Math.ceil(bandsTexels / TEXTURE_WIDTH);
		const bandsUintArray = new Uint32Array(TEXTURE_WIDTH * bandsTexHeight * 2);
		bandsUintArray.set(bandOffsets, 0);
		bandsUintArray.set(curveOffsets, bandOffsets.length);

		const curvesBytes = curvesFloatArray.byteLength;
		const bandsBytes = bandsUintArray.byteLength;
		const metrics = generatedData._raw.metrics;

		const totalBytes =
			8 + 2 + codePoints.length * 40 + 8 + curvesBytes + 8 + bandsBytes + 16;
		const buffer = new ArrayBuffer(totalBytes);
		const view = new DataView(buffer);
		let offset = 0;

		for (let i = 0; i < 8; i++) {
			view.setUint8(offset++, SLUGGISH_HEADER_DATA.charCodeAt(i));
		}

		view.setUint16(offset, codePoints.length, true);
		offset += 2;

		for (const cp of codePoints) {
			view.setUint32(offset, cp.codePoint, true);
			offset += 4;
			view.setUint32(offset, cp.width, true);
			offset += 4;
			view.setUint32(offset, cp.height, true);
			offset += 4;
			view.setUint32(offset, cp.advanceWidth, true);
			offset += 4;
			view.setInt32(offset, cp.bearingX, true);
			offset += 4;
			view.setInt32(offset, cp.bearingY, true);
			offset += 4;
			view.setUint32(offset, cp.bandCount, true);
			offset += 4;
			view.setUint32(offset, cp.bandDimX, true);
			offset += 4;
			view.setUint32(offset, cp.bandDimY, true);
			offset += 4;
			view.setUint16(offset, cp.bandsTexCoordX, true);
			offset += 2;
			view.setUint16(offset, cp.bandsTexCoordY, true);
			offset += 2;
		}

		view.setUint16(offset, TEXTURE_WIDTH, true);
		offset += 2;
		view.setUint16(offset, curvesTexHeight, true);
		offset += 2;
		view.setUint32(offset, curvesBytes, true);
		offset += 4;
		new Uint8Array(buffer).set(new Uint8Array(curvesFloatArray.buffer), offset);
		offset += curvesBytes;

		view.setUint16(offset, TEXTURE_WIDTH, true);
		offset += 2;
		view.setUint16(offset, bandsTexHeight, true);
		offset += 2;
		view.setUint32(offset, bandsBytes, true);
		offset += 4;
		new Uint8Array(buffer).set(new Uint8Array(bandsUintArray.buffer), offset);
		offset += bandsBytes;

		view.setInt32(offset, metrics.ascender || 0, true);
		offset += 4;
		view.setInt32(offset, metrics.descender || 0, true);
		offset += 4;
		view.setInt32(offset, metrics.lineGap || 0, true);
		offset += 4;
		view.setInt32(offset, metrics.unitsPerEm || 0, true);
		offset += 4;

		return buffer;
	}
}
