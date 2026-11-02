/**
 * Filling compound paths: every subpath is a contour, contours nest, and a
 * region is filled by SVG's nonzero rule (the windings of the contours
 * around it, summed, are not zero). Each filled contour is triangulated with
 * its direct children as holes, so a map's coastlines and islands, a
 * letter's counter or a ring fill as drawn instead of being bridged into
 * one polygon.
 *
 * Contours are taken not to cross each other (each pair is nested or
 * apart), which holds for maps, glyphs and icons; a contour that crosses
 * itself is still triangulated as well as earcut can.
 */
import earcut from "earcut";
import type { Point } from "./path-geometry.js";

interface Contour {
	points: Point[];
	/** Signed area: its sign is the winding direction. */
	area: number;
	box: { x0: number; y0: number; x1: number; y1: number };
	/** A point strictly inside, for containment (a vertex may lie on a neighbour's edge). */
	inside: Point;
	parent: number;
	winding: number;
}

export function signedArea(points: readonly Point[]): number {
	let area = 0;
	for (let i = 0; i < points.length; i++) {
		const a = points[i] as Point;
		const b = points[(i + 1) % points.length] as Point;
		area += a.x * b.y - b.x * a.y;
	}
	return area / 2;
}

function flat(points: readonly Point[]): number[] {
	const out: number[] = [];
	for (const p of points) out.push(p.x, p.y);
	return out;
}

function boxOf(points: readonly Point[]): Contour["box"] {
	const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	for (const p of points) {
		box.x0 = Math.min(box.x0, p.x);
		box.y0 = Math.min(box.y0, p.y);
		box.x1 = Math.max(box.x1, p.x);
		box.y1 = Math.max(box.y1, p.y);
	}
	return box;
}

/** The centroid of the contour's largest triangle: inside it, away from its edges. */
function insidePoint(points: readonly Point[]): Point {
	const coords = flat(points);
	const tris = earcut(coords);
	const at = (k: number): Point => ({
		x: coords[k * 2] as number,
		y: coords[k * 2 + 1] as number,
	});
	let best = -1;
	let inside = points[0] as Point;
	for (let i = 0; i < tris.length; i += 3) {
		const a = at(tris[i] as number);
		const b = at(tris[i + 1] as number);
		const c = at(tris[i + 2] as number);
		const size = Math.abs(
			(b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y),
		);
		if (size > best) {
			best = size;
			inside = { x: (a.x + b.x + c.x) / 3, y: (a.y + b.y + c.y) / 3 };
		}
	}
	return inside;
}

function contains(points: readonly Point[], p: Point): boolean {
	let inside = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i] as Point;
		const b = points[j] as Point;
		if (
			a.y > p.y !== b.y > p.y &&
			p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
		)
			inside = !inside;
	}
	return inside;
}

const encloses = (p: Contour, c: Contour) =>
	p.box.x0 <= c.box.x0 &&
	p.box.y0 <= c.box.y0 &&
	p.box.x1 >= c.box.x1 &&
	p.box.y1 >= c.box.y1 &&
	contains(p.points, c.inside);

/** Triangles filling closed `contours` by the nonzero rule, as flat [x, y, …] vertices. */
export function fillContours(contours: readonly Point[][]): Float32Array {
	const all: Contour[] = contours.map((points) => ({
		points,
		area: signedArea(points),
		box: boxOf(points),
		inside: insidePoint(points),
		parent: -1,
		winding: 0,
	}));
	// Largest first, so a contour's parent has its winding before it is reached.
	const order = all
		.map((_, i) => i)
		.sort(
			(a, b) =>
				Math.abs((all[b] as Contour).area) - Math.abs((all[a] as Contour).area),
		);
	order.forEach((ci, rank) => {
		const c = all[ci] as Contour;
		// Its parent is the smallest larger contour around it.
		for (let r = rank - 1; r >= 0; r--) {
			const pi = order[r] as number;
			if (encloses(all[pi] as Contour, c)) {
				c.parent = pi;
				break;
			}
		}
		const around = c.parent >= 0 ? (all[c.parent] as Contour).winding : 0;
		c.winding = around + Math.sign(c.area);
	});

	const out: number[] = [];
	all.forEach((c, ci) => {
		if (c.winding === 0) return;
		const coords = flat(c.points);
		const holeStarts: number[] = [];
		for (const h of all) {
			if (h.parent !== ci) continue;
			holeStarts.push(coords.length / 2);
			for (const p of h.points) coords.push(p.x, p.y);
		}
		for (const k of earcut(coords, holeStarts))
			out.push(coords[k * 2] as number, coords[k * 2 + 1] as number);
	});
	return new Float32Array(out);
}
