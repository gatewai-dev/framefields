/**
 * The textures a traced frame reads, packed into one texture array. WebGPU
 * has no bindless textures, so every layer picture and material map a ray
 * may hit is drawn into a shelf of a `layerSize`² array layer, downscaled
 * when larger. Values are copied as they are stored (display-encoded colors
 * stay display-encoded; `-srgb` sources are encoded back), so the kernel
 * decodes exactly what the raster shaders decode.
 */

/** Where one texture landed: normalized rect (inset half a texel) and layer. */
export interface AtlasSlot {
	rect: [number, number, number, number];
	layer: number;
}

interface Placement {
	texture: GPUTexture;
	x: number;
	y: number;
	w: number;
	h: number;
	layer: number;
}

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

/** Shelf packer over square layers. */
function pack(
	sizes: { texture: GPUTexture; w: number; h: number }[],
	layerSize: number,
): Placement[] {
	const order = sizes
		.map((s, i) => ({ ...s, i }))
		.sort((a, b) => b.h - a.h || b.w - a.w);
	const placed: Placement[] = new Array(sizes.length);
	let layer = 0;
	let x = 0;
	let y = 0;
	let shelf = 0;
	for (const s of order) {
		if (x + s.w > layerSize) {
			x = 0;
			y += shelf;
			shelf = 0;
		}
		if (y + s.h > layerSize) {
			layer++;
			x = 0;
			y = 0;
			shelf = 0;
		}
		placed[s.i] = { texture: s.texture, x, y, w: s.w, h: s.h, layer };
		x += s.w;
		shelf = Math.max(shelf, s.h);
	}
	return placed;
}

/** Texels of padding around each entry, so filtering never reads a neighbour. */
const GUTTER = 2;

export class TextureAtlas {
	private texture: GPUTexture | null = null;
	private pipeline: GPURenderPipeline;
	private sampler: GPUSampler;
	private encodeOn: GPUBuffer;
	private encodeOff: GPUBuffer;
	readonly filterSampler: GPUSampler;

	constructor(private device: GPUDevice) {
		const module = device.createShaderModule({
			label: "PathTraceAtlasBlit",
			code: blitWgsl,
		});
		this.pipeline = device.createRenderPipeline({
			label: "PathTraceAtlasBlit",
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
		this.filterSampler = device.createSampler({
			label: "PathTraceAtlasSampler",
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
	 * Draws `textures` into the atlas for this frame and returns where each
	 * went. `maxSize` caps an entry's longer side (never upscaled).
	 */
	build(
		encoder: GPUCommandEncoder,
		textures: GPUTexture[],
		layerSize: number,
		maxSize: number,
	): { view: GPUTextureView; slots: Map<GPUTexture, AtlasSlot> } {
		const unique = [...new Set(textures)];
		const limit = Math.min(maxSize, layerSize - 2 * GUTTER);
		const sizes = unique.map((texture) => {
			const k = Math.min(1, limit / Math.max(texture.width, texture.height));
			return {
				texture,
				w: Math.max(1, Math.round(texture.width * k)) + 2 * GUTTER,
				h: Math.max(1, Math.round(texture.height * k)) + 2 * GUTTER,
			};
		});
		const placed = pack(sizes, layerSize);
		const layers = Math.max(1, ...placed.map((p) => p.layer + 1));
		const maxLayers = this.device.limits.maxTextureArrayLayers;
		if (layers > maxLayers) {
			throw new Error(
				`Path tracer textures need ${layers} atlas layers of ${layerSize}²; the device holds ${maxLayers}. Lower pathTrace.textureSize.`,
			);
		}
		const atlas = this.ensure(layerSize, layers);
		const slots = new Map<GPUTexture, AtlasSlot>();
		for (const p of placed) {
			this.blit(encoder, atlas, p);
			const iw = p.w - 2 * GUTTER;
			const ih = p.h - 2 * GUTTER;
			slots.set(p.texture, {
				rect: [
					(p.x + GUTTER + 0.5) / layerSize,
					(p.y + GUTTER + 0.5) / layerSize,
					(iw - 1) / layerSize,
					(ih - 1) / layerSize,
				],
				layer: p.layer,
			});
		}
		return { view: atlas.createView({ dimension: "2d-array" }), slots };
	}

	private ensure(size: number, layers: number): GPUTexture {
		const t = this.texture;
		if (t && t.width === size && t.depthOrArrayLayers >= layers) return t;
		t?.destroy();
		this.texture = this.device.createTexture({
			label: "PathTraceAtlas",
			size: { width: size, height: size, depthOrArrayLayers: layers },
			format: "rgba8unorm",
			usage:
				GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
		});
		return this.texture;
	}

	private blit(encoder: GPUCommandEncoder, atlas: GPUTexture, p: Placement) {
		const srgb = p.texture.format.endsWith("-srgb");
		const bind = this.device.createBindGroup({
			layout: this.pipeline.getBindGroupLayout(0),
			entries: [
				{
					binding: 0,
					resource: p.texture.createView({ mipLevelCount: 1, dimension: "2d" }),
				},
				{ binding: 1, resource: this.sampler },
				{
					binding: 2,
					resource: { buffer: srgb ? this.encodeOn : this.encodeOff },
				},
			],
		});
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: atlas.createView({
						dimension: "2d",
						baseArrayLayer: p.layer,
						arrayLayerCount: 1,
					}),
					loadOp: "load",
					storeOp: "store",
				},
			],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bind);
		// The gutter stays empty: lookups are clamped half a texel inside the entry.
		pass.setViewport(
			p.x + GUTTER,
			p.y + GUTTER,
			p.w - 2 * GUTTER,
			p.h - 2 * GUTTER,
			0,
			1,
		);
		pass.draw(3);
		pass.end();
	}

	destroy(): void {
		this.texture?.destroy();
		this.encodeOn.destroy();
		this.encodeOff.destroy();
	}
}
