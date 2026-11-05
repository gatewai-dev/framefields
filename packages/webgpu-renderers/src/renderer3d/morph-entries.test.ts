/**
 * Morph targets regroup by vertex the same way whether they arrive dense or
 * sparse: only moved vertices get entries, in target order.
 */
import { describe, expect, it } from "vitest";
import { denseMorphDeltas, type Mesh3DData } from "../loaders/types.js";
import { morphEntries } from "./morph-pipeline.js";

const mesh = (morphTargets: Mesh3DData["morphTargets"]): Mesh3DData => ({
	positions: new Float32Array(4 * 3),
	normals: new Float32Array(4 * 3),
	uvs: new Float32Array(4 * 2),
	indices: new Uint16Array([0, 1, 2]),
	morphTargets,
});

describe("morphEntries", () => {
	const lift = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 2, 0]);
	const push = new Float32Array([0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
	const sparseLift = {
		indices: Uint32Array.from([1, 3]),
		positions: Float32Array.from([0, 1, 0, 0, 2, 0]),
	};

	it("gives each moved vertex its entries, and none to the rest", () => {
		const { rows, entries } = morphEntries(
			mesh([{ positions: lift }, { positions: push }]),
		);
		expect(Array.from(rows)).toEqual([0, 1, 2, 2, 3]);
		const bits = new Uint32Array(entries.buffer);
		// Vertex 0: target 1 pushes it 3 along z.
		expect([bits[0], entries[3]]).toEqual([1, 3]);
		// Vertex 3: target 0 lifts it 2.
		expect([bits[16], entries[18]]).toEqual([0, 2]);
	});

	it("reads sparse targets to the same entries as dense ones", () => {
		const dense = morphEntries(
			mesh([{ positions: lift }, { positions: push }]),
		);
		const sparse = morphEntries(mesh([sparseLift, { positions: push }]));
		expect(Array.from(sparse.rows)).toEqual(Array.from(dense.rows));
		expect(Array.from(sparse.entries)).toEqual(Array.from(dense.entries));
		expect(Array.from(denseMorphDeltas(sparseLift, 4))).toEqual(
			Array.from(lift),
		);
	});
});
