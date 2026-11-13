/**
 * The textures a traced frame reads, packed into one texture array. WebGPU
 * has no bindless textures, so every layer picture and material map a ray
 * may hit is drawn into a shelf of a `layerSize`² array layer, downscaled
 * when larger. Values are copied as they are stored (`DisplayBlit`), so the
 * kernel decodes exactly what the raster shaders decode.
 */

import { DisplayBlit } from "../renderer3d/display-blit.js";

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
	private readonly blitter: DisplayBlit;
	readonly filterSampler: GPUSampler;

	constructor(private device: GPUDevice) {
		this.blitter = new DisplayBlit(device);
		this.filterSampler = device.createSampler({
			label: "PathTraceAtlasSampler",
			magFilter: "linear",
			minFilter: "linear",
		});
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
		// The gutter stays empty: lookups are clamped half a texel inside the entry.
		this.blitter.draw(
			encoder,
			p.texture,
			atlas.createView({
				dimension: "2d",
				baseArrayLayer: p.layer,
				arrayLayerCount: 1,
			}),
			[p.x + GUTTER, p.y + GUTTER, p.w - 2 * GUTTER, p.h - 2 * GUTTER],
		);
	}

	destroy(): void {
		this.texture?.destroy();
		this.blitter.destroy();
	}
}
