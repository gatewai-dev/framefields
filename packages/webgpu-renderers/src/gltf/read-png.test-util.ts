/** Decodes the 8-bit RGBA PNGs `encodePng` writes (tests only). */
import { inflateSync } from "node:zlib";

export function readPng(png: Uint8Array): {
	width: number;
	height: number;
	rgba: Uint8Array;
} {
	const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
	let at = 8;
	let width = 0;
	let height = 0;
	const idat: Uint8Array[] = [];
	while (at < png.length) {
		const length = view.getUint32(at);
		const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
		const data = png.subarray(at + 8, at + 8 + length);
		if (type === "IHDR") {
			width = view.getUint32(at + 8);
			height = view.getUint32(at + 12);
		} else if (type === "IDAT") idat.push(data);
		at += 12 + length;
	}
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * 4;
	const rgba = new Uint8Array(stride * height);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)] as number;
		for (let x = 0; x < stride; x++) {
			const i = y * stride + x;
			const a = x >= 4 ? (rgba[i - 4] as number) : 0;
			const b = y > 0 ? (rgba[i - stride] as number) : 0;
			const c = x >= 4 && y > 0 ? (rgba[i - stride - 4] as number) : 0;
			const p = a + b - c;
			const pa = Math.abs(p - a);
			const pb = Math.abs(p - b);
			const pc = Math.abs(p - c);
			const pred = [
				0,
				a,
				b,
				(a + b) >> 1,
				pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
			][filter] as number;
			rgba[i] = ((raw[y * (stride + 1) + 1 + x] as number) + pred) & 0xff;
		}
	}
	return { width, height, rgba };
}
