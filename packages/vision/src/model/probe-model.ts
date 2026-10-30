import { concat, encoder, lengthDelimited, varint } from "./onnx-proto.js";

// ModelProto / GraphProto / NodeProto / ValueInfoProto / TypeProto field numbers.
const MODEL_IR_VERSION = 1;
const MODEL_OPSET_IMPORT = 8;
const MODEL_GRAPH = 7;
const OPSET_VERSION = 2;
const GRAPH_NODE = 1;
const GRAPH_NAME = 2;
const GRAPH_INPUT = 11;
const GRAPH_OUTPUT = 12;
const NODE_INPUT = 1;
const NODE_OUTPUT = 2;
const NODE_OP_TYPE = 4;
const VALUE_NAME = 1;
const VALUE_TYPE = 2;
const TYPE_TENSOR = 1;
const TENSOR_ELEM_TYPE = 1;
const TENSOR_SHAPE = 2;
const SHAPE_DIM = 1;
const DIM_VALUE = 1;
const FLOAT = 1;

const text = (field: number, value: string) =>
	lengthDelimited(field, encoder.encode(value));
const number = (field: number, value: number) =>
	new Uint8Array([...varint(field * 8), ...varint(value)]);

function floatVector(name: string): Uint8Array {
	const dim = lengthDelimited(SHAPE_DIM, number(DIM_VALUE, 1));
	const tensor = concat([
		number(TENSOR_ELEM_TYPE, FLOAT),
		lengthDelimited(TENSOR_SHAPE, dim),
	]);
	return concat([
		text(VALUE_NAME, name),
		lengthDelimited(VALUE_TYPE, lengthDelimited(TYPE_TENSOR, tensor)),
	]);
}

let probe: Uint8Array | undefined;

/**
 * A one-node ONNX model (`y = Identity(x)`, float[1]). Creating a session from it tells
 * whether an execution provider works here before any real model is downloaded.
 */
export function probeModel(): Uint8Array {
	probe ??= concat([
		number(MODEL_IR_VERSION, 8),
		lengthDelimited(MODEL_OPSET_IMPORT, number(OPSET_VERSION, 13)),
		lengthDelimited(
			MODEL_GRAPH,
			concat([
				lengthDelimited(
					GRAPH_NODE,
					concat([
						text(NODE_INPUT, "x"),
						text(NODE_OUTPUT, "y"),
						text(NODE_OP_TYPE, "Identity"),
					]),
				),
				text(GRAPH_NAME, "probe"),
				lengthDelimited(GRAPH_INPUT, floatVector("x")),
				lengthDelimited(GRAPH_OUTPUT, floatVector("y")),
			]),
		),
	]);
	return probe;
}
