/**
 * NumPy `.npy` (format 1.0) and `.npz` (a zip of them): what `numpy.load`
 * reads, and what WebDataset and Hugging Face decode `*.npy` / `*.npz`
 * sample members as. Little-endian, C order.
 */
import { crc32, deflateRawSync } from "node:zlib";

type NpyData = Float32Array | Uint32Array | Uint16Array | Uint8Array;
/** NumPy dtype strings this writer emits. */
export type NpyDtype = "<f4" | "<f2" | "<u4" | "<u2" | "|u1";

function defaultDtype(data: NpyData): NpyDtype {
	if (data instanceof Float32Array) return "<f4";
	if (data instanceof Uint32Array) return "<u4";
	if (data instanceof Uint16Array) return "<u2";
	return "|u1";
}

/**
 * The array `data` with `shape` (its length must be their product) as
 * `.npy` bytes; `dtype` overrides the one its type implies (float16 is
 * stored as `Uint16Array` bits, `"<f2"`).
 */
export function encodeNpy(
	data: NpyData,
	shape: number[],
	dtype: NpyDtype = defaultDtype(data),
): Uint8Array {
	const count = shape.reduce((n, d) => n * d, 1);
	if (count !== data.length)
		throw new Error(
			`encodeNpy: shape ${shape.join("×")} holds ${count} values, the data ${data.length}.`,
		);
	const dims = shape.length === 1 ? `${shape[0]},` : shape.join(", ");
	let header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': (${dims}), }`;
	// Magic (6) + version (2) + length (2) + header, padded to 64 with a newline.
	const unpadded = 10 + header.length + 1;
	header += " ".repeat((64 - (unpadded % 64)) % 64);
	header += "\n";
	const out = new Uint8Array(10 + header.length + data.byteLength);
	out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0], 0);
	new DataView(out.buffer).setUint16(8, header.length, true);
	for (let i = 0; i < header.length; i++) out[10 + i] = header.charCodeAt(i);
	out.set(
		new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
		10 + header.length,
	);
	return out;
}

/** IEEE half-precision bits of each value (round to nearest even). */
export function toFloat16Bits(values: Float32Array): Uint16Array {
	const out = new Uint16Array(values.length);
	const f = new Float32Array(1);
	const u = new Uint32Array(f.buffer);
	for (let i = 0; i < values.length; i++) {
		f[0] = values[i];
		const x = u[0];
		const sign = (x >>> 16) & 0x8000;
		const exp = (x >>> 23) & 0xff;
		let mant = x & 0x7fffff;
		if (exp === 0xff) {
			out[i] = sign | 0x7c00 | (mant ? 0x200 : 0);
			continue;
		}
		const e = exp - 127 + 15;
		if (e >= 31) {
			out[i] = sign | 0x7c00;
		} else if (e <= 0) {
			if (e < -10) {
				out[i] = sign;
				continue;
			}
			mant |= 0x800000;
			const shift = 14 - e;
			const half = mant >>> shift;
			const rest = mant & ((1 << shift) - 1);
			const mid = 1 << (shift - 1);
			out[i] =
				sign | (half + (rest > mid || (rest === mid && half & 1) ? 1 : 0));
		} else {
			const half = (e << 10) | (mant >>> 13);
			const rest = mant & 0x1fff;
			out[i] =
				sign |
				(half + (rest > 0x1000 || (rest === 0x1000 && half & 1) ? 1 : 0));
		}
	}
	return out;
}

/** The smallest unsigned array (8, 16 or 32 bit) that holds every value. */
export function narrowUint(
	values: Uint32Array,
): Uint8Array | Uint16Array | Uint32Array {
	let max = 0;
	for (const v of values) if (v > max) max = v;
	if (max < 256) return Uint8Array.from(values);
	if (max < 65536) return Uint16Array.from(values);
	return values;
}

/** MS-DOS date of 1980-01-01, time 00:00: fixed, so archives are reproducible. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;

/**
 * A `.npz`: deflated zip members `name.npy`, in the given order, with
 * fixed timestamps (the same arrays, the same bytes).
 */
export function encodeNpz(arrays: Array<[string, Uint8Array]>): Uint8Array {
	const locals: Uint8Array[] = [];
	const centrals: Uint8Array[] = [];
	let offset = 0;
	for (const [name, npy] of arrays) {
		const file = new TextEncoder().encode(`${name}.npy`);
		const packed = deflateRawSync(npy, { level: 6 });
		const crc = crc32(npy);
		const local = new Uint8Array(30 + file.length);
		const lv = new DataView(local.buffer);
		lv.setUint32(0, 0x04034b50, true);
		lv.setUint16(4, 20, true); // version needed
		lv.setUint16(8, 8, true); // deflate
		lv.setUint16(12, DOS_DATE, true);
		lv.setUint32(14, crc, true);
		lv.setUint32(18, packed.length, true);
		lv.setUint32(22, npy.length, true);
		lv.setUint16(26, file.length, true);
		local.set(file, 30);
		const central = new Uint8Array(46 + file.length);
		const cv = new DataView(central.buffer);
		cv.setUint32(0, 0x02014b50, true);
		cv.setUint16(4, 20, true); // made by
		cv.setUint16(6, 20, true); // needed
		cv.setUint16(10, 8, true);
		cv.setUint16(14, DOS_DATE, true);
		cv.setUint32(16, crc, true);
		cv.setUint32(20, packed.length, true);
		cv.setUint32(24, npy.length, true);
		cv.setUint16(28, file.length, true);
		cv.setUint32(42, offset, true);
		central.set(file, 46);
		locals.push(local, packed);
		centrals.push(central);
		offset += local.length + packed.length;
	}
	const centralSize = centrals.reduce((n, c) => n + c.length, 0);
	const end = new Uint8Array(22);
	const ev = new DataView(end.buffer);
	ev.setUint32(0, 0x06054b50, true);
	ev.setUint16(8, arrays.length, true);
	ev.setUint16(10, arrays.length, true);
	ev.setUint32(12, centralSize, true);
	ev.setUint32(16, offset, true);
	const parts = [...locals, ...centrals, end];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}
