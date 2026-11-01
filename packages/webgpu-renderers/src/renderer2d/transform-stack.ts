/**
 * Target pixels per local unit along the axis `m` stretches most: what a
 * raster drawn under `m` needs per unit to stay sharp, and what one target
 * pixel is in local units (its inverse).
 */
export function transformScale(m: {
	a: number;
	b: number;
	c: number;
	d: number;
}): number {
	return Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d));
}

export class TransformStack {
	private stack: DOMMatrix[] = [new DOMMatrix()];

	push(matrix: DOMMatrix): void {
		const current = this.stack[this.stack.length - 1];
		const next = current.multiply(matrix);
		this.stack.push(next);
	}

	pop(): void {
		if (this.stack.length > 1) {
			this.stack.pop();
		}
	}

	getCurrent(): DOMMatrix {
		return this.stack[this.stack.length - 1];
	}

	packIntoBuffer(
		bufferData: Float32Array,
		opacity: number,
		surfaceWidth: number,
		surfaceHeight: number,
		localOverride?: DOMMatrix,
		customParam?: number,
	): void {
		let m = this.getCurrent();
		if (localOverride) {
			m = m.multiply(localOverride);
		}

		bufferData[0] = m.a;
		bufferData[1] = m.b;
		bufferData[2] = 0;
		bufferData[3] = 0;

		bufferData[4] = m.c;
		bufferData[5] = m.d;
		bufferData[6] = 0;
		bufferData[7] = 0;

		bufferData[8] = m.e;
		bufferData[9] = m.f;
		bufferData[10] = 1;
		bufferData[11] = 0;

		bufferData[12] = opacity;
		bufferData[13] = surfaceWidth;
		bufferData[14] = surfaceHeight;
		bufferData[15] = customParam ?? 0;
	}

	destroy(): void {
		this.stack = [new DOMMatrix()];
	}
}
