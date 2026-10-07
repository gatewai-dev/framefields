/// <reference lib="dom" />
/// <reference types="webgpu" />
/**
 * Copies one texture onto another of any size, with linear filtering. Kept
 * apart from the 2D renderer on purpose: showing a cached frame must not
 * touch the renderer's pools.
 */

const WGSL = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;

struct VSOut {
	@builtin(position) pos: vec4<f32>,
	@location(0) uv: vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) i: u32) -> VSOut {
	var p = array<vec2<f32>, 3>(vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
	var out: VSOut;
	out.pos = vec4(p[i], 0.0, 1.0);
	out.uv = vec2(p[i].x * 0.5 + 0.5, 0.5 - p[i].y * 0.5);
	return out;
}

@fragment fn fs(in: VSOut) -> @location(0) vec4<f32> {
	return textureSampleLevel(src, samp, in.uv, 0.0);
}
`;

export class Blitter {
	private readonly pipeline: GPURenderPipeline;
	private readonly sampler: GPUSampler;
	private readonly bindGroups = new WeakMap<GPUTexture, GPUBindGroup>();

	constructor(
		private readonly device: GPUDevice,
		format: GPUTextureFormat,
	) {
		const module = device.createShaderModule({
			label: "preview_blit",
			code: WGSL,
		});
		this.pipeline = device.createRenderPipeline({
			label: "preview_blit",
			layout: "auto",
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-list" },
		});
		this.sampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});
	}

	/** Draws all of `src` over all of `dst` and submits it. */
	blit(src: GPUTexture, dst: GPUTexture): void {
		let bindGroup = this.bindGroups.get(src);
		if (!bindGroup) {
			bindGroup = this.device.createBindGroup({
				layout: this.pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: src.createView() },
					{ binding: 1, resource: this.sampler },
				],
			});
			this.bindGroups.set(src, bindGroup);
		}
		const encoder = this.device.createCommandEncoder({ label: "preview_blit" });
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: dst.createView(),
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
		this.device.queue.submit([encoder.finish()]);
	}
}
