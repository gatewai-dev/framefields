/**
 * A small Apache Parquet writer: one row group, PLAIN-encoded, uncompressed
 * columns of int64, float32, float64, bool or string, each optionally a
 * list (of lists …) of them. Every value and list is required (lists may
 * be empty). That is all the robot-learning formats need (LeRobot's frame
 * tables, episode metadata and task index), and what pyarrow, pandas and
 * Hugging Face `datasets` read.
 *
 * Format: "PAR1", one data page per column (Thrift compact page header,
 * RLE repetition / definition levels, values), the file metadata (Thrift
 * compact), its length, "PAR1".
 */

export type ParquetType = "int64" | "float32" | "float64" | "bool" | "string";

/** A value, or a list of them `depth` levels deep. */
export type ParquetValue = number | bigint | boolean | string | ParquetValue[];

export interface ParquetColumn {
	name: string;
	type: ParquetType;
	/** List nesting: 0 a scalar per row, 1 a list per row, 2 a list of lists… */
	depth?: number;
	/** One entry per row. */
	values: ParquetValue[];
}

// ---------------------------------------------------------------------------
// Thrift compact protocol (just what the metadata uses).
// ---------------------------------------------------------------------------

const T = { i32: 5, i64: 6, binary: 8, list: 9, struct: 12 } as const;

class Thrift {
	private readonly bytes: number[] = [];
	private last: number[] = [0];

	private byte(b: number): void {
		this.bytes.push(b & 0xff);
	}

	private varint(v: bigint): void {
		let x = v;
		while (x >= 0x80n) {
			this.byte(Number(x & 0x7fn) | 0x80);
			x >>= 7n;
		}
		this.byte(Number(x));
	}

	private zigzag(v: bigint): void {
		this.varint(v >= 0n ? v << 1n : (-v << 1n) - 1n);
	}

	private header(id: number, type: number): void {
		const delta = id - (this.last.at(-1) ?? 0);
		if (delta > 0 && delta <= 15) this.byte((delta << 4) | type);
		else {
			this.byte(type);
			this.zigzag(BigInt(id));
		}
		this.last[this.last.length - 1] = id;
	}

	i32(id: number, v: number): this {
		this.header(id, T.i32);
		this.zigzag(BigInt(v));
		return this;
	}

	i64(id: number, v: number | bigint): this {
		this.header(id, T.i64);
		this.zigzag(BigInt(v));
		return this;
	}

	string(id: number, v: string): this {
		this.header(id, T.binary);
		this.rawString(v);
		return this;
	}

	private rawString(v: string): void {
		const b = new TextEncoder().encode(v);
		this.varint(BigInt(b.length));
		for (const x of b) this.byte(x);
	}

	struct(id: number, fill: (t: Thrift) => void): this {
		this.header(id, T.struct);
		this.inStruct(fill);
		return this;
	}

	private inStruct(fill: (t: Thrift) => void): void {
		this.last.push(0);
		fill(this);
		this.byte(0); // stop
		this.last.pop();
	}

	private listHeader(id: number, size: number, type: number): void {
		this.header(id, T.list);
		if (size < 15) this.byte((size << 4) | type);
		else {
			this.byte(0xf0 | type);
			this.varint(BigInt(size));
		}
	}

	i32List(id: number, values: number[]): this {
		this.listHeader(id, values.length, T.i32);
		for (const v of values) this.zigzag(BigInt(v));
		return this;
	}

	stringList(id: number, values: string[]): this {
		this.listHeader(id, values.length, T.binary);
		for (const v of values) this.rawString(v);
		return this;
	}

	structList<V>(
		id: number,
		values: V[],
		fill: (t: Thrift, v: V) => void,
	): this {
		this.listHeader(id, values.length, T.struct);
		for (const v of values) this.inStruct((t) => fill(t, v));
		return this;
	}

	/** A top-level struct's bytes. */
	static encode(fill: (t: Thrift) => void): Uint8Array {
		const t = new Thrift();
		fill(t);
		t.byte(0);
		return Uint8Array.from(t.bytes);
	}
}

// ---------------------------------------------------------------------------
// Columns.
// ---------------------------------------------------------------------------

/** Parquet physical types and the (legacy) converted types used. */
const PHYSICAL: Record<ParquetType, number> = {
	bool: 0,
	int64: 2,
	float32: 4,
	float64: 5,
	string: 6,
};
const UTF8 = 0;
const LIST = 3;
const REQUIRED = 0;
const REPEATED = 2;
const PLAIN = 0;
const RLE = 3;

/** Dremel shredding: leaf values with their repetition and definition levels. */
function shred(column: ParquetColumn) {
	const depth = column.depth ?? 0;
	const values: Array<number | bigint | boolean | string> = [];
	const rep: number[] = [];
	const def: number[] = [];
	const walk = (v: ParquetValue, level: number, r: number) => {
		if (level === depth) {
			if (Array.isArray(v))
				throw new Error(
					`parquet: ${column.name} holds a list ${level} levels deep; it is declared ${depth}`,
				);
			values.push(v);
			rep.push(r);
			def.push(depth);
			return;
		}
		if (!Array.isArray(v))
			throw new Error(
				`parquet: ${column.name} needs lists ${depth} levels deep`,
			);
		if (v.length === 0) {
			rep.push(r);
			def.push(level);
			return;
		}
		for (const [i, x] of v.entries())
			walk(x, level + 1, i === 0 ? r : level + 1);
	};
	for (const v of column.values) walk(v, 0, 0);
	return { values, rep, def };
}

/** RLE/bit-packed hybrid levels (RLE runs only), with their 4-byte length. */
function levels(data: number[], max: number): Uint8Array {
	const width = Math.ceil(Math.log2(max + 1));
	const bytesPerValue = Math.ceil(width / 8);
	const out: number[] = [];
	const varint = (v: number) => {
		let x = v;
		while (x >= 0x80) {
			out.push((x & 0x7f) | 0x80);
			x >>>= 7;
		}
		out.push(x);
	};
	for (let i = 0; i < data.length; ) {
		let j = i;
		while (j < data.length && data[j] === data[i]) j++;
		varint((j - i) << 1);
		for (let b = 0; b < bytesPerValue; b++)
			out.push((data[i] >> (8 * b)) & 0xff);
		i = j;
	}
	const result = new Uint8Array(4 + out.length);
	new DataView(result.buffer).setUint32(0, out.length, true);
	result.set(out, 4);
	return result;
}

function plain(
	type: ParquetType,
	values: Array<number | bigint | boolean | string>,
): Uint8Array {
	switch (type) {
		case "bool": {
			const out = new Uint8Array(Math.ceil(values.length / 8));
			values.forEach((v, i) => {
				if (v) out[i >> 3] |= 1 << (i & 7);
			});
			return out;
		}
		case "int64": {
			const out = new BigInt64Array(values.length);
			values.forEach((v, i) => {
				out[i] = BigInt(v as number | bigint);
			});
			return new Uint8Array(out.buffer);
		}
		case "float32":
			return new Uint8Array(Float32Array.from(values as number[]).buffer);
		case "float64":
			return new Uint8Array(Float64Array.from(values as number[]).buffer);
		case "string": {
			const parts = values.map((v) => new TextEncoder().encode(String(v)));
			const out = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
			const view = new DataView(out.buffer);
			let o = 0;
			for (const p of parts) {
				view.setUint32(o, p.length, true);
				out.set(p, o + 4);
				o += 4 + p.length;
			}
			return out;
		}
	}
}

function concat(parts: Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let o = 0;
	for (const p of parts) {
		out.set(p, o);
		o += p.length;
	}
	return out;
}

/** The schema path of a column's leaf: name, then list/element per level. */
function leafPath(column: ParquetColumn): string[] {
	const path = [column.name];
	for (let k = 0; k < (column.depth ?? 0); k++) path.push("list", "element");
	return path;
}

/**
 * A Parquet file of `columns` (all the same number of rows).
 * `metadata` lands in the footer's key-value metadata (e.g. `pandas`).
 */
export function encodeParquet(
	columns: ParquetColumn[],
	metadata: Record<string, string> = {},
): Uint8Array {
	const rows = columns[0]?.values.length ?? 0;
	for (const c of columns)
		if (c.values.length !== rows)
			throw new Error(
				`parquet: ${c.name} has ${c.values.length} rows, ${columns[0].name} ${rows}`,
			);
	const magic = new TextEncoder().encode("PAR1");
	const parts: Uint8Array[] = [magic];
	let offset = magic.length;
	const chunks: Array<{
		column: ParquetColumn;
		offset: number;
		size: number;
		count: number;
	}> = [];
	for (const column of columns) {
		const depth = column.depth ?? 0;
		const { values, rep, def } = shred(column);
		const body = concat([
			...(depth > 0 ? [levels(rep, depth), levels(def, depth)] : []),
			plain(column.type, values),
		]);
		const header = Thrift.encode((t) =>
			t
				.i32(1, 0) // DATA_PAGE
				.i32(2, body.length)
				.i32(3, body.length)
				.struct(5, (h) =>
					h
						.i32(1, rep.length || values.length)
						.i32(2, PLAIN)
						.i32(3, RLE)
						.i32(4, RLE),
				),
		);
		chunks.push({
			column,
			offset,
			size: header.length + body.length,
			count: rep.length || values.length,
		});
		parts.push(header, body);
		offset += header.length + body.length;
	}
	const footer = Thrift.encode((t) => {
		t.i32(1, 1);
		// Schema: the root, then per column its LIST groups and its leaf.
		const schema: Array<(s: Thrift) => void> = [
			(s) => s.string(4, "schema").i32(5, columns.length),
		];
		for (const c of columns) {
			const depth = c.depth ?? 0;
			for (let k = 0; k < depth; k++) {
				const name = k === 0 ? c.name : "element";
				schema.push((s) =>
					s.i32(3, REQUIRED).string(4, name).i32(5, 1).i32(6, LIST),
				);
				schema.push((s) => s.i32(3, REPEATED).string(4, "list").i32(5, 1));
			}
			const leaf = depth === 0 ? c.name : "element";
			schema.push((s) => {
				s.i32(1, PHYSICAL[c.type]).i32(3, REQUIRED).string(4, leaf);
				if (c.type === "string") s.i32(6, UTF8);
			});
		}
		t.structList(2, schema, (s, fill) => fill(s));
		t.i64(3, rows);
		t.structList(4, [0], (rg) => {
			rg.structList(1, chunks, (cc, ch) =>
				cc.i64(2, ch.offset).struct(3, (m) =>
					m
						.i32(1, PHYSICAL[ch.column.type])
						.i32List(2, [PLAIN, RLE])
						.stringList(3, leafPath(ch.column))
						.i32(4, 0) // UNCOMPRESSED
						.i64(5, ch.count)
						.i64(6, ch.size)
						.i64(7, ch.size)
						.i64(9, ch.offset),
				),
			);
			rg.i64(
				2,
				chunks.reduce((n, ch) => n + ch.size, 0),
			);
			rg.i64(3, rows);
		});
		const kv = Object.entries(metadata);
		if (kv.length)
			t.structList(5, kv, (s, [k, v]) => s.string(1, k).string(2, v));
		t.string(6, "framefields");
	});
	const length = new Uint8Array(4);
	new DataView(length.buffer).setUint32(0, footer.length, true);
	parts.push(footer, length, magic);
	return concat(parts);
}
