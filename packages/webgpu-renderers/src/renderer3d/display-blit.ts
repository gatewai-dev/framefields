/**
 * Copies a texture of any color format into an rgba8unorm target as it is
 * stored: display-encoded colors stay display-encoded, and an `-srgb`
 * source (which samples as linear) is encoded back. The path tracer's atlas
 * and the glTF exporter read textures through it, so both see exactly the
 * values the raster shaders decode.
 */

const blitWgsl = /* wgsl */ `
struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;
@group(0) @binding(2) var<uniform> encode : vec4<f32>;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var out: VsOut;
    out.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    out.uv = vec2<f32>(p.x, 1.0 - p.y);
    return out;
}

fn toSrgb(c: vec3<f32>) -> vec3<f32> {
    let lo = c * 12.92;
    let hi = 1.055 * pow(max(c, vec3<f32>(0.0)), vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, c <= vec3<f32>(0.0031308));
}

@fragment
fn fs(in: VsOut) -> @location(0) vec4<f32> {
    let t = textureSampleLevel(src, srcSampler, in.uv, 0.0);
    return select(t, vec4<f32>(toSrgb(t.rgb), t.a), encode.x > 0.5);
}
`;

export class DisplayBlit {
	private readonly pipeline: GPURenderPipeline;
	private readonly sampler: GPUSampler;
	private readonly encodeOn: GPUBuffer;
	private readonly encodeOff: GPUBuffer;

	constructor(private readonly device: GPUDevice) {
		const module = device.createShaderModule({
			label: "DisplayBlit",
			code: blitWgsl,
		});
		this.pipeline = device.createRenderPipeline({
			label: "DisplayBlit",
			layout: "auto",
			vertex: { module, entryPoint: "vs" },
			fragment: {
				module,
				entryPoint: "fs",
				targets: [{ format: "rgba8unorm" }],
			},
			primitive: { topology: "triangle-list" },
		});
		this.sampler = device.createSampler({
			magFilter: "linear",
			minFilter: "linear",
		});
		const uniform = (v: number) => {
			const b = device.createBuffer({
				size: 16,
				usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
			});
			device.queue.writeBuffer(b, 0, new Float32Array([v, 0, 0, 0]));
			return b;
		};
		this.encodeOn = uniform(1);
		this.encodeOff = uniform(0);
	}

	/**
	 * Draws `source` (its first mip) over `viewport` [x, y, width, height]
	 * of `target`, an rgba8unorm view; the rest of the target is kept.
	 */
	draw(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		target: GPUTextureView,
		viewport: [number, number, number, number],
	): void {
		const srgb = source.format.endsWith("-srgb");
		const bind = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: source.createView({ mipLevelCount: 1, dimension: "2d" }),
				},
				{ binding: 1, resource: this.sampler },
				{
					binding: 2,
					resource: { buffer: srgb ? this.encodeOn : this.encodeOff },
				},
			],
		});
		const pass = encoder.beginRenderPass({
			colorAttachments: [{ view: target, loadOp: "load", storeOp: "store" }],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bind);
		pass.setViewport(...viewport, 0, 1);
		pass.draw(3);
		pass.end();
	}

	destroy(): void {
		this.encodeOn.destroy();
		this.encodeOff.destroy();
	}
}
