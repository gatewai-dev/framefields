/**
 * onnxruntime-web 1.30's WebGPU EP computes grouped convolutions wrong in its
 * default NHWC layout when a group has more than one channel and the count
 * isn't a multiple of 4 (RTMO's head: 18 per group → duplicate skeletons).
 * NCHW is correct but ~30% slower, so only models with such a convolution get
 * it. Depthwise convolutions (one channel per group: RTMDet-Ins, Selfie) are
 * fine in NHWC.
 */

import {
	fields,
	firstString,
	GRAPH_INITIALIZER,
	GRAPH_NODE,
	MODEL_GRAPH,
	NODE_INPUT,
	readVarint,
	strings,
	TENSOR_NAME,
	WIRE_LEN,
	WIRE_VARINT,
} from "./onnx-proto.js";

const NODE_OP_TYPE = 4;
const NODE_ATTRIBUTE = 5;
const NODE_OUTPUT = 2;
const ATTR_NAME = 1;
const ATTR_I = 3;
const ATTR_T = 5;
const TENSOR_DIMS = 1;

function varintValues(field: {
	wire: number;
	raw: Uint8Array;
	body: Uint8Array;
}): number[] {
	const values: number[] = [];
	if (field.wire === WIRE_LEN) {
		let pos = 0;
		while (pos < field.body.length) {
			const [value, next] = readVarint(field.body, pos);
			values.push(value);
			pos = next;
		}
	} else if (field.wire === WIRE_VARINT) {
		let pos = 0;
		pos = readVarint(field.raw, pos)[1]; // tag
		values.push(readVarint(field.raw, pos)[0]);
	}
	return values;
}

function tensorDims(tensor: Uint8Array): number[] {
	return fields(tensor)
		.filter((f) => f.number === TENSOR_DIMS)
		.flatMap(varintValues);
}

/**
 * True when the model has a grouped convolution the NHWC kernels get wrong,
 * and when it can't be read (NCHW is always correct).
 */
export function needsNchwLayout(model: Uint8Array): boolean {
	let graph: ReturnType<typeof fields>[number] | undefined;
	try {
		graph = fields(model).find(
			(f) => f.number === MODEL_GRAPH && f.wire === WIRE_LEN,
		);
	} catch {
		return true;
	}
	if (!graph) return true;
	const dims = new Map<string, number[]>();
	const convs: { weight: string; group: number }[] = [];
	for (const f of fields(graph.body)) {
		if (f.number === GRAPH_INITIALIZER) {
			const name = firstString(f.body, TENSOR_NAME);
			if (name !== undefined) dims.set(name, tensorDims(f.body));
		} else if (f.number === GRAPH_NODE) {
			const op = firstString(f.body, NODE_OP_TYPE);
			if (op !== "Conv" && op !== "Constant") continue;
			const attributes = fields(f.body)
				.filter((a) => a.number === NODE_ATTRIBUTE)
				.map((a) => a.body);
			if (op === "Constant") {
				const value = attributes.find(
					(a) => firstString(a, ATTR_NAME) === "value",
				);
				const tensor = value && fields(value).find((a) => a.number === ATTR_T);
				const output = strings(f.body, NODE_OUTPUT)[0];
				if (tensor && output) dims.set(output, tensorDims(tensor.body));
				continue;
			}
			const groupAttr = attributes.find(
				(a) => firstString(a, ATTR_NAME) === "group",
			);
			const groupField =
				groupAttr && fields(groupAttr).find((a) => a.number === ATTR_I);
			const group = groupField ? (varintValues(groupField)[0] ?? 1) : 1;
			const weight = strings(f.body, NODE_INPUT)[1];
			if (group > 1 && weight) convs.push({ weight, group });
		}
	}
	return convs.some(({ weight }) => {
		const perGroup = dims.get(weight)?.[1];
		return perGroup !== undefined && perGroup > 1 && perGroup % 4 !== 0;
	});
}
