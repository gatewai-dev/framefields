/**
 * Headless DOMMatrix polyfill (2D subset).
 *
 * Installed onto `globalThis` when the runtime has no native DOMMatrix
 * (Node / headless WebGPU). Must mirror the native constructor surface the
 * renderers rely on — in particular the 2D array form
 * `new DOMMatrix([a, b, c, d, e, f])` that `toDOMMatrix` in the compositor
 * renderer uses to materialize pure `Matrix2D` values.
 *
 * (Regression: the array form was previously ignored, silently producing an
 * identity matrix and dropping every layer transform in headless renders.)
 */
export class HeadlessDOMMatrix {
	a = 1;
	b = 0;
	c = 0;
	d = 1;
	e = 0;
	f = 0;

	constructor(
		init?:
			| HeadlessDOMMatrix
			| number[]
			| {
					a?: number;
					b?: number;
					c?: number;
					d?: number;
					e?: number;
					f?: number;
			  },
	) {
		this.a = 1;
		this.b = 0;
		this.c = 0;
		this.d = 1;
		this.e = 0;
		this.f = 0;

		if (init instanceof HeadlessDOMMatrix) {
			this.a = init.a;
			this.b = init.b;
			this.c = init.c;
			this.d = init.d;
			this.e = init.e;
			this.f = init.f;
		} else if (Array.isArray(init)) {
			// 2D array form [a, b, c, d, e, f] (spec). The 4x4 array form
			// [m11..m44] collapses to its 2D members for compat.
			if (init.length === 6) {
				this.a = init[0];
				this.b = init[1];
				this.c = init[2];
				this.d = init[3];
				this.e = init[4];
				this.f = init[5];
			} else if (init.length === 16) {
				this.a = init[0];
				this.b = init[1];
				this.c = init[4];
				this.d = init[5];
				this.e = init[12];
				this.f = init[13];
			}
		} else if (init && typeof init === "object") {
			// Plain { a, b, c, d, e, f } — the pure Matrix2D shape.
			this.a = init.a ?? 1;
			this.b = init.b ?? 0;
			this.c = init.c ?? 0;
			this.d = init.d ?? 1;
			this.e = init.e ?? 0;
			this.f = init.f ?? 0;
		}
	}

	multiply(other: HeadlessDOMMatrix): HeadlessDOMMatrix {
		const m = new HeadlessDOMMatrix();
		m.a = this.a * other.a + this.c * other.b;
		m.b = this.b * other.a + this.d * other.b;
		m.c = this.a * other.c + this.c * other.d;
		m.d = this.b * other.c + this.d * other.d;
		m.e = this.a * other.e + this.c * other.f + this.e;
		m.f = this.b * other.e + this.d * other.f + this.f;
		return m;
	}

	inverse(): HeadlessDOMMatrix {
		const det = this.a * this.d - this.b * this.c;
		if (det === 0) throw new Error("Matrix is not invertible");
		const m = new HeadlessDOMMatrix();
		m.a = this.d / det;
		m.b = -this.b / det;
		m.c = -this.c / det;
		m.d = this.a / det;
		m.e = (this.c * this.f - this.d * this.e) / det;
		m.f = (this.b * this.e - this.a * this.f) / det;
		return m;
	}

	transformPoint(point: { x: number; y: number }): {
		x: number;
		y: number;
	} {
		return {
			x: point.x * this.a + point.y * this.c + this.e,
			y: point.x * this.b + point.y * this.d + this.f,
		};
	}

	translate(x: number, y: number): HeadlessDOMMatrix {
		const m = new HeadlessDOMMatrix();
		m.e = x;
		m.f = y;
		return this.multiply(m);
	}

	scale(sx: number, sy?: number): HeadlessDOMMatrix {
		const m = new HeadlessDOMMatrix();
		m.a = sx;
		m.d = sy ?? sx;
		return this.multiply(m);
	}

	rotate(angle: number): HeadlessDOMMatrix {
		const rad = (angle * Math.PI) / 180;
		const cos = Math.cos(rad);
		const sin = Math.sin(rad);
		const m = new HeadlessDOMMatrix();
		m.a = cos;
		m.b = sin;
		m.c = -sin;
		m.d = cos;
		return this.multiply(m);
	}
}

export type HeadlessDOMMatrixLike = HeadlessDOMMatrix;
