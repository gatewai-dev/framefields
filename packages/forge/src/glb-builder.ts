/**
 * The binary layer of a GLB: typed arrays become 4-byte-aligned buffer
 * views and accessors in one BIN chunk, and `build` wraps a glTF JSON
 * document around them. `GltfDocument` is the typed layer on top; use this
 * directly only to hand-write unusual files.
 */

export type AccessorType = "SCALAR" | "VEC2" | "VEC3" | "VEC4" | "MAT4";

export type AccessorData =
	| Float32Array
	| Uint32Array
	| Uint16Array
	| Uint8Array
	| Int16Array
	| Int8Array;

export interface AccessorOptions {
	/** Integers read as 0..1 (unsigned) or -1..1 (signed). */
	normalized?: boolean;
	/** Write per-component `min` / `max` (required for POSITION). */
	bounds?: boolean;
	/** The buffer view's GPU target: vertex attributes or indices. */
	target?: "vertex" | "index";
}

const COMPONENTS: Record<AccessorType, number> = {
	SCALAR: 1,
	VEC2: 2,
	VEC3: 3,
	VEC4: 4,
	MAT4: 16,
};

function componentType(data: AccessorData): number {
	if (data instanceof Float32Array) return 5126;
	if (data instanceof Uint32Array) return 5125;
	if (data instanceof Uint16Array) return 5123;
	if (data instanceof Int16Array) return 5122;
	if (data instanceof Uint8Array) return 5121;
	return 5120;
}

/** Per-component min and max over an interleaved array. */
function bounds(data: AccessorData, size: number) {
	const min = new Array<number>(size).fill(Number.POSITIVE_INFINITY);
	const max = new Array<number>(size).fill(Number.NEGATIVE_INFINITY);
	for (let i = 0; i < data.length; i++) {
		const c = i % size;
		const v = data[i] as number;
		if (v < (min[c] as number)) min[c] = v;
		if (v > (max[c] as number)) max[c] = v;
	}
	return { min, max };
}

const align4 = (n: number) => (4 - (n % 4)) % 4;

/** Accumulates typed arrays into one binary buffer and the accessors that view them. */
export class GlbBuilder {
	private chunks: Uint8Array[] = [];
	private length = 0;
	readonly bufferViews: Record<string, unknown>[] = [];
	readonly accessors: Record<string, unknown>[] = [];

	private view(data: Uint8Array, target?: number): number {
		const pad = align4(this.length);
		if (pad) {
			this.chunks.push(new Uint8Array(pad));
			this.length += pad;
		}
		this.bufferViews.push({
			buffer: 0,
			byteOffset: this.length,
			byteLength: data.byteLength,
			...(target ? { target } : {}),
		});
		this.chunks.push(data);
		this.length += data.byteLength;
		return this.bufferViews.length - 1;
	}

	/** An accessor over `data`, `type` components per element. Returns its index. */
	accessor(
		data: AccessorData,
		type: AccessorType,
		options: AccessorOptions = {},
	): number {
		const size = COMPONENTS[type];
		if (data.length === 0 || data.length % size !== 0)
			throw new Error(
				`accessor: ${data.length} components is not a whole number of ${type}`,
			);
		const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		const target =
			options.target === "vertex"
				? 34962
				: options.target === "index"
					? 34963
					: undefined;
		const accessor: Record<string, unknown> = {
			bufferView: this.view(bytes, target),
			componentType: componentType(data),
			count: data.length / size,
			type,
		};
		if (options.normalized) accessor.normalized = true;
		if (options.bounds) Object.assign(accessor, bounds(data, size));
		this.accessors.push(accessor);
		return this.accessors.length - 1;
	}

	/**
	 * A float accessor of `count` elements that are zero except at
	 * `indices` (strictly increasing), which take `values`: glTF's sparse
	 * storage, for morph targets that move a few vertices of many.
	 */
	sparseAccessor(
		count: number,
		type: AccessorType,
		indices: Uint32Array,
		values: Float32Array,
		options: { bounds?: boolean } = {},
	): number {
		const size = COMPONENTS[type];
		if (values.length !== indices.length * size)
			throw new Error("sparse accessor: values don't match the indices");
		const idx = count <= 65536 ? Uint16Array.from(indices) : indices;
		const accessor: Record<string, unknown> = {
			componentType: 5126,
			count,
			type,
			sparse: {
				count: indices.length,
				indices: {
					bufferView: this.view(
						new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength),
					),
					componentType: componentType(idx),
				},
				values: {
					bufferView: this.view(
						new Uint8Array(values.buffer, values.byteOffset, values.byteLength),
					),
				},
			},
		};
		if (options.bounds) {
			const b = bounds(values, size);
			// The elements outside `indices` are zero.
			if (indices.length < count)
				for (let c = 0; c < size; c++) {
					b.min[c] = Math.min(b.min[c] as number, 0);
					b.max[c] = Math.max(b.max[c] as number, 0);
				}
			Object.assign(accessor, b);
		}
		this.accessors.push(accessor);
		return this.accessors.length - 1;
	}

	/** Raw bytes (an image) as a buffer view. Returns its index. */
	image(bytes: Uint8Array): number {
		return this.view(bytes);
	}

	/** The GLB file: `json` plus the buffers, views and accessors collected here. */
	build(json: Record<string, unknown>): Uint8Array {
		const bin = concat(this.chunks, this.length);
		const doc = new TextEncoder().encode(
			JSON.stringify({
				asset: { version: "2.0", generator: "framefields forge" },
				...json,
				...(bin.byteLength
					? {
							buffers: [{ byteLength: bin.byteLength }],
							bufferViews: this.bufferViews,
							accessors: this.accessors,
						}
					: {}),
			}),
		);
		const jsonChunk = padded(doc, 0x20);
		const binChunk = padded(bin, 0);
		const total =
			12 +
			8 +
			jsonChunk.byteLength +
			(bin.byteLength ? 8 + binChunk.byteLength : 0);
		const out = new Uint8Array(total);
		const dv = new DataView(out.buffer);
		dv.setUint32(0, 0x46546c67, true);
		dv.setUint32(4, 2, true);
		dv.setUint32(8, total, true);
		let at = 12;
		const chunk = (data: Uint8Array, type: number) => {
			dv.setUint32(at, data.byteLength, true);
			dv.setUint32(at + 4, type, true);
			out.set(data, at + 8);
			at += 8 + data.byteLength;
		};
		chunk(jsonChunk, 0x4e4f534a);
		if (bin.byteLength) chunk(binChunk, 0x004e4942);
		return out;
	}
}

function concat(chunks: Uint8Array[], length: number): Uint8Array {
	const out = new Uint8Array(length);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.byteLength;
	}
	return out;
}

function padded(data: Uint8Array, fill: number): Uint8Array {
	const pad = align4(data.byteLength);
	if (!pad) return data;
	const out = new Uint8Array(data.byteLength + pad).fill(fill);
	out.set(data);
	return out;
}
