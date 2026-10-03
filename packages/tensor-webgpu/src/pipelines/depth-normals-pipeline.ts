import {
	depthNormalsRgba8Wgsl,
	depthNormalsRgba16fWgsl,
} from "../shaders/depth-normals.wgsl.js";
import type { DepthNormalsOptions } from "../types.js";

export class DepthNormalsComputePipeline {
	private normalRgba16fPipeline: GPUComputePipeline;
	private normalRgba8Pipeline: GPUComputePipeline;
	private uniformBuffer: GPUBuffer;
	private cachedOutputTexture?: GPUTexture;

	constructor(private device: GPUDevice) {
		const rgba16fModule = device.createShaderModule({
			label: "depth_normals_rgba16f.wgsl",
			code: depthNormalsRgba16fWgsl,
		});
		this.normalRgba16fPipeline = device.createComputePipeline({
			label: "DepthNormalsRgba16fPipeline",
			layout: "auto",
			compute: {
				module: rgba16fModule,
				entryPoint: "computeNormals",
			},
		});

		const rgba8Module = device.createShaderModule({
			label: "depth_normals_rgba8.wgsl",
			code: depthNormalsRgba8Wgsl,
		});
		this.normalRgba8Pipeline = device.createComputePipeline({
			label: "DepthNormalsRgba8Pipeline",
			layout: "auto",
			compute: {
				module: rgba8Module,
				entryPoint: "computeNormals",
			},
		});

		this.uniformBuffer = device.createBuffer({
			size: 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			label: "depth_normals_uniform_buffer",
		});
	}

	public execute(
		depthTexture: GPUTexture,
		options: DepthNormalsOptions = {},
	): GPUTexture {
		const width = depthTexture.width;
		const height = depthTexture.height;
		const depthScale = options.depthScale ?? 1.0;
		const outputFormat: "rgba16float" | "rgba8unorm" =
			options.outputFormat ?? "rgba16float";

		// Update uniform buffer
		const uniformData = new ArrayBuffer(16);
		const u32View = new Uint32Array(uniformData);
		const f32View = new Float32Array(uniformData);
		u32View[0] = width;
		u32View[1] = height;
		f32View[2] = depthScale;
		f32View[3] = 0.0;

		this.device.queue.writeBuffer(
			this.uniformBuffer,
			0,
			uniformData as unknown as GPUAllowSharedBufferSource,
		);

		// Prepare output texture
		if (
			!this.cachedOutputTexture ||
			this.cachedOutputTexture.width !== width ||
			this.cachedOutputTexture.height !== height ||
			this.cachedOutputTexture.format !== outputFormat
		) {
			this.cachedOutputTexture?.destroy();
			this.cachedOutputTexture = this.device.createTexture({
				label: `normal_output_${outputFormat}`,
				size: [width, height],
				format: outputFormat,
				usage:
					GPUTextureUsage.STORAGE_BINDING |
					GPUTextureUsage.TEXTURE_BINDING |
					GPUTextureUsage.COPY_SRC,
			});
		}

		const pipeline =
			outputFormat === "rgba8unorm"
				? this.normalRgba8Pipeline
				: this.normalRgba16fPipeline;

		const commandEncoder = this.device.createCommandEncoder({
			label: "depth_normals_command_encoder",
		});

		const bindGroup = this.device.createBindGroup({
			layout: pipeline.getBindGroupLayout(0),
			entries: [
				{ binding: 0, resource: depthTexture.createView() },
				{ binding: 1, resource: this.cachedOutputTexture.createView() },
				{ binding: 2, resource: { buffer: this.uniformBuffer } },
			],
		});

		const pass = commandEncoder.beginComputePass({
			label: "depth_normals_compute_pass",
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
		pass.end();

		this.device.queue.submit([commandEncoder.finish()]);

		return this.cachedOutputTexture;
	}

	public destroy(): void {
		this.cachedOutputTexture?.destroy();
		this.uniformBuffer.destroy();
	}
}
