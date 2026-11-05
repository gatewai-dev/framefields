/**
 * Shutter motion blur of a 3D scene from its velocity buffer (see
 * `shaders/motion-blur.ts`): tile max, neighbor max, then a depth-aware
 * reconstruction gather into the target.
 */
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { motionBlurWgsl } from "../shaders/motion-blur.js";

export interface MotionBlurPassOptions {
	/** Shutter angle, degrees. Default 180. */
	shutterAngle?: number;
	/** Taps along each pixel's motion. Default 20. */
	sampleCount?: number;
	/** Longest blur from a pixel (and the tile size), px. Default 48. */
	maxBlur?: number;
	/** Depth softness between in front and behind, scene px. Default 20. */
	softDepth?: number;
}

const TILE_FORMAT: GPUTextureFormat = "rgba16float";

export class MotionBlurPipeline {
	private readonly device: GPUDevice;
	private readonly module: GPUShaderModule;
	private readonly tileMax: GPURenderPipeline;
	private readonly neighborMax: GPURenderPipeline;
	private readonly reconstruct = new Map<GPUTextureFormat, GPURenderPipeline>();
	/** One uniform block per blur this frame: an encoder may blur several scenes. */
	private readonly params: BufferPool;
	private tiles: { a: GPUTexture; b: GPUTexture; w: number; h: number } | null =
		null;

	constructor(device: GPUDevice) {
		this.device = device;
		this.module = device.createShaderModule({
			label: "motion-blur.wgsl",
			code: motionBlurWgsl,
		});
		this.tileMax = this.pipeline("fs_tile_max", TILE_FORMAT);
		this.neighborMax = this.pipeline("fs_neighbor_max", TILE_FORMAT);
		this.params = new BufferPool(
			32,
			GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		);
	}

	private pipeline(entry: string, format: GPUTextureFormat): GPURenderPipeline {
		return this.device.createRenderPipeline({
			label: `motion-blur-${entry}`,
			layout: "auto",
			vertex: { module: this.module, entryPoint: "vs_main" },
			fragment: {
				module: this.module,
				entryPoint: entry,
				targets: [{ format }],
			},
			primitive: { topology: "triangle-list" },
		});
	}

	private tileTextures(w: number, h: number): { a: GPUTexture; b: GPUTexture } {
		if (this.tiles && this.tiles.w === w && this.tiles.h === h)
			return this.tiles;
		this.tiles?.a.destroy();
		this.tiles?.b.destroy();
		const make = (label: string) =>
			this.device.createTexture({
				label,
				size: { width: w, height: h },
				format: TILE_FORMAT,
				usage:
					GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
			});
		this.tiles = {
			a: make("motion-blur-tile-max"),
			b: make("motion-blur-neighbor-max"),
			w,
			h,
		};
		return this.tiles;
	}

	/**
	 * Blurs `color` (premultiplied) by `velocity` (`VELOCITY_FORMAT`, same
	 * size) into `target` (a view of `targetFormat`, same size).
	 */
	render(
		encoder: GPUCommandEncoder,
		color: GPUTexture,
		velocity: GPUTexture,
		target: GPUTextureView,
		targetFormat: GPUTextureFormat,
		options: MotionBlurPassOptions = {},
	): void {
		const k = Math.max(4, Math.min(160, Math.round(options.maxBlur ?? 48)));
		const width = color.width;
		const height = color.height;
		const tw = Math.ceil(width / k);
		const th = Math.ceil(height / k);
		const { a, b } = this.tileTextures(tw, th);
		const params = this.params.getBuffer(
			this.device,
			new Float32Array([
				width,
				height,
				tw,
				th,
				(options.shutterAngle ?? 180) / 360 / 2,
				k,
				Math.max(1, Math.round(options.sampleCount ?? 20)),
				options.softDepth ?? 20,
			]),
		);
		const velocityView = velocity.createView();
		this.pass(encoder, this.tileMax, a.createView(), [
			{ binding: 0, resource: { buffer: params } },
			{ binding: 1, resource: velocityView },
		]);
		this.pass(encoder, this.neighborMax, b.createView(), [
			{ binding: 0, resource: { buffer: params } },
			{ binding: 2, resource: a.createView() },
		]);
		let reconstruct = this.reconstruct.get(targetFormat);
		if (!reconstruct) {
			reconstruct = this.pipeline("fs_reconstruct", targetFormat);
			this.reconstruct.set(targetFormat, reconstruct);
		}
		this.pass(encoder, reconstruct, target, [
			{ binding: 0, resource: { buffer: params } },
			{ binding: 1, resource: velocityView },
			{ binding: 2, resource: b.createView() },
			{ binding: 3, resource: color.createView() },
		]);
	}

	private pass(
		encoder: GPUCommandEncoder,
		pipeline: GPURenderPipeline,
		view: GPUTextureView,
		entries: GPUBindGroupEntry[],
	): void {
		const pass = encoder.beginRenderPass({
			label: pipeline.label,
			colorAttachments: [
				{
					view,
					loadOp: "clear",
					storeOp: "store",
					clearValue: { r: 0, g: 0, b: 0, a: 0 },
				},
			],
		});
		pass.setPipeline(pipeline);
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries,
			}),
		);
		pass.draw(3);
		pass.end();
	}

	resetPools(): void {
		this.params.reset();
	}

	destroy(): void {
		this.params.destroy();
		this.tiles?.a.destroy();
		this.tiles?.b.destroy();
	}
}
