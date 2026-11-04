import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isExr, parseExr } from "./exr-loader.js";
import { decodeHdrSource, encodeHdr } from "./hdr-loader.js";

const FIXTURES = join(import.meta.dirname, "__fixtures__", "exr");
const W = 23;
const H = 37;

/** The source image every fixture encodes (see __fixtures__/exr/README.md). */
function fixtureValue(x: number, y: number, c: number): number {
	if (x < 5) return [1, 0.5, 0.25][c] ?? 0;
	const base = 0.01 + ((x * 7 + y * 13 + c * 5) % 29) / 29;
	return base * 2 ** ((y % 9) - 4);
}

const fixture = (name: string) =>
	new Uint8Array(readFileSync(join(FIXTURES, `${name}.exr`)));

function expectImage(name: string, relTolerance: number): void {
	const img = parseExr(fixture(name));
	expect(img.width).toBe(W);
	expect(img.height).toBe(H);
	let worst = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			for (let c = 0; c < 3; c++) {
				const want = Math.fround(fixtureValue(x, y, c));
				const got = img.data[(y * W + x) * 4 + c] ?? Number.NaN;
				worst = Math.max(worst, Math.abs(got - want) / want);
			}
			expect(img.data[(y * W + x) * 4 + 3]).toBe(1);
		}
	}
	expect(worst).toBeLessThanOrEqual(relTolerance);
}

describe("OpenEXR decoding against reference-encoded files", () => {
	const HALF = 2 ** -11; // half keeps 11 significant bits
	for (const codec of ["none", "rle", "zips", "zip", "piz"]) {
		it(`${codec}: float is exact, half is within half precision`, () => {
			expectImage(`${codec}-float`, 0);
			expectImage(`${codec}-half`, HALF);
		});
	}

	it("pxr24: half is lossless, float keeps 24 bits", () => {
		expectImage("pxr24-half", HALF);
		expectImage("pxr24-float", 2 ** -15);
		expect(parseExr(fixture("pxr24-half")).data).toEqual(
			parseExr(fixture("none-half")).data,
		);
	});

	it("tiled images decode to the same pixels as their scanline sources", () => {
		expect(parseExr(fixture("tiled-zip-half")).data).toEqual(
			parseExr(fixture("zip-half")).data,
		);
		// Mipmapped: level 0 only.
		expect(parseExr(fixture("tiled-mip-piz-float")).data).toEqual(
			parseExr(fixture("piz-float")).data,
		);
	});

	it("names the codec when it is lossy and unsupported", () => {
		expect(() => parseExr(fixture("b44-half"))).toThrow(
			/B44 compression is not supported/,
		);
	});

	it("rejects truncated files instead of returning partial pixels", () => {
		const bytes = fixture("piz-half");
		expect(() => parseExr(bytes.subarray(0, bytes.length - 200))).toThrow();
	});

	it("is told apart from Radiance .hdr by its magic bytes", () => {
		expect(isExr(fixture("zip-half"))).toBe(true);
		const hdr = encodeHdr(2, 1, new Float32Array([1, 2, 3, 1, 4, 5, 6, 1]));
		expect(isExr(hdr)).toBe(false);
		expect(decodeHdrSource(join(FIXTURES, "zip-float.exr")).data).toEqual(
			parseExr(fixture("zip-float")).data,
		);
		expect(decodeHdrSource(hdr).width).toBe(2);
	});
});
