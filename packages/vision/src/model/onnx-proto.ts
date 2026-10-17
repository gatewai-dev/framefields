/**
 * Minimal ONNX protobuf wire-format helpers: split a message into fields,
 * read strings, write length-delimited fields. Only what the graph editors
 * (onnx-subgraph.ts, onnx-float16.ts) need; unknown fields are copied as raw
 * bytes, so nothing else in a model is touched.
 */

// ModelProto.graph, GraphProto.{node,initializer,input,output,value_info},
// NodeProto.{input,output}, ValueInfoProto.name, TensorProto.name.
export const MODEL_GRAPH = 7;
export const GRAPH_NODE = 1;
export const GRAPH_INITIALIZER = 5;
export const GRAPH_INPUT = 11;
export const GRAPH_OUTPUT = 12;
export const GRAPH_VALUE_INFO = 13;
export const NODE_INPUT = 1;
export const NODE_OUTPUT = 2;
export const VALUE_INFO_NAME = 1;
export const TENSOR_NAME = 8;

export const WIRE_VARINT = 0;
export const WIRE_I64 = 1;
export const WIRE_LEN = 2;
export const WIRE_I32 = 5;

export interface Field {
	readonly number: number;
	readonly wire: number;
	/** The whole field: tag, length prefix and payload. */
	readonly raw: Uint8Array;
	/** Payload of a length-delimited field. */
	readonly body: Uint8Array;
}

export function readVarint(buf: Uint8Array, pos: number): [number, number] {
	let value = 0;
	let scale = 1;
	for (;;) {
		if (pos >= buf.length) throw new Error("ONNX model: truncated varint");
		const byte = buf[pos++] as number;
		value += (byte & 0x7f) * scale;
		if (byte < 0x80) return [value, pos];
		scale *= 128;
	}
}

export function fields(buf: Uint8Array): Field[] {
	const out: Field[] = [];
	let pos = 0;
	while (pos < buf.length) {
		const start = pos;
		const [tag, afterTag] = readVarint(buf, pos);
		pos = afterTag;
		const number = Math.floor(tag / 8);
		const wire = tag & 7;
		let body = buf.subarray(pos, pos);
		if (wire === WIRE_VARINT) {
			pos = readVarint(buf, pos)[1];
		} else if (wire === WIRE_I64) {
			pos += 8;
		} else if (wire === WIRE_I32) {
			pos += 4;
		} else if (wire === WIRE_LEN) {
			const [length, afterLength] = readVarint(buf, pos);
			body = buf.subarray(afterLength, afterLength + length);
			pos = afterLength + length;
		} else {
			throw new Error(`ONNX model: unsupported wire type ${wire}`);
		}
		if (pos > buf.length) throw new Error("ONNX model: truncated field");
		out.push({ number, wire, raw: buf.subarray(start, pos), body });
	}
	return out;
}

export const decoder = new TextDecoder();
export const encoder = new TextEncoder();

export function strings(buf: Uint8Array, number: number): string[] {
	return fields(buf)
		.filter((f) => f.number === number && f.wire === WIRE_LEN)
		.map((f) => decoder.decode(f.body));
}

export function firstString(
	buf: Uint8Array,
	number: number,
): string | undefined {
	return strings(buf, number)[0];
}

export function varint(value: number): number[] {
	const bytes: number[] = [];
	while (value >= 0x80) {
		bytes.push((value % 128) | 0x80);
		value = Math.floor(value / 128);
	}
	bytes.push(value);
	return bytes;
}

export function lengthDelimited(
	number: number,
	payload: Uint8Array,
): Uint8Array {
	const head = [...varint(number * 8 + WIRE_LEN), ...varint(payload.length)];
	const out = new Uint8Array(head.length + payload.length);
	out.set(head, 0);
	out.set(payload, head.length);
	return out;
}

export function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}
