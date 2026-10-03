import type { SegmentationOptions } from "../types.js";
import { segmentationWgsl } from "../shaders/segmentation.wgsl.js";

export class SegmentationComputePipeline {
	private computePipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const shaderModule = device.createShaderModule({
			label: "segmentation.wgsl",
			code: segmentationWgsl,
		});

		this.computePipeline = device.createComputePipeline({
			label: "SegmentationComputePipeline",
			layout: "auto",
			compute: {
				module: shaderModule,
				entryPoint: "computeSegmentation",
			},
		});

		this.uniformBuffer = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "segmentation_uniform_buffer",
		});
	}

	public execute(
		inputTexture: GPUTexture,
		options: SegmentationOptions = {},
	): GPUTexture {
		const width = inputTexture.width;
		const height = inputTexture.height;
		const threshold = options.threshold ?? 0.5;
		const feather = options.feather ?? 0.05;

		const arrayBuf = new ArrayBuffer(16);
		const f32View = new Float32Array(arrayBuf);
		const u32View = new Uint32Array(arrayBuf);

		f32View[0] = threshold;
		f32View[1] = feather;
		u32View[2] = width;
		u32View[3] = height;

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			arrayBuf as unknown as GPUAllowSharedBufferSource,
		);

		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: "segmentation_output_texture",
				size: [width, height],
				format: "rgba8unorm",
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
			});
		}

		const commandEncoder = this.device.createCommandEncoder({
			label: "segmentation_command_encoder",
		});

		const bindGroup = this.device.createBindGroup({
			label: "segmentation_bind_group",
			layout: this.computePipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: inputTexture.createView({
						label: "segmentation_input_view",
					}),
				},
				{
					binding: 1,
					resource: this.cachedOutputTexture.createView({
						label: "segmentation_output_view",
					}),
				},
				{
					binding: 2,
					resource: {
						buffer: this.uniformBuffer,
					},
				},
			],
		});

		const pass = commandEncoder.beginComputePass({
			label: "segmentation_compute_pass",
		});
		pass.setPipeline(this.computePipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16), 1);
		pass.end();

		this.device.queue.submit([commandEncoder.finish()]);

		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.cachedOutputTexture?.destroy();
		this.cachedOutputTexture = undefined;
		this.uniformBuffer.destroy();
	}
}
