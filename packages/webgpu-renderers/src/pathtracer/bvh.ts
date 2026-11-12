/**
 * Binned SAH BVH over axis-aligned boxes, and the flat node layout the path
 * tracer's traversal reads.
 *
 * The builder is ported from MuTracer's `binnedSahBvh.ts`
 * (https://github.com/pissang/mutracer, MIT, Copyright (c) 2022-present
 * Yi Shen), itself a port of TinyBVH's reference builder (`BVH::Build`, tiny_bvh.h,
 * https://github.com/jbikker/tinybvh, MIT, Copyright (c) 2024-2026 Jacco
 * Bikker / Breda University of Applied Sciences). See NOTICE.md.
 *
 * It bins primitive centroids into 8 bins on all three axes, sweeps the bins
 * for the lowest surface area heuristic cost and stops splitting when a leaf
 * is cheaper (C_INT = C_TRAV = 1). An interior node's children are stored
 * next to each other at `leftFirst` and `leftFirst + 1`, so traversal reads
 * both boxes from one cache line. Arithmetic is float64.
 */

const BINS = 8;
const C_INT = 1;
const C_TRAV = 1;
const FAR = 1e30;

export interface BinnedSahBvh {
	nodeCount: number;
	/** Per node: min x, y, z, max x, y, z. */
	bounds: Float32Array;
	/** Interior node: index of the left child. Leaf: first slot in `primIndices`. */
	leftFirst: Uint32Array;
	/** Primitive count of a leaf; 0 for interior nodes. */
	primCount: Uint32Array;
	/** Primitive indices referenced by leaves. */
	primIndices: Uint32Array;
}

interface BinScratch {
	binMin: Float64Array;
	binMax: Float64Array;
	binCount: Uint32Array;
	leftCost: Float64Array;
	rightCost: Float64Array;
}

const scratch: BinScratch = {
	binMin: new Float64Array(3 * BINS * 3),
	binMax: new Float64Array(3 * BINS * 3),
	binCount: new Uint32Array(3 * BINS),
	leftCost: new Float64Array(BINS - 1),
	rightCost: new Float64Array(BINS - 1),
};

/** Bin of a centroid along one axis; binning and partitioning both use it. */
function binOf(center: number, nodeMin: number, scale: number): number {
	const bin = ((center - nodeMin) * scale) | 0;
	return bin < 0 ? 0 : bin > BINS - 1 ? BINS - 1 : bin;
}

function growBin(
	s: BinScratch,
	o: number,
	aabbs: Float32Array,
	b: number,
): void {
	for (let k = 0; k < 3; k++) {
		s.binMin[o + k] = Math.min(s.binMin[o + k], aabbs[b + k]);
		s.binMax[o + k] = Math.max(s.binMax[o + k], aabbs[b + 3 + k]);
	}
}

interface NodeBox {
	min: [number, number, number];
	extent: [number, number, number];
	scale: [number, number, number];
	area: number;
}

function nodeBox(
	bounds: Float32Array,
	node: number,
	minDim: number[],
): NodeBox {
	const nb = node * 6;
	const min: [number, number, number] = [
		bounds[nb],
		bounds[nb + 1],
		bounds[nb + 2],
	];
	const extent: [number, number, number] = [
		bounds[nb + 3] - min[0],
		bounds[nb + 4] - min[1],
		bounds[nb + 5] - min[2],
	];
	const scale = extent.map((e, k) => (e > minDim[k] ? BINS / e : 0)) as [
		number,
		number,
		number,
	];
	const area =
		extent[0] * extent[1] + extent[1] * extent[2] + extent[2] * extent[0];
	return { min, extent, scale, area };
}

function fillBins(
	s: BinScratch,
	box: NodeBox,
	aabbs: Float32Array,
	centers: Float32Array,
	primIndices: Uint32Array,
	first: number,
	count: number,
): void {
	s.binMin.fill(FAR);
	s.binMax.fill(-FAR);
	s.binCount.fill(0);
	for (let i = first, end = first + count; i < end; i++) {
		const p = primIndices[i];
		for (let axis = 0; axis < 3; axis++) {
			const bin =
				axis * BINS +
				binOf(centers[p * 3 + axis], box.min[axis], box.scale[axis]);
			s.binCount[bin]++;
			growBin(s, bin * 3, aabbs, p * 6);
		}
	}
}

function halfArea(min: number[], max: number[]): number {
	const x = max[0] - min[0];
	const y = max[1] - min[1];
	const z = max[2] - min[2];
	return x * y + y * z + z * x;
}

/** Sweeps one axis' bins, writing the cost of each split position. */
function sweepAxis(s: BinScratch, axis: number): void {
	const lMin = [FAR, FAR, FAR];
	const lMax = [-FAR, -FAR, -FAR];
	const rMin = [FAR, FAR, FAR];
	const rMax = [-FAR, -FAR, -FAR];
	let leftN = 0;
	let rightN = 0;
	for (let i = 0; i < BINS - 1; i++) {
		const l = (axis * BINS + i) * 3;
		const r = (axis * BINS + BINS - 1 - i) * 3;
		for (let k = 0; k < 3; k++) {
			lMin[k] = Math.min(lMin[k], s.binMin[l + k]);
			lMax[k] = Math.max(lMax[k], s.binMax[l + k]);
			rMin[k] = Math.min(rMin[k], s.binMin[r + k]);
			rMax[k] = Math.max(rMax[k], s.binMax[r + k]);
		}
		leftN += s.binCount[axis * BINS + i];
		rightN += s.binCount[axis * BINS + BINS - 1 - i];
		s.leftCost[i] = leftN === 0 ? FAR : halfArea(lMin, lMax) * leftN;
		s.rightCost[BINS - 2 - i] =
			rightN === 0 ? FAR : halfArea(rMin, rMax) * rightN;
	}
}

interface Split {
	cost: number;
	axis: number;
	pos: number;
}

function bestSplit(s: BinScratch, box: NodeBox, minDim: number[]): Split {
	const split: Split = { cost: FAR, axis: 0, pos: 0 };
	for (let axis = 0; axis < 3; axis++) {
		if (!(box.extent[axis] > minDim[axis])) continue;
		sweepAxis(s, axis);
		for (let i = 0; i < BINS - 1; i++) {
			const cost = s.leftCost[i] + s.rightCost[i];
			if (cost < split.cost) {
				split.cost = cost;
				split.axis = axis;
				split.pos = i;
			}
		}
	}
	split.cost = C_TRAV + (C_INT * split.cost) / box.area;
	return split;
}

/** In-place partition by the chosen bin; returns the first right-side slot. */
function partition(
	primIndices: Uint32Array,
	centers: Float32Array,
	first: number,
	count: number,
	split: Split,
	box: NodeBox,
): number {
	let j = first + count;
	let src = first;
	for (let i = 0; i < count; i++) {
		const p = primIndices[src];
		const bin = binOf(
			centers[p * 3 + split.axis],
			box.min[split.axis],
			box.scale[split.axis],
		);
		if (bin <= split.pos) {
			src++;
		} else {
			j--;
			primIndices[src] = primIndices[j];
			primIndices[j] = p;
		}
	}
	return src;
}

/** Child bounds: the union of the bins on each side of the split. */
function writeChildBounds(
	s: BinScratch,
	bounds: Float32Array,
	left: number,
	split: Split,
): void {
	const leftBase = left * 6;
	const rightBase = leftBase + 6;
	for (let k = 0; k < 3; k++) {
		bounds[leftBase + k] = FAR;
		bounds[rightBase + k] = FAR;
		bounds[leftBase + 3 + k] = -FAR;
		bounds[rightBase + 3 + k] = -FAR;
	}
	for (let i = 0; i < BINS; i++) {
		const o = (split.axis * BINS + i) * 3;
		const base = i <= split.pos ? leftBase : rightBase;
		for (let k = 0; k < 3; k++) {
			bounds[base + k] = Math.min(bounds[base + k], s.binMin[o + k]);
			bounds[base + 3 + k] = Math.max(bounds[base + 3 + k], s.binMax[o + k]);
		}
	}
}

function rootBounds(
	aabbs: Float32Array,
	count: number,
	centers: Float32Array,
	primIndices: Uint32Array,
	bounds: Float32Array,
): void {
	for (let k = 0; k < 3; k++) {
		bounds[k] = FAR;
		bounds[3 + k] = -FAR;
	}
	for (let i = 0; i < count; i++) {
		const b = i * 6;
		for (let k = 0; k < 3; k++) {
			centers[i * 3 + k] = (aabbs[b + k] + aabbs[b + 3 + k]) * 0.5;
			bounds[k] = Math.min(bounds[k], aabbs[b + k]);
			bounds[3 + k] = Math.max(bounds[3 + k], aabbs[b + 3 + k]);
		}
		primIndices[i] = i;
	}
}

/**
 * Builds a binary BVH over boxes.
 * @param aabbs min x, y, z, max x, y, z for each primitive.
 */
export function buildBinnedSahBvh(
	aabbs: Float32Array,
	count: number,
): BinnedSahBvh {
	const capacity = Math.max(1, count * 2 - 1);
	const bounds = new Float32Array(capacity * 6);
	const leftFirst = new Uint32Array(capacity);
	const primCount = new Uint32Array(capacity);
	const primIndices = new Uint32Array(count);
	if (count === 0) {
		return { nodeCount: 0, bounds, leftFirst, primCount, primIndices };
	}
	const centers = new Float32Array(count * 3);
	rootBounds(aabbs, count, centers, primIndices, bounds);
	primCount[0] = count;
	const minDim = [0, 1, 2].map((k) => (bounds[3 + k] - bounds[k]) * 1e-20);

	let newNode = 1;
	const tasks: number[] = [0];
	while (tasks.length) {
		let node = tasks.pop() as number;
		while (true) {
			const box = nodeBox(bounds, node, minDim);
			const first = leftFirst[node];
			const nodePrims = primCount[node];
			// A point-sized node or a single primitive cannot be split.
			if (box.area === 0 || nodePrims === 1) break;
			fillBins(scratch, box, aabbs, centers, primIndices, first, nodePrims);
			const split = bestSplit(scratch, box, minDim);
			// Not splitting is cheaper (also stops on non-finite bounds).
			if (!(split.cost < nodePrims * C_INT)) break;
			const right = partition(
				primIndices,
				centers,
				first,
				nodePrims,
				split,
				box,
			);
			const leftPrims = right - first;
			if (leftPrims === 0 || leftPrims === nodePrims) break;
			const n = newNode;
			newNode += 2;
			writeChildBounds(scratch, bounds, n, split);
			leftFirst[n] = first;
			primCount[n] = leftPrims;
			leftFirst[n + 1] = right;
			primCount[n + 1] = nodePrims - leftPrims;
			leftFirst[node] = n;
			primCount[node] = 0;
			tasks.push(n + 1);
			node = n;
		}
	}
	return { nodeCount: newNode, bounds, leftFirst, primCount, primIndices };
}

/** Floats per GPU node: `vec4(min, leftFirst)`, `vec4(max, primCount)`. */
export const BVH_NODE_FLOATS = 8;

/** Deepest tree the traversal stacks hold; deeper builds are rejected. */
export const BVH_MAX_DEPTH = 64;

/**
 * The tree as the traversal shader reads it. Leaves reference a contiguous
 * run of primitives in `primOrder` order: the caller stores its primitives
 * in that order, so `leftFirst` of a leaf is the first primitive itself.
 */
export interface FlatBvh {
	/** BVH_NODE_FLOATS per node; `leftFirst` and `primCount` are u32 bit patterns. */
	nodes: Float32Array;
	nodeCount: number;
	/** The source primitive stored at each slot. */
	primOrder: Uint32Array;
	depth: number;
}

function treeDepth(bvh: BinnedSahBvh): number {
	let deepest = 0;
	const stack: number[] = [0, 1];
	while (stack.length) {
		const depth = stack.pop() as number;
		const node = stack.pop() as number;
		deepest = Math.max(deepest, depth);
		if (bvh.primCount[node] === 0) {
			stack.push(bvh.leftFirst[node], depth + 1);
			stack.push(bvh.leftFirst[node] + 1, depth + 1);
		}
	}
	return deepest;
}

/** Packs a built tree into GPU nodes. */
export function flattenBvh(bvh: BinnedSahBvh): FlatBvh {
	const nodes = new Float32Array(Math.max(1, bvh.nodeCount) * BVH_NODE_FLOATS);
	const words = new Uint32Array(nodes.buffer);
	for (let n = 0; n < bvh.nodeCount; n++) {
		const o = n * BVH_NODE_FLOATS;
		nodes.set(bvh.bounds.subarray(n * 6, n * 6 + 3), o);
		nodes.set(bvh.bounds.subarray(n * 6 + 3, n * 6 + 6), o + 4);
		words[o + 3] = bvh.leftFirst[n];
		words[o + 7] = bvh.primCount[n];
	}
	if (bvh.nodeCount === 0) {
		// An empty tree: one leaf with no primitives whose box no ray enters.
		nodes.set([FAR, FAR, FAR], 0);
		nodes.set([-FAR, -FAR, -FAR], 4);
	}
	const depth = bvh.nodeCount ? treeDepth(bvh) : 0;
	if (depth >= BVH_MAX_DEPTH) {
		throw new Error(
			`Path tracer BVH is ${depth} levels deep; traversal holds ${BVH_MAX_DEPTH}. The mesh is degenerate (many coincident triangles).`,
		);
	}
	return {
		nodes,
		nodeCount: Math.max(1, bvh.nodeCount),
		primOrder: bvh.primIndices,
		depth,
	};
}

/**
 * Refits a flat tree to moved primitives (same topology): every leaf takes
 * its primitives' boxes, every interior node its children's. Children always
 * have higher indices than their parent, so one reverse sweep suffices.
 * @param primBoxes min, max per stored primitive slot (in `primOrder` order).
 */
export function refitBvh(flat: FlatBvh, primBoxes: Float32Array): void {
	const { nodes } = flat;
	const words = new Uint32Array(nodes.buffer, nodes.byteOffset, nodes.length);
	for (let n = flat.nodeCount - 1; n >= 0; n--) {
		const o = n * BVH_NODE_FLOATS;
		const first = words[o + 3];
		const count = words[o + 7];
		const min = [FAR, FAR, FAR];
		const max = [-FAR, -FAR, -FAR];
		if (count > 0) {
			for (let p = first; p < first + count; p++) {
				for (let k = 0; k < 3; k++) {
					min[k] = Math.min(min[k], primBoxes[p * 6 + k]);
					max[k] = Math.max(max[k], primBoxes[p * 6 + 3 + k]);
				}
			}
		} else {
			for (const c of [first, first + 1]) {
				const co = c * BVH_NODE_FLOATS;
				for (let k = 0; k < 3; k++) {
					min[k] = Math.min(min[k], nodes[co + k]);
					max[k] = Math.max(max[k], nodes[co + 4 + k]);
				}
			}
		}
		nodes.set(min, o);
		nodes.set(max, o + 4);
	}
}

/** Surface area of the root box over the sum of all node areas, a quality proxy for refits. */
export function bvhCost(flat: FlatBvh): number {
	const { nodes } = flat;
	let total = 0;
	for (let n = 0; n < flat.nodeCount; n++) {
		const o = n * BVH_NODE_FLOATS;
		total += halfArea(
			[nodes[o], nodes[o + 1], nodes[o + 2]],
			[nodes[o + 4], nodes[o + 5], nodes[o + 6]],
		);
	}
	const root = halfArea(
		[nodes[0], nodes[1], nodes[2]],
		[nodes[4], nodes[5], nodes[6]],
	);
	return root > 0 ? total / root : 0;
}
