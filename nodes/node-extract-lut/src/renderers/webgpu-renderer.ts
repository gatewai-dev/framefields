/// <reference types="webgpu" />

import { getFingerprint, type VirtualMediaData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { lutStore } from "@framefields/webgpu-renderers";

// Per-node extraction cache to avoid redundant GPU readbacks on every frame.
const extractionCache = new Map<string, string>();
const pendingExtractions = new Map<string, Promise<void>>();
const latestRequestedFingerprint = new Map<string, string>();
const activeTextures = new Map<
	string,
	{ srcTex: GPUTexture; tgtTex: GPUTexture }
>();

// ─── Compute pipeline cache (keyed by GPUDevice) ────────────────────────────

type ComputePipelines = {
	rbf: GPUComputePipeline;
	statistical: GPUComputePipeline;
};
const pipelineCache = new WeakMap<GPUDevice, ComputePipelines>();

/**
 * Lazily compiles and caches the two WGSL compute shaders per device.
 *
 * Both shaders write a flat array of f32 triples (R,G,B) for every cell of a
 * `lutSize³` cube.  The host uploads whatever small set of parameters is needed
 * (RBF weights OR LAB statistics), then reads the result back as a typed array
 * that can be forwarded to `lutStore.createOrUpdate`.
 *
 * Workgroup size 8×8×4 = 256 threads maps cleanly onto lutSize=33 with
 * ceil(33/8)=5 groups on X/Y and ceil(33/4)=9 on Z  →  5×5×9 = 225 dispatches.
 */
function getOrCreatePipelines(device: GPUDevice): ComputePipelines {
	const cached = pipelineCache.get(device);
	if (cached) return cached;

	// ── Shader: RBF evaluation ───────────────────────────────────────────────
	//
	// Inputs (all via storage / uniform buffers):
	//   params    – u32 lutSize, u32 numSamples
	//   srcPoints – array<vec3f>  (M source RGB triples)
	//   srcPoints – array<vec4f>  (M source RGB triples)
	//   weights   – array<vec4f>  (M RBF weights, one vec3 per sample)
	//   poly      – array<vec4f>  (4 polynomial coefficients: bias + 3 axis slopes)
	//
	// Output:
	//   lut       – array<f32>  (lutSize³ × 3, written as [R0,G0,B0, R1,G1,B1 …])
	//
	// Each thread owns one (r,g,b) LUT cell.  The inner loop over M samples is
	// sequential inside the thread – this is fine because M ≈ 150–200 and the
	// 35 937 LUT cells are in flight at once across the GPU's SMs.
	const rbfShader = /* wgsl */ `
struct Params {
	lutSize    : u32,
	numSamples : u32,
	epsilonSq  : f32,
}

@group(0) @binding(0) var<uniform>             params    : Params;
@group(0) @binding(1) var<storage, read>       srcPoints : array<vec4f>;  // [numSamples]
@group(0) @binding(2) var<storage, read>       weights   : array<vec4f>;  // [numSamples]
@group(0) @binding(3) var<storage, read>       poly      : array<vec4f>;  // [4]
@group(0) @binding(4) var<storage, read_write> lut       : array<f32>;    // [lutSize³ * 3]

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
	let lutSize = params.lutSize;
	if (gid.x >= lutSize || gid.y >= lutSize || gid.z >= lutSize) { return; }

	let inR = f32(gid.x) / f32(lutSize - 1u);
	let inG = f32(gid.y) / f32(lutSize - 1u);
	let inB = f32(gid.z) / f32(lutSize - 1u);
	let p   = vec3f(inR, inG, inB);

	// Polynomial part:  poly[0] + poly[1]*r + poly[2]*g + poly[3]*b
	var out = poly[0].xyz + poly[1].xyz * inR + poly[2].xyz * inG + poly[3].xyz * inB;

	// RBF sum
	let eps = params.epsilonSq;
	let M   = params.numSamples;
	var minDistSq = 1e10;
	var rbfSum = vec3f(0.0);
	for (var i = 0u; i < M; i++) {
		let d   = p - srcPoints[i].xyz;
		let dSq = dot(d, d);
		minDistSq = min(minDistSq, dSq);
		let phi = sqrt(dSq + eps);
		rbfSum    += weights[i].xyz * phi;
	}

	// Smoothly fade out RBF weight contribution for regions far from samples
	// starts fading at distance 0.25 (dist^2 = 0.0625), fully faded at 0.5 (dist^2 = 0.25)
	let rbfFade = clamp(1.0 - (minDistSq - 0.0625) / (0.25 - 0.0625), 0.0, 1.0);
	out += rbfSum * rbfFade;

	// Smoothly blend the entire mapping towards identity for regions extremely far from samples
	// starts blending at distance 0.35 (dist^2 = 0.1225), fully identity at 0.65 (dist^2 = 0.4225)
	let identityBlend = clamp((minDistSq - 0.1225) / (0.4225 - 0.1225), 0.0, 1.0);
	out = mix(out, p, identityBlend);

	// Clamp + write
	let cell = (gid.z * lutSize * lutSize + gid.y * lutSize + gid.x) * 3u;
	lut[cell + 0u] = clamp(out.r, 0.0, 1.0);
	lut[cell + 1u] = clamp(out.g, 0.0, 1.0);
	lut[cell + 2u] = clamp(out.b, 0.0, 1.0);
}`;

	// ── Shader: Statistical (Reinhard LAB) LUT generation ───────────────────
	//
	// Inputs:
	//   params  – u32 lutSize
	//   stats   – vec3f srcMean, vec3f tgtMean, vec3f scale  (in LAB space)
	//
	// The RGB↔LAB conversion mirrors `rgbToLab` / `labToRgb` exactly.
	const statisticalShader = /* wgsl */ `
struct Stats {
	srcMean : vec4f,   // (meanL, meanA, meanB, pad) of source
	tgtMean : vec4f,   // (meanL, meanA, meanB, pad) of target
	scale   : vec4f,   // tgtStd / srcStd per channel
	lutSize : u32,
}

@group(0) @binding(0) var<uniform>             stats : Stats;
@group(0) @binding(1) var<storage, read_write> lut   : array<f32>;

// Constants matching the Reinhard/rgbToLab implementation
const INV_SQRT3 : f32 = 0.57735026919;   // 1 / sqrt(3)
const INV_SQRT6 : f32 = 0.40824829046;   // 1 / sqrt(6)
const INV_SQRT2 : f32 = 0.70710678118;   // 1 / sqrt(2)

fn safeLog10(v : f32) -> f32 {
	return log(max(v, 1e-5)) * 0.43429448190;  // log10(x) = ln(x) / ln(10)
}

fn rgbToLab(rgb : vec3f) -> vec3f {
	let R = max(rgb.r, 1e-5);
	let G = max(rgb.g, 1e-5);
	let B = max(rgb.b, 1e-5);

	let Lms_L = safeLog10(0.3811 * R + 0.5783 * G + 0.0402 * B);
	let Lms_M = safeLog10(0.1967 * R + 0.7244 * G + 0.0782 * B);
	let Lms_S = safeLog10(0.0241 * R + 0.1288 * G + 0.8444 * B);

	return vec3f(
		(Lms_L + Lms_M + Lms_S) * INV_SQRT3,
		(Lms_L + Lms_M - 2.0 * Lms_S) * INV_SQRT6,
		(Lms_L - Lms_M) * INV_SQRT2,
	);
}

fn labToRgb(lab : vec3f) -> vec3f {
	let l = lab.x; let a = lab.y; let b = lab.z;

	let L_log = l * INV_SQRT3 + a * INV_SQRT6 + b * INV_SQRT2;
	let M_log = l * INV_SQRT3 + a * INV_SQRT6 - b * INV_SQRT2;
	let S_log = l * INV_SQRT3 - 2.0 * a * INV_SQRT6;

	let L = pow(10.0, L_log);
	let M = pow(10.0, M_log);
	let S = pow(10.0, S_log);

	return clamp(vec3f(
		 4.4679 * L - 3.5873 * M + 0.1193 * S,
		-1.2186 * L + 2.3809 * M - 0.1624 * S,
		 0.0497 * L - 0.2439 * M + 1.2045 * S,
	), vec3f(0.0), vec3f(1.0));
}

@compute @workgroup_size(8, 8, 4)
fn main(@builtin(global_invocation_id) gid : vec3u) {
	let lutSize = stats.lutSize;
	if (gid.x >= lutSize || gid.y >= lutSize || gid.z >= lutSize) { return; }

	let inR = f32(gid.x) / f32(lutSize - 1u);
	let inG = f32(gid.y) / f32(lutSize - 1u);
	let inB = f32(gid.z) / f32(lutSize - 1u);

	let lab    = rgbToLab(vec3f(inR, inG, inB));
	let mapped = stats.scale.xyz * (lab - stats.srcMean.xyz) + stats.tgtMean.xyz;
	let rgb    = labToRgb(mapped);

	let cell = (gid.z * lutSize * lutSize + gid.y * lutSize + gid.x) * 3u;
	lut[cell + 0u] = rgb.r;
	lut[cell + 1u] = rgb.g;
	lut[cell + 2u] = rgb.b;
}`;

	const rbf = device.createComputePipeline({
		layout: "auto",
		compute: {
			module: device.createShaderModule({ code: rbfShader }),
			entryPoint: "main",
		},
	});

	const statistical = device.createComputePipeline({
		layout: "auto",
		compute: {
			module: device.createShaderModule({ code: statisticalShader }),
			entryPoint: "main",
		},
	});

	const pipelines: ComputePipelines = { rbf, statistical };
	pipelineCache.set(device, pipelines);
	return pipelines;
}

// ─── CPU helpers (unchanged – they run on small data) ────────────────────────

function solveLU(
	A: Float64Array,
	B: Float64Array,
	n: number,
): Float64Array | null {
	const ipiv = new Int32Array(n);
	for (let i = 0; i < n; i++) ipiv[i] = i;

	for (let i = 0; i < n; i++) {
		let maxVal = 0;
		let pivotRow = i;
		for (let r = i; r < n; r++) {
			const val = Math.abs(A[r * n + i]);
			if (val > maxVal) {
				maxVal = val;
				pivotRow = r;
			}
		}
		if (maxVal < 1e-9) {
			return null;
		} else if (pivotRow !== i) {
			const tmp = ipiv[i];
			ipiv[i] = ipiv[pivotRow];
			ipiv[pivotRow] = tmp;
			for (let col = 0; col < n; col++) {
				const i1 = i * n + col,
					i2 = pivotRow * n + col;
				const t = A[i1];
				A[i1] = A[i2];
				A[i2] = t;
			}
			for (let col = 0; col < 3; col++) {
				const i1 = i * 3 + col,
					i2 = pivotRow * 3 + col;
				const t = B[i1];
				B[i1] = B[i2];
				B[i2] = t;
			}
		}
		const pivot = A[i * n + i];
		if (Math.abs(pivot) < 1e-9) {
			return null;
		}
		for (let r = i + 1; r < n; r++) {
			const factor = A[r * n + i] / pivot;
			A[r * n + i] = 0;
			for (let col = i + 1; col < n; col++)
				A[r * n + col] -= factor * A[i * n + col];
			for (let col = 0; col < 3; col++)
				B[r * 3 + col] -= factor * B[i * 3 + col];
		}
	}

	const X = new Float64Array(n * 3);
	for (let col = 0; col < 3; col++) {
		for (let i = n - 1; i >= 0; i--) {
			let sum = B[i * 3 + col];
			for (let j = i + 1; j < n; j++) sum -= A[i * n + j] * X[j * 3 + col];
			const denom = A[i * n + i];
			if (Math.abs(denom) < 1e-9) {
				return null;
			}
			X[i * 3 + col] = sum / denom;
		}
	}
	return X;
}

function hasAbsurdCoefficients(X_sol: Float64Array): boolean {
	for (let i = 0; i < X_sol.length; i++) {
		const val = X_sol[i];
		if (Number.isNaN(val) || !Number.isFinite(val) || Math.abs(val) > 1e5) {
			return true;
		}
	}
	return false;
}

function solveLU1D(
	A: Float64Array,
	B: Float64Array,
	n: number,
): Float64Array | null {
	const ipiv = new Int32Array(n);
	for (let i = 0; i < n; i++) ipiv[i] = i;

	for (let i = 0; i < n; i++) {
		let maxVal = 0;
		let pivotRow = i;
		for (let r = i; r < n; r++) {
			const val = Math.abs(A[r * n + i]);
			if (val > maxVal) {
				maxVal = val;
				pivotRow = r;
			}
		}
		if (maxVal < 1e-9) {
			return null;
		} else if (pivotRow !== i) {
			const tmp = ipiv[i];
			ipiv[i] = ipiv[pivotRow];
			ipiv[pivotRow] = tmp;
			for (let col = 0; col < n; col++) {
				const i1 = i * n + col,
					i2 = pivotRow * n + col;
				const t = A[i1];
				A[i1] = A[i2];
				A[i2] = t;
			}
			const t = B[i];
			B[i] = B[pivotRow];
			B[pivotRow] = t;
		}
		const pivot = A[i * n + i];
		if (Math.abs(pivot) < 1e-9) {
			return null;
		}
		for (let r = i + 1; r < n; r++) {
			const factor = A[r * n + i] / pivot;
			A[r * n + i] = 0;
			for (let col = i + 1; col < n; col++)
				A[r * n + col] -= factor * A[i * n + col];
			B[r] -= factor * B[i];
		}
	}

	const X = new Float64Array(n);
	for (let i = n - 1; i >= 0; i--) {
		let sum = B[i];
		for (let j = i + 1; j < n; j++) sum -= A[i * n + j] * X[j];
		const denom = A[i * n + i];
		if (Math.abs(denom) < 1e-9) {
			return null;
		}
		X[i] = sum / denom;
	}
	return X;
}

function solve1DChannel(
	srcVals: number[],
	tgtVals: number[],
	epsilonSq: number,
): Float64Array | null {
	const M = srcVals.length;
	const H = M + 2;

	const K_mat = new Float64Array(H * H);
	const B_rhs = new Float64Array(H);

	for (let i = 0; i < M; i++) {
		const xi = srcVals[i];
		B_rhs[i] = tgtVals[i];
		for (let j = 0; j < M; j++) {
			const xj = srcVals[j];
			const dx = xi - xj;
			K_mat[i * H + j] = Math.sqrt(dx * dx + epsilonSq);
		}
		K_mat[i * H + M + 0] = 1;
		K_mat[i * H + M + 1] = xi;
		K_mat[(M + 0) * H + i] = 1;
		K_mat[(M + 1) * H + i] = xi;
	}

	// Regularize RBF block
	let diagMean = 0;
	for (let i = 0; i < M; i++) diagMean += K_mat[i * H + i];
	diagMean /= M;

	const lambda = Math.max(1e-4, diagMean * 0.01);
	for (let i = 0; i < M; i++) {
		K_mat[i * H + i] += lambda;
	}

	const polyLambda = Math.max(1e-4, diagMean * 0.001);
	for (let k = 0; k < 2; k++) {
		K_mat[(M + k) * H + M + k] = polyLambda;
	}

	return solveLU1D(K_mat, B_rhs, H);
}

function evaluate1DChannel(
	srcVals: number[],
	X_sol: Float64Array,
	epsilonSq: number,
	lutSize: number,
): Float32Array {
	const M = srcVals.length;
	const out = new Float32Array(lutSize);
	for (let cell = 0; cell < lutSize; cell++) {
		const p = cell / (lutSize - 1);
		// Extrapolation check
		let minDistSq = 1e10;
		for (let i = 0; i < M; i++) {
			const dx = p - srcVals[i];
			minDistSq = Math.min(minDistSq, dx * dx);
		}

		// RBF sum
		let rbfSum = 0;
		for (let i = 0; i < M; i++) {
			const dx = p - srcVals[i];
			const phi = Math.sqrt(dx * dx + epsilonSq);
			rbfSum += X_sol[i] * phi;
		}

		// Smoothly fade out RBF weight contribution for regions far from samples
		// starts fading at distance 0.25 (dist^2 = 0.0625), fully faded at 0.5 (dist^2 = 0.25)
		const rbfFade = Math.max(
			0,
			Math.min(1, 1 - (minDistSq - 0.0625) / (0.25 - 0.0625)),
		);
		let val = X_sol[M + 0] + X_sol[M + 1] * p + rbfSum * rbfFade;

		// Smoothly blend the entire mapping towards identity for regions extremely far from samples
		// starts blending at distance 0.35 (dist^2 = 0.1225), fully identity at 0.65 (dist^2 = 0.4225)
		const identityBlend = Math.max(
			0,
			Math.min(1, (minDistSq - 0.1225) / (0.4225 - 0.1225)),
		);
		val = val * (1 - identityBlend) + p * identityBlend;

		out[cell] = Math.max(0, Math.min(1, val));
	}
	return out;
}

function isSeparableOperationTree(
	vv: VirtualMediaData,
	sourceMedia: VirtualMediaData,
): boolean {
	const sourceFingerprint = getFingerprint(sourceMedia);
	let current: VirtualMediaData | undefined = vv;
	while (current) {
		const op = current.operation;
		if (!op) break;

		// Check fingerprint match to see if we reached sourceMedia
		const mediaToFingerprint: Record<string, unknown> = {
			...current,
			metadata: {},
			operation: current.operation ? { ...current.operation } : undefined,
		};
		if (mediaToFingerprint.operation) {
			delete (mediaToFingerprint.operation as Record<string, unknown>).lutUrl;
		}
		if (getFingerprint(mediaToFingerprint) === sourceFingerprint) {
			return true;
		}

		if (op.op === "source") {
			return false; // we reached a different source image
		}

		// Check if this operation is separable
		if (op.op === "Curves") {
			if (op.curveType !== "rgb") {
				return false;
			}
		} else if (op.op === "Levels") {
			// Levels is always separable
		} else {
			return false;
		}

		if (current.children && current.children.length > 0) {
			current = current.children[0];
		} else {
			break;
		}
	}
	return false;
}

function rgbToLab(r: number, g: number, b: number): [number, number, number] {
	const R = Math.max(1e-5, r),
		G = Math.max(1e-5, g),
		B = Math.max(1e-5, b);
	const L = Math.log10(Math.max(1e-5, 0.3811 * R + 0.5783 * G + 0.0402 * B));
	const M = Math.log10(Math.max(1e-5, 0.1967 * R + 0.7244 * G + 0.0782 * B));
	const S = Math.log10(Math.max(1e-5, 0.0241 * R + 0.1288 * G + 0.8444 * B));
	return [
		(L + M + S) / Math.sqrt(3),
		(L + M - 2 * S) / Math.sqrt(6),
		(L - M) / Math.sqrt(2),
	];
}

function getPixelRGB(
	pixels: Uint8Array,
	idx: number,
	isBGRA: boolean,
): [number, number, number] {
	const o = idx * 4;
	const rIdx = isBGRA ? o + 2 : o;
	const bIdx = isBGRA ? o : o + 2;
	return [pixels[rIdx] / 255, pixels[o + 1] / 255, pixels[bIdx] / 255];
}

function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = (hash * 33) ^ str.charCodeAt(i);
	}
	return hash >>> 0;
}

class SeededRandom {
	private state: number;
	constructor(seed: number) {
		this.state = seed || 1;
	}
	next(): number {
		this.state = (this.state * 1664525 + 1013904223) % 4294967296;
		return this.state / 4294967296;
	}
}

function seededShuffle<T>(array: T[], seed: number): T[] {
	const rng = new SeededRandom(seed);
	const shuffled = [...array];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(rng.next() * (i + 1));
		const temp = shuffled[i];
		shuffled[i] = shuffled[j];
		shuffled[j] = temp;
	}
	return shuffled;
}

interface ColorPair {
	src: [number, number, number];
	tgt: [number, number, number];
}

function buildUniqueColorPool(
	srcPixels: Uint8Array,
	tgtPixels: Uint8Array,
	isBGRA: boolean,
	gridResolution = 20,
): ColorPair[] {
	const occupied = new Set<number>();
	const pool: ColorPair[] = [];
	const numPixels = srcPixels.length / 4;

	for (let i = 0; i < numPixels; i++) {
		const src = getPixelRGB(srcPixels, i, isBGRA);
		const r = Math.max(
			0,
			Math.min(gridResolution - 1, Math.floor(src[0] * gridResolution)),
		);
		const g = Math.max(
			0,
			Math.min(gridResolution - 1, Math.floor(src[1] * gridResolution)),
		);
		const b = Math.max(
			0,
			Math.min(gridResolution - 1, Math.floor(src[2] * gridResolution)),
		);
		const cellKey =
			r * gridResolution * gridResolution + g * gridResolution + b;

		if (!occupied.has(cellKey)) {
			occupied.add(cellKey);
			pool.push({ src, tgt: getPixelRGB(tgtPixels, i, isBGRA) });
		}
	}
	return pool;
}

// ─── GPU LUT evaluation helpers ──────────────────────────────────────────────

/**
 * Evaluates the fitted RBF on the GPU.
 *
 * CPU work that remains:
 *   • Build K matrix  O(M²) – tiny (≈ 162×162)
 *   • solveLU         O(M³) – tiny
 *
 * GPU work (replaces the triple-nested JS loop):
 *   • 33³ = 35 937 threads × M inner iterations  →  ~5.7 M parallel MADs
 *
 * Returns a plain Float32Array of length lutSize³×3 for lutStore.
 */
async function evaluateRbfOnGpu(
	device: GPUDevice,
	pipelines: ComputePipelines,
	sampledPoints: Array<{
		src: [number, number, number];
		tgt: [number, number, number];
	}>,
	X_sol: Float64Array,
	lutSize: number,
	epsilonSq: number,
): Promise<Float32Array> {
	const M = sampledPoints.length;
	const totalCells = lutSize * lutSize * lutSize;
	const wgs = 8; // must match @workgroup_size

	// ── Pack srcPoints and weights into f32 arrays (vec4f = 4×f32, aligned to 16-bytes) ─
	const srcPointsData = new Float32Array(M * 4);
	const weightsData = new Float32Array(M * 4);
	for (let i = 0; i < M; i++) {
		srcPointsData[i * 4 + 0] = sampledPoints[i].src[0];
		srcPointsData[i * 4 + 1] = sampledPoints[i].src[1];
		srcPointsData[i * 4 + 2] = sampledPoints[i].src[2];
		srcPointsData[i * 4 + 3] = 0;
		weightsData[i * 4 + 0] = X_sol[i * 3 + 0];
		weightsData[i * 4 + 1] = X_sol[i * 3 + 1];
		weightsData[i * 4 + 2] = X_sol[i * 3 + 2];
		weightsData[i * 4 + 3] = 0;
	}

	// Polynomial coefficients: [bias, slope_R, slope_G, slope_B] × 3 channels, padded to vec4
	// X_sol layout: rows 0..M-1 are RBF weights, rows M..M+3 are poly coeffs
	const polyData = new Float32Array(4 * 4);
	for (let k = 0; k < 4; k++) {
		polyData[k * 4 + 0] = X_sol[(M + k) * 3 + 0];
		polyData[k * 4 + 1] = X_sol[(M + k) * 3 + 1];
		polyData[k * 4 + 2] = X_sol[(M + k) * 3 + 2];
		polyData[k * 4 + 3] = 0;
	}

	// ── Uniform: params ──────────────────────────────────────────────────────
	// struct Params { lutSize: u32, numSamples: u32, epsilonSq: f32 }  → 12 bytes, pad to 16
	const paramsBuffer = device.createBuffer({
		size: 16,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	const paramsData = new ArrayBuffer(16);
	new Uint32Array(paramsData, 0, 2).set([lutSize, M]);
	new Float32Array(paramsData, 8, 1).set([epsilonSq]);
	device.queue.writeBuffer(paramsBuffer, 0, paramsData);

	// ── Storage: srcPoints, weights, poly ───────────────────────────────────
	const srcPointsBuf = upload(device, srcPointsData);
	const weightsBuf = upload(device, weightsData);
	const polyBuf = upload(device, polyData);

	// ── Output buffer ────────────────────────────────────────────────────────
	const lutByteSize = totalCells * 3 * 4; // f32 per channel
	const lutBuf = device.createBuffer({
		size: lutByteSize,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
	});
	const readbackBuf = device.createBuffer({
		size: lutByteSize,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});

	// ── Bind group ───────────────────────────────────────────────────────────
	const bg = device.createBindGroup({
		layout: pipelines.rbf.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: paramsBuffer } },
			{ binding: 1, resource: { buffer: srcPointsBuf } },
			{ binding: 2, resource: { buffer: weightsBuf } },
			{ binding: 3, resource: { buffer: polyBuf } },
			{ binding: 4, resource: { buffer: lutBuf } },
		],
	});

	// ── Dispatch ─────────────────────────────────────────────────────────────
	const enc = device.createCommandEncoder({ label: "rbf-lut-eval" });
	const pass = enc.beginComputePass();
	pass.setPipeline(pipelines.rbf);
	pass.setBindGroup(0, bg);
	const groups = Math.ceil(lutSize / wgs);
	pass.dispatchWorkgroups(groups, groups, Math.ceil(lutSize / 4));
	pass.end();
	enc.copyBufferToBuffer(lutBuf, 0, readbackBuf, 0, lutByteSize);
	device.queue.submit([enc.finish()]);

	// ── Read back ─────────────────────────────────────────────────────────────
	await readbackBuf.mapAsync(GPUMapMode.READ);
	const result = new Float32Array(readbackBuf.getMappedRange().slice(0));
	readbackBuf.unmap();

	// cleanup
	paramsBuffer.destroy();
	srcPointsBuf.destroy();
	weightsBuf.destroy();
	polyBuf.destroy();
	lutBuf.destroy();
	readbackBuf.destroy();

	return result;
}

/**
 * Generates the statistical LAB-transfer LUT entirely on the GPU.
 * The only CPU work is computing 6 scalars (mean/std per LAB channel).
 */
async function evaluateStatisticalOnGpu(
	device: GPUDevice,
	pipelines: ComputePipelines,
	srcMean: [number, number, number],
	tgtMean: [number, number, number],
	scale: [number, number, number],
	lutSize: number,
): Promise<Float32Array> {
	const totalCells = lutSize * lutSize * lutSize;
	const lutByteSize = totalCells * 3 * 4;

	// struct Stats – 4 × vec3f (each padded to vec4 in std140, but uniform layout
	// with explicit padding keeps it simple).  We write as raw f32 + a u32 at the end.
	// Layout: srcMean(3f) pad(1f)  tgtMean(3f) pad(1f)  scale(3f) pad(1f)  lutSize(1u) pad(3u)
	const statsData = new ArrayBuffer(64);
	const f = new Float32Array(statsData);
	const u = new Uint32Array(statsData);
	f[0] = srcMean[0];
	f[1] = srcMean[1];
	f[2] = srcMean[2]; // f[3] = pad
	f[4] = tgtMean[0];
	f[5] = tgtMean[1];
	f[6] = tgtMean[2]; // f[7] = pad
	f[8] = scale[0];
	f[9] = scale[1];
	f[10] = scale[2]; // f[11] = pad
	u[12] = lutSize; // u[13..15] = pad

	const statsBuf = device.createBuffer({
		size: 64,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(statsBuf, 0, statsData);

	const lutBuf = device.createBuffer({
		size: lutByteSize,
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
	});
	const readbackBuf = device.createBuffer({
		size: lutByteSize,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});

	const bg = device.createBindGroup({
		layout: pipelines.statistical.getBindGroupLayout(0),
		entries: [
			{ binding: 0, resource: { buffer: statsBuf } },
			{ binding: 1, resource: { buffer: lutBuf } },
		],
	});

	const enc = device.createCommandEncoder({ label: "stat-lut-eval" });
	const pass = enc.beginComputePass();
	pass.setPipeline(pipelines.statistical);
	pass.setBindGroup(0, bg);
	const wgs = 8;
	const groups = Math.ceil(lutSize / wgs);
	pass.dispatchWorkgroups(groups, groups, Math.ceil(lutSize / 4));
	pass.end();
	enc.copyBufferToBuffer(lutBuf, 0, readbackBuf, 0, lutByteSize);
	device.queue.submit([enc.finish()]);

	await readbackBuf.mapAsync(GPUMapMode.READ);
	const result = new Float32Array(readbackBuf.getMappedRange().slice(0));
	readbackBuf.unmap();

	statsBuf.destroy();
	lutBuf.destroy();
	readbackBuf.destroy();
	return result;
}

/** Uploads a Float32Array into a storage-readable GPUBuffer. */
function upload(device: GPUDevice, data: Float32Array): GPUBuffer {
	const buf = device.createBuffer({
		size: Math.max(data.byteLength, 16), // min binding size
		usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	});
	device.queue.writeBuffer(buf, 0, data);
	return buf;
}

/**
 * Converts a flat Float32Array [R0,G0,B0, R1,G1,B1 …] returned from the GPU
 * into the tuple array expected by `lutStore.createOrUpdate`.
 */
function flatToPoints(flat: Float32Array): Array<[number, number, number]> {
	const n = flat.length / 3;
	const out: Array<[number, number, number]> = new Array(n);
	for (let i = 0; i < n; i++) {
		out[i] = [flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]];
	}
	return out;
}

// ─── Main renderer ───────────────────────────────────────────────────────────

export const ExtractLutWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, encoder, pass, props, drawChild } = args;

	const op = props.virtualMedia?.operation as {
		op?: string;
		nodeId?: string;
		lutUrl?: string;
		strategy?: "deterministic" | "statistical";
		samplePoints?: number;
	};
	if (op?.op !== "ExtractLUT" || !op) return;

	const nodeId: string = op.nodeId ?? props.renderId;

	const mediaToFingerprint: Record<string, unknown> = {
		...props.virtualMedia,
		metadata: {},
		operation: props.virtualMedia?.operation
			? { ...(props.virtualMedia.operation as Record<string, unknown>) }
			: undefined,
	};
	if (mediaToFingerprint.operation) {
		delete (mediaToFingerprint.operation as Record<string, unknown>).lutUrl;
		delete (mediaToFingerprint.operation as Record<string, unknown>).timeline;
		delete (mediaToFingerprint.operation as Record<string, unknown>).startFrame;
	}

	const lutUrl: string =
		op.lutUrl ??
		`runtime://lut/extract-lut-${nodeId}-${getFingerprint(mediaToFingerprint)}`;

	const fingerprint = lutUrl.startsWith(`runtime://lut/extract-lut-${nodeId}-`)
		? lutUrl.slice(`runtime://lut/extract-lut-${nodeId}-`.length)
		: getFingerprint(mediaToFingerprint);

	const cacheKey = `${nodeId}-${fingerprint}`;

	const sourceMedia = props.virtualMedia?.children?.[0];
	const targetMedia = props.virtualMedia?.children?.[1];
	if (!sourceMedia || !targetMedia) {
		pass.end();
		return;
	}

	const strategy = op.strategy ?? "deterministic";
	const samplePoints = op.samplePoints ?? 150;

	const GRID_RESOLUTION = 64;
	const gridSize = GRID_RESOLUTION;
	const numPixels = gridSize * gridSize;

	if (
		extractionCache.get(nodeId) === fingerprint &&
		lutStore.get(lutUrl, ctx.device)
	) {
		pass.end();
		return;
	}

	if (pendingExtractions.has(cacheKey)) {
		pass.end();
		return;
	}

	latestRequestedFingerprint.set(nodeId, fingerprint);
	pass.end();

	// Register the runtime LUT promise in the store so that downstream callers await it
	void lutStore.getOrLoad(lutUrl, ctx.device);

	// 1. Destroy previous textures (clean up old cache entries)
	const prev = activeTextures.get(nodeId);
	if (prev) {
		const toDestroy = prev;
		ctx.device.queue.onSubmittedWorkDone().then(() => {
			try {
				toDestroy.srcTex.destroy();
			} catch {}
			try {
				toDestroy.tgtTex.destroy();
			} catch {}
		});
		activeTextures.delete(nodeId);
	}

	// 2. Synchronously create and render the source child texture
	const srcTex = ctx.device.createTexture({
		label: `ExtractLUT-src-grid-${nodeId}`,
		size: [gridSize, gridSize],
		format: ctx.renderer.format,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});

	const clearPassSrc = ctx.renderer.beginFrame(
		encoder,
		srcTex.createView(),
		{ r: 0, g: 0, b: 0, a: 1 },
		gridSize,
		gridSize,
		"clear",
	);
	clearPassSrc.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width: gridSize, height: gridSize });
	ctx.renderer.pushIdentity();
	await drawChild(
		sourceMedia,
		{
			...props,
			renderId: `${nodeId}-c0`,
			virtualMedia: sourceMedia,
			containerWidth: gridSize,
			containerHeight: gridSize,
			forceWait: true,
		},
		srcTex.createView(),
		srcTex,
		gridSize,
		gridSize,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 3. Synchronously create and render the target child texture
	const tgtTex = ctx.device.createTexture({
		label: `ExtractLUT-tgt-grid-${nodeId}`,
		size: [gridSize, gridSize],
		format: ctx.renderer.format,
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	activeTextures.set(nodeId, { srcTex, tgtTex });

	const clearPassTgt = ctx.renderer.beginFrame(
		encoder,
		tgtTex.createView(),
		{ r: 0, g: 0, b: 0, a: 1 },
		gridSize,
		gridSize,
		"clear",
	);
	clearPassTgt.end();

	ctx.renderer.pushScissor({ x: 0, y: 0, width: gridSize, height: gridSize });
	ctx.renderer.pushIdentity();
	await drawChild(
		targetMedia,
		{
			...props,
			renderId: `${nodeId}-c1`,
			virtualMedia: targetMedia,
			containerWidth: gridSize,
			containerHeight: gridSize,
			forceWait: true,
		},
		tgtTex.createView(),
		tgtTex,
		gridSize,
		gridSize,
	);
	ctx.renderer.popTransform();
	ctx.renderer.popScissor();

	// 4. Synchronously create staging buffers and record texture-to-buffer copies on the main encoder
	const bytesPerPixel = 4;
	const align = 256;
	const unpaddedBPR = gridSize * bytesPerPixel;
	const bytesPerRow = Math.ceil(unpaddedBPR / align) * align;
	const stagingSize = bytesPerRow * gridSize;

	const srcStagingBuffer = ctx.device.createBuffer({
		label: `ExtractLUT-src-staging-${nodeId}`,
		size: stagingSize,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});

	const tgtStagingBuffer = ctx.device.createBuffer({
		label: `ExtractLUT-tgt-staging-${nodeId}`,
		size: stagingSize,
		usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
	});

	encoder.copyTextureToBuffer(
		{ texture: srcTex },
		{ buffer: srcStagingBuffer, bytesPerRow },
		[gridSize, gridSize],
	);
	encoder.copyTextureToBuffer(
		{ texture: tgtTex },
		{ buffer: tgtStagingBuffer, bytesPerRow },
		[gridSize, gridSize],
	);

	let startMapping: () => void = () => {};
	const mainSubmitPromise = new Promise<void>((resolve) => {
		startMapping = resolve;
	});

	// Hook the queue submit so that buffer mapping only begins once the main render commands are submitted
	const originalSubmit = ctx.device.queue.submit;
	ctx.device.queue.submit = function (
		this: GPUQueue,
		commandBuffers: GPUCommandBuffer[],
	) {
		ctx.device.queue.submit = originalSubmit;
		originalSubmit.call(this, commandBuffers);
		startMapping();
	};

	// 5. Schedule the deferred asynchronous extraction task (CPU solve / readback)
	const extractionPromise = (async () => {
		try {
			// Wait for the queue submit containing our copy commands to happen
			await mainSubmitPromise;

			if (latestRequestedFingerprint.get(nodeId) !== fingerprint) {
				try {
					srcStagingBuffer.destroy();
					tgtStagingBuffer.destroy();
				} catch {}
				lutStore.rejectRawDataPromise(
					lutUrl,
					new DOMException(
						"Extraction superseded by a newer request",
						"AbortError",
					),
				);
				return;
			}

			// Wait for the queue submission of this frame to finish executing on the GPU
			await ctx.device.queue.onSubmittedWorkDone();

			await Promise.all([
				srcStagingBuffer.mapAsync(GPUMapMode.READ),
				tgtStagingBuffer.mapAsync(GPUMapMode.READ),
			]);

			// Unpack pixel rows (strip GPU row padding)
			const srcPixels = new Uint8Array(numPixels * bytesPerPixel);
			const tgtPixels = new Uint8Array(numPixels * bytesPerPixel);
			const copyRows = (src: Uint8Array, dst: Uint8Array) => {
				if (bytesPerRow === unpaddedBPR) {
					dst.set(src);
				} else {
					for (let y = 0; y < gridSize; y++) {
						dst.set(
							src.subarray(y * bytesPerRow, y * bytesPerRow + unpaddedBPR),
							y * unpaddedBPR,
						);
					}
				}
			};
			copyRows(new Uint8Array(srcStagingBuffer.getMappedRange()), srcPixels);
			copyRows(new Uint8Array(tgtStagingBuffer.getMappedRange()), tgtPixels);
			srcStagingBuffer.unmap();
			srcStagingBuffer.destroy();
			tgtStagingBuffer.unmap();
			tgtStagingBuffer.destroy();

			if (latestRequestedFingerprint.get(nodeId) !== fingerprint) {
				lutStore.rejectRawDataPromise(
					lutUrl,
					new DOMException(
						"Extraction superceded by a newer request",
						"AbortError",
					),
				);
				return;
			}

			const isBGRA =
				ctx.renderer.format === "bgra8unorm" ||
				ctx.renderer.format === "bgra8unorm-srgb";
			const lutSize = 33;
			const pipelines = getOrCreatePipelines(ctx.device);

			let flat: Float32Array | null = null;
			let succeeded = false;

			if (strategy === "deterministic") {
				// ── CPU: build sample list + solve (small matrices, sequential) ──

				// Build unique color pool using spatial occupancy grid deduplication
				const pool = buildUniqueColorPool(srcPixels, tgtPixels, isBGRA, 20);

				// Seed LCG with content-only fingerprint (excluding samplePoints and strategy)
				const seedFingerprint = getFingerprint({
					...props.virtualMedia,
					metadata: {},
					operation: undefined,
				});
				const seed = hashString(seedFingerprint);

				// Deterministically shuffle unique color pool and pick samplePoints
				const shuffled = seededShuffle(pool, seed);
				const sampledPoints = shuffled.slice(
					0,
					Math.min(shuffled.length, samplePoints),
				);

				const M = sampledPoints.length;
				if (M >= 8) {
					// Check if targetMedia has a purely separable operation tree (e.g. RGB curves, levels)
					const isSeparable = isSeparableOperationTree(
						targetMedia,
						sourceMedia,
					);

					if (isSeparable) {
						// Estimate epsilonSq from 1D data
						let epsilonSq = 0.01;
						let totalMinDist = 0;
						for (let i = 0; i < M; i++) {
							let minD = Infinity;
							for (let j = 0; j < M; j++) {
								if (i === j) continue;
								const dx = sampledPoints[i].src[0] - sampledPoints[j].src[0];
								minD = Math.min(minD, dx * dx);
							}
							totalMinDist += Math.sqrt(minD);
						}
						const meanNND = totalMinDist / M;
						epsilonSq = Math.max(meanNND * meanNND * 4, 1e-4);

						// Solve channels independently
						const srcR = sampledPoints.map((p) => p.src[0]);
						const tgtR = sampledPoints.map((p) => p.tgt[0]);
						const srcG = sampledPoints.map((p) => p.src[1]);
						const tgtG = sampledPoints.map((p) => p.tgt[1]);
						const srcB = sampledPoints.map((p) => p.src[2]);
						const tgtB = sampledPoints.map((p) => p.tgt[2]);

						const X_sol_R = solve1DChannel(srcR, tgtR, epsilonSq);
						const X_sol_G = solve1DChannel(srcG, tgtG, epsilonSq);
						const X_sol_B = solve1DChannel(srcB, tgtB, epsilonSq);

						if (
							X_sol_R &&
							!hasAbsurdCoefficients(X_sol_R) &&
							X_sol_G &&
							!hasAbsurdCoefficients(X_sol_G) &&
							X_sol_B &&
							!hasAbsurdCoefficients(X_sol_B)
						) {
							const lutR = evaluate1DChannel(srcR, X_sol_R, epsilonSq, lutSize);
							const lutG = evaluate1DChannel(srcG, X_sol_G, epsilonSq, lutSize);
							const lutB = evaluate1DChannel(srcB, X_sol_B, epsilonSq, lutSize);

							flat = new Float32Array(lutSize * lutSize * lutSize * 3);
							for (let b = 0; b < lutSize; b++) {
								for (let g = 0; g < lutSize; g++) {
									for (let r = 0; r < lutSize; r++) {
										const idx = (b * lutSize * lutSize + g * lutSize + r) * 3;
										flat[idx + 0] = lutR[r];
										flat[idx + 1] = lutG[g];
										flat[idx + 2] = lutB[b];
									}
								}
							}
							succeeded = true;
						}
					}

					if (!succeeded) {
						// Fall back to joint 3D RBF solver
						const H = M + 4;

						// Estimate epsilonSq from data (mean nearest-neighbor distance squared * 4, clamped)
						let epsilonSq = 0.01;
						let totalMinDist = 0;
						for (let i = 0; i < M; i++) {
							let minD = Infinity;
							for (let j = 0; j < M; j++) {
								if (i === j) continue;
								const dx = sampledPoints[i].src[0] - sampledPoints[j].src[0];
								const dy = sampledPoints[i].src[1] - sampledPoints[j].src[1];
								const dz = sampledPoints[i].src[2] - sampledPoints[j].src[2];
								minD = Math.min(minD, dx * dx + dy * dy + dz * dz);
							}
							totalMinDist += Math.sqrt(minD);
						}
						const meanNND = totalMinDist / M;
						epsilonSq = Math.max(meanNND * meanNND * 4, 1e-4);

						const K_mat = new Float64Array(H * H);
						const B_rhs = new Float64Array(H * 3);
						for (let i = 0; i < M; i++) {
							const pi = sampledPoints[i].src;
							const gi = sampledPoints[i].tgt;
							B_rhs[i * 3 + 0] = gi[0];
							B_rhs[i * 3 + 1] = gi[1];
							B_rhs[i * 3 + 2] = gi[2];
							for (let j = 0; j < M; j++) {
								const pj = sampledPoints[j].src;
								const dx = pi[0] - pj[0],
									dy = pi[1] - pj[1],
									dz = pi[2] - pj[2];
								K_mat[i * H + j] = Math.sqrt(
									dx * dx + dy * dy + dz * dz + epsilonSq,
								);
							}
							K_mat[i * H + M + 0] = 1;
							K_mat[i * H + M + 1] = pi[0];
							K_mat[i * H + M + 2] = pi[1];
							K_mat[i * H + M + 3] = pi[2];
							K_mat[(M + 0) * H + i] = 1;
							K_mat[(M + 1) * H + i] = pi[0];
							K_mat[(M + 2) * H + i] = pi[1];
							K_mat[(M + 3) * H + i] = pi[2];
						}

						// Regularize the polynomial block to handle coplanar/colinear color sets stably
						// Normalize regularization lambda relative to mean diagonal of K (RBF block)
						let diagMean = 0;
						for (let i = 0; i < M; i++) diagMean += K_mat[i * H + i];
						diagMean /= M;

						const lambda = Math.max(1e-4, diagMean * 0.01); // 1% of mean diagonal, floored at 1e-4
						for (let i = 0; i < M; i++) {
							K_mat[i * H + i] += lambda;
						}

						const polyLambda = Math.max(1e-4, diagMean * 0.001); // 0.1% of mean diagonal, floored at 1e-4
						for (let k = 0; k < 4; k++) {
							K_mat[(M + k) * H + M + k] = polyLambda;
						}

						const X_sol = solveLU(K_mat, B_rhs, H);

						if (X_sol && !hasAbsurdCoefficients(X_sol)) {
							try {
								// ── GPU: evaluate 33³ RBF nodes in parallel ──────────────────
								flat = await evaluateRbfOnGpu(
									ctx.device,
									pipelines,
									sampledPoints,
									X_sol,
									lutSize,
									epsilonSq,
								);

								// Verify output has no NaN/Infinity
								let hasInvalid = false;
								for (let i = 0; i < flat.length; i++) {
									const val = flat[i];
									if (Number.isNaN(val) || !Number.isFinite(val)) {
										hasInvalid = true;
										break;
									}
								}

								if (!hasInvalid) {
									succeeded = true;
								}
							} catch (gpuErr) {
								console.error(
									"[ExtractLUT] RBF GPU evaluation failed:",
									gpuErr,
								);
							}
						}
					}
				}
			}

			if (!succeeded) {
				// ── CPU: compute 6 LAB statistics (tiny reduction) ───────────
				let srcMeanL = 0,
					srcMeanA = 0,
					srcMeanB = 0;
				let tgtMeanL = 0,
					tgtMeanA = 0,
					tgtMeanB = 0;
				const srcLABs: Array<[number, number, number]> = [];
				const tgtLABs: Array<[number, number, number]> = [];

				for (let i = 0; i < numPixels; i++) {
					const sl = rgbToLab(...getPixelRGB(srcPixels, i, isBGRA));
					srcLABs.push(sl);
					srcMeanL += sl[0];
					srcMeanA += sl[1];
					srcMeanB += sl[2];
					const tl = rgbToLab(...getPixelRGB(tgtPixels, i, isBGRA));
					tgtLABs.push(tl);
					tgtMeanL += tl[0];
					tgtMeanA += tl[1];
					tgtMeanB += tl[2];
				}
				srcMeanL /= numPixels;
				srcMeanA /= numPixels;
				srcMeanB /= numPixels;
				tgtMeanL /= numPixels;
				tgtMeanA /= numPixels;
				tgtMeanB /= numPixels;

				let srcStdL = 0,
					srcStdA = 0,
					srcStdB = 0;
				let tgtStdL = 0,
					tgtStdA = 0,
					tgtStdB = 0;
				for (let i = 0; i < numPixels; i++) {
					srcStdL += (srcLABs[i][0] - srcMeanL) ** 2;
					srcStdA += (srcLABs[i][1] - srcMeanA) ** 2;
					srcStdB += (srcLABs[i][2] - srcMeanB) ** 2;
					tgtStdL += (tgtLABs[i][0] - tgtMeanL) ** 2;
					tgtStdA += (tgtLABs[i][1] - tgtMeanA) ** 2;
					tgtStdB += (tgtLABs[i][2] - tgtMeanB) ** 2;
				}
				srcStdL = Math.max(Math.sqrt(srcStdL / numPixels), 1e-6);
				srcStdA = Math.max(Math.sqrt(srcStdA / numPixels), 1e-6);
				srcStdB = Math.max(Math.sqrt(srcStdB / numPixels), 1e-6);
				tgtStdL = Math.sqrt(tgtStdL / numPixels);
				tgtStdA = Math.sqrt(tgtStdA / numPixels);
				tgtStdB = Math.sqrt(tgtStdB / numPixels);

				if (srcStdL < 1e-4 || srcMeanL < 1e-4) {
					// Fallback to identity mapping for degenerate / empty images
					flat = new Float32Array(lutSize * lutSize * lutSize * 3);
					for (let b = 0; b < lutSize; b++) {
						for (let g = 0; g < lutSize; g++) {
							for (let r = 0; r < lutSize; r++) {
								const idx = (b * lutSize * lutSize + g * lutSize + r) * 3;
								flat[idx + 0] = r / (lutSize - 1);
								flat[idx + 1] = g / (lutSize - 1);
								flat[idx + 2] = b / (lutSize - 1);
							}
						}
					}
				} else {
					// ── GPU: evaluate 33³ LAB→RGB nodes in parallel ─────────────
					flat = await evaluateStatisticalOnGpu(
						ctx.device,
						pipelines,
						[srcMeanL, srcMeanA, srcMeanB],
						[tgtMeanL, tgtMeanA, tgtMeanB],
						[tgtStdL / srcStdL, tgtStdA / srcStdA, tgtStdB / srcStdB],
						lutSize,
					);
				}
			}

			const points = flatToPoints(flat!);
			const smoothedPoints = points;

			if (latestRequestedFingerprint.get(nodeId) !== fingerprint) {
				lutStore.rejectRawDataPromise(
					lutUrl,
					new DOMException(
						"Extraction superseded by a newer request",
						"AbortError",
					),
				);
				return;
			}

			lutStore.createOrUpdate(
				lutUrl,
				ctx.device,
				smoothedPoints,
				lutSize,
				"3D",
			);
			extractionCache.set(nodeId, fingerprint);
		} catch (err) {
			console.error("[ExtractLUT] Async extraction error:", err);

			// Fatal error fallback: build and set an identity LUT so the canvas graph doesn't freeze or show raw errors
			try {
				const lutSize = 33;
				const identityPoints: Array<[number, number, number]> = [];
				for (let z = 0; z < lutSize; z++) {
					for (let y = 0; y < lutSize; y++) {
						for (let x = 0; x < lutSize; x++) {
							identityPoints.push([
								x / (lutSize - 1),
								y / (lutSize - 1),
								z / (lutSize - 1),
							]);
						}
					}
				}
				if (latestRequestedFingerprint.get(nodeId) === fingerprint) {
					lutStore.createOrUpdate(
						lutUrl,
						ctx.device,
						identityPoints,
						lutSize,
						"3D",
					);
					extractionCache.set(nodeId, fingerprint);
				}
			} catch (fallbackErr) {
				console.error(
					"[ExtractLUT] Failed to write fallback identity LUT:",
					fallbackErr,
				);
				lutStore.rejectRawDataPromise(lutUrl, err);
			}
		} finally {
			pendingExtractions.delete(cacheKey);
		}
	})();

	pendingExtractions.set(cacheKey, extractionPromise);
};
