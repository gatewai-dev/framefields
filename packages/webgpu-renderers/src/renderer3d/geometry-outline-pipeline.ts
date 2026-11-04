import type { GeometryOutlineOptions } from "@framefields/core";
import { parseColor } from "../color.js";
import { Camera3D, type Camera3DPose } from "../math3d/camera3d.js";
import type { Environment3DFog } from "../math3d/environment3d.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";

function outlineShader(sampleCount: number): string {
	const multisampled = sampleCount > 1;
	const textureType = multisampled
		? "texture_multisampled_2d<f32>"
		: "texture_2d<f32>";
	return /* wgsl */ `
struct Uniforms {
    params : vec4<f32>, // width, cosine(crease angle), relative depth threshold, opacity
    ink : vec4<f32>,
    fog : vec4<f32>,
    fogRange : vec4<f32>,
    projection : vec4<f32>, // inverse projection x/y scale, far depth
};
@group(0) @binding(0) var<uniform> u : Uniforms;
@group(0) @binding(1) var colorTex : ${textureType};
@group(0) @binding(2) var geometryTex : ${textureType};

@vertex fn vs(@builtin(vertex_index) i : u32) -> @builtin(position) vec4<f32> {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    return vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
}

fn geometry(p : vec2<i32>, sample : i32) -> vec4<f32> {
    let size = vec2<i32>(textureDimensions(geometryTex));
    // Beyond the viewport is the same surface: never ink the canvas border.
    return textureLoad(geometryTex, clamp(p, vec2<i32>(0), size - 1), sample);
}

fn normal(oct : vec2<f32>) -> vec3<f32> {
    let p = oct * 2.0 - 1.0;
    var n = vec3<f32>(p, 1.0 - abs(p.x) - abs(p.y));
    let t = max(-n.z, 0.0);
    n = vec3<f32>(n.xy + select(vec2<f32>(t), vec2<f32>(-t), n.xy >= vec2<f32>(0.0)), n.z);
    return normalize(n);
}

fn srgbToLinear(c : vec3<f32>) -> vec3<f32> {
    return select(pow((max(c, vec3<f32>(0.0)) + 0.055) / 1.055, vec3<f32>(2.4)), c / 12.92, c <= vec3<f32>(0.04045));
}
fn linearToSrgb(c : vec3<f32>) -> vec3<f32> {
    let x = max(c, vec3<f32>(0.0));
    return select(1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055, x * 12.92, x <= vec3<f32>(0.0031308));
}

fn edge(center : vec4<f32>, next : vec4<f32>, previous : vec4<f32>) -> f32 {
    let z = 1.0 / max(center.r, 0.0001);
    let a = 1.0 / max(next.r, 0.0001);
    let b = 1.0 / max(previous.r, 0.0001);
    // Inverse depth is affine on a perspective-projected plane. Its signed
    // second difference suppresses grazing surfaces and inks only the near
    // side of an occlusion, including thin geometry with background both sides.
    let curvature = (2.0 * z - a - b) / z;
    let depthEdge = smoothstep(u.params.z, u.params.z * 2.0, curvature);
    let sameDepth = abs(center.r - next.r) / max(center.r, 0.0001) < 0.03;
    let crease = select(0.0, 1.0, next.a > 0.5 && sameDepth && dot(normal(center.gb), normal(next.gb)) < u.params.y);
    return max(depthEdge, crease);
}

@fragment fn fs(@builtin(position) pos : vec4<f32>${multisampled ? ", @builtin(sample_index) sampleIndex : u32" : ""}) -> @location(0) vec4<f32> {
    let sample = ${multisampled ? "i32(sampleIndex)" : "0"};
    let pixel = vec2<i32>(pos.xy);
    let source = textureLoad(colorTex, pixel, sample);
    let c = geometry(pixel, sample);
    if (c.a <= 0.0 || u.params.x <= 0.0 || u.params.w <= 0.0) { return source; }
    var coverage = 0.0;
    let directions = array<vec2<f32>, 8>(
        vec2<f32>(1.0, 0.0), vec2<f32>(-1.0, 0.0), vec2<f32>(0.0, 1.0), vec2<f32>(0.0, -1.0),
        vec2<f32>(0.707107, 0.707107), vec2<f32>(-0.707107, 0.707107), vec2<f32>(0.707107, -0.707107), vec2<f32>(-0.707107, -0.707107));
    for (var r = 1; r <= i32(ceil(u.params.x)); r++) {
        let weight = clamp(u.params.x - f32(r) + 1.0, 0.0, 1.0);
        for (var d = 0; d < 8; d++) {
            let offset = vec2<i32>(round(directions[d] * f32(r)));
            coverage = max(coverage, edge(c, geometry(pixel + offset, sample), geometry(pixel - offset, sample)) * weight);
        }
    }
    var ink = u.ink.rgb;
    if (u.fog.w > 0.5) {
        let uv = pos.xy / vec2<f32>(textureDimensions(colorTex));
        let ray = vec3<f32>((uv * 2.0 - 1.0) * u.projection.xy, 1.0);
        let distance = c.r * length(ray);
        let fog = smoothstep(u.fogRange.x, max(u.fogRange.y, u.fogRange.x + 1.0), distance) * u.fogRange.z;
        // Match surface fog's linear-light blend; display-space interpolation
        // would darken outlines halfway into a light-colored atmosphere.
        ink = linearToSrgb(mix(srgbToLinear(ink), srgbToLinear(u.fog.rgb), fog));
    }
    let visibleCoverage = min(c.a / max(source.a, 0.0001), 1.0);
    return vec4<f32>(mix(source.rgb, ink * source.a, coverage * visibleCoverage * u.params.w * u.ink.a), source.a);
}
`;
}

/** Ink shades original color/depth/normal samples, then resolves color with MSAA. */
export class GeometryOutlinePipeline {
	private layout: GPUBindGroupLayout;
	private pipeline: GPURenderPipeline;
	private multisampledOutput: GPUTexture | null = null;
	private pool = new BufferPool(
		80,
		GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	);

	constructor(
		private device: GPUDevice,
		private format: GPUTextureFormat,
		private sampleCount = 1,
	) {
		this.layout = device.createBindGroupLayout({
			label: "GeometryOutlineLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				...[1, 2].map((binding) => ({
					binding,
					visibility: GPUShaderStage.FRAGMENT,
					texture: {
						sampleType: "unfilterable-float" as const,
						multisampled: sampleCount > 1,
					},
				})),
			],
		});
		const module = device.createShaderModule({
			label: "geometry-outlines.wgsl",
			code: outlineShader(sampleCount),
		});
		this.pipeline = device.createRenderPipeline({
			label: "GeometryOutlines",
			layout: device.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
			vertex: { module, entryPoint: "vs" },
			fragment: { module, entryPoint: "fs", targets: [{ format }] },
			primitive: { topology: "triangle-list" },
			multisample: { count: sampleCount },
		});
	}

	reset(): void {
		this.pool.reset();
	}
	destroy(): void {
		this.pool.destroy();
		this.multisampledOutput?.destroy();
	}

	private attachment(
		source: GPUTexture,
		dest: GPUTextureView,
	): GPURenderPassColorAttachment {
		if (this.sampleCount <= 1)
			return { view: dest, loadOp: "clear", storeOp: "store" };
		if (
			!this.multisampledOutput ||
			this.multisampledOutput.width !== source.width ||
			this.multisampledOutput.height !== source.height
		) {
			this.multisampledOutput?.destroy();
			this.multisampledOutput = this.device.createTexture({
				label: "GeometryOutlineMsaaOutput",
				size: { width: source.width, height: source.height },
				format: this.format,
				sampleCount: this.sampleCount,
				usage: GPUTextureUsage.RENDER_ATTACHMENT,
			});
		}
		return {
			view: this.multisampledOutput.createView(),
			resolveTarget: dest,
			loadOp: "clear",
			storeOp: "discard",
		};
	}

	render(
		encoder: GPUCommandEncoder,
		source: GPUTexture,
		geometry: GPUTexture,
		dest: GPUTextureView,
		camera: Camera3DPose,
		options: GeometryOutlineOptions,
		fog?: Environment3DFog,
	): void {
		const data = new Float32Array(20);
		data.set([
			((options.width ?? 1.5) * source.height) /
				(options.referenceHeight ?? 1080),
			Math.cos(((options.creaseAngle ?? 45) * Math.PI) / 180),
			options.depthThreshold ?? 0.01,
			options.opacity ?? 1,
		]);
		const color = parseColor(options.color ?? "#16131c");
		data.set([color.r, color.g, color.b, color.a], 4);
		if (fog) {
			const tint = parseColor(fog.color);
			data.set([tint.r, tint.g, tint.b, 1], 8);
			data.set([fog.start, fog.end, fog.opacity ?? 1, 0], 12);
		}
		const projection = Camera3D.computeProjectionMatrix(camera);
		data.set([1 / projection[0], 1 / projection[5], camera.far, 0], 16);
		const bindGroup = this.device.createBindGroup({
			layout: this.layout,
			entries: [
				{
					binding: 0,
					resource: { buffer: this.pool.getBuffer(this.device, data) },
				},
				{ binding: 1, resource: source.createView() },
				{ binding: 2, resource: geometry.createView() },
			],
		});
		const pass = encoder.beginRenderPass({
			colorAttachments: [this.attachment(source, dest)],
		});
		pass.setPipeline(this.pipeline);
		pass.setBindGroup(0, bindGroup);
		pass.draw(3);
		pass.end();
	}
}
