import { describe, expect, it } from "vitest";
import { HeadlessDOMMatrix } from "./dom-matrix.js";

describe("HeadlessDOMMatrix (headless DOMMatrix polyfill)", () => {
	it("defaults to identity", () => {
		const m = new HeadlessDOMMatrix();
		expect({ a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f }).toEqual({
			a: 1,
			b: 0,
			c: 0,
			d: 1,
			e: 0,
			f: 0,
		});
	});

	it("accepts the 2D array form [a, b, c, d, e, f] (used by toDOMMatrix)", () => {
		const m = new HeadlessDOMMatrix([1, 0, 0, 1, 340, 160]);
		expect(m.a).toBe(1);
		expect(m.b).toBe(0);
		expect(m.c).toBe(0);
		expect(m.d).toBe(1);
		expect(m.e).toBe(340);
		expect(m.f).toBe(160);
	});

	it("collapses the 4x4 array form [m11..m44] to its 2D members", () => {
		// m11=2, m12=0, m21=0, m22=2, m41=50, m42=90 — a 2x scale + translate.
		const m = new HeadlessDOMMatrix([
			2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 50, 90, 0, 1,
		]);
		expect(m.a).toBe(2);
		expect(m.d).toBe(2);
		expect(m.e).toBe(50);
		expect(m.f).toBe(90);
	});

	it("copies from another instance", () => {
		const src = new HeadlessDOMMatrix([1, 0, 0, 1, 10, 20]);
		const m = new HeadlessDOMMatrix(src);
		expect(m.e).toBe(10);
		expect(m.f).toBe(20);
	});

	it("accepts a plain { a, b, c, d, e, f } object", () => {
		const m = new HeadlessDOMMatrix({ a: 1, b: 0, c: 0, d: 1, e: 7, f: 9 });
		expect(m.e).toBe(7);
		expect(m.f).toBe(9);
	});

	it("multiply composes in DOMMatrix order (this ∘ other)", () => {
		const t = new HeadlessDOMMatrix().translate(340, 160);
		const s = new HeadlessDOMMatrix().scale(2);
		const m = t.multiply(s);
		// translate(340,160) ∘ scale(2)
		expect(m.a).toBe(2);
		expect(m.d).toBe(2);
		expect(m.e).toBe(340);
		expect(m.f).toBe(160);
	});

	it("transformPoint applies translation", () => {
		const m = new HeadlessDOMMatrix([1, 0, 0, 1, 340, 160]);
		expect(m.transformPoint({ x: 0, y: 0 })).toEqual({ x: 340, y: 160 });
		expect(m.transformPoint({ x: 600, y: 400 })).toEqual({
			x: 940,
			y: 560,
		});
	});

	it("buildLayerMatrix-style chain keeps translation (regression)", () => {
		// Mirrors node-compositor buildLayerMatrix with anchor 0.5, no
		// rotation/scale: translate(x,y) ∘ translate(cx,cy) ∘ translate(-cx,-cy)
		// must reduce to a pure translation, not identity.
		const x = 340;
		const y = 160;
		const cx = 300;
		const cy = 200;
		const m = new HeadlessDOMMatrix()
			.translate(x, y)
			.multiply(new HeadlessDOMMatrix().translate(cx, cy))
			.multiply(new HeadlessDOMMatrix().translate(-cx, -cy));
		expect(m.e).toBe(340);
		expect(m.f).toBe(160);
		expect(m.transformPoint({ x: 0, y: 0 })).toEqual({ x: 340, y: 160 });
	});
});
