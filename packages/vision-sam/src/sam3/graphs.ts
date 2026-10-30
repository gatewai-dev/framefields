/** SAM 3's small prompt/position heads, assembled from the pinned upstream weights.
 * The video export omits dense prompts and learned temporal constants. These heads
 * restore the original operations, without approximating a semantic mask by clicks.
 */
import {
	concat,
	encoder,
	fields,
	firstString,
	lengthDelimited as ld,
	readVarint,
	strings,
	varint,
} from "@framefields/vision";

function integer(field: number, value: number): Uint8Array {
	return new Uint8Array([...varint(field * 8), ...varint(value)]);
}
function text(field: number, value: string): Uint8Array {
	return ld(field, encoder.encode(value));
}
function attribute(name: string, values: readonly number[]): Uint8Array {
	return ld(
		5,
		concat([
			text(1, name),
			integer(20, 7),
			ld(8, new Uint8Array(values.flatMap(varint))),
		]),
	);
}
function intAttribute(name: string, value: number): Uint8Array {
	return ld(5, concat([text(1, name), integer(3, value), integer(20, 2)]));
}
function floatAttribute(name: string, value: number): Uint8Array {
	const bytes = new Uint8Array(4);
	new DataView(bytes.buffer).setFloat32(0, value, true);
	return ld(
		5,
		concat([text(1, name), new Uint8Array([21, ...bytes]), integer(20, 1)]),
	);
}
function node(
	op: string,
	inputs: readonly string[],
	output: string,
	attrs: readonly Uint8Array[] = [],
): Uint8Array {
	return ld(
		1,
		concat([
			...inputs.map((x) => text(1, x)),
			text(2, output),
			text(4, op),
			...attrs,
		]),
	);
}
function value(name: string, dims: readonly number[]): Uint8Array {
	const shape = concat(dims.map((d) => ld(1, integer(1, d))));
	return concat([
		text(1, name),
		ld(2, ld(1, concat([integer(1, 1), ld(2, shape)]))),
	]);
}
function scalar(name: string, amount: number): Uint8Array {
	const data = new Float32Array([amount]);
	return concat([
		integer(2, 1),
		text(8, name),
		ld(9, new Uint8Array(data.buffer)),
	]);
}
function model(
	nodes: readonly Uint8Array[],
	inputs: readonly [string, readonly number[]][],
	outputs: readonly [string, readonly number[]][],
	weights: readonly Uint8Array[],
): Uint8Array {
	const graph = concat([
		...nodes,
		text(2, "framefields_sam3"),
		...weights.map((w) => ld(5, w)),
		...inputs.map(([n, d]) => ld(11, value(n, d))),
		...outputs.map(([n, d]) => ld(12, value(n, d))),
	]);
	return concat([integer(1, 9), ld(7, graph), ld(8, integer(2, 18))]);
}
interface Weight {
	readonly proto: Uint8Array;
	readonly data: Float32Array;
}
function weightsFrom(
	modelBytes: Uint8Array,
	external: Uint8Array,
): Map<string, Weight> {
	const graph = fields(modelBytes).find((f) => f.number === 7);
	if (!graph) throw new Error("SAM 3 constants graph is missing.");
	const result = new Map<string, Weight>();
	for (const entry of fields(graph.body).filter((f) => f.number === 5)) {
		const fs = fields(entry.body),
			name = firstString(entry.body, 8);
		if (
			!name ||
			!/tracker\.(maskmem_tpos_enc|no_mem_embed|obj_ptr_tpos_proj|sam_prompt_encoder\.mask_downscaling)/.test(
				name,
			)
		)
			continue;
		const metadata = new Map(
			fs
				.filter((f) => f.number === 13)
				.map((f) => [firstString(f.body, 1), firstString(f.body, 2)]),
		);
		const offset = Number(metadata.get("offset") ?? 0),
			length = Number(metadata.get("length") ?? 0);
		const raw =
			fs.find((f) => f.number === 9)?.body ??
			external.subarray(offset, offset + length);
		const dataType = fs.find((f) => f.number === 2);
		const dtype = dataType ? readVarint(dataType.raw, 1)[0] : 0;
		if (![1, 10].includes(dtype))
			throw new Error(`Unsupported SAM 3 weight type: ${name}`);
		if (raw.length === 0 || raw.length % (dtype === 10 ? 2 : 4) !== 0)
			throw new Error(`Invalid SAM 3 weight: ${name}`);
		const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
		const data = Float32Array.from(
			{ length: raw.length / (dtype === 10 ? 2 : 4) },
			(_, i) => {
				if (dtype === 1) return view.getFloat32(i * 4, true);
				const bits = view.getUint16(i * 2, true),
					sign = bits & 0x8000 ? -1 : 1,
					exponent = (bits >> 10) & 31,
					fraction = bits & 1023;
				if (exponent === 31) throw new Error(`Non-finite SAM 3 weight ${name}`);
				return (
					sign *
					(exponent === 0
						? fraction * 2 ** -24
						: (1 + fraction / 1024) * 2 ** (exponent - 15))
				);
			},
		);
		const copy = new Uint8Array(data.buffer);
		result.set(name, {
			proto: concat([
				...fs
					.filter((f) => ![2, 9, 13, 14].includes(f.number))
					.map((f) => f.raw),
				integer(2, 1),
				ld(9, copy),
			]),
			data: new Float32Array(copy.buffer),
		});
	}
	return result;
}
export function sam3SupportGraphs(
	reference: Uint8Array,
	external: Uint8Array,
): {
	densePrompt: Uint8Array;
	pointerPosition: Uint8Array;
	temporal: Float32Array;
	noMemory: Float32Array;
} {
	const weights = weightsFrom(reference, external);
	const get = (name: string): Weight => {
		const item = weights.get(`tracker.${name}`);
		if (!item) throw new Error(`Missing SAM 3 weight ${name}`);
		return item;
	};
	const nodes: Uint8Array[] = [],
		denseWeights: Uint8Array[] = [
			scalar("sqrt2", Math.SQRT2),
			scalar("one", 1),
			scalar("half", 0.5),
		];
	let previous = "mask";
	for (const [index, layer] of [0, 3, 6].entries()) {
		const base = `sam_prompt_encoder.mask_downscaling.${layer}`;
		for (const suffix of ["weight", "bias"])
			denseWeights.push(get(`${base}.${suffix}`).proto);
		const output = `conv${index}`;
		nodes.push(
			node(
				"Conv",
				[previous, `tracker.${base}.weight`, `tracker.${base}.bias`],
				output,
				[
					attribute("kernel_shape", layer === 6 ? [1, 1] : [2, 2]),
					attribute("strides", layer === 6 ? [1, 1] : [2, 2]),
				],
			),
		);
		previous = output;
		if (layer === 6) continue;
		const norm = `sam_prompt_encoder.mask_downscaling.${layer + 1}`;
		for (const suffix of ["weight", "bias"])
			denseWeights.push(get(`${norm}.${suffix}`).proto);
		nodes.push(
			node("Transpose", [previous], `nhwc${index}`, [
				attribute("perm", [0, 2, 3, 1]),
			]),
			node(
				"LayerNormalization",
				[`nhwc${index}`, `tracker.${norm}.weight`, `tracker.${norm}.bias`],
				`norm${index}`,
				[intAttribute("axis", 3), floatAttribute("epsilon", 1e-6)],
			),
			node("Transpose", [`norm${index}`], `nchw${index}`, [
				attribute("perm", [0, 3, 1, 2]),
			]),
			node("Div", [`nchw${index}`, "sqrt2"], `div${index}`),
			node("Erf", [`div${index}`], `erf${index}`),
			node("Add", [`erf${index}`, "one"], `add${index}`),
			node("Mul", [`add${index}`, `nchw${index}`], `mul${index}`),
			node("Mul", [`mul${index}`, "half"], `gelu${index}`),
		);
		previous = `gelu${index}`;
	}
	nodes.push(node("Identity", [previous], "dense_prompt"));
	const pointerWeights = [
		get("obj_ptr_tpos_proj.weight").proto,
		get("obj_ptr_tpos_proj.bias").proto,
	];
	return {
		densePrompt: model(
			nodes,
			[["mask", [1, 1, 288, 288]]],
			[["dense_prompt", [1, 256, 72, 72]]],
			denseWeights,
		),
		pointerPosition: model(
			[
				node(
					"Gemm",
					[
						"encoding",
						"tracker.obj_ptr_tpos_proj.weight",
						"tracker.obj_ptr_tpos_proj.bias",
					],
					"position",
					[intAttribute("transB", 1)],
				),
			],
			[["encoding", [16, 256]]],
			[["position", [16, 64]]],
			pointerWeights,
		),
		temporal: get("maskmem_tpos_enc").data,
		noMemory: get("no_mem_embed").data,
	};
}

/** Replace the no-mask embedding by the actual dense prompt head's output. */
export function sam3DenseDecoder(modelBytes: Uint8Array): Uint8Array {
	const modelFields = fields(modelBytes),
		graph = modelFields.find((f) => f.number === 7);
	if (!graph) throw new Error("Missing SAM 3 decoder graph.");
	let replaced = false;
	const graphParts = fields(graph.body).map((f) => {
		if (f.number !== 1 || firstString(f.body, 3) !== "/mask_decoder/Add")
			return f.raw;
		const inputs = strings(f.body, 1);
		if (
			inputs[0] !== "feats2" ||
			inputs[1] !== "/prompt_encoder/Expand_output_0"
		)
			throw new Error("Unexpected SAM 3 dense prompt contract.");
		replaced = true;
		return ld(
			1,
			concat(
				fields(f.body)
					.filter((x) => x.number !== 1)
					.map((x) => x.raw)
					.concat([text(1, "feats2"), text(1, "dense_prompt")]),
			),
		);
	});
	if (!replaced)
		throw new Error("SAM 3 decoder has no prompt embedding input.");
	graphParts.push(ld(11, value("dense_prompt", [1, 256, 72, 72])));
	return concat(
		modelFields.map((f) => (f === graph ? ld(7, concat(graphParts)) : f.raw)),
	);
}
