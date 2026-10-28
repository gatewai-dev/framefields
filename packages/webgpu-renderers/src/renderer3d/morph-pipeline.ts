import type { Mesh3DData } from "../loaders/types.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";

const morphWgsl = `
struct Counts { vertices: u32, targets: u32, pad0: u32, pad1: u32 };
@group(0) @binding(0) var<storage, read> source: array<f32>;
@group(0) @binding(1) var<storage, read> deltas: array<f32>;
@group(0) @binding(2) var<storage, read> weights: array<f32>;
@group(0) @binding(3) var<uniform> counts: Counts;
@group(0) @binding(4) var<storage, read_write> dest: array<f32>;
@compute @workgroup_size(128)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let vertex = gid.x;
  if (vertex >= counts.vertices) { return; }
  let v = vertex * 16u;
  for (var c = 0u; c < 16u; c++) { dest[v + c] = source[v + c]; }
  var position = vec3<f32>(source[v], source[v + 1u], source[v + 2u]);
  var normal = vec3<f32>(source[v + 5u], source[v + 6u], source[v + 7u]);
  for (var t = 0u; t < counts.targets; t++) {
    let d = (t * counts.vertices + vertex) * 6u;
    let w = weights[t];
    position += vec3<f32>(deltas[d], deltas[d + 1u], deltas[d + 2u]) * w;
    normal += vec3<f32>(deltas[d + 3u], deltas[d + 4u], deltas[d + 5u]) * w;
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
	private targets = new WeakMap<Mesh3DData, GPUBuffer>();
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

	private targetBuffer(mesh: Mesh3DData): GPUBuffer {
		const existing = this.targets.get(mesh);
		if (existing) return existing;
		const targets = mesh.morphTargets ?? [];
		const count = mesh.positions.length / 3;
		const data = new Float32Array(count * targets.length * 6);
		for (let t = 0; t < targets.length; t++) {
			const target = targets[t];
			for (let v = 0; v < count; v++) {
				for (let k = 0; k < 3; k++) {
					data[(t * count + v) * 6 + k] = target.positions?.[v * 3 + k] ?? 0;
					data[(t * count + v) * 6 + 3 + k] = target.normals?.[v * 3 + k] ?? 0;
				}
			}
		}
		const buffer = this.device.createBuffer({
			label: "MeshMorphTargets",
			size: Math.max(4, data.byteLength),
			usage: GPUBufferUsage.STORAGE,
			mappedAtCreation: true,
		});
		new Float32Array(buffer.getMappedRange()).set(data);
		buffer.unmap();
		this.targets.set(mesh, buffer);
		return buffer;
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
		const bind = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{ binding: 0, resource: { buffer: source } },
				{ binding: 1, resource: { buffer: this.targetBuffer(mesh) } },
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
