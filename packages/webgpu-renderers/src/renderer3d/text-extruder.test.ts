import earcut from "earcut";
import { describe, expect, it } from "vitest";
import { type Contour, organizeGlyphPolygons } from "./text-extruder.js";

describe("glyph outlines without skia (browser)", () => {
	// Syne's "V" and "M": one contour each that crosses itself where the
	// strokes overlap (font units, y up).
	const pts = (xs: number[]): Contour =>
		xs.flatMap((_, i) => (i % 2 ? [] : [{ x: xs[i]!, y: xs[i + 1]! }]));
	const V = pts([
		259, 0, 20, 650, 106, 650, 313, 80, 289, 80, 496, 650, 580, 650, 343, 0,
	]);
	const M = pts([
		456, 48, 424, 48, 720, 650, 800, 650, 800, 0, 720, 0, 720, 511, 736, 507,
		480, 0, 400, 0, 144, 506, 160, 510, 160, 0, 80, 0, 80, 650, 160, 650,
	]);

	/** Whether the triangulated front cap covers a point. */
	function covers(contour: Contour, x: number, y: number): boolean {
		const polys = organizeGlyphPolygons({
			contours: [contour],
			simplified: false,
		});
		for (const poly of polys) {
			const coords: number[] = [];
			const holes: number[] = [];
			for (const p of poly.outer) coords.push(p.x, p.y);
			for (const h of poly.holes) {
				holes.push(coords.length / 2);
				for (const p of h) coords.push(p.x, p.y);
			}
			const tri = earcut(coords, holes, 2);
			for (let i = 0; i < tri.length; i += 3) {
				const [a, b, c] = [tri[i]!, tri[i + 1]!, tri[i + 2]!].map((k) => ({
					x: coords[k * 2]!,
					y: coords[k * 2 + 1]!,
				}));
				const s1 = (b!.x - a!.x) * (y - a!.y) - (b!.y - a!.y) * (x - a!.x);
				const s2 = (c!.x - b!.x) * (y - b!.y) - (c!.y - b!.y) * (x - b!.x);
				const s3 = (a!.x - c!.x) * (y - c!.y) - (a!.y - c!.y) * (x - c!.x);
				if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0))
					return true;
			}
		}
		return false;
	}

	it("keeps the notch of a self-crossing V open", () => {
		expect(covers(V, 300, 400)).toBe(false); // inside the notch
		expect(covers(V, 140, 500)).toBe(true); // left stroke
		expect(covers(V, 450, 500)).toBe(true); // right stroke
		expect(covers(V, 300, 30)).toBe(true); // the point
	});

	it("keeps the valleys of a self-crossing M open", () => {
		expect(covers(M, 600, 600)).toBe(false); // right valley
		expect(covers(M, 300, 600)).toBe(false); // left valley
		expect(covers(M, 760, 300)).toBe(true); // right stem
		expect(covers(M, 120, 300)).toBe(true); // left stem
	});
});
