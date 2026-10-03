/**
 * IEEE 754 half-precision (float16) bitwise converter and encoder.
 */

/**
 * Converts a 32-bit floating point number to a 16-bit half-precision float bit pattern (IEEE 754).
 */
export function float32ToFloat16Bits(val: number): number {
	const f = new Float32Array([val]);
	const u = new Uint32Array(f.buffer)[0]!;
	const sign = (u >>> 16) & 0x8000;
	const exp = ((u >>> 23) & 0xff) - 127 + 15;
	let mant = u & 0x7fffff;

	if (exp <= 0) {
		if (exp < -10) return sign;
		mant = (mant | 0x800000) >> (1 - exp);
		return sign | ((mant + 0x1000) >> 13);
	} else if (exp >= 31) {
		return sign | 0x7c00;
	}
	return sign | (exp << 10) | ((mant + 0x1000) >> 13);
}

/**
 * Packs a Float32Array (or array of numbers) into a Uint16Array containing IEEE 754 half-precision floats.
 * Uses native Float16Array if supported by the runtime engine, otherwise falls back to bitwise conversion.
 */
export function encodeFloat32ToFloat16(
	f32Array: ArrayLike<number>,
): Uint16Array {
	if (typeof Float16Array !== "undefined") {
		return new Uint16Array(new Float16Array(f32Array).buffer);
	}
	const len = f32Array.length;
	const out = new Uint16Array(len);
	for (let i = 0; i < len; i++) {
		out[i] = float32ToFloat16Bits(f32Array[i]!);
	}
	return out;
}
