import { describe, expect, it } from "vitest";
import { extractSubgraph } from "./onnx-subgraph.js";

// A hand-encoded ONNX graph: x → A → a → B → b → C → c, plus an initializer
// `w` read by B and an unrelated node D → d.
const enc = new TextEncoder();
const dec = new TextDecoder();

function varint(n: number): number[] {
	const out: number[] = [];
	while (n >= 0x80) {
		out.push((n % 128) | 0x80);
		n = Math.floor(n / 128);
	}
	out.push(n);
	return out;
}

function field(number: number, payload: Uint8Array | string): number[] {
	const bytes = typeof payload === "string" ? enc.encode(payload) : payload;
	return [...varint(number * 8 + 2), ...varint(bytes.length), ...bytes];
}

const bytes = (parts: number[][]) => new Uint8Array(parts.flat());

const node = (op: string, inputs: string[], outputs: string[]) =>
	bytes([
		...inputs.map((i) => field(1, i)),
		...outputs.map((o) => field(2, o)),
		field(4, op),
	]);

const valueInfo = (name: string) => bytes([field(1, name)]);

const graph = bytes([
	field(1, node("A", ["x"], ["a"])),
	field(1, node("B", ["a", "w"], ["b"])),
	field(1, node("C", ["b"], ["c"])),
	field(1, node("D", ["x"], ["d"])),
	field(2, "g"),
	field(5, bytes([field(8, "w")])),
	field(5, bytes([field(8, "unused")])),
	field(11, valueInfo("x")),
	field(12, valueInfo("c")),
	field(12, valueInfo("d")),
	field(13, valueInfo("b")),
]);
// ir_version 8, graph, opset_import { version 17 }.
const model = new Uint8Array([
	0x08,
	0x08,
	...field(7, graph),
	...field(8, new Uint8Array([0x10, 0x11])),
]);

/** Decodes the length-delimited fields we care about, by number. */
function read(buf: Uint8Array): Map<number, Uint8Array[]> {
	const out = new Map<number, Uint8Array[]>();
	let pos = 0;
	const v = () => {
		let n = 0;
		let s = 1;
		for (;;) {
			const b = buf[pos++] as number;
			n += (b & 0x7f) * s;
			if (b < 0x80) return n;
			s *= 128;
		}
	};
	while (pos < buf.length) {
		const tag = v();
		if ((tag & 7) === 0) {
			v();
			continue;
		}
		const len = v();
		const list = out.get(tag >> 3) ?? [];
		list.push(buf.subarray(pos, pos + len));
		out.set(tag >> 3, list);
		pos += len;
	}
	return out;
}

const names = (list: Uint8Array[] | undefined, nameField: number) =>
	(list ?? []).map((m) => dec.decode(read(m).get(nameField)?.[0]));

describe("extractSubgraph", () => {
	it("keeps only what the requested tensors need, and makes them the outputs", () => {
		const cut = read(extractSubgraph(model, ["b"]));
		const g = read((cut.get(7) as Uint8Array[])[0] as Uint8Array);
		expect(
			(g.get(1) ?? []).map((n) => dec.decode(read(n).get(4)?.[0])),
		).toEqual(["A", "B"]);
		expect(names(g.get(5), 8)).toEqual(["w"]);
		expect(names(g.get(11), 1)).toEqual(["x"]);
		expect(names(g.get(12), 1)).toEqual(["b"]);
		// Other model fields (opset import) and the graph name are kept.
		expect(cut.get(8)).toHaveLength(1);
		expect(dec.decode(g.get(2)?.[0])).toBe("g");
	});

	it("declares outputs without value_info as float tensors", () => {
		const g = read(
			(
				read(extractSubgraph(model, ["a", "c"])).get(7) as Uint8Array[]
			)[0] as Uint8Array,
		);
		const outputs = g.get(12) ?? [];
		expect(names(outputs, 1)).toEqual(["a", "c"]);
		// type { tensor_type { elem_type: FLOAT } }
		const type = read(outputs[0] as Uint8Array).get(2)?.[0] as Uint8Array;
		expect([...(read(type).get(1)?.[0] ?? [])]).toEqual([0x08, 0x01]);
	});

	it("rejects tensors the graph doesn't produce", () => {
		expect(() => extractSubgraph(model, ["nope"])).toThrow(/no tensor 'nope'/);
	});

	it("rejects bytes that aren't a model", () => {
		expect(() =>
			extractSubgraph(new Uint8Array([1, 2, 3, 4]), ["b"]),
		).toThrow();
	});
});
