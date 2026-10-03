import { describe, expect, it } from "vitest";
import {
	buildArrowPath,
	buildCirclePath,
	buildEllipsePath,
	buildPolygonPath,
	buildRectPath,
	buildShapeSvgPath,
	buildStarPath,
	dashPathSegments,
	parseSvgPathToSegments,
	sampleCubicBezier,
	sampleQuadraticBezier,
	triangulatePolygon,
	triangulateShape,
	trimPathSegments,
} from "./path-geometry.js";

describe("path-geometry", () => {
	describe("bezier sampling", () => {
		it("samples cubic bezier into linear segments", () => {
			const p0 = { x: 0, y: 0 };
			const p1 = { x: 0, y: 50 };
			const p2 = { x: 100, y: 50 };
			const p3 = { x: 100, y: 100 };
			const segs = sampleCubicBezier(p0, p1, p2, p3, 10);
			expect(segs.length).toBe(10);
			expect(segs[0].p0).toEqual(p0);
			expect(Math.round(segs[9].p1.x)).toBe(100);
			expect(Math.round(segs[9].p1.y)).toBe(100);
		});

		it("samples quadratic bezier into linear segments", () => {
			const p0 = { x: 0, y: 0 };
			const p1 = { x: 50, y: 100 };
			const p2 = { x: 100, y: 0 };
			const segs = sampleQuadraticBezier(p0, p1, p2, 8);
			expect(segs.length).toBe(8);
			expect(segs[0].p0).toEqual(p0);
			expect(Math.round(segs[7].p1.x)).toBe(100);
			expect(Math.round(segs[7].p1.y)).toBe(0);
		});
	});

	describe("parseSvgPathToSegments", () => {
		it("parses linear M L and Z commands", () => {
			const d = "M 0 0 L 100 0 L 100 100 Z";
			const segs = parseSvgPathToSegments(d);
			expect(segs.length).toBe(3);
			expect(segs[0]).toEqual({ p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } });
			expect(segs[1]).toEqual({ p0: { x: 100, y: 0 }, p1: { x: 100, y: 100 } });
			expect(segs[2]).toEqual({ p0: { x: 100, y: 100 }, p1: { x: 0, y: 0 } });
		});

		it("parses H and V commands", () => {
			const d = "M 10 10 H 60 V 80";
			const segs = parseSvgPathToSegments(d);
			expect(segs.length).toBe(2);
			expect(segs[0]).toEqual({ p0: { x: 10, y: 10 }, p1: { x: 60, y: 10 } });
			expect(segs[1]).toEqual({ p0: { x: 60, y: 10 }, p1: { x: 60, y: 80 } });
		});

		it("parses relative commands", () => {
			const d = "m 10 20 l 30 40";
			const segs = parseSvgPathToSegments(d);
			expect(segs.length).toBe(1);
			expect(segs[0]).toEqual({ p0: { x: 10, y: 20 }, p1: { x: 40, y: 60 } });
		});

		it("parses cubic and quadratic curves", () => {
			const d = "M 0 0 C 0 50 100 50 100 100 Q 150 150 200 100";
			const segs = parseSvgPathToSegments(d);
			expect(segs.length).toBeGreaterThan(30);
		});

		it("returns empty array for empty string", () => {
			expect(parseSvgPathToSegments("")).toEqual([]);
		});

		it("parses elliptical arcs into points on the circle", () => {
			// Two half arcs: a full circle of radius 50 around (100, 100).
			const d = "M 100 50 A 50 50 0 1 1 100 150 A 50 50 0 1 1 100 50";
			const segs = parseSvgPathToSegments(d);
			expect(segs.length).toBeGreaterThanOrEqual(64);
			for (const s of segs) {
				expect(Math.hypot(s.p1.x - 100, s.p1.y - 100)).toBeCloseTo(50, 6);
			}
			// Sweep flag 1 runs clockwise on screen: from 12 o'clock through 3 o'clock.
			const quarter = segs[Math.floor(segs.length / 4) - 1].p1;
			expect(quarter.x).toBeCloseTo(150, 0);
			expect(segs[segs.length - 1].p1).toEqual({ x: 100, y: 50 });
		});

		it("scales arc radii up when they cannot span the endpoints", () => {
			const segs = parseSvgPathToSegments("M 0 0 a 10 10 0 0 1 100 0");
			for (const s of segs) {
				expect(Math.hypot(s.p1.x - 50, s.p1.y)).toBeCloseTo(50, 6);
			}
			// Sweep 1 from (0,0) to (100,0) bulges upward (negative y) on screen.
			expect(segs[Math.floor(segs.length / 2)].p1.y).toBeLessThan(-45);
		});
	});

	describe("trimPathSegments", () => {
		const box = [
			{ p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } },
			{ p0: { x: 100, y: 0 }, p1: { x: 100, y: 100 } },
			{ p0: { x: 100, y: 100 }, p1: { x: 0, y: 100 } },
			{ p0: { x: 0, y: 100 }, p1: { x: 0, y: 0 } },
		]; // Total perimeter = 400

		it("returns full path when trimStart=0 and trimEnd=1", () => {
			const trimmed = trimPathSegments(box, 0, 1, 0);
			expect(trimmed.length).toBe(4);
		});

		it("trims the first half of a path [0, 0.5]", () => {
			const trimmed = trimPathSegments(box, 0, 0.5, 0);
			// 0.5 * 400 = 200 length -> first 2 segments
			expect(trimmed.length).toBe(2);
			expect(trimmed[0].p0).toEqual({ x: 0, y: 0 });
			expect(trimmed[1].p1).toEqual({ x: 100, y: 100 });
		});

		it("trims intermediate range [0.25, 0.75]", () => {
			const trimmed = trimPathSegments(box, 0.25, 0.75, 0);
			// Distance 100 to 300 -> segments 1 and 2
			expect(trimmed.length).toBe(2);
			expect(trimmed[0].p0).toEqual({ x: 100, y: 0 });
			expect(trimmed[1].p1).toEqual({ x: 0, y: 100 });
		});

		it("handles wrapping trim where trimStart > trimEnd", () => {
			// [0.75, 0.25]: from 300 to 400 + from 0 to 100
			const trimmed = trimPathSegments(box, 0.75, 0.25, 0);
			expect(trimmed.length).toBe(2);
			expect(trimmed[0].p0).toEqual({ x: 0, y: 100 });
			expect(trimmed[0].p1).toEqual({ x: 0, y: 0 });
			expect(trimmed[1].p0).toEqual({ x: 0, y: 0 });
			expect(trimmed[1].p1).toEqual({ x: 100, y: 0 });
		});

		it("returns empty when trimStart == trimEnd", () => {
			const trimmed = trimPathSegments(box, 0.5, 0.5, 0);
			expect(trimmed.length).toBe(0);
		});

		it("applies trimOffset", () => {
			// Offset by 90 degrees (0.25)
			const trimmed = trimPathSegments(box, 0, 0.25, 90);
			// Becomes [0.25, 0.5]
			expect(trimmed.length).toBe(1);
			expect(trimmed[0].p0).toEqual({ x: 100, y: 0 });
			expect(trimmed[0].p1).toEqual({ x: 100, y: 100 });
		});
	});

	describe("dashPathSegments", () => {
		const line = [{ p0: { x: 0, y: 0 }, p1: { x: 100, y: 0 } }];

		it("applies regular dash array", () => {
			const dashed = dashPathSegments(line, [20, 20]);
			// 0..20 (draw), 20..40 (gap), 40..60 (draw), 60..80 (gap), 80..100 (draw) -> 3 dashes
			expect(dashed.length).toBe(3);
			expect(dashed[0].p0.x).toBeCloseTo(0);
			expect(dashed[0].p1.x).toBeCloseTo(20);
			expect(dashed[1].p0.x).toBeCloseTo(40);
			expect(dashed[1].p1.x).toBeCloseTo(60);
			expect(dashed[2].p0.x).toBeCloseTo(80);
			expect(dashed[2].p1.x).toBeCloseTo(100);
		});
	});

	describe("parametric shape builders", () => {
		it("builds unrounded rect path", () => {
			const p = buildRectPath(200, 100);
			expect(p).toBe("M 0 0 L 200 0 L 200 100 L 0 100 Z");
		});

		it("builds rounded rect path", () => {
			const p = buildRectPath(200, 100, 10, 10, 10, 10);
			expect(p).toContain("Q");
			expect(p).toContain("Z");
		});

		it("builds circle path", () => {
			const p = buildCirclePath(100, 100);
			expect(p).toContain("C");
			expect(p).toContain("Z");
		});

		it("builds ellipse path", () => {
			const p = buildEllipsePath(200, 100);
			expect(p).toContain("C");
			expect(p).toContain("Z");
		});

		it("builds polygon path", () => {
			const p = buildPolygonPath(100, 100, 6);
			expect(p).toContain("M");
			expect(p).toContain("L");
			expect(p).toContain("Z");
		});

		it("builds star path", () => {
			const p = buildStarPath(100, 100, 5, 0.5);
			expect(p).toContain("M");
			expect(p).toContain("L");
			expect(p).toContain("Z");
		});

		it("builds arrow path", () => {
			const p = buildArrowPath(100, 50);
			expect(p).toContain("M");
			expect(p).toContain("L");
			expect(p).toContain("Z");
		});

		it("buildShapeSvgPath handles each shape type", () => {
			expect(
				buildShapeSvgPath({ shapeType: "rect", width: 10, height: 10 }),
			).toContain("M 0 0");
			expect(
				buildShapeSvgPath({ shapeType: "circle", width: 10, height: 10 }),
			).toContain("C");
			expect(
				buildShapeSvgPath({ shapeType: "star", width: 10, height: 10 }),
			).toContain("L");
			expect(
				buildShapeSvgPath({
					shapeType: "path",
					width: 10,
					height: 10,
					path: "M 0 0 Z",
				}),
			).toBe("M 0 0 Z");
		});
	});

	describe("triangulation", () => {
		it("triangulates simple polygon with ear clipping", () => {
			const quad = [
				{ x: 0, y: 0 },
				{ x: 100, y: 0 },
				{ x: 100, y: 100 },
				{ x: 0, y: 100 },
			];
			const tris = triangulatePolygon(quad);
			// 4-vertex polygon yields 2 triangles (6 points)
			expect(tris.length).toBe(6);
		});

		it("triangulates shapes into float arrays", () => {
			const rectTris = triangulateShape({
				shapeType: "rect",
				width: 100,
				height: 50,
			});
			// 2 triangles * 3 vertices * 2 coords = 12 floats
			expect(rectTris.length).toBe(12);

			const circleTris = triangulateShape({
				shapeType: "circle",
				width: 100,
				height: 100,
			});
			expect(circleTris.length).toBe(48 * 3 * 2);

			const starTris = triangulateShape({
				shapeType: "star",
				width: 100,
				height: 100,
				starPoints: 5,
			});
			expect(starTris.length).toBe(10 * 3 * 2);

			const arrowTris = triangulateShape({
				shapeType: "arrow",
				width: 100,
				height: 50,
			});
			// 3 triangles * 3 vertices * 2 coords = 18 floats
			expect(arrowTris.length).toBe(18);
		});
	});
});
