import { readFileSync } from "node:fs";
import { isExr, parseExr } from "./exr-loader.js";

export interface DecodedHdrImage {
	width: number;
	height: number;
	/** Linear scene-referred RGBA float32 pixels (`width * height * 4`). */
	data: Float32Array;
}

function readAsciiLine(
	bytes: Uint8Array,
	start: number,
): { line: string; next: number } {
	let i = start;
	while (i < bytes.length && bytes[i] !== 0x0a) {
		i++;
	}
	let end = i;
	if (end > start && bytes[end - 1] === 0x0d) {
		end--;
	}
	let line = "";
	for (let k = start; k < end; k++) {
		line += String.fromCharCode(bytes[k] ?? 0);
	}
	return { line, next: Math.min(bytes.length, i + 1) };
}

function parseHdrHeader(bytes: Uint8Array): {
	width: number;
	height: number;
	offset: number;
} {
	let cursor = 0;
	const first = readAsciiLine(bytes, cursor);
	cursor = first.next;
	if (
		!first.line.startsWith("#?RADIANCE") &&
		!first.line.startsWith("#?RGBE")
	) {
		throw new Error(
			"Invalid Radiance .hdr file: missing #?RADIANCE or #?RGBE signature",
		);
	}

	while (cursor < bytes.length) {
		const { line, next } = readAsciiLine(bytes, cursor);
		cursor = next;
		if (line.trim() === "") break;
	}

	const res = readAsciiLine(bytes, cursor);
	cursor = res.next;
	const match = res.line.trim().match(/^-Y\s+(\d+)\s+\+X\s+(\d+)$/i);
	if (!match) {
		throw new Error(
			`Unsupported Radiance .hdr resolution string: "${res.line}"`,
		);
	}
	const height = Number.parseInt(match[1] ?? "0", 10);
	const width = Number.parseInt(match[2] ?? "0", 10);
	if (width <= 0 || height <= 0) {
		throw new Error(`Invalid Radiance .hdr dimensions: ${width}x${height}`);
	}
	return { width, height, offset: cursor };
}

function decodeRleScanline(
	bytes: Uint8Array,
	startOffset: number,
	width: number,
	scanlineRgbe: Uint8Array,
): number {
	let cursor = startOffset + 4;
	for (let ch = 0; ch < 4; ch++) {
		let x = 0;
		while (x < width) {
			if (cursor >= bytes.length) {
				throw new Error("Truncated RLE scanline in Radiance .hdr file");
			}
			const code = bytes[cursor++] ?? 0;
			if (code > 128) {
				const count = code - 128;
				const val = bytes[cursor++] ?? 0;
				for (let k = 0; k < count && x < width; k++) {
					scanlineRgbe[x * 4 + ch] = val;
					x++;
				}
			} else {
				const count = code;
				for (let k = 0; k < count && x < width; k++) {
					scanlineRgbe[x * 4 + ch] = bytes[cursor++] ?? 0;
					x++;
				}
			}
		}
	}
	return cursor;
}

function rgbeToFloatRgba(
	scanlineRgbe: Uint8Array,
	width: number,
	out: Float32Array,
	rowOffsetFloats: number,
): void {
	for (let x = 0; x < width; x++) {
		const i4 = x * 4;
		const e = scanlineRgbe[i4 + 3] ?? 0;
		const dst = rowOffsetFloats + i4;
		if (e === 0) {
			out[dst] = 0;
			out[dst + 1] = 0;
			out[dst + 2] = 0;
			out[dst + 3] = 1;
		} else {
			const scale = 2 ** (e - 136);
			out[dst] = ((scanlineRgbe[i4] ?? 0) + 0.5) * scale;
			out[dst + 1] = ((scanlineRgbe[i4 + 1] ?? 0) + 0.5) * scale;
			out[dst + 2] = ((scanlineRgbe[i4 + 2] ?? 0) + 0.5) * scale;
			out[dst + 3] = 1;
		}
	}
}

/**
 * Decodes a Radiance `.hdr` (RGBE) binary buffer into linear RGBA float32 radiance.
 */
export function parseHdr(input: Uint8Array | ArrayBuffer): DecodedHdrImage {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const { width, height, offset: startOffset } = parseHdrHeader(bytes);
	const data = new Float32Array(width * height * 4);
	const scanlineRgbe = new Uint8Array(width * 4);
	let cursor = startOffset;

	for (let y = 0; y < height; y++) {
		if (cursor + 4 > bytes.length) {
			throw new Error("Unexpected EOF while reading Radiance .hdr scanline");
		}
		const b0 = bytes[cursor] ?? 0;
		const b1 = bytes[cursor + 1] ?? 0;
		const b2 = bytes[cursor + 2] ?? 0;
		const b3 = bytes[cursor + 3] ?? 0;
		const isAdaptiveRle =
			width >= 8 &&
			width <= 0x7fff &&
			b0 === 2 &&
			b1 === 2 &&
			((b2 << 8) | b3) === width;

		if (isAdaptiveRle) {
			cursor = decodeRleScanline(bytes, cursor, width, scanlineRgbe);
		} else {
			const byteLen = width * 4;
			scanlineRgbe.set(bytes.subarray(cursor, cursor + byteLen));
			cursor += byteLen;
		}
		rgbeToFloatRgba(scanlineRgbe, width, data, y * width * 4);
	}

	return { width, height, data };
}

/**
 * Encodes linear RGB/RGBA float32 pixels into a valid Radiance `.hdr` (RGBE) binary buffer.
 */
export function encodeHdr(
	width: number,
	height: number,
	rgbaOrRgb: Float32Array,
	stride: 3 | 4 = 4,
): Uint8Array {
	const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`;
	const headerBytes = new Uint8Array(header.length);
	for (let i = 0; i < header.length; i++) {
		headerBytes[i] = header.charCodeAt(i);
	}
	const pixelBytes = width * height * 4;
	const out = new Uint8Array(headerBytes.length + pixelBytes);
	out.set(headerBytes, 0);

	let dst = headerBytes.length;
	const count = width * height;
	for (let i = 0; i < count; i++) {
		const src = i * stride;
		const r = Math.max(0, rgbaOrRgb[src] ?? 0);
		const g = Math.max(0, rgbaOrRgb[src + 1] ?? 0);
		const b = Math.max(0, rgbaOrRgb[src + 2] ?? 0);
		const maxComp = Math.max(r, g, b);
		if (maxComp < 1e-32) {
			out[dst] = 0;
			out[dst + 1] = 0;
			out[dst + 2] = 0;
			out[dst + 3] = 0;
		} else {
			const exp = Math.floor(Math.log2(maxComp)) + 1;
			const scale = 2 ** (8 - exp);
			out[dst] = Math.min(255, Math.max(0, Math.floor(r * scale)));
			out[dst + 1] = Math.min(255, Math.max(0, Math.floor(g * scale)));
			out[dst + 2] = Math.min(255, Math.max(0, Math.floor(b * scale)));
			out[dst + 3] = Math.min(255, Math.max(0, exp + 128));
		}
		dst += 4;
	}
	return out;
}

const f32View = new Float32Array(1);
const u32View = new Uint32Array(f32View.buffer);

/** Converts a 32-bit float to IEEE 754 16-bit half-float bits, clamping to max finite half (65504). */
export function float32ToFloat16(val: number): number {
	const clamped = Math.max(
		-65504,
		Math.min(65504, Number.isFinite(val) ? val : 0),
	);
	f32View[0] = clamped;
	const x = u32View[0] ?? 0;
	const sign = (x >>> 16) & 0x8000;
	const exp = ((x >>> 23) & 0xff) - 127 + 15;
	const mant = x & 0x7fffff;
	if (exp <= 0) {
		if (exp < -10) return sign;
		const m = (mant | 0x800000) >>> (1 - exp + 13);
		return sign | m;
	}
	if (exp >= 31) {
		return sign | 0x7bff;
	}
	return sign | (exp << 10) | (mant >>> 13);
}

/** Converts RGBA float32 pixels to `rgba16float` texel bits. */
export function floatRgbaToHalf16(src: Float32Array): Uint16Array {
	const out = new Uint16Array(src.length);
	for (let i = 0; i < src.length; i++) {
		out[i] = float32ToFloat16(src[i] ?? 0);
	}
	return out;
}

/** Halves an equirectangular panorama with horizontal wrap-around filtering. */
export function downsampleEquirect(image: DecodedHdrImage): DecodedHdrImage {
	const { data: src, width: srcW, height: srcH } = image;
	const dstW = Math.max(1, srcW >> 1);
	const dstH = Math.max(1, srcH >> 1);
	const dst = new Float32Array(dstW * dstH * 4);
	for (let y = 0; y < dstH; y++) {
		const sy0 = Math.min(srcH - 1, y * 2);
		const sy1 = Math.min(srcH - 1, y * 2 + 1);
		for (let x = 0; x < dstW; x++) {
			const sx0 = (x * 2) % srcW;
			const sx1 = (x * 2 + 1) % srcW;
			const sxPrev = (sx0 + srcW - 1) % srcW;
			const sxNext = (sx1 + 1) % srcW;
			const idx00 = (sy0 * srcW + sx0) * 4;
			const idx10 = (sy0 * srcW + sx1) * 4;
			const idx01 = (sy1 * srcW + sx0) * 4;
			const idx11 = (sy1 * srcW + sx1) * 4;
			const idxL = (sy0 * srcW + sxPrev) * 4;
			const idxR = (sy1 * srcW + sxNext) * 4;
			const outIdx = (y * dstW + x) * 4;
			for (let c = 0; c < 3; c++) {
				const core =
					(src[idx00 + c] ?? 0) +
					(src[idx10 + c] ?? 0) +
					(src[idx01 + c] ?? 0) +
					(src[idx11 + c] ?? 0);
				const wing = (src[idxL + c] ?? 0) + (src[idxR + c] ?? 0);
				dst[outIdx + c] = core * 0.2 + wing * 0.1;
			}
			dst[outIdx + 3] = 1;
		}
	}
	return { width: dstW, height: dstH, data: dst };
}

/**
 * Decodes a panorama from a file path or its bytes: OpenEXR (`.exr`) or
 * Radiance RGBE (`.hdr`), told apart by their magic bytes.
 */
export function decodeHdrSource(source: string | Uint8Array): DecodedHdrImage {
	const bytes =
		typeof source === "string" ? new Uint8Array(readFileSync(source)) : source;
	return isExr(bytes) ? parseExr(bytes) : parseHdr(bytes);
}

/**
 * World direction of an equirectangular texel center (y points down; u = 0.5
 * looks down -z). The shaders sample the same mapping.
 */
export function equirectDirection(
	u: number,
	v: number,
): [number, number, number] {
	const theta = v * Math.PI;
	const a = (u - 0.5) * 2 * Math.PI;
	const s = Math.sin(theta);
	return [s * Math.sin(a), -Math.cos(theta), -s * Math.cos(a)];
}

/** Real L2 spherical-harmonic basis, in the order the shaders evaluate it. */
export function shBasis(x: number, y: number, z: number): number[] {
	return [
		0.282095,
		0.488603 * y,
		0.488603 * z,
		0.488603 * x,
		1.092548 * x * y,
		1.092548 * y * z,
		0.315392 * (3 * z * z - 1),
		1.092548 * x * z,
		0.546274 * (x * x - y * y),
	];
}

/** Cosine-lobe convolution per band (Ramamoorthi & Hanrahan), over π. */
const SH_BAND_SCALE = [
	1,
	2 / 3,
	2 / 3,
	2 / 3,
	1 / 4,
	1 / 4,
	1 / 4,
	1 / 4,
	1 / 4,
];

/** Widest panorama row the SH projection reads; L2 needs nothing finer. */
const SH_MAX_WIDTH = 256;

/**
 * Projects a panorama's diffuse lighting onto 9 L2 spherical harmonics
 * (36 floats: 9 × rgb + pad). Evaluated at a normal, the result is the
 * cosine-weighted mean radiance arriving there (irradiance / π), so a
 * Lambertian surface of albedo `c` reflects `c × result`.
 */
export function projectIrradianceSh(image: DecodedHdrImage): Float32Array {
	let src = image;
	while (src.width > SH_MAX_WIDTH) src = downsampleEquirect(src);
	const { width: w, height: h, data } = src;
	const acc = new Float64Array(27);
	const dPhiDTheta = ((2 * Math.PI) / w) * (Math.PI / h);
	for (let y = 0; y < h; y++) {
		const v = (y + 0.5) / h;
		const weight = dPhiDTheta * Math.sin(v * Math.PI);
		for (let x = 0; x < w; x++) {
			const [dx, dy, dz] = equirectDirection((x + 0.5) / w, v);
			const basis = shBasis(dx, dy, dz);
			const i = (y * w + x) * 4;
			for (let k = 0; k < 9; k++) {
				const b = (basis[k] ?? 0) * weight;
				acc[k * 3] += (data[i] ?? 0) * b;
				acc[k * 3 + 1] += (data[i + 1] ?? 0) * b;
				acc[k * 3 + 2] += (data[i + 2] ?? 0) * b;
			}
		}
	}
	const out = new Float32Array(36);
	for (let k = 0; k < 9; k++) {
		const scale = SH_BAND_SCALE[k] ?? 0;
		out[k * 4] = (acc[k * 3] ?? 0) * scale;
		out[k * 4 + 1] = (acc[k * 3 + 1] ?? 0) * scale;
		out[k * 4 + 2] = (acc[k * 3 + 2] ?? 0) * scale;
	}
	return out;
}

/** Evaluates `projectIrradianceSh` coefficients at a unit normal. */
export function evaluateIrradianceSh(
	sh: Float32Array,
	n: [number, number, number],
): [number, number, number] {
	const basis = shBasis(n[0], n[1], n[2]);
	const out: [number, number, number] = [0, 0, 0];
	for (let k = 0; k < 9; k++) {
		const b = basis[k] ?? 0;
		out[0] += (sh[k * 4] ?? 0) * b;
		out[1] += (sh[k * 4 + 1] ?? 0) * b;
		out[2] += (sh[k * 4 + 2] ?? 0) * b;
	}
	return out;
}
