/**
 * Color MSAA resolves average samples. Depth and octahedral normals cannot
 * be averaged across silhouettes: that invents a distant surface and a
 * normal that belongs to neither object. Keep the nearest visible sample
 * and carry outline coverage separately, without re-rendering geometry.
 */
const shader = /* wgsl */ `
@group(0) @binding(0) var geometry : texture_multisampled_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos : vec4<f32>) -> @location(0) vec4<f32> {
    let pixel = vec2<i32>(pos.xy);
    let samples = i32(textureNumSamples(geometry));
    var nearest = textureLoad(geometry, pixel, 0);
    var coverage = 0.0;
    for (var i = 0; i < samples; i++) {
        let s = textureLoad(geometry, pixel, i);
        if (s.r < nearest.r) { nearest = s; }
        coverage += s.a;
    }
    return vec4<f32>(nearest.rgb, nearest.a * coverage / f32(samples));
}
`;

export class GeometryResolvePipeline {
	private layout: GPUBindGroupLayout;
	private pipeline: GPURenderPipeline;

	constructor(private device: GPUDevice) {
		this.layout = device.createBindGroupLayout({
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "unfilterable-float", multisampled: true },
				},
			],
		});
		const module = device.createShaderModule({
			label: "geometry-resolve.wgsl",
			code: shader,
		});
		this.pipeline = device.createRenderPipeline({
			label: "GeometryResolve",
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format: "rgba16float" }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	render(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		dest: GPUTextureView,
	): void {
		const bindGroup = this.device.createBindGroup({
			layout: this.layout,
			entries: [{ binding: 0, resource: source.createView() }],
		});
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: dest, loadOp: "clear", storeOp: "store" }],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}
}
