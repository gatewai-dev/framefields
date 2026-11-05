/** Builds GLB files in tests: typed arrays become accessors in one binary chunk. */

/** Accumulates typed arrays into one binary buffer and the accessors that view them. */
export class GlbBuilder {
	private chunks: Buffer[] = [];
	private length = 0;
	readonly bufferViews: object[] = [];
	readonly accessors: object[] = [];

	private view(data: Buffer): number {
		const pad = (4 - (this.length % 4)) % 4;
		if (pad) {
			this.chunks.push(Buffer.alloc(pad));
			this.length += pad;
		}
		this.bufferViews.push({
			buffer: 0,
			byteOffset: this.length,
			byteLength: data.length,
		});
		this.chunks.push(data);
		this.length += data.length;
		return this.bufferViews.length - 1;
	}

	accessor(
		data: Float32Array | Uint16Array,
		type: "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4",
	): number {
		const bufferView = this.view(
			Buffer.from(data.buffer, data.byteOffset, data.byteLength),
		);
		const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
		this.accessors.push({
			bufferView,
			componentType: data instanceof Float32Array ? 5126 : 5123,
			count: data.length / size,
			type,
		});
		return this.accessors.length - 1;
	}

	image(png: Buffer): number {
		return this.view(png);
	}

	build(json: Record<string, unknown>): Buffer {
		const bin = Buffer.concat(this.chunks);
		const doc = Buffer.from(
			JSON.stringify({
				asset: { version: "2.0" },
				...json,
				buffers: [{ byteLength: bin.length }],
				bufferViews: this.bufferViews,
				accessors: this.accessors,
			}),
		);
		const docPadded = Buffer.concat([
			doc,
			Buffer.alloc((4 - (doc.length % 4)) % 4, 0x20),
		]);
		const binPadded = Buffer.concat([
			bin,
			Buffer.alloc((4 - (bin.length % 4)) % 4),
		]);
		const header = Buffer.alloc(12);
		header.writeUInt32LE(0x46546c67, 0);
		header.writeUInt32LE(2, 4);
		header.writeUInt32LE(12 + 8 + docPadded.length + 8 + binPadded.length, 8);
		const chunk = (data: Buffer, type: number) => {
			const h = Buffer.alloc(8);
			h.writeUInt32LE(data.length, 0);
			h.writeUInt32LE(type, 4);
			return Buffer.concat([h, data]);
		};
		return Buffer.concat([
			header,
			chunk(docPadded, 0x4e4f534a),
			chunk(binPadded, 0x004e4942),
		]);
	}
}
