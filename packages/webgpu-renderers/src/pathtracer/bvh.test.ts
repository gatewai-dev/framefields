import { describe, expect, it } from "vitest";
import {
	BVH_NODE_FLOATS,
	buildBinnedSahBvh,
	bvhCost,
	flattenBvh,
	refitBvh,
} from "./bvh.js";
import { Blas, deformPose, TRIANGLE_FLOATS, unitQuadMesh } from "./geometry.js";

function randomBoxes(count: number, seed = 1): Float32Array {
	let s = seed;
	const rand = () => {
		s = (s * 1664525 + 1013904223) >>> 0;
		return s / 2 ** 32;
	};
	const boxes = new Float32Array(count * 6);
	for (let i = 0; i < count; i++) {
		for (let k = 0; k < 3; k++) {
			const c = rand() * 1000;
			const h = rand() * 10;
			boxes[i * 6 + k] = c - h;
			boxes[i * 6 + 3 + k] = c + h;
		}
	}
	return boxes;
}

/** Every leaf primitive lies inside its leaf, every child inside its parent. */
function checkTree(boxes: Float32Array, count: number) {
	const flat = flattenBvh(buildBinnedSahBvh(boxes, count));
	const words = new Uint32Array(flat.nodes.buffer);
	const seen = new Set<number>();
	const inside = (o: number, min: ArrayLike<number>, max: ArrayLike<number>) =>
		[0, 1, 2].every(
			(k) =>
				flat.nodes[o + k] <= min[k] + 1e-3 &&
				flat.nodes[o + 4 + k] >= max[k] - 1e-3,
		);
	for (let n = 0; n < flat.nodeCount; n++) {
		const o = n * BVH_NODE_FLOATS;
		const first = words[o + 3];
		const prims = words[o + 7];
		if (prims === 0) {
			for (const c of [first, first + 1]) {
				const co = c * BVH_NODE_FLOATS;
				expect(c).toBeGreaterThan(n);
				expect(
					inside(
						o,
						flat.nodes.subarray(co, co + 3),
						flat.nodes.subarray(co + 4, co + 7),
					),
				).toBe(true);
			}
			continue;
		}
		for (let slot = first; slot < first + prims; slot++) {
			const p = flat.primOrder[slot];
			seen.add(p);
			expect(
				inside(
					o,
					boxes.subarray(p * 6, p * 6 + 3),
					boxes.subarray(p * 6 + 3, p * 6 + 6),
				),
			).toBe(true);
		}
	}
	expect(seen.size).toBe(count);
	return flat;
}

describe("path tracer BVH", () => {
	it("covers every primitive with nested boxes", () => {
		for (const count of [1, 2, 3, 17, 1000]) {
			checkTree(randomBoxes(count, count), count);
		}
	});

	it("represents an empty tree as one leaf no ray enters", () => {
		const flat = flattenBvh(buildBinnedSahBvh(new Float32Array(0), 0));
		expect(flat.nodeCount).toBe(1);
		expect(flat.nodes[0]).toBeGreaterThan(flat.nodes[4]);
	});

	it("splits coincident boxes into a valid leaf", () => {
		const boxes = new Float32Array(60);
		for (let i = 0; i < 10; i++) boxes.set([0, 0, 0, 1, 1, 1], i * 6);
		checkTree(boxes, 10);
	});

	it("refits to moved primitives without changing the cost of a rigid move", () => {
		const count = 200;
		const boxes = randomBoxes(count, 7);
		const flat = checkTree(boxes, count);
		const before = bvhCost(flat);
		const moved = new Float32Array(count * 6);
		for (let slot = 0; slot < count; slot++) {
			const p = flat.primOrder[slot];
			for (let k = 0; k < 6; k++) moved[slot * 6 + k] = boxes[p * 6 + k] + 50;
		}
		refitBvh(flat, moved);
		expect(flat.nodes[0]).toBeCloseTo(
			Math.min(...Array.from({ length: count }, (_, i) => boxes[i * 6])) + 50,
			3,
		);
		expect(bvhCost(flat)).toBeCloseTo(before, 4);
	});
});

describe("path tracer geometry", () => {
	it("stores triangles in leaf order with their attributes", () => {
		const quad = unitQuadMesh();
		const blas = new Blas(quad);
		expect(blas.triangleCount).toBe(2);
		expect(blas.records.length).toBe(2 * TRIANGLE_FLOATS);
		const words = new Uint32Array(blas.records.buffer);
		// No vertex colors: white.
		expect(words[24]).toBe(0xffffffff);
		// Normals face -z.
		expect(blas.records[14]).toBe(-1);
	});

	it("skins and morphs as the vertex shader does", () => {
		const quad = unitQuadMesh();
		quad.morphTargets = [{ positions: new Float32Array(12).fill(1) }];
		quad.jointIndices = new Float32Array(16);
		quad.jointWeights = new Float32Array(16);
		for (let v = 0; v < 4; v++) quad.jointWeights[v * 4] = 1;
		// Joint 0 translates by (10, 0, 0).
		const joints = new Float32Array([
			1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1,
		]);
		const pose = deformPose(quad, [0.5], joints);
		expect(Array.from(pose.positions.subarray(0, 3))).toEqual([10, 0, 0.5]);
		const blas = new Blas(quad);
		blas.update(pose);
		expect(blas.version).toBe(1);
		expect(blas.flat.nodes[0]).toBeCloseTo(10, 5);
	});
});
