import { describe, expect, it } from "vitest";
import {
	type DecodedHdrImage,
	encodeHdr,
	equirectDirection,
	evaluateIrradianceSh,
	float32ToFloat16,
	parseHdr,
	projectIrradianceSh,
} from "./hdr-loader.js";

function gradient(width: number, height: number): Float32Array {
	const px = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4;
			px[i] = (x + 1) * 0.37;
			px[i + 1] = (y + 1) * 1.9;
			px[i + 2] = 0.002 * (x + y + 1);
			px[i + 3] = 1;
		}
	}
	return px;
}

/** Radiance new-style RLE for one scanline: each channel as a single literal run. */
function rleScanline(rgbe: Uint8Array, width: number): Uint8Array {
	const out: number[] = [2, 2, width >> 8, width & 0xff];
	for (let ch = 0; ch < 4; ch++) {
		// A run of `width` identical bytes for alpha-ish channels, literals for the rest.
		const values = Array.from({ length: width }, (_, x) => rgbe[x * 4 + ch]);
		if (values.every((v) => v === values[0])) {
			out.push(128 + width, values[0] ?? 0);
		} else {
			out.push(width, ...values.map((v) => v ?? 0));
		}
	}
	return Uint8Array.from(out);
}

describe("Radiance .hdr decoding", () => {
	it("round-trips linear radiance through RGBE within mantissa precision", () => {
		const w = 16;
		const h = 8;
		const src = gradient(w, h);
		const decoded = parseHdr(encodeHdr(w, h, src));
		expect(decoded.width).toBe(w);
		expect(decoded.height).toBe(h);
		for (let i = 0; i < src.length; i += 4) {
			const max = Math.max(src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0);
			for (let c = 0; c < 3; c++) {
				// RGBE shares one exponent: error is bounded by max / 256 per channel.
				expect(
					Math.abs((decoded.data[i + c] ?? 0) - (src[i + c] ?? 0)),
				).toBeLessThanOrEqual(max / 256 + 1e-6);
			}
			expect(decoded.data[i + 3]).toBe(1);
		}
	});

	it("decodes new-style RLE scanlines identically to flat ones", () => {
		const w = 12;
		const h = 3;
		const flat = encodeHdr(w, h, gradient(w, h));
		const header = "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n";
		const headerEnd =
			flat.indexOf(0x0a, flat.indexOf(0x0a, header.length) - 1) + 1;
		const parts: Uint8Array[] = [flat.subarray(0, headerEnd)];
		for (let y = 0; y < h; y++) {
			const row = flat.subarray(
				headerEnd + y * w * 4,
				headerEnd + (y + 1) * w * 4,
			);
			parts.push(rleScanline(row, w));
		}
		const rle = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
		let o = 0;
		for (const p of parts) {
			rle.set(p, o);
			o += p.length;
		}
		expect(rle.length).not.toBe(flat.length);
		expect(parseHdr(rle).data).toEqual(parseHdr(flat).data);
	});

	it("rejects files without a Radiance signature or with unsupported orientation", () => {
		const bytes = (s: string) => Uint8Array.from(s, (ch) => ch.charCodeAt(0));
		expect(() => parseHdr(bytes("P6\n1 1\n255\n"))).toThrow(/signature/);
		expect(() => parseHdr(bytes("#?RADIANCE\n\n+Y 1 +X 1\n\0\0\0\0"))).toThrow(
			/resolution/,
		);
		expect(() => parseHdr(bytes("#?RADIANCE\n\n-Y 2 +X 1\n\0\0\0\0"))).toThrow(
			/EOF/,
		);
	});

	it("converts float32 to half-float bits, clamping to the largest finite half", () => {
		expect(float32ToFloat16(0)).toBe(0);
		expect(float32ToFloat16(1)).toBe(0x3c00);
		expect(float32ToFloat16(-2)).toBe(0xc000);
		expect(float32ToFloat16(0.5)).toBe(0x3800);
		expect(float32ToFloat16(65504)).toBe(0x7bff);
		expect(float32ToFloat16(1e9)).toBe(0x7bff);
		expect(float32ToFloat16(Number.NaN)).toBe(0);
		// Smallest subnormal half is 2^-24.
		expect(float32ToFloat16(2 ** -24)).toBe(1);
	});
});

function panorama(
	width: number,
	height: number,
	radiance: (d: [number, number, number]) => [number, number, number],
): DecodedHdrImage {
	const data = new Float32Array(width * height * 4);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const d = equirectDirection((x + 0.5) / width, (y + 0.5) / height);
			data.set([...radiance(d), 1], (y * width + x) * 4);
		}
	}
	return { width, height, data };
}

describe("Irradiance spherical harmonics", () => {
	it("maps texel centers to unit directions, u = 0.5 looking down -z, top row up (-y)", () => {
		const [x, y, z] = equirectDirection(0.5, 0.5);
		expect([x, y, z].map((v) => +v.toFixed(6))).toEqual([0, -0, -1]);
		expect(equirectDirection(0.3, 0)[1]).toBeCloseTo(-1);
		expect(equirectDirection(0.75, 0.5)[0]).toBeCloseTo(1);
	});

	it("returns a uniform environment's radiance at every normal", () => {
		const sh = projectIrradianceSh(panorama(128, 64, () => [0.5, 1, 2]));
		for (const n of [
			[0, -1, 0],
			[1, 0, 0],
			[0, 0.6, -0.8],
		] as [number, number, number][]) {
			const e = evaluateIrradianceSh(sh, n);
			expect(e[0]).toBeCloseTo(0.5, 2);
			expect(e[1]).toBeCloseTo(1, 2);
			expect(e[2]).toBeCloseTo(2, 2);
		}
	});

	it("matches the exact cosine-weighted mean of a bright sky over a black ground", () => {
		// Sky-only lighting gives (1 + cos θ) / 2 from the zenith, linear in cos θ,
		// which L2 harmonics represent exactly.
		const sh = projectIrradianceSh(
			panorama(256, 128, (d) => (d[1] < 0 ? [1, 1, 1] : [0, 0, 0])),
		);
		const at = (n: [number, number, number]) => evaluateIrradianceSh(sh, n)[0];
		expect(at([0, -1, 0])).toBeCloseTo(1, 1);
		expect(at([0, 1, 0])).toBeCloseTo(0, 1);
		expect(at([1, 0, 0])).toBeCloseTo(0.5, 2);
		expect(at([0, -0.5, Math.sqrt(0.75)])).toBeCloseTo(0.75, 1);
	});

	it("reads wide panoramas at a bounded resolution with the same result", () => {
		const light = (d: [number, number, number]): [number, number, number] => [
			Math.max(0, d[0]) * 3,
			Math.max(0, -d[1]),
			Math.max(0, d[2]) * 2,
		];
		const small = projectIrradianceSh(panorama(256, 128, light));
		const wide = projectIrradianceSh(panorama(1024, 512, light));
		for (let i = 0; i < 36; i++) {
			expect(wide[i] ?? 0).toBeCloseTo(small[i] ?? 0, 2);
		}
	});
});
