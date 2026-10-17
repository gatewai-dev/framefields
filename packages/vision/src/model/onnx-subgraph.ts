/**
 * Cuts an ONNX model down to the nodes that compute a chosen set of tensors,
 * which become the graph's outputs. Works on the protobuf wire format directly
 * (only the fields it needs are decoded; everything else is copied byte for
 * byte), so it needs no protobuf library and keeps the weights untouched.
 *
 * Used to run a detector's fixed-shape body on the GPU and do its
 * data-dependent tail (top-k, NMS, mask assembly) ourselves.
 */

import {
	concat,
	encoder,
	fields,
	firstString,
	GRAPH_INITIALIZER,
	GRAPH_INPUT,
	GRAPH_NODE,
	GRAPH_OUTPUT,
	GRAPH_VALUE_INFO,
	lengthDelimited,
	MODEL_GRAPH,
	NODE_INPUT,
	NODE_OUTPUT,
	strings,
	TENSOR_NAME,
	VALUE_INFO_NAME,
	WIRE_LEN,
} from "./onnx-proto.js";

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
