/**
 * A minimal PNG encoder for textures built in code: 8-bit RGBA, each row
 * filtered with Paeth (smooth maps compress several times better than
 * unfiltered), deflated by Node's zlib.
 */
import { crc32, deflateSync } from "node:zlib";

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

const paeth = (a: number, b: number, c: number) => {
	const p = a + b - c;
	const pa = Math.abs(p - a);
	const pb = Math.abs(p - b);
	const pc = Math.abs(p - c);
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** `rgba` holds width × height × 4 bytes, rows top to bottom. */
export function encodePng(
	rgba: Uint8Array,
	width: number,
	height: number,
): Uint8Array {
	if (rgba.length !== width * height * 4)
		throw new Error(`png: ${rgba.length} bytes for ${width}x${height} RGBA`);
	const stride = width * 4;
	const raw = new Uint8Array((stride + 1) * height);
	for (let y = 0; y < height; y++) {
		const row = y * (stride + 1);
		raw[row] = 4; // Paeth
		for (let x = 0; x < stride; x++) {
			const i = y * stride + x;
			const a = x >= 4 ? (rgba[i - 4] as number) : 0;
			const b = y > 0 ? (rgba[i - stride] as number) : 0;
			const c = x >= 4 && y > 0 ? (rgba[i - stride - 4] as number) : 0;
			raw[row + 1 + x] = ((rgba[i] as number) - paeth(a, b, c)) & 0xff;
		}
	}
	const header = new Uint8Array(13);
	const hv = new DataView(header.buffer);
	hv.setUint32(0, width);
	hv.setUint32(4, height);
	header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, adaptive, no interlace
	const parts = [
		new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 6 })),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}
