/**
 * POSIX ustar archives, written as a stream: the container WebDataset reads
 * (one sample = the members sharing a key, `key.ext`). Every header has
 * mtime 0 and fixed owners, so the same samples make the same bytes.
 */
import { closeSync, openSync, writeSync } from "node:fs";

const BLOCK = 512;

function field(
	header: Uint8Array,
	offset: number,
	length: number,
	value: string,
) {
	for (let i = 0; i < value.length && i < length; i++) {
		header[offset + i] = value.charCodeAt(i);
	}
}

/** `n` as zero-padded octal in `digits` characters. */
function octal(n: number, digits: number): string {
	return n.toString(8).padStart(digits, "0");
}

/** A ustar header for a regular file `name` of `size` bytes. */
export function tarHeader(name: string, size: number): Uint8Array {
	if (name.length > 100)
		throw new Error(`tar: member name over 100 characters: ${name}`);
	const h = new Uint8Array(BLOCK);
	field(h, 0, 100, name);
	field(h, 100, 8, "0000644\0");
	field(h, 108, 8, "0000000\0");
	field(h, 116, 8, "0000000\0");
	field(h, 124, 12, `${octal(size, 11)}\0`);
	field(h, 136, 12, `${octal(0, 11)}\0`);
	field(h, 148, 8, "        ");
	h[156] = "0".charCodeAt(0);
	field(h, 257, 6, "ustar\0");
	field(h, 263, 2, "00");
	let sum = 0;
	for (const b of h) sum += b;
	field(h, 148, 8, `${octal(sum, 6)}\0 `);
	return h;
}

/** Appends members to one archive file; `close()` writes the end blocks. */
export class TarWriter {
	private readonly fd: number;
	/** Bytes written so far. */
	size = 0;

	constructor(readonly path: string) {
		this.fd = openSync(path, "w");
	}

	add(name: string, data: Uint8Array): void {
		this.write(tarHeader(name, data.byteLength));
		this.write(data);
		const pad = (BLOCK - (data.byteLength % BLOCK)) % BLOCK;
		if (pad) this.write(new Uint8Array(pad));
	}

	close(): void {
		this.write(new Uint8Array(BLOCK * 2));
		closeSync(this.fd);
	}

	private write(bytes: Uint8Array): void {
		writeSync(this.fd, bytes);
		this.size += bytes.byteLength;
	}
}
