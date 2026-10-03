import {
	cannyNmsR32fWgsl,
	cannyNmsRgba8Wgsl,
	cannySobelWgsl,
} from "../shaders/canny.wgsl.js";
import type { CannyOptions } from "../types.js";

export class CannyComputePipeline {
	private sobelPipeline: GPUComputePipeline;
	private nmsRgba8Pipeline: GPUComputePipeline;
	private nmsR32fPipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private cachedIntermediateTexture?: GPUTexture;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const sobelModule = device.createShaderModule({
			label: "canny_sobel.wgsl",
			code: cannySobelWgsl,
		});
		this.sobelPipeline = device.createComputePipeline({
			label: "CannySobelPipeline",
			layout: "auto",
			compute: {
				module: sobelModule,
				entryPoint: "computeSobel",
			},
		});

		const nmsRgba8Module = device.createShaderModule({
			label: "canny_nms_rgba8.wgsl",
			code: cannyNmsRgba8Wgsl,
		});
		this.nmsRgba8Pipeline = device.createComputePipeline({
			label: "CannyNmsRgba8Pipeline",
			layout: "auto",
			compute: {
				module: nmsRgba8Module,
				entryPoint: "computeNonMaxSuppression",
			},
		});

		const nmsR32fModule = device.createShaderModule({
			label: "canny_nms_r32f.wgsl",
			code: cannyNmsR32fWgsl,
		});
		this.nmsR32fPipeline = device.createComputePipeline({
			label: "CannyNmsR32fPipeline",
			layout: "auto",
			compute: {
				module: nmsR32fModule,
				entryPoint: "computeNonMaxSuppression",
			},
		});

		this.uniformBuffer = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "canny_uniform_buffer",
		});
	}

	public execute(
		inputTexture: GPUTexture,
		options: CannyOptions = {},
	): GPUTexture {
		const width = inputTexture.width;
		const height = inputTexture.height;
		const lowThreshold = options.low ?? 0.1;
		const highThreshold = options.high ?? 0.3;
		const outputFormat: "rgba8unorm" | "r32float" =
			options.outputFormat ?? "rgba8unorm";

		// Update uniform buffer
		const uniformData = new ArrayBuffer(16);
		const f32View = new Float32Array(uniformData);
		const u32View = new Uint32Array(uniformData);
		f32View[0] = lowThreshold;
		f32View[1] = highThreshold;
		u32View[2] = width;
		u32View[3] = height;

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			uniformData as unknown as GPUAllowSharedBufferSource,
		);

		// Prepare intermediate rgba16float texture for gradient magnitude & sector
		if (
			!this.cachedIntermediateTexture ||
			this.cachedIntermediateTexture.width !== width ||
			this.cachedIntermediateTexture.height !== height
		) {
			this.cachedIntermediateTexture?.destroy();
			this.cachedIntermediateTexture = this.device.createTexture({
				label: "canny_magnitude_intermediate",
				size: [width, height],
				format: "rgba16float",
				usage:
					GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
			});
		}

		// Prepare output texture
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height ||
			this.cachedOutputTexture.format !== outputFormat
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: `canny_edge_output_${outputFormat}`,
				size: [width, height],
				format: outputFormat,
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
			});
		}

		const commandEncoder = this.device.createCommandEncoder({
			label: "canny_command_encoder",
		});

		// Pass 1: Sobel gradient magnitude & angle
		const sobelBindGroup = this.device.createBindGroup({
			layout: this.sobelPipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: inputTexture.createView() },
				{
					binding: 1,
					resource: this.cachedIntermediateTexture.createView(),
				},
				{ binding: 2, resource: { buffer: this.uniformBuffer } },
			],
		});

		const pass1 = commandEncoder.beginComputePass({
			label: "canny_sobel_pass",
		});
		pass1.setPipeline(this.sobelPipeline);
		pass1.setBindGroup(0, sobelBindGroup);
		pass1.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
		pass1.end();

		// Pass 2: Non-Maximum Suppression & Hysteresis
		const nmsPipeline =
			outputFormat === "r32float"
				? this.nmsR32fPipeline
				: this.nmsRgba8Pipeline;

		const nmsBindGroup = this.device.createBindGroup({
			layout: nmsPipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: this.cachedIntermediateTexture.createView(),
				},
				{
					binding: 1,
					resource: this.cachedOutputTexture.createView(),
				},
				{ binding: 2, resource: { buffer: this.uniformBuffer } },
			],
		});

		const pass2 = commandEncoder.beginComputePass({
			label: "canny_nms_pass",
		});
		pass2.setPipeline(nmsPipeline);
		pass2.setBindGroup(0, nmsBindGroup);
		pass2.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
		pass2.end();

		this.device.queue.submit([commandEncoder.finish()]);

		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.cachedIntermediateTexture?.destroy();
		this.cachedOutputTexture?.destroy();
		this.uniformBuffer.destroy();
	}
}
