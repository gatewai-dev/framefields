/**
 * Lens remap: turns a cube map drawn around the eye (`cubeFaceCameras`) into
 * the picture of a lens. Every output pixel becomes a ray (perspective,
 * equirectangular or equidistant fisheye), optionally seen by an observer
 * moving near the speed of light: the ray is aberrated back to the direction
 * it left the scene, and its colour Doppler-shifted (`relativistic-doppler`).
 *
 * The cube is mipmapped first, so a lens or a fast observer that squeezes
 * much of the scene into few pixels filters it instead of aliasing.
 */

import type { LensProjection } from "../math3d/cube-lens.js";
import {
	DOPPLER_LUT_MAX,
	DOPPLER_LUT_SIZE,
	dopplerLuminanceGain,
	dopplerLut,
	lorentzFactor,
} from "../math3d/relativistic-doppler.js";
import type { Vec3 } from "../math3d/vector3.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";

/** An observer moving at `speed` (a fraction of c) through a scene at rest. */
export interface RelativisticObserver {
	/** β = v / c, 0 ≤ β < 1. */
	speed: number;
	/** Unit direction of motion in world space. */
	direction: Vec3;
	/** Shift colours along the spectrum (blue ahead, red behind). */
	doppler: boolean;
	/** Brighten ahead and dim behind (relativistic beaming). */
	beaming: boolean;
	/**
	 * Exposure for the shifted light: stops, or "auto" to meter the centre of
	 * the view, so what the camera looks at keeps its brightness at rest.
	 */
	exposure: number | "auto";
}

export interface LensRemapOptions {
	projection: LensProjection;
	/** Degrees; see `CubeLensOptions.fov`. */
	fov: number;
	zoom: number;
	/** The camera's frame: screen right, screen up, forward (world space). */
	basis: { right: Vec3; up: Vec3; forward: Vec3 };
	observer?: RelativisticObserver | null;
}

const PROJECTION_INDEX: Record<LensProjection, number> = {
	perspective: 0,
	equirectangular: 1,
	fisheye: 2,
};

/** How the observer changes colour: none, spectral table, or brightness only. */
const ColorMode = { None: 0, Spectral: 1, Beaming: 2 } as const;

const mipWgsl = /* wgsl */ `
@group(0) @binding(0) var samp : sampler;
@group(0) @binding(1) var src : texture_2d<f32>;

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o : VsOut;
    o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    o.uv = vec2<f32>(p.x, 1.0 - p.y);
    return o;
}

// One bilinear tap between four texels of the level above: a 2x2 box.
@fragment
fn fs(in : VsOut) -> @location(0) vec4<f32> {
    return textureSampleLevel(src, samp, in.uv, 0.0);
}
`;

const remapWgsl = /* wgsl */ `
struct Lens {
    right   : vec4<f32>, // xyz screen right, w projection (0 persp, 1 equirect, 2 fisheye)
    up      : vec4<f32>, // xyz screen up, w scale (persp: tan(fov/2)/zoom, fisheye: fov/2/zoom)
    forward : vec4<f32>, // xyz forward, w aspect (width / height)
    motion  : vec4<f32>, // xyz direction of motion, w β
    params  : vec4<f32>, // x color mode, y exposure gain, z γ, w ln(max D)
};

@group(0) @binding(0) var<uniform> lens : Lens;
@group(0) @binding(1) var samp : sampler;
@group(0) @binding(2) var colorCube : texture_cube<f32>;
@group(0) @binding(3) var hdrCube : texture_cube<f32>;
@group(0) @binding(4) var<storage, read> dopplerLut : array<vec4<f32>>;

const PI = 3.14159265358979;
const LUT_SIZE = ${DOPPLER_LUT_SIZE}.0;

struct VsOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) ndc : vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) i : u32) -> VsOut {
    let p = vec2<f32>(f32((i << 1u) & 2u), f32(i & 2u));
    var o : VsOut;
    o.pos = vec4<f32>(p * 2.0 - 1.0, 0.0, 1.0);
    o.ndc = p * 2.0 - 1.0;
    return o;
}

struct Ray {
    dir : vec3<f32>,
    inside : f32,
};

// The ray an output pixel sees, in world space.
fn lensRay(ndc : vec2<f32>) -> Ray {
    let r = lens.right.xyz;
    let u = lens.up.xyz;
    let f = lens.forward.xyz;
    let scale = lens.up.w;
    let aspect = lens.forward.w;
    let projection = lens.right.w;
    var out : Ray;
    out.inside = 1.0;
    if (projection < 0.5) {
        out.dir = normalize(f + ndc.x * aspect * scale * r + ndc.y * scale * u);
    } else if (projection < 1.5) {
        let lon = ndc.x * PI;
        let lat = ndc.y * 0.5 * PI;
        out.dir = cos(lat) * (sin(lon) * r + cos(lon) * f) + sin(lat) * u;
    } else {
        let q = vec2<f32>(ndc.x * aspect, ndc.y);
        let rho = length(q);
        let theta = rho * scale;
        let side = select(vec2<f32>(0.0), q / rho, rho > 1e-6);
        out.dir = cos(theta) * f + sin(theta) * (side.x * r + side.y * u);
        out.inside = select(0.0, 1.0, theta <= PI);
    }
    return out;
}

struct Seen {
    dir : vec3<f32>,
    doppler : f32,
};

// Aberration: where a ray seen by the moving observer left the scene.
fn aberrate(observed : vec3<f32>) -> Seen {
    let beta = lens.motion.w;
    let n = lens.motion.xyz;
    let c = clamp(dot(observed, n), -1.0, 1.0);
    let cs = (c - beta) / (1.0 - beta * c);
    let side = observed - c * n;
    let len = length(side);
    // Exactly ahead or behind, any perpendicular will do: sin θ is 0.
    let fallback = normalize(cross(n, select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(n.x) > 0.9)));
    let perp = select(fallback, side / len, len > 1e-6);
    var out : Seen;
    out.dir = cs * n + sqrt(max(0.0, 1.0 - cs * cs)) * perp;
    out.doppler = lens.params.z * (1.0 + beta * c);
    return out;
}

// Linear-sRGB matrix for Doppler factor d, interpolated in ln d.
fn dopplerMatrix(d : f32) -> mat3x3<f32> {
    let span = lens.params.w;
    let t = clamp((log(d) + span) / (2.0 * span), 0.0, 1.0) * (LUT_SIZE - 1.0);
    let i0 = u32(floor(t));
    let i1 = min(i0 + 1u, u32(LUT_SIZE) - 1u);
    let w = t - f32(i0);
    let r0 = mix(dopplerLut[i0 * 3u], dopplerLut[i1 * 3u], w).xyz;
    let r1 = mix(dopplerLut[i0 * 3u + 1u], dopplerLut[i1 * 3u + 1u], w).xyz;
    let r2 = mix(dopplerLut[i0 * 3u + 2u], dopplerLut[i1 * 3u + 2u], w).xyz;
    // Rows in the table; WGSL matrices take columns.
    return transpose(mat3x3<f32>(r0, r1, r2));
}

// The observer's light from scene light \`c\` (linear rgb) at Doppler factor d.
fn shiftLight(c : vec3<f32>, d : f32) -> vec3<f32> {
    let mode = lens.params.x;
    var out = c;
    if (mode > 1.5) {
        out = c * pow(d, 4.0);
    } else if (mode > 0.5) {
        out = dopplerMatrix(d) * c;
    }
    return max(out * lens.params.y, vec3<f32>(0.0));
}

fn srgbToLinear(c : vec3<f32>) -> vec3<f32> {
    let lo = c / 12.92;
    let hi = pow((max(c, vec3<f32>(0.0)) + 0.055) / 1.055, vec3<f32>(2.4));
    return select(hi, lo, c <= vec3<f32>(0.04045));
}

fn linearToSrgb(c : vec3<f32>) -> vec3<f32> {
    let x = clamp(c, vec3<f32>(0.0), vec3<f32>(1.0));
    let lo = x * 12.92;
    let hi = 1.055 * pow(x, vec3<f32>(1.0 / 2.4)) - 0.055;
    return select(hi, lo, x <= vec3<f32>(0.0031308));
}

struct Sampled {
    color : vec4<f32>,
    hdr : vec4<f32>,
};

fn sampleLens(ndc : vec2<f32>) -> Sampled {
    let ray = lensRay(ndc);
    var seen : Seen;
    seen.dir = ray.dir;
    seen.doppler = 1.0;
    if (lens.motion.w > 0.0) {
        seen = aberrate(ray.dir);
    }
    // The engine's frames are right-handed, cube lookups left-handed.
    let lookup = vec3<f32>(seen.dir.xy, -seen.dir.z);
    var color = textureSample(colorCube, samp, lookup);
    var hdr = textureSample(hdrCube, samp, lookup);
    if (lens.params.x > 0.5) {
        // Premultiplied display colour: shift its light, then re-encode.
        let a = color.a;
        let lin = srgbToLinear(color.rgb / max(a, 1e-4));
        color = vec4<f32>(linearToSrgb(shiftLight(lin, seen.doppler)) * a, a);
        // Radiance is linear and premultiplied: the shift applies directly.
        hdr = vec4<f32>(shiftLight(hdr.rgb, seen.doppler), hdr.a);
    }
    var out : Sampled;
    out.color = color * ray.inside;
    out.hdr = hdr * ray.inside;
    return out;
}

@fragment
fn fs_color(in : VsOut) -> @location(0) vec4<f32> {
    return sampleLens(in.ndc).color;
}

struct HdrOut {
    @location(0) color : vec4<f32>,
    @location(1) hdr : vec4<f32>,
};

@fragment
fn fs_color_hdr(in : VsOut) -> HdrOut {
    let s = sampleLens(in.ndc);
    var out : HdrOut;
    out.color = s.color;
    out.hdr = s.hdr;
    return out;
}
`;

const HDR_FORMAT: GPUTextureFormat = "rgba16float";

export class LensRemapPipeline {
	private device: GPUDevice;
	private colorFormat: GPUTextureFormat;
	private mipModule: GPUShaderModule;
	private mipLayout: GPUBindGroupLayout;
	private mipPipes = new Map<GPUTextureFormat, GPURenderPipeline>();
	private remapLayout: GPUBindGroupLayout;
	private remapModule: GPUShaderModule;
	private remapPipe: GPURenderPipeline | null = null;
	private remapHdrPipe: GPURenderPipeline | null = null;
	private mipSampler: GPUSampler;
	private cubeSampler: GPUSampler;
	private placeholderCube: GPUTexture;
	private luts = new Map<boolean, GPUBuffer>();
	private uniformPool = new BufferPool(
		80,
		GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	);
	private uniformData = new Float32Array(20);

	constructor(device: GPUDevice, colorFormat: GPUTextureFormat) {
		this.device = device;
		this.colorFormat = colorFormat;
		this.mipModule = device.createShaderModule({
			label: "lens-mip.wgsl",
			code: mipWgsl,
		});
		this.remapModule = device.createShaderModule({
			label: "lens-remap.wgsl",
			code: remapWgsl,
		});
		this.mipLayout = device.createBindGroupLayout({
			label: "LensMipLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float" },
				},
			],
		});
		this.remapLayout = device.createBindGroupLayout({
			label: "LensRemapLayout",
			entries: [
				{
					binding: 0,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "uniform" },
				},
				{
					binding: 1,
					visibility: GPUShaderStage.FRAGMENT,
					sampler: { type: "filtering" },
				},
				{
					binding: 2,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float", viewDimension: "cube" },
				},
				{
					binding: 3,
					visibility: GPUShaderStage.FRAGMENT,
					texture: { sampleType: "float", viewDimension: "cube" },
				},
				{
					binding: 4,
					visibility: GPUShaderStage.FRAGMENT,
					buffer: { type: "read-only-storage" },
				},
			],
		});
		this.mipSampler = device.createSampler({
			label: "LensMipSampler",
			magFilter: "linear",
			minFilter: "linear",
		});
		this.cubeSampler = device.createSampler({
			label: "LensCubeSampler",
			magFilter: "linear",
			minFilter: "linear",
			mipmapFilter: "linear",
			maxAnisotropy: 16,
		});
		this.placeholderCube = device.createTexture({
			label: "LensPlaceholderCube",
			size: { width: 1, height: 1, depthOrArrayLayers: 6 },
			format: HDR_FORMAT,
			usage: GPUTextureUsage.TEXTURE_BINDING,
		});
	}

	/** Mip levels a cube face of `size` gets. */
	static mipLevels(size: number): number {
		return Math.floor(Math.log2(Math.max(1, size))) + 1;
	}

	/** Fills every mip level of every layer of `texture` from level 0. */
	generateMips(encoder: GPUCommandEncoder, texture: GPUTexture): void {
		const pipe = this.mipPipeline(texture.format);
		for (let layer = 0; layer < texture.depthOrArrayLayers; layer++) {
			for (let level = 1; level < texture.mipLevelCount; level++) {
				const view = (mip: number) =>
					texture.createView({
						dimension: "2d",
						baseArrayLayer: layer,
						arrayLayerCount: 1,
						baseMipLevel: mip,
						mipLevelCount: 1,
					});
				const pass = encoder.beginRenderPass({
					label: "LensMip",
					colorAttachments: [
						{ view: view(level), loadOp: "clear", storeOp: "store" },
					],
				});
				pass.setPipeline(pipe);
				pass.setBindGroup(
					0,
					this.device.createBindGroup({
						layout: this.mipLayout,
						entries: [
							{ binding: 0, resource: this.mipSampler },
							{ binding: 1, resource: view(level - 1) },
						],
					}),
				);
				pass.draw(3);
				pass.end();
			}
		}
	}

	/**
	 * Draws the lens's picture of `color` (and of `hdr`, the scene radiance,
	 * into `destHdr` when both are given). Generates the cubes' mips first.
	 */
	remap(
		encoder: GPUCommandEncoder,
		color: GPUTexture,
		hdr: GPUTexture | null,
		dest: GPUTextureView,
		destHdr: GPUTextureView | null,
		width: number,
		height: number,
		options: LensRemapOptions,
	): void {
		this.generateMips(encoder, color);
		if (hdr) this.generateMips(encoder, hdr);
		const withHdr = Boolean(hdr && destHdr);
		const pass = encoder.beginRenderPass({
			label: "LensRemap",
			colorAttachments: [
				{ view: dest, loadOp: "clear", storeOp: "store" },
				...(withHdr && destHdr
					? [
							{
								view: destHdr,
								loadOp: "clear" as const,
								storeOp: "store" as const,
							},
						]
					: []),
			],
		});
		pass.setPipeline(this.remapPipeline(withHdr));
		pass.setBindGroup(
			0,
			this.device.createBindGroup({
				layout: this.remapLayout,
				entries: [
					{
						binding: 0,
						resource: {
							buffer: this.uniformPool.getBuffer(
								this.device,
								this.packUniforms(options, width, height),
							),
						},
					},
					{ binding: 1, resource: this.cubeSampler },
					{ binding: 2, resource: color.createView({ dimension: "cube" }) },
					{
						binding: 3,
						resource: (hdr ?? this.placeholderCube).createView({
							dimension: "cube",
						}),
					},
					{
						binding: 4,
						resource: { buffer: this.lut(options.observer?.beaming ?? true) },
					},
				],
			}),
		);
		pass.draw(3);
		pass.end();
	}

	private packUniforms(
		options: LensRemapOptions,
		width: number,
		height: number,
	): Float32Array {
		const u = this.uniformData;
		const { right, up, forward } = options.basis;
		const half = (options.fov * Math.PI) / 360;
		const scale =
			options.projection === "fisheye"
				? half / options.zoom
				: Math.tan(half) / options.zoom;
		u.set([...right, PROJECTION_INDEX[options.projection]], 0);
		u.set([...up, scale], 4);
		u.set([...forward, width / Math.max(1, height)], 8);
		const observer = options.observer;
		const beta = observer ? Math.min(Math.max(observer.speed, 0), 0.99999) : 0;
		const direction = observer?.direction ?? forward;
		u.set([...direction, beta], 12);
		u.set(
			[
				observer && beta > 0 ? colorMode(observer) : ColorMode.None,
				observer ? exposureGain(observer, beta, forward) : 1,
				lorentzFactor(beta),
				Math.log(DOPPLER_LUT_MAX),
			],
			16,
		);
		return u;
	}

	private lut(beaming: boolean): GPUBuffer {
		let buffer = this.luts.get(beaming);
		if (!buffer) {
			const data = dopplerLut(beaming);
			buffer = this.device.createBuffer({
				label: `DopplerLut${beaming ? "Beaming" : ""}`,
				size: data.byteLength,
				usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
			});
			this.device.queue.writeBuffer(buffer, 0, data);
			this.luts.set(beaming, buffer);
		}
		return buffer;
	}

	private mipPipeline(format: GPUTextureFormat): GPURenderPipeline {
		let pipe = this.mipPipes.get(format);
		if (!pipe) {
			pipe = this.device.createRenderPipeline({
				label: `LensMip:${format}`,
				layout: this.device.createPipelineLayout({
					bindGroupLayouts: [this.mipLayout],
				}),
				vertex: { module: this.mipModule, entryPoint: "vs" },
				fragment: {
					module: this.mipModule,
					entryPoint: "fs",
					targets: [{ format }],
				},
				primitive: { topology: "triangle-list" },
			});
			this.mipPipes.set(format, pipe);
		}
		return pipe;
	}

	private remapPipeline(withHdr: boolean): GPURenderPipeline {
		const cached = withHdr ? this.remapHdrPipe : this.remapPipe;
		if (cached) return cached;
		const pipe = this.device.createRenderPipeline({
			label: withHdr ? "LensRemapHdr" : "LensRemap",
			layout: this.device.createPipelineLayout({
				bindGroupLayouts: [this.remapLayout],
			}),
			vertex: { module: this.remapModule, entryPoint: "vs" },
			fragment: {
				module: this.remapModule,
				entryPoint: withHdr ? "fs_color_hdr" : "fs_color",
				targets: withHdr
					? [{ format: this.colorFormat }, { format: HDR_FORMAT }]
					: [{ format: this.colorFormat }],
			},
			primitive: { topology: "triangle-list" },
		});
		if (withHdr) this.remapHdrPipe = pipe;
		else this.remapPipe = pipe;
		return pipe;
	}

	/** Call once per frame: recycles the per-pass uniforms. */
	resetPools(): void {
		this.uniformPool.reset();
	}

	destroy(): void {
		this.uniformPool.destroy();
		this.placeholderCube.destroy();
		for (const buffer of this.luts.values()) buffer.destroy();
		this.luts.clear();
	}
}

/** The gain on the shifted light: metered at the centre of the view, or fixed stops. */
function exposureGain(
	observer: RelativisticObserver,
	beta: number,
	forward: Vec3,
): number {
	if (observer.exposure !== "auto") return 2 ** observer.exposure;
	const c =
		forward[0] * observer.direction[0] +
		forward[1] * observer.direction[1] +
		forward[2] * observer.direction[2];
	const d = lorentzFactor(beta) * (1 + beta * c);
	return 1 / dopplerLuminanceGain(d, observer.doppler, observer.beaming);
}

function colorMode(observer: RelativisticObserver): number {
	if (observer.doppler) return ColorMode.Spectral;
	return observer.beaming ? ColorMode.Beaming : ColorMode.None;
}
