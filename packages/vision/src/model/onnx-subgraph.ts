/**
 * Cuts an ONNX model down to the nodes that compute a chosen set of tensors,
 * which become the graph's outputs. Works on the protobuf wire format directly
 * (only the fields it needs are decoded; everything else is copied byte for
 * byte), so it needs no protobuf library and keeps the weights untouched.
 *
 * Used to run a detector's fixed-shape body on the GPU and do its
 * data-dependent tail (top-k, NMS, mask assembly) ourselves.
 */

// ModelProto.graph, GraphProto.{node,initializer,input,output,value_info},
// NodeProto.{input,output}, ValueInfoProto.name, TensorProto.name.
const MODEL_GRAPH = 7;
const GRAPH_NODE = 1;
const GRAPH_INITIALIZER = 5;
const GRAPH_INPUT = 11;
const GRAPH_OUTPUT = 12;
const GRAPH_VALUE_INFO = 13;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const VALUE_INFO_NAME = 1;
const TENSOR_NAME = 8;

const WIRE_VARINT = 0;
const WIRE_I64 = 1;
const WIRE_LEN = 2;
const WIRE_I32 = 5;

interface Field {
	readonly number: number;
	readonly wire: number;
	/** The whole field: tag, length prefix and payload. */
	readonly raw: Uint8Array;
	/** Payload of a length-delimited field. */
	readonly body: Uint8Array;
}

function readVarint(buf: Uint8Array, pos: number): [number, number] {
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

function fields(buf: Uint8Array): Field[] {
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

const decoder = new TextDecoder();
const encoder = new TextEncoder();

function strings(buf: Uint8Array, number: number): string[] {
	return fields(buf)
		.filter((f) => f.number === number && f.wire === WIRE_LEN)
		.map((f) => decoder.decode(f.body));
}

function firstString(buf: Uint8Array, number: number): string | undefined {
	return strings(buf, number)[0];
}

function varint(value: number): number[] {
	const bytes: number[] = [];
	while (value >= 0x80) {
		bytes.push((value % 128) | 0x80);
		value = Math.floor(value / 128);
	}
	bytes.push(value);
	return bytes;
}

function lengthDelimited(number: number, payload: Uint8Array): Uint8Array {
	const head = [...varint(number * 8 + WIRE_LEN), ...varint(payload.length)];
	const out = new Uint8Array(head.length + payload.length);
	out.set(head, 0);
	out.set(payload, head.length);
	return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const part of parts) {
		out.set(part, offset);
		offset += part.length;
	}
	return out;
}

/** ValueInfoProto for a float tensor of unknown shape. */
function floatOutput(name: string): Uint8Array {
	// TypeProto.tensor_type (1) { elem_type (1) = FLOAT (1) }
	const tensorType = new Uint8Array([0x08, 0x01]);
	const typeProto = lengthDelimited(1, tensorType);
	return concat([
		lengthDelimited(VALUE_INFO_NAME, encoder.encode(name)),
		lengthDelimited(2, typeProto),
	]);
}

/**
 * Returns a model whose outputs are `outputs` (tensors of the original graph),
 * keeping only the nodes, initializers and inputs needed to compute them.
 * Output types come from the graph's value_info when present; otherwise they
 * are declared as float tensors.
 */
export function extractSubgraph(
	model: Uint8Array,
	outputs: readonly string[],
): Uint8Array {
	const modelFields = fields(model);
	const graphField = modelFields.find(
		(f) => f.number === MODEL_GRAPH && f.wire === WIRE_LEN,
	);
	if (!graphField) throw new Error("ONNX model has no graph");
	const graphFields = fields(graphField.body);

	const nodes = graphFields
		.filter((f) => f.number === GRAPH_NODE)
		.map((f) => ({
			field: f,
			inputs: strings(f.body, NODE_INPUT),
			outputs: strings(f.body, NODE_OUTPUT),
		}));
	const producer = new Map<string, number>();
	nodes.forEach((node, index) => {
		for (const name of node.outputs) producer.set(name, index);
	});

	// Walk back from the requested tensors.
	const keepNode = new Set<number>();
	const needed = new Set<string>();
	const stack = [...outputs];
	for (const name of outputs) {
		if (!producer.has(name)) {
			throw new Error(`ONNX model has no tensor '${name}'`);
		}
	}
	while (stack.length > 0) {
		const name = stack.pop() as string;
		if (needed.has(name)) continue;
		needed.add(name);
		const index = producer.get(name);
		if (index === undefined || keepNode.has(index)) continue;
		keepNode.add(index);
		for (const input of (nodes[index] as { inputs: string[] }).inputs) {
			if (input) stack.push(input);
		}
	}

	const valueInfo = new Map<string, Uint8Array>();
	for (const f of graphFields) {
		if (f.number !== GRAPH_VALUE_INFO) continue;
		const name = firstString(f.body, VALUE_INFO_NAME);
		if (name !== undefined) valueInfo.set(name, f.body);
	}

	const parts: Uint8Array[] = [];
	let nodeIndex = 0;
	for (const f of graphFields) {
		switch (f.number) {
			case GRAPH_NODE:
				if (keepNode.has(nodeIndex)) parts.push(f.raw);
				nodeIndex++;
				break;
			case GRAPH_INITIALIZER: {
				const name = firstString(f.body, TENSOR_NAME);
				if (name !== undefined && needed.has(name)) parts.push(f.raw);
				break;
			}
			case GRAPH_INPUT:
			case GRAPH_VALUE_INFO: {
				const name = firstString(f.body, VALUE_INFO_NAME);
				if (name !== undefined && needed.has(name)) parts.push(f.raw);
				break;
			}
			case GRAPH_OUTPUT:
				break;
			default:
				parts.push(f.raw);
		}
	}
	for (const name of outputs) {
		parts.push(
			lengthDelimited(GRAPH_OUTPUT, valueInfo.get(name) ?? floatOutput(name)),
		);
	}

	const graph = concat(parts);
	return concat(
		modelFields.map((f) =>
			f === graphField ? lengthDelimited(MODEL_GRAPH, graph) : f.raw,
		),
	);
}
