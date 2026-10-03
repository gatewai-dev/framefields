/// <reference types="webgpu" />

/**
 * GPU-accelerated histogram computation using WebGPU compute shaders.
 * Uses atomicAdd on 256-bin storage buffers per channel.
 * Records commands into the caller's encoder so texture data is available.
 * Readback is async via mapAsync after the queue drains.
 */

export interface HistogramData {
	r: Uint32Array;
	g: Uint32Array;
	b: Uint32Array;
	luma: Uint32Array;
}

const HISTOGRAM_BINS = 256;
const PER_CHAN_SIZE = HISTOGRAM_BINS * 4; // 256 × 4 bytes (u32)

const HISTOGRAM_COMPUTE_SHADER = /* wgsl */ `
@group(0) @binding(0) var t_src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins_r:    array<atomic<u32>, 256>;
@group(0) @binding(2) var<storage, read_write> bins_g:    array<atomic<u32>, 256>;
@group(0) @binding(3) var<storage, read_write> bins_b:    array<atomic<u32>, 256>;
@group(0) @binding(4) var<storage, read_write> bins_luma: array<atomic<u32>, 256>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
	let dims = textureDimensions(t_src, 0);
	if (gid.x >= dims.x || gid.y >= dims.y) { return; }

	let color = textureLoad(t_src, vec2<u32>(gid.x, gid.y), 0);
	let a = color.a;
	if (a < 1e-5) { return; }

	let rgb = color.rgb / a;

	let ri    = u32(clamp(rgb.r * 255.0, 0.0, 255.0));
	let gi    = u32(clamp(rgb.g * 255.0, 0.0, 255.0));
	let bi    = u32(clamp(rgb.b * 255.0, 0.0, 255.0));
	let luma  = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
	let lumai = u32(clamp(luma * 255.0, 0.0, 255.0));

	atomicAdd(&bins_r[ri],    1u);
	atomicAdd(&bins_g[gi],    1u);
	atomicAdd(&bins_b[bi],    1u);
	atomicAdd(&bins_luma[lumai], 1u);
}
`;

interface DeviceHistogramResources {
	pipeline: GPUComputePipeline;
	bindGroupLayout: GPUBindGroupLayout;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceHistogramResources>();

function getHistogramResources(device: GPUDevice): DeviceHistogramResources {
	let res = deviceResourceCache.get(device);
	if (!res) {
		const bindGroupLayout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.COMPUTE,
					texture: { sampleType: "float", viewDimension: "2d" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.COMPUTE,
					buffer: { type: "storage" },
				},
			],
		});
		const module = device.createShaderModule({
			label: "histogram.wgsl",
			code: HISTOGRAM_COMPUTE_SHADER,
		});
		const pipeline = device.createComputePipeline({
			label: "HistogramPipeline",
			layout: device.createPipelineLayout({
				bindGroupLayouts: [bindGroupLayout],
			}),
			compute: { module, entryPoint: "main" },
		});
		res = { pipeline, bindGroupLayout };
		deviceResourceCache.set(device, res);
	}
	return res;
}

type HistogramCallback = (data: HistogramData) => void;
const histogramCallbacks = new Map<string, HistogramCallback>();

// Throttle: skip if a readback is already in-flight for this node
const inflight = new Set<string>();

export function registerHistogramCallback(
	nodeId: string,
	cb: HistogramCallback,
): void {
	histogramCallbacks.set(nodeId, cb);
}

export function unregisterHistogramCallback(nodeId: string): void {
	histogramCallbacks.delete(nodeId);
	inflight.delete(nodeId);
}

/**
 * Records histogram compute + buffer copy commands into the provided encoder.
 * The async readback fires after the queue processes the encoder's commands.
 * This ensures the source texture data is valid when the compute pass reads it.
 */
export function computeHistogramFromEncoder(
	device: GPUDevice,
	encoder: GPUCommandEncoder,
	srcTexture: GPUTexture,
	nodeId: string,
): void {
	const cb = histogramCallbacks.get(nodeId);
	if (!cb) return;
	// Skip if a readback is already pending
	if (inflight.has(nodeId)) return;
	inflight.add(nodeId);

	const { pipeline, bindGroupLayout } = getHistogramResources(device);

	const makeStorage = () =>
		device.createBuffer({
			size: PER_CHAN_SIZE,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
		});

	const bufR = makeStorage();
	const bufG = makeStorage();
	const bufB = makeStorage();
	const bufLuma = makeStorage();

	// Clear storage buffers
	encoder.clearBuffer(bufR);
	encoder.clearBuffer(bufG);
	encoder.clearBuffer(bufB);
	encoder.clearBuffer(bufLuma);

	const bindGroup = device.createBindGroup({
		layout: bindGroupLayout,
		entries: [
			{ binding: 0, resource: srcTexture.createView() },
			{ binding: 1, resource: { buffer: bufR } },
			{ binding: 2, resource: { buffer: bufG } },
			{ binding: 3, resource: { buffer: bufB } },
			{ binding: 4, resource: { buffer: bufLuma } },
		],
	});

	const pass = encoder.beginComputePass({ label: "histogram-pass" });
	pass.setPipeline(pipeline);
	pass.setBindGroup(0, bindGroup);
	pass.dispatchWorkgroups(
		Math.ceil(srcTexture.width / 8),
		Math.ceil(srcTexture.height / 8),
	);
	pass.end();

	// Readback staging buffers
	const makeReadback = () =>
		device.createBuffer({
			size: PER_CHAN_SIZE,
			usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
		});

	const rbR = makeReadback();
	const rbG = makeReadback();
	const rbB = makeReadback();
	const rbLuma = makeReadback();

	encoder.copyBufferToBuffer(bufR, 0, rbR, 0, PER_CHAN_SIZE);
	encoder.copyBufferToBuffer(bufG, 0, rbG, 0, PER_CHAN_SIZE);
	encoder.copyBufferToBuffer(bufB, 0, rbB, 0, PER_CHAN_SIZE);
	encoder.copyBufferToBuffer(bufLuma, 0, rbLuma, 0, PER_CHAN_SIZE);

	// Async readback — fires after the encoder's command buffer is submitted and processed
	// We use device.queue.onSubmittedWorkDone() to know when GPU is done
	device.queue
		.onSubmittedWorkDone()
		.then(() => {
			return Promise.all([
				rbR.mapAsync(GPUMapMode.READ),
				rbG.mapAsync(GPUMapMode.READ),
				rbB.mapAsync(GPUMapMode.READ),
				rbLuma.mapAsync(GPUMapMode.READ),
			]);
		})
		.then(() => {
			const r = new Uint32Array(rbR.getMappedRange().slice(0));
			const g = new Uint32Array(rbG.getMappedRange().slice(0));
			const b = new Uint32Array(rbB.getMappedRange().slice(0));
			const luma = new Uint32Array(rbLuma.getMappedRange().slice(0));

			rbR.unmap();
			rbG.unmap();
			rbB.unmap();
			rbLuma.unmap();
			rbR.destroy();
			rbG.destroy();
			rbB.destroy();
			rbLuma.destroy();
			bufR.destroy();
			bufG.destroy();
			bufB.destroy();
			bufLuma.destroy();
			inflight.delete(nodeId);

			const currentCb = histogramCallbacks.get(nodeId);
			if (currentCb) currentCb({ r, g, b, luma });
		})
		.catch(() => {
			rbR.destroy();
			rbG.destroy();
			rbB.destroy();
			rbLuma.destroy();
			bufR.destroy();
			bufG.destroy();
			bufB.destroy();
			bufLuma.destroy();
			inflight.delete(nodeId);
		});
}
