import type { Mesh3DData } from "../loaders/types.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";

/**
 * Morph deltas are stored per vertex: `rows[v] … rows[v + 1]` are the
 * entries that move vertex v, each eight floats (target index as bits,
 * position delta, normal delta, padding). A vertex adds the weighted
 * deltas of its own entries: memory follows the deltas that exist (a face
 * with hundreds of sparse correctives stays small) and no atomics are needed.
 */
const morphWgsl = `
struct Counts { vertices: u32, targets: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read> entries: array<f32>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<uniform> counts: Counts;
@group(0) @binding(4) var<storage, read_write> dest: array<f32>;
@group(0) @binding(5) var<storage, read> rows: array<u32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vertex = gid.x;
  if (vertex >= counts.vertices) { return; }
  let v = vertex * 16u;
  for (var c = 0u; c < 16u; c++) { dest[v + c] = source[v + c]; }
  var position = vec3<f32>(source[v], source[v + 1u], source[v + 2u]);
  var normal = vec3<f32>(source[v + 5u], source[v + 6u], source[v + 7u]);
  for (var e = rows[vertex]; e < rows[vertex + 1u]; e++) {
    let o = e * 8u;
    let w = weights[bitcast<u32>(entries[o])];
    if (w == 0.0) { continue; }
    position += vec3<f32>(entries[o + 1u], entries[o + 2u], entries[o + 3u]) * w;
    normal += vec3<f32>(entries[o + 4u], entries[o + 5u], entries[o + 6u]) * w;
  }
  dest[v] = position.x; dest[v + 1u] = position.y; dest[v + 2u] = position.z;
  dest[v + 5u] = normal.x; dest[v + 6u] = normal.y; dest[v + 7u] = normal.z;
}`;

/** Applies per-instance morph targets on the GPU before skinning or audio deformation. */
export class MorphPipeline {
	private pipeline: GPUComputePipeline;
	private layout: GPUBindGroupLayout;
	private weights = new BufferPool(
		16,
		GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
	);
	private counts = new BufferPool(
		16,
		GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	);
	private targets = new WeakMap<Mesh3DData, MorphBuffers>();
	private outputs: GPUBuffer[] = [];
	private outputIndex = 0;

	constructor(private device: GPUDevice) {
		this.layout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "uniform" },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 5,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "read-only-storage" },
				},
			],
		});
		this.pipeline = device.createComputePipeline({
			label: "MeshMorphPipeline",
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
			compute: {
				module: device.createShaderModule({ code: morphWgsl }),
				entryPoint: "main",
			},
		});
	}

	/** The mesh's morph entries per vertex, uploaded once. */
	private targetBuffers(mesh: Mesh3DData): MorphBuffers {
		const existing = this.targets.get(mesh);
		if (existing) return existing;
		const { rows, entries } = morphEntries(mesh);
		const upload = (label: string, data: Uint32Array | Float32Array) => {
			const buffer = this.device.createBuffer({
				label,
				size: Math.max(32, data.byteLength),
				usage: GPUBufferUsage.STORAGE,
				mappedAtCreation: true,
			});
			const range = buffer.getMappedRange();
			if (data instanceof Uint32Array) new Uint32Array(range).set(data);
			else new Float32Array(range).set(data);
			buffer.unmap();
			return buffer;
		};
		const buffers = {
			rows: upload("MeshMorphRows", rows),
			entries: upload("MeshMorphEntries", entries),
		};
		this.targets.set(mesh, buffers);
		return buffers;
	}

	execute(
		encoder: GPUCommandEncoder,
		mesh: Mesh3DData,
		source: GPUBuffer,
		weights: number[],
	): GPUBuffer {
		const vertexCount = mesh.positions.length / 3;
		const targetCount = mesh.morphTargets?.length ?? 0;
		const size = Math.max(64, vertexCount * 64);
		let output = this.outputs[this.outputIndex];
		if (!output || output.size < size) {
			if (output) {
				const old = output;
				this.device.queue.onSubmittedWorkDone().then(() => old.destroy());
			}
			output = this.device.createBuffer({
				label: "MeshMorphOutput",
				size,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX,
			});
			this.outputs[this.outputIndex] = output;
		}
		this.outputIndex++;
		const weightData = new Float32Array(Math.max(4, targetCount));
		for (let i = 0; i < targetCount; i++) weightData[i] = weights[i] ?? 0;
		const buffers = this.targetBuffers(mesh);
		const bind = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{ binding: 0, resource: { buffer: source } },
				{ binding: 1, resource: { buffer: buffers.entries } },
				{
					binding: 2,
					resource: { buffer: this.weights.getBuffer(this.device, weightData) },
				},
				{
					binding: 3,
					resource: {
						buffer: this.counts.getBuffer(
							this.device,
							new Uint32Array([vertexCount, targetCount, 0, 0]),
						),
					},
				},
				{ binding: 4, resource: { buffer: output } },
				{ binding: 5, resource: { buffer: buffers.rows } },
			],
		});
		const pass = encoder.beginComputePass({ label: "MeshMorphPass" });
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bind);
		pass.dispatchWorkgroups(Math.ceil(vertexCount / 128));
		pass.end();
		return output;
	}

	resetPools(): void {
		this.outputIndex = 0;
		this.weights.reset();
		this.counts.reset();
	}
	destroy(): void {
		this.weights.destroy();
		this.counts.destroy();
		for (const output of this.outputs) output.destroy();
	}
}

interface MorphBuffers {
	rows: GPUBuffer;
	entries: GPUBuffer;
}

/**
 * The mesh's morph targets regrouped by vertex: `rows` (vertex count + 1
 * offsets) and `entries` (eight floats each: target index as bits,
 * position delta, normal delta, padding). Unmoved vertices have none.
 */
export function morphEntries(mesh: Mesh3DData): {
	rows: Uint32Array;
	entries: Float32Array;
} {
	const targets = mesh.morphTargets ?? [];
	const n = mesh.positions.length / 3;
	// Each target's moved vertices and where their deltas sit.
	const each = (fn: (t: number, v: number, at: number) => void) => {
		targets.forEach((target, t) => {
			const moved = (at: number) =>
				[target.positions, target.normals].some(
					(d) => d && (d[at * 3] || d[at * 3 + 1] || d[at * 3 + 2]),
				);
			if (target.indices)
				target.indices.forEach((v, i) => {
					if (v < n && moved(i)) fn(t, v, i);
				});
			else for (let v = 0; v < n; v++) if (moved(v)) fn(t, v, v);
		});
	};
	const rows = new Uint32Array(n + 1);
	each((_, v) => {
		rows[v + 1] = (rows[v + 1] as number) + 1;
	});
	for (let v = 0; v < n; v++)
		rows[v + 1] = (rows[v + 1] as number) + (rows[v] as number);
	const entries = new Float32Array((rows[n] as number) * 8);
	const bits = new Uint32Array(entries.buffer);
	const fill = rows.slice(0, n);
	each((t, v, at) => {
		const e = (fill[v] as number) * 8;
		fill[v] = (fill[v] as number) + 1;
		bits[e] = t;
		const target = targets[t];
		for (let k = 0; k < 3; k++) {
			entries[e + 1 + k] = target?.positions?.[at * 3 + k] ?? 0;
			entries[e + 4 + k] = target?.normals?.[at * 3 + k] ?? 0;
		}
	});
	return { rows, entries };
}
