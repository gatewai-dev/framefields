/**
 * Reads the binary archives DNA files are written in: big-endian numbers,
 * and arrays and strings prefixed with a 32-bit element count.
 *
 * Based on OpenRigLogic's `terse` binary input archive (MIT, Epic Games).
 */
export class ByteReader {
	private readonly view: DataView;
	private at = 0;

	constructor(private readonly bytes: Uint8Array) {
		this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	}

	get offset(): number {
		return this.at;
	}

	get length(): number {
		return this.bytes.byteLength;
	}

	seek(offset: number): void {
		if (offset < 0 || offset > this.bytes.byteLength)
			throw new Error(
				`dna: seek to ${offset} is outside the file (${this.bytes.byteLength} bytes)`,
			);
		this.at = offset;
	}

	private need(n: number): number {
		const start = this.at;
		if (start + n > this.bytes.byteLength)
			throw new Error(
				`dna: the file ends at ${this.bytes.byteLength} bytes; ${n} more needed at ${start}`,
			);
		this.at += n;
		return start;
	}

	u8(): number {
		return this.view.getUint8(this.need(1));
	}

	u16(): number {
		return this.view.getUint16(this.need(2));
	}

	u32(): number {
		return this.view.getUint32(this.need(4));
	}

	i32(): number {
		return this.view.getInt32(this.need(4));
	}

	f32(): number {
		return this.view.getFloat32(this.need(4));
	}

	chars(n: number): string {
		const start = this.need(n);
		return new TextDecoder().decode(this.bytes.subarray(start, start + n));
	}

	/** A counted string. */
	string(): string {
		return this.chars(this.u32());
	}

	u16s(): Uint16Array {
		const n = this.u32();
		const start = this.need(n * 2);
		const out = new Uint16Array(n);
		for (let i = 0; i < n; i++) out[i] = this.view.getUint16(start + i * 2);
		return out;
	}

	u32s(): Uint32Array {
		const n = this.u32();
		const start = this.need(n * 4);
		const out = new Uint32Array(n);
		for (let i = 0; i < n; i++) out[i] = this.view.getUint32(start + i * 4);
		return out;
	}

	f32s(): Float32Array {
		const n = this.u32();
		const start = this.need(n * 4);
		const out = new Float32Array(n);
		for (let i = 0; i < n; i++) out[i] = this.view.getFloat32(start + i * 4);
		return out;
	}

	/** A counted list of anything. */
	list<T>(item: (r: ByteReader) => T): T[] {
		const n = this.u32();
		const out: T[] = [];
		for (let i = 0; i < n; i++) out.push(item(this));
		return out;
	}
}
