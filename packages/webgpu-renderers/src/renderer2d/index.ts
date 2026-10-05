import { SlugPipeline } from "../slug/slug-pipeline.js";
import { textureCache } from "../texture-cache.js";
import { BindGroupCache } from "./bind-group-cache.js";
import { ClipStack, type ScissorEntry } from "./clip-stack.js";
import { EffectPipeline } from "./effect-pipeline.js";
import {
	buildShapeSvgPath,
	type ShapeGeometryConfig,
	triangulateShape,
} from "./path-geometry.js";
import { type PathDrawOpts, PathPipeline } from "./path-pipeline.js";
import { QuadPipeline } from "./quad-pipeline.js";
import { SamplerCache } from "./sampler-cache.js";
import {
	type ShapeFillConfig,
	ShapeFillPipeline,
} from "./shape-fill-pipeline.js";
import { SolidPipeline } from "./solid-pipeline.js";
import { TransformStack } from "./transform-stack.js";

export * from "./path-geometry.js";
export * from "./shape-fill-pipeline.js";
export type { PathDrawOpts } from "./path-pipeline.js";

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RRect {
	rect: Rect;
	rx: number;
	ry: number;
}

export interface Color {
	r: number;
	g: number;
	b: number;
	a: number;
}

export type BlendMode =
	| "normal"
	| "multiply"
	| "screen"
	| "overlay"
	| "darken"
	| "lighten"
	| "color-dodge"
	| "color-burn"
	| "hard-light"
	| "soft-light"
	| "difference"
	| "exclusion"
	| "hue"
	| "saturation"
	| "color"
	| "luminosity"
	| "mask-in"
	| "mask-out"
	| "source-over"
	| "source-in"
	| "source-out"
	| "source-atop"
	| "destination-over"
	| "destination-in"
	| "destination-out"
	| "destination-atop"
	| "lighter"
	| "copy"
	| "xor";

export interface DrawOpts {
	opacity?: number;
	blendMode?: GPUBlendFactor | BlendMode;
	transform?: DOMMatrix;
	customParam?: number;
}

export interface ClipPath {
	path: string;
}

function premultiplyClearColor(color: GPUColor): GPUColor {
	if (Array.isArray(color)) {
		const a = color[3] ?? 1;
		return [color[0] * a, color[1] * a, color[2] * a, a];
	}
	if ("r" in color) {
		const a = color.a ?? 1;
		return {
			r: color.r * a,
			g: color.g * a,
			b: color.b * a,
			a,
		};
	}
	const arr = Array.from(color);
	const a = arr[3] ?? 1;
	return [arr[0] * a, arr[1] * a, arr[2] * a, a];
}

const deviceRenderer2DCache = new WeakMap<GPUDevice, Renderer2D>();

export function getRenderer2D(
	device: GPUDevice,
	format: GPUTextureFormat,
): Renderer2D {
	let r2d = deviceRenderer2DCache.get(device);
	if (!r2d || r2d.format !== format || r2d.isDestroyed) {
		r2d = new Renderer2D(device, format);
		deviceRenderer2DCache.set(device, r2d);
	}
	r2d.resetPools();
	return r2d;
}

export class Renderer2D {
	private device: GPUDevice;
	private transformStack = new TransformStack();
	private clipStack = new ClipStack();
	public quadPipeline: QuadPipeline;
	public solidPipeline: SolidPipeline;
	public shapeFillPipeline: ShapeFillPipeline;
	public pathPipeline: PathPipeline;
	public effectPipeline: EffectPipeline;
	public slugPipeline: SlugPipeline;
	public bindGroupCache = new BindGroupCache();
	public samplerCache = new SamplerCache();
	public format: GPUTextureFormat;
	public isDestroyed = false;
	/**
	 * Non-glyph draws issued so far. A 3D text layer compares it across its
	 * content to learn whether anything besides captured glyphs (a backdrop,
	 * an emoji) landed in its texture.
	 */
	public rasterDrawCount = 0;
	private surfaceWidth = 0;
	private surfaceHeight = 0;
	private lastEncoder: GPUCommandEncoder | null = null;

	constructor(device: GPUDevice, format: GPUTextureFormat) {
		this.device = device;
		this.format = format;
		this.quadPipeline = new QuadPipeline(device, format);
		this.solidPipeline = new SolidPipeline(device, format);
		this.shapeFillPipeline = new ShapeFillPipeline(device, format);
		this.pathPipeline = new PathPipeline(device, format);
		this.effectPipeline = new EffectPipeline(device, format);
		this.slugPipeline = new SlugPipeline(device, format);
	}

	beginFrame(
		encoder: GPUCommandEncoder,
		targetView: GPUTextureView,
		clearColor: GPUColor = { r: 0, g: 0, b: 0, a: 0 },
		surfaceWidth: number,
		surfaceHeight: number,
		loadOp: GPULoadOp = "clear",
	): GPURenderPassEncoder {
		this.surfaceWidth = surfaceWidth;
		this.surfaceHeight = surfaceHeight;
		if (encoder !== this.lastEncoder) {
			this.lastEncoder = encoder;
			this.resetPools();
		}
		const pass = encoder.beginRenderPass({
			colorAttachments: [
				{
					view: targetView,
					clearValue: premultiplyClearColor(clearColor),
					loadOp,
					storeOp: "store",
				},
			],
		});

		this.clipStack.applyScissorToPass(pass, surfaceWidth, surfaceHeight);
		return pass;
	}

	endFrame(_encoder: GPUCommandEncoder): void {
		// Completed pass submission is handled by caller in layout effect
	}
	resetPools(): void {
		this.quadPipeline.resetPools();
		this.solidPipeline.resetPools();
		this.shapeFillPipeline.resetPools();
		this.pathPipeline.resetPools();
		if (this.effectPipeline) this.effectPipeline.resetPools();
		this.slugPipeline.resetPools();
		// The previous frame has been submitted: textures evicted while it was
		// recorded can go once it completes.
		textureCache.flushRetired(this.device);
		textureCache.prune(this.device);
	}

	drawTexture(
		pass: GPURenderPassEncoder,
		tex: GPUTexture,
		dst: Rect,
		opts?: DrawOpts,
	): void {
		const sampler = this.samplerCache.getSampler(this.device);
		const src: Rect = { x: 0, y: 0, width: tex.width, height: tex.height };
		this.rasterDrawCount++;
		this.quadPipeline.draw(
			pass,
			this.bindGroupCache,
			this.transformStack,
			tex,
			sampler,
			src,
			dst,
			this.surfaceWidth,
			this.surfaceHeight,
			opts,
		);
	}

	drawTextureRegion(
		pass: GPURenderPassEncoder,
		tex: GPUTexture,
		src: Rect,
		dst: Rect,
		opts?: DrawOpts,
	): void {
		const sampler = this.samplerCache.getSampler(this.device);
		this.rasterDrawCount++;
		this.quadPipeline.draw(
			pass,
			this.bindGroupCache,
			this.transformStack,
			tex,
			sampler,
			src,
			dst,
			this.surfaceWidth,
			this.surfaceHeight,
			opts,
		);
	}

	drawRect(
		pass: GPURenderPassEncoder,
		rect: Rect,
		color: Color | string,
		cornerRadius: number | DrawOpts = 0,
		opts?: DrawOpts,
	): void {
		let cr = 0;
		let effectiveOpts = opts;
		if (typeof cornerRadius === "object" && cornerRadius !== null) {
			effectiveOpts = cornerRadius as DrawOpts;
			cr = 0;
		} else if (typeof cornerRadius === "number") {
			cr = cornerRadius;
		}
		this.rasterDrawCount++;
		this.solidPipeline.draw(
			pass,
			this.transformStack,
			rect,
			color,
			this.surfaceWidth,
			this.surfaceHeight,
			cr,
			effectiveOpts,
		);
	}

	drawPath(
		pass: GPURenderPassEncoder,
		pathStr: string,
		color: Color | string,
		strokeWidth: number,
		opts?: PathDrawOpts,
	): void {
		this.rasterDrawCount++;
		this.pathPipeline.drawPath(
			pass,
			this.transformStack,
			pathStr,
			color,
			strokeWidth,
			this.surfaceWidth,
			this.surfaceHeight,
			opts,
		);
	}

	drawShapeFill(
		pass: GPURenderPassEncoder,
		vertices: Float32Array,
		fill: ShapeFillConfig,
		bounds: Rect,
		opts?: DrawOpts,
	): void {
		this.rasterDrawCount++;
		this.shapeFillPipeline.draw(
			pass,
			this.transformStack,
			vertices,
			fill,
			bounds,
			this.surfaceWidth,
			this.surfaceHeight,
			opts,
		);
	}

	drawShape(
		pass: GPURenderPassEncoder,
		config: ShapeGeometryConfig,
		fill?: ShapeFillConfig,
		stroke?: {
			color?: Color | string;
			width?: number;
			cap?: "round" | "butt" | "square";
			trimStart?: number;
			trimEnd?: number;
			trimOffset?: number;
			dashArray?: number[];
			dashOffset?: number;
		},
		opts?: DrawOpts,
	): void {
		const bounds: Rect = {
			x: 0,
			y: 0,
			width: config.width,
			height: config.height,
		};
		if (fill && fill.type !== "none") {
			const tris = triangulateShape(config);
			if (tris.length > 0) {
				this.drawShapeFill(pass, tris, fill, bounds, opts);
				// AA the triangulated edge with a hairline in the fill colour — solid fills
				// only, since a gradient has no single edge colour.
				if (
					(!stroke || !stroke.width || stroke.width <= 0) &&
					(fill.type ?? "solid") === "solid" &&
					fill.color
				) {
					const svgPath = buildShapeSvgPath(config);
					if (svgPath) {
						this.drawPath(pass, svgPath, fill.color, 1.0, {
							...opts,
							strokeLineCap: "round",
						});
					}
				}
			}
		}
		if (stroke && stroke.width && stroke.width > 0 && stroke.color) {
			const svgPath = buildShapeSvgPath(config);
			if (svgPath) {
				this.drawPath(pass, svgPath, stroke.color, stroke.width, {
					...opts,
					strokeLineCap: stroke.cap,
					trimStart: stroke.trimStart,
					trimEnd: stroke.trimEnd,
					trimOffset: stroke.trimOffset,
					strokeDashArray: stroke.dashArray,
					strokeDashOffset: stroke.dashOffset,
				});
			}
		}
	}

	drawRRect(
		pass: GPURenderPassEncoder,
		rrect: RRect,
		color: Color | string,
		opts?: DrawOpts,
	): void {
		this.drawRect(pass, rrect.rect, color, rrect.rx, opts);
	}

	getTemporaryTexture(
		width: number,
		height: number,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		return this.effectPipeline.getTexture(
			this.device,
			width,
			height,
			this.format,
			exclude,
		);
	}

	getTemporaryBuffer(data: ArrayBufferView): GPUBuffer {
		return this.effectPipeline.getBuffer(this.device, data);
	}

	composite(
		encoder: GPUCommandEncoder,
		base: GPUTexture,
		overlay: GPUTexture,
		mode: BlendMode,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		return this.effectPipeline.composite(
			encoder,
			this.bindGroupCache,
			this.samplerCache,
			base,
			overlay,
			mode,
			this.format,
			exclude,
		);
	}

	applyMotionBlur(
		encoder: GPUCommandEncoder,
		sourceTex: GPUTexture,
		vx: number,
		vy: number,
		shutterAngle = 180,
		samples = 16,
		exclude?: GPUTexture | GPUTexture[],
	): GPUTexture {
		return this.effectPipeline.applyMotionBlur(
			encoder,
			this.bindGroupCache,
			this.samplerCache,
			sourceTex,
			vx,
			vy,
			shutterAngle,
			samples,
			this.format,
			exclude,
		);
	}

	getCurrentTransform(): DOMMatrix {
		return this.transformStack.getCurrent();
	}

	getTransformStack(): TransformStack {
		return this.transformStack;
	}

	getSurfaceWidth(): number {
		return this.surfaceWidth;
	}

	getSurfaceHeight(): number {
		return this.surfaceHeight;
	}

	pushIdentity(): void {
		const current = this.transformStack.getCurrent();
		this.pushTransform(current.inverse());
	}

	pushTransform(matrix: DOMMatrix): void {
		this.transformStack.push(matrix);
	}

	popTransform(): void {
		this.transformStack.pop();
	}

	pushScissor(rect: Rect): void {
		this.clipStack.pushScissor(rect, this.surfaceWidth, this.surfaceHeight);
	}

	pushScissorLocal(rect: Rect): void {
		const m = this.transformStack.getCurrent();
		const points = [
			m.transformPoint(new DOMPoint(rect.x, rect.y)),
			m.transformPoint(new DOMPoint(rect.x + rect.width, rect.y)),
			m.transformPoint(new DOMPoint(rect.x, rect.y + rect.height)),
			m.transformPoint(new DOMPoint(rect.x + rect.width, rect.y + rect.height)),
		];
		const xs = points.map((p) => p.x);
		const ys = points.map((p) => p.y);

		let x = Math.min(...xs);
		let y = Math.min(...ys);
		let width = Math.max(...xs) - x;
		let height = Math.max(...ys) - y;

		// Intersect with current scissor if exists
		const current = this.clipStack.getCurrentScissor(
			this.surfaceWidth,
			this.surfaceHeight,
		);
		if (current) {
			const x1 = Math.max(x, current.x);
			const y1 = Math.max(y, current.y);
			const x2 = Math.min(x + width, current.x + current.width);
			const y2 = Math.min(y + height, current.y + current.height);
			x = x1;
			y = y1;
			width = Math.max(0, x2 - x1);
			height = Math.max(0, y2 - y1);
		}

		this.clipStack.pushScissor(
			{ x, y, width, height },
			this.surfaceWidth,
			this.surfaceHeight,
		);
	}

	popScissor(): void {
		this.clipStack.popScissor();
	}

	suspendScissors(): ScissorEntry[] {
		const saved = this.clipStack.saveScissors();
		this.clipStack.clearScissors();
		return saved;
	}

	resumeScissors(saved: ScissorEntry[]): void {
		this.clipStack.restoreScissors(saved);
	}

	pushStencilClip(path: ClipPath): void {
		this.clipStack.pushStencilClip(path);
	}

	popStencilClip(): void {
		this.clipStack.popStencilClip();
	}

	destroy(): void {
		this.isDestroyed = true;
		this.transformStack.destroy();
		this.clipStack.destroy();
		this.bindGroupCache.destroy();
		this.samplerCache.destroy();
		this.quadPipeline.destroy();
		this.solidPipeline.destroy();
		this.shapeFillPipeline.destroy();
		this.pathPipeline.destroy();
		this.effectPipeline.destroy();
		this.slugPipeline.destroy();
		this.lastEncoder = null;
	}
}
