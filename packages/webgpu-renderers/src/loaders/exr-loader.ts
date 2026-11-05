/**
 * OpenEXR decoder for HDRI panoramas, in pure TypeScript.
 *
 * Reads single-part scanline and tiled images (level 0 of mipmapped and
 * ripmapped files) with NONE, RLE, ZIPS, ZIP, PIZ and PXR24 compression and
 * HALF / FLOAT / UINT channels. The lossy B44 / B44A / DWAA / DWAB / HTJ2K
 * codecs, deep data and multi-part files are rejected with a clear error.
 * Block formats follow the OpenEXR reference implementation (ImfZip,
 * ImfRle, ImfPizCompressor + ImfHuf + ImfWav, ImfPxr24Compressor).
 */
import { inflateSync } from "node:zlib";
import type { DecodedHdrImage } from "./hdr-loader.js";

const MAGIC = 20000630;
const FLAG_TILED = 0x200;
const FLAG_DEEP = 0x800;
const FLAG_MULTIPART = 0x1000;

const PIXEL_UINT = 0;
const PIXEL_HALF = 1;
const PIXEL_FLOAT = 2;

const COMPRESSION_NAMES = [
	"NONE",
	"RLE",
	"ZIPS",
	"ZIP",
	"PIZ",
	"PXR24",
	"B44",
	"B44A",
	"DWAA",
	"DWAB",
	"HTJ2K256",
	"HTJ2K32",
];
/** Scan lines per chunk, per supported compression. */
const LINES_PER_BLOCK: Record<number, number> = {
	0: 1,
	1: 1,
	2: 1,
	3: 16,
	4: 32,
	5: 16,
};

interface ExrChannel {
	name: string;
	type: number;
	/** Bytes per sample in the uncompressed layout. */
	size: number;
}

interface ExrHeader {
	channels: ExrChannel[];
	compression: number;
	xMin: number;
	yMin: number;
	width: number;
	height: number;
	tiled: boolean;
	tileWidth: number;
	tileHeight: number;
	/** Byte offset of the chunk offset table. */
	tableOffset: number;
}

/** True when `bytes` start with the OpenEXR magic number. */
export function isExr(bytes: Uint8Array): boolean {
	return (
		bytes.length >= 4 &&
		bytes[0] === 0x76 &&
		bytes[1] === 0x2f &&
		bytes[2] === 0x31 &&
		bytes[3] === 0x01
	);
}

class Reader {
	readonly view: DataView;
	offset: number;
	constructor(
		readonly bytes: Uint8Array,
		offset = 0,
	) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
		this.offset = offset;
	}
	u8(): number {
		return this.view.getUint8(this.offset++);
	}
	u16(): number {
		const v = this.view.getUint16(this.offset, true);
		this.offset += 2;
		return v;
	}
	i32(): number {
		const v = this.view.getInt32(this.offset, true);
		this.offset += 4;
		return v;
	}
	u32(): number {
		const v = this.view.getUint32(this.offset, true);
		this.offset += 4;
		return v;
	}
	u64(): number {
		const v = this.view.getBigUint64(this.offset, true);
		this.offset += 8;
		return Number(v);
	}
	cstring(): string {
		const start = this.offset;
		while (this.offset < this.bytes.length && this.bytes[this.offset] !== 0)
			this.offset++;
		const s = String.fromCharCode(...this.bytes.subarray(start, this.offset));
		this.offset++;
		return s;
	}
}

function sampleSize(type: number): number {
	if (type === PIXEL_HALF) return 2;
	if (type === PIXEL_UINT || type === PIXEL_FLOAT) return 4;
	throw new Error(`OpenEXR: unknown pixel type ${type}`);
}

function readChannels(r: Reader, end: number): ExrChannel[] {
	const channels: ExrChannel[] = [];
	while (r.offset < end) {
		const name = r.cstring();
		if (name === "") break;
		const type = r.i32();
		r.offset += 4; // pLinear + reserved
		const xSampling = r.i32();
		const ySampling = r.i32();
		if (xSampling !== 1 || ySampling !== 1)
			throw new Error(
				`OpenEXR: subsampled channel '${name}' (${xSampling}×${ySampling}) is not supported`,
			);
		channels.push({ name, type, size: sampleSize(type) });
	}
	return channels;
}

function readHeader(bytes: Uint8Array): ExrHeader {
	const r = new Reader(bytes);
	if (r.i32() !== MAGIC) throw new Error("Not an OpenEXR file");
	const version = r.i32();
	if (version & FLAG_MULTIPART)
		throw new Error("OpenEXR: multi-part files are not supported");
	if (version & FLAG_DEEP)
		throw new Error("OpenEXR: deep images are not supported");
	const header: ExrHeader = {
		channels: [],
		compression: -1,
		xMin: 0,
		yMin: 0,
		width: 0,
		height: 0,
		tiled: (version & FLAG_TILED) !== 0,
		tileWidth: 0,
		tileHeight: 0,
		tableOffset: 0,
	};
	for (;;) {
		const name = r.cstring();
		if (name === "") break;
		r.cstring(); // attribute type
		const size = r.i32();
		const end = r.offset + size;
		readAttribute(r, name, end, header);
		r.offset = end;
	}
	header.tableOffset = r.offset;
	return header;
}

function readAttribute(
	r: Reader,
	name: string,
	end: number,
	header: ExrHeader,
): void {
	if (name === "channels") {
		header.channels = readChannels(r, end);
	} else if (name === "compression") {
		header.compression = r.u8();
	} else if (name === "dataWindow") {
		header.xMin = r.i32();
		header.yMin = r.i32();
		header.width = r.i32() - header.xMin + 1;
		header.height = r.i32() - header.yMin + 1;
	} else if (name === "tiles") {
		header.tileWidth = r.u32();
		header.tileHeight = r.u32();
	}
}

// ── ZIP / RLE: byte predictor and half-split interleave ──────────────

function unpredictAndInterleave(tmp: Uint8Array): Uint8Array {
	for (let i = 1; i < tmp.length; i++) {
		tmp[i] = ((tmp[i - 1] ?? 0) + (tmp[i] ?? 0) - 128) & 0xff;
	}
	const out = new Uint8Array(tmp.length);
	const half = (tmp.length + 1) >> 1;
	for (let i = 0, t1 = 0, t2 = half; i < out.length; ) {
		out[i++] = tmp[t1++] ?? 0;
		if (i < out.length) out[i++] = tmp[t2++] ?? 0;
	}
	return out;
}

function rleDecode(src: Uint8Array, size: number): Uint8Array {
	const out = new Uint8Array(size);
	let o = 0;
	let i = 0;
	while (i < src.length && o < size) {
		const code = ((src[i++] ?? 0) << 24) >> 24;
		if (code < 0) {
			const n = -code;
			out.set(src.subarray(i, i + n), o);
			i += n;
			o += n;
		} else {
			out.fill(src[i++] ?? 0, o, o + code + 1);
			o += code + 1;
		}
	}
	if (o !== size) throw new Error("OpenEXR: corrupt RLE block");
	return out;
}

// ── PXR24: per-channel byte planes of differences ────────────────────

function pxr24Decode(
	src: Uint8Array,
	width: number,
	lines: number,
	channels: ExrChannel[],
	size: number,
): Uint8Array {
	const tmp = inflateSync(src);
	const out = new Uint8Array(size);
	const view = new DataView(out.buffer);
	let t = 0;
	let o = 0;
	for (let y = 0; y < lines; y++) {
		for (const ch of channels) {
			const planes =
				ch.type === PIXEL_HALF ? 2 : ch.type === PIXEL_FLOAT ? 3 : 4;
			let pixel = 0;
			for (let x = 0; x < width; x++) {
				let diff = 0;
				for (let p = 0; p < planes; p++) {
					diff = diff * 256 + (tmp[t + p * width + x] ?? 0);
				}
				if (ch.type === PIXEL_FLOAT) diff *= 256;
				pixel = (pixel + diff) % 4294967296;
				if (ch.type === PIXEL_HALF) {
					view.setUint16(o, pixel & 0xffff, true);
					o += 2;
				} else {
					view.setUint32(o, pixel, true);
					o += 4;
				}
			}
			t += planes * width;
		}
	}
	return out;
}

// ── PIZ: Huffman + LUT + Haar wavelet ────────────────────────────────

const HUF_ENCSIZE = 65537;
const HUF_DECBITS = 14;

class BitReader {
	pos = 0;
	constructor(
		readonly bytes: Uint8Array,
		readonly start: number,
	) {}
	/** Next `n` (≤ 17) bits, MSB first, without consuming them; zero past the end. */
	peek(n: number): number {
		const b = this.start + (this.pos >>> 3);
		const v =
			((this.bytes[b] ?? 0) << 16) |
			((this.bytes[b + 1] ?? 0) << 8) |
			(this.bytes[b + 2] ?? 0);
		return (v >>> (24 - (this.pos & 7) - n)) & ((1 << n) - 1);
	}
	read(n: number): number {
		const v = this.peek(n);
		this.pos += n;
		return v;
	}
}

/** Code lengths for symbols im..iM, packed 6 bits each with zero runs (hufUnpackEncTable). */
function unpackCodeLengths(
	bits: BitReader,
	im: number,
	iM: number,
): Uint8Array {
	const lengths = new Uint8Array(HUF_ENCSIZE);
	for (let i = im; i <= iM; i++) {
		const l = bits.read(6);
		if (l === 63) {
			const run = bits.read(8) + 6;
			if (i + run > iM + 1) throw new Error("OpenEXR: corrupt Huffman table");
			i += run - 1;
		} else if (l >= 59) {
			const run = l - 59 + 2;
			if (i + run > iM + 1) throw new Error("OpenEXR: corrupt Huffman table");
			i += run - 1;
		} else {
			lengths[i] = l;
		}
	}
	return lengths;
}

interface HuffmanTable {
	/** Short codes: `symbol << 8 | length` for every HUF_DECBITS-bit prefix, 0 if longer. */
	short: Int32Array;
	/** Canonical decoding for long codes: first code and symbols per length. */
	firstCode: number[];
	symbols: number[][];
}

/** Canonical codes as OpenEXR assigns them (hufCanonicalCodeTable). */
function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
	const count = new Array<number>(59).fill(0);
	for (const l of lengths) count[l] = (count[l] ?? 0) + 1;
	const firstCode = new Array<number>(59).fill(0);
	let c = 0;
	for (let l = 58; l > 0; l--) {
		firstCode[l] = c;
		c = Math.floor((c + (count[l] ?? 0)) / 2);
	}
	const next = firstCode.slice();
	const symbols: number[][] = Array.from({ length: 59 }, () => []);
	const short = new Int32Array(1 << HUF_DECBITS);
	for (let s = 0; s < lengths.length; s++) {
		const l = lengths[s] ?? 0;
		if (l === 0) continue;
		const code = next[l] ?? 0;
		next[l] = code + 1;
		symbols[l]?.push(s);
		if (l <= HUF_DECBITS) {
			const shift = HUF_DECBITS - l;
			const startIdx = code * 2 ** shift;
			short.fill((s << 8) | l, startIdx, startIdx + 2 ** shift);
		}
	}
	return { short, firstCode, symbols };
}

function decodeSymbol(
	bits: BitReader,
	table: HuffmanTable,
	nBits: number,
): number {
	const entry = table.short[bits.peek(HUF_DECBITS)] ?? 0;
	const len = entry & 0xff;
	if (len > 0 && bits.pos + len <= nBits) {
		bits.pos += len;
		return entry >>> 8;
	}
	// Longer than the table: extend bit by bit until a code of that length matches.
	let code = 0;
	for (let l = 1; l <= 58 && bits.pos < nBits; l++) {
		code = code * 2 + bits.read(1);
		const offset = code - (table.firstCode[l] ?? 0);
		const syms = table.symbols[l] ?? [];
		if (offset >= 0 && offset < syms.length) return syms[offset] ?? 0;
	}
	throw new Error("OpenEXR: corrupt Huffman data");
}

function hufUncompress(src: Uint8Array, start: number, out: Uint16Array): void {
	const r = new Reader(src, start);
	const im = r.u32();
	const iM = r.u32();
	r.offset += 4; // table length
	const nBits = r.u32();
	r.offset += 4;
	if (im >= HUF_ENCSIZE || iM >= HUF_ENCSIZE)
		throw new Error("OpenEXR: corrupt Huffman header");
	const tableBits = new BitReader(src, r.offset);
	const table = buildHuffmanTable(unpackCodeLengths(tableBits, im, iM));
	const bits = new BitReader(src, r.offset + Math.ceil(tableBits.pos / 8));
	let o = 0;
	while (bits.pos < nBits && o < out.length) {
		const sym = decodeSymbol(bits, table, nBits);
		if (sym === iM) {
			// Run-length code: repeat the previous symbol.
			const run = bits.read(8);
			if (o === 0 || o + run > out.length)
				throw new Error("OpenEXR: corrupt Huffman run");
			out.fill(out[o - 1] ?? 0, o, o + run);
			o += run;
		} else {
			out[o++] = sym;
		}
	}
	if (o !== out.length) throw new Error("OpenEXR: truncated Huffman data");
}

function wdec14(l: number, h: number): [number, number] {
	const ls = (l << 16) >> 16;
	const hs = (h << 16) >> 16;
	const ai = ls + (hs & 1) + (hs >> 1);
	return [ai & 0xffff, (ai - hs) & 0xffff];
}

function wdec16(l: number, h: number): [number, number] {
	const b = (l - (h >> 1)) & 0xffff;
	return [(h + b - 0x8000) & 0xffff, b];
}

/** Inverse 2D Haar wavelet in place (ImfWav wav2Decode). */
function wav2Decode(
	buf: Uint16Array,
	j: number,
	nx: number,
	ox: number,
	ny: number,
	oy: number,
	maxValue: number,
): void {
	const dec = maxValue < 1 << 14 ? wdec14 : wdec16;
	const n = Math.min(nx, ny);
	let p = 1;
	while (p <= n) p <<= 1;
	p >>= 1;
	let p2 = p;
	p >>= 1;
	const at = (i: number) => buf[i + j] ?? 0;
	const set = (i: number, v: number) => {
		buf[i + j] = v;
	};
	while (p >= 1) {
		let py = 0;
		const ey = oy * (ny - p2);
		const oy1 = oy * p;
		const oy2 = oy * p2;
		const ox1 = ox * p;
		const ox2 = ox * p2;
		for (; py <= ey; py += oy2) {
			let px = py;
			const ex = py + ox * (nx - p2);
			for (; px <= ex; px += ox2) {
				const p01 = px + ox1;
				const p10 = px + oy1;
				const p11 = p10 + ox1;
				const [i00, i10] = dec(at(px), at(p10));
				const [i01, i11] = dec(at(p01), at(p11));
				const [a, b] = dec(i00, i01);
				const [c, d] = dec(i10, i11);
				set(px, a);
				set(p01, b);
				set(p10, c);
				set(p11, d);
			}
			if (nx & p) {
				const p10 = px + oy1;
				const [a, b] = dec(at(px), at(p10));
				set(px, a);
				set(p10, b);
			}
		}
		if (ny & p) {
			let px = py;
			const ex = py + ox * (nx - p2);
			for (; px <= ex; px += ox2) {
				const p01 = px + ox1;
				const [a, b] = dec(at(px), at(p01));
				set(px, a);
				set(p01, b);
			}
		}
		p2 = p;
		p >>= 1;
	}
}

function pizDecode(
	src: Uint8Array,
	width: number,
	lines: number,
	channels: ExrChannel[],
	size: number,
): Uint8Array {
	const r = new Reader(src);
	const minNonZero = r.u16();
	const maxNonZero = r.u16();
	if (maxNonZero >= 8192) throw new Error("OpenEXR: corrupt PIZ bitmap");
	const bitmap = new Uint8Array(8192);
	if (minNonZero <= maxNonZero) {
		const n = maxNonZero - minNonZero + 1;
		bitmap.set(src.subarray(r.offset, r.offset + n), minNonZero);
		r.offset += n;
	}
	// Reverse LUT: dense codes back to the 16-bit values present in the block.
	const lut = new Uint16Array(65536);
	let k = 0;
	for (let i = 0; i < 65536; i++) {
		if (i === 0 || (bitmap[i >> 3] ?? 0) & (1 << (i & 7))) lut[k++] = i;
	}
	const maxValue = k - 1;
	const length = r.i32();
	const words = new Uint16Array(size / 2);
	hufUncompress(src.subarray(0, r.offset + length), r.offset, words);
	let start = 0;
	for (const ch of channels) {
		const perSample = ch.size / 2;
		for (let j = 0; j < perSample; j++) {
			wav2Decode(
				words,
				start + j,
				width,
				perSample,
				lines,
				width * perSample,
				maxValue,
			);
		}
		start += width * lines * perSample;
	}
	for (let i = 0; i < words.length; i++) words[i] = lut[words[i] ?? 0] ?? 0;
	// Channel-planar words back to the line-interleaved layout.
	const out = new Uint8Array(size);
	const outWords = new Uint16Array(out.buffer);
	let o = 0;
	const cursors: number[] = [];
	let c0 = 0;
	for (const ch of channels) {
		cursors.push(c0);
		c0 += width * lines * (ch.size / 2);
	}
	for (let y = 0; y < lines; y++) {
		channels.forEach((ch, ci) => {
			const n = width * (ch.size / 2);
			const from = cursors[ci] ?? 0;
			outWords.set(words.subarray(from, from + n), o);
			cursors[ci] = from + n;
			o += n;
		});
	}
	return out;
}

/** One chunk's pixels in the uncompressed layout: per line, per channel, `width` samples. */
function decompressBlock(
	header: ExrHeader,
	data: Uint8Array,
	width: number,
	lines: number,
): Uint8Array {
	const bytesPerLine = header.channels.reduce((n, c) => n + c.size * width, 0);
	const size = bytesPerLine * lines;
	// Every codec stores a chunk raw when compressing would not shrink it.
	if (data.length >= size) return data.subarray(0, size);
	switch (header.compression) {
		case 1:
			return unpredictAndInterleave(rleDecode(data, size));
		case 2:
		case 3:
			return unpredictAndInterleave(new Uint8Array(inflateSync(data)));
		case 4:
			return pizDecode(data, width, lines, header.channels, size);
		case 5:
			return pxr24Decode(data, width, lines, header.channels, size);
		default:
			throw new Error(
				`OpenEXR: compression ${header.compression} cannot be decoded`,
			);
	}
}

let halfTable: Float32Array | null = null;

function halfToFloat(): Float32Array {
	if (halfTable) return halfTable;
	const t = new Float32Array(65536);
	for (let h = 0; h < 65536; h++) {
		const s = h & 0x8000 ? -1 : 1;
		const e = (h >> 10) & 0x1f;
		const m = h & 0x3ff;
		t[h] =
			e === 0
				? s * m * 2 ** -24
				: e === 31
					? m
						? Number.NaN
						: s * Number.POSITIVE_INFINITY
					: s * (1 + m / 1024) * 2 ** (e - 15);
	}
	halfTable = t;
	return t;
}

/** Which source channel feeds R, G and B: RGB, or luminance Y for all three. */
function colorChannels(channels: ExrChannel[]): number[] {
	const index = (name: string) => channels.findIndex((c) => c.name === name);
	const rgb = ["R", "G", "B"].map(index);
	if (rgb.every((i) => i >= 0)) return rgb;
	const y = index("Y");
	if (y >= 0) return [y, y, y];
	throw new Error(
		`OpenEXR: no R/G/B or Y channels (found ${channels.map((c) => c.name).join(", ")})`,
	);
}

/** Writes a decoded block into the RGBA output at (x0, y0) of the data window. */
function storeBlock(
	header: ExrHeader,
	pick: number[],
	block: Uint8Array,
	x0: number,
	y0: number,
	width: number,
	lines: number,
	out: Float32Array,
): void {
	const view = new DataView(block.buffer, block.byteOffset, block.byteLength);
	const half = halfToFloat();
	const offsets: number[] = [];
	let lineBytes = 0;
	for (const c of header.channels) {
		offsets.push(lineBytes);
		lineBytes += c.size * width;
	}
	for (let y = 0; y < lines; y++) {
		const row = y0 + y;
		if (row < 0 || row >= header.height) continue;
		for (let k = 0; k < 3; k++) {
			const ci = pick[k] ?? 0;
			const ch = header.channels[ci];
			if (!ch) continue;
			let at = y * lineBytes + (offsets[ci] ?? 0);
			for (let x = 0; x < width; x++, at += ch.size) {
				const v =
					ch.type === PIXEL_HALF
						? (half[view.getUint16(at, true)] ?? 0)
						: ch.type === PIXEL_FLOAT
							? view.getFloat32(at, true)
							: view.getUint32(at, true);
				out[(row * header.width + x0 + x) * 4 + k] = v;
			}
		}
	}
}

/** Decodes an OpenEXR panorama into linear RGBA float32 (alpha 1). */
export function parseExr(input: Uint8Array | ArrayBuffer): DecodedHdrImage {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	const header = readHeader(bytes);
	const linesPerBlock = LINES_PER_BLOCK[header.compression];
	if (linesPerBlock === undefined)
		throw new Error(
			`OpenEXR: ${COMPRESSION_NAMES[header.compression] ?? header.compression} compression is not supported (use NONE, RLE, ZIPS, ZIP, PIZ or PXR24)`,
		);
	const pick = colorChannels(header.channels);
	const { width, height } = header;
	const data = new Float32Array(width * height * 4);
	for (let i = 3; i < data.length; i += 4) data[i] = 1;
	const r = new Reader(bytes, header.tableOffset);
	if (header.tiled) {
		const tw = header.tileWidth;
		const th = header.tileHeight;
		const count = Math.ceil(width / tw) * Math.ceil(height / th);
		const offsets = Array.from({ length: count }, () => r.u64());
		for (const offset of offsets) {
			const c = new Reader(bytes, offset);
			const dx = c.i32();
			const dy = c.i32();
			c.offset += 8; // level x, y: level-0 tiles come first
			const size = c.i32();
			const w = Math.min(tw, width - dx * tw);
			const h = Math.min(th, height - dy * th);
			const chunk = bytes.subarray(c.offset, c.offset + size);
			const block = decompressBlock(header, chunk, w, h);
			storeBlock(header, pick, block, dx * tw, dy * th, w, h, data);
		}
	} else {
		const count = Math.ceil(height / linesPerBlock);
		const offsets = Array.from({ length: count }, () => r.u64());
		for (const offset of offsets) {
			const c = new Reader(bytes, offset);
			const y = c.i32() - header.yMin;
			const size = c.i32();
			const lines = Math.min(linesPerBlock, height - y);
			const chunk = bytes.subarray(c.offset, c.offset + size);
			const block = decompressBlock(header, chunk, width, lines);
			storeBlock(header, pick, block, 0, y, width, lines, data);
		}
	}
	return { width, height, data };
}
