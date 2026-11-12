import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import {
	type DecodedHdrImage,
	decodeHdrSource,
	downsampleEquirect,
	floatRgbaToHalf16,
	projectIrradianceSh,
} from "../loaders/hdr-loader.js";
import { buildEnvImportance } from "../pathtracer/env-importance.js";

/** A captured panorama, ready for image-based lighting. */
export interface HdrEnvironment {
	/**
	 * GGX-prefiltered radiance cubemap: mip `m` holds the panorama as a surface
	 * of perceptual roughness `m / (mipLevelCount - 1)` reflects it.
	 */
	cube: GPUTexture;
	faceSize: number;
	mipLevelCount: number;
	/** Diffuse irradiance as 9 L2 SH coefficients (`projectIrradianceSh`). */
	sh: Float32Array;
	/** Luminance distribution the path tracer samples lights from (`buildEnvImportance`). */
	importance: Float32Array;
}

/** Most environments kept resident per device; the least recently used is destroyed. */
export const MAX_HDR_CACHE_ENTRIES = 8;
/** Largest cube face; finer than this adds memory, not visible detail. */
const MAX_FACE_SIZE = 256;
/** Roughest level is 4×4: GGX at roughness 1 has nothing finer to show. */
const MAX_CUBE_MIPS = 7;
/** Importance samples per texel for every rough level. */
const PREFILTER_SAMPLES = 256;

const deviceCaches = new WeakMap<GPUDevice, Map<string, HdrEnvironment>>();
/** Stable keys for in-memory sources, so the same object never hashes twice. */
const objectKeys = new WeakMap<object, string>();

export const hdrPrefilterWgsl = /* wgsl */ `
const PI = 3.14159265359;

struct Params {
    faceSize : u32,
    sampleCount : u32,
    roughness : f32,
    srcMaxLod : f32,
    srcTexelSolidAngle : f32,
    cubeTexelSolidAngle : f32,
};

@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var srcSampler : sampler;
@group(0) @binding(2) var dst : texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> params : Params;

// WebGPU cube face orientation: s right, t down, both in -1..1.
fn faceDirection(face : u32, s : f32, t : f32) -> vec3<f32> {
    switch face {
        case 0u: { return vec3<f32>(1.0, -t, -s); }
        case 1u: { return vec3<f32>(-1.0, -t, s); }
        case 2u: { return vec3<f32>(s, 1.0, t); }
        case 3u: { return vec3<f32>(s, -1.0, -t); }
        case 4u: { return vec3<f32>(s, -t, 1.0); }
        default: { return vec3<f32>(-s, -t, -1.0); }
    }
}

// Same mapping as equirectDirection (y down, u = 0.5 looks down -z).
fn equirectUv(d : vec3<f32>) -> vec2<f32> {
    let u = fract(atan2(d.x, -d.z) / (2.0 * PI) + 0.5);
    let v = acos(clamp(-d.y, -1.0, 1.0)) / PI;
    return vec2<f32>(u, v);
}

fn sampleSource(d : vec3<f32>, lod : f32) -> vec3<f32> {
    return textureSampleLevel(src, srcSampler, equirectUv(d), clamp(lod, 0.0, params.srcMaxLod)).rgb;
}

fn radicalInverse(i : u32) -> f32 {
    var b = (i << 16u) | (i >> 16u);
    b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
    b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
    b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
    b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
    return f32(b) * 2.3283064365386963e-10;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let size = params.faceSize;
    if (gid.x >= size || gid.y >= size) {
        return;
    }
    let st = (vec2<f32>(gid.xy) + 0.5) / f32(size) * 2.0 - 1.0;
    let N = normalize(faceDirection(gid.z, st.x, st.y));
    // A mirror level resamples the panorama at the cube's own footprint.
    let mirrorLod = 0.5 * log2(params.cubeTexelSolidAngle / params.srcTexelSolidAngle);
    if (params.roughness <= 0.0) {
        textureStore(dst, gid.xy, gid.z, vec4<f32>(sampleSource(N, mirrorLod), 1.0));
        return;
    }

    // Split-sum prefilter (Karis 2013) with view = normal, filtered importance
    // sampling (Krivanek & Colbert 2008) to keep few samples noise-free.
    let a = params.roughness * params.roughness;
    let a2 = a * a;
    let up = select(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(0.0, 1.0, 0.0), abs(N.y) < 0.999);
    let T = normalize(cross(up, N));
    let B = cross(N, T);
    var sum = vec3<f32>(0.0);
    var weight = 0.0;
    let n = params.sampleCount;
    for (var i = 0u; i < n; i++) {
        let xi = vec2<f32>(f32(i) / f32(n), radicalInverse(i));
        let phi = 2.0 * PI * xi.x;
        let cosTheta = sqrt((1.0 - xi.y) / (1.0 + (a2 - 1.0) * xi.y));
        let sinTheta = sqrt(1.0 - cosTheta * cosTheta);
        let H = normalize(T * (sinTheta * cos(phi)) + B * (sinTheta * sin(phi)) + N * cosTheta);
        let L = 2.0 * dot(N, H) * H - N;
        let nDotL = dot(N, L);
        if (nDotL <= 0.0) {
            continue;
        }
        let nDotH = max(dot(N, H), 0.0);
        let dDen = nDotH * nDotH * (a2 - 1.0) + 1.0;
        let D = a2 / (PI * dDen * dDen);
        // pdf(L) = D * nDotH / (4 vDotH), and vDotH = nDotH with V = N.
        let pdf = max(D * 0.25, 1e-6);
        let sampleSolidAngle = 1.0 / (f32(n) * pdf);
        let lod = 0.5 * log2(sampleSolidAngle / params.srcTexelSolidAngle) + 1.0;
        sum += sampleSource(L, lod) * nDotL;
        weight += nDotL;
    }
    textureStore(dst, gid.xy, gid.z, vec4<f32>(sum / max(weight, 1e-6), 1.0));
}
`;

interface PrefilterResources {
	pipeline: GPUComputePipeline;
	layout: GPUBindGroupLayout;
	sampler: GPUSampler;
}

const prefilterResources = new WeakMap<GPUDevice, PrefilterResources>();

function getPrefilterResources(device: GPUDevice): PrefilterResources {
	const cached = prefilterResources.get(device);
	if (cached) return cached;
	const layout = device.createBindGroupLayout({
		label: "HdrPrefilterLayout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				sampler: { type: "filtering" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.COMPUTE,
				storageTexture: {
					access: "write-only",
					format: "rgba16float",
					viewDimension: "2d-array",
				},
			},
			{
				binding: 3,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "uniform" },
			},
		],
	});
	const pipeline = device.createComputePipeline({
		label: "HdrPrefilterPipeline",
		layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
		compute: {
			module: device.createShaderModule({
				label: "HdrPrefilterShader",
				code: hdrPrefilterWgsl,
			}),
			entryPoint: "main",
		},
	});
	const sampler = device.createSampler({
		label: "HdrPrefilterSampler",
		magFilter: "linear",
		minFilter: "linear",
		mipmapFilter: "linear",
		addressModeU: "repeat",
		addressModeV: "clamp-to-edge",
	});
	const res = { pipeline, layout, sampler };
	prefilterResources.set(device, res);
	return res;
}

/** Uploads the panorama with a full mip chain, the prefilter's sampling source. */
function uploadEquirect(device: GPUDevice, image: DecodedHdrImage): GPUTexture {
	const mipLevelCount =
		Math.floor(Math.log2(Math.max(image.width, image.height))) + 1;
	const texture = device.createTexture({
		label: "HdrEquirectSource",
		size: { width: image.width, height: image.height },
		mipLevelCount,
		format: "rgba16float",
		usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	let level = image;
	for (let mip = 0; mip < mipLevelCount; mip++) {
		device.queue.writeTexture(
			{ texture, mipLevel: mip },
			floatRgbaToHalf16(level.data),
			{ bytesPerRow: level.width * 8, rowsPerImage: level.height },
			{ width: level.width, height: level.height },
		);
		if (mip + 1 < mipLevelCount) level = downsampleEquirect(level);
	}
	return texture;
}

/** Cube face size for a panorama: about a quarter of its width, a power of two. */
export function cubeFaceSize(panoramaWidth: number): number {
	const quarter = Math.max(1, panoramaWidth / 4);
	return Math.max(
		8,
		Math.min(MAX_FACE_SIZE, 2 ** Math.floor(Math.log2(quarter))),
	);
}

/** Prefilters an equirectangular panorama into a GGX radiance cubemap on the GPU. */
function prefilterCube(
	device: GPUDevice,
	image: DecodedHdrImage,
	label: string,
): { cube: GPUTexture; faceSize: number; mipLevelCount: number } {
	const { pipeline, layout, sampler } = getPrefilterResources(device);
	const source = uploadEquirect(device, image);
	const faceSize = cubeFaceSize(image.width);
	const mipLevelCount = Math.min(
		MAX_CUBE_MIPS,
		Math.floor(Math.log2(faceSize)) - 1,
	);
	const cube = device.createTexture({
		label: `HdrEnvironmentCube:${label}`,
		size: { width: faceSize, height: faceSize, depthOrArrayLayers: 6 },
		mipLevelCount,
		format: "rgba16float",
		// COPY_SRC lets tools and tests read the prefiltered levels back.
		usage:
			GPUTextureUsage.TEXTURE_BINDING |
			GPUTextureUsage.STORAGE_BINDING |
			GPUTextureUsage.COPY_SRC,
	});
	const srcTexelSolidAngle = (4 * Math.PI) / (image.width * image.height);
	const sourceView = source.createView();
	const buffers: GPUBuffer[] = [];
	const encoder = device.createCommandEncoder({ label: "HdrPrefilter" });
	const pass = encoder.beginComputePass({ label: "HdrPrefilterPass" });
	pass.setPipeline(pipeline);
	for (let mip = 0; mip < mipLevelCount; mip++) {
		const size = Math.max(1, faceSize >> mip);
		const params = new ArrayBuffer(32);
		const u32 = new Uint32Array(params);
		const f32 = new Float32Array(params);
		u32[0] = size;
		u32[1] = PREFILTER_SAMPLES;
		f32[2] = mipLevelCount > 1 ? mip / (mipLevelCount - 1) : 0;
		f32[3] = source.mipLevelCount - 1;
		f32[4] = srcTexelSolidAngle;
		f32[5] = (4 * Math.PI) / (6 * size * size);
		const buffer = device.createBuffer({
			label: `HdrPrefilterParams${mip}`,
			size: params.byteLength,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		});
		device.queue.writeBuffer(buffer, 0, params);
		buffers.push(buffer);
		pass.setBindGroup(
			0,
			device.createBindGroup({
				layout,
				entries: [
					{ binding: 0, resource: sourceView },
					{ binding: 1, resource: sampler },
					{
						binding: 2,
						resource: cube.createView({
							dimension: "2d-array",
							baseMipLevel: mip,
							mipLevelCount: 1,
						}),
					},
					{ binding: 3, resource: { buffer } },
				],
			}),
		);
		const groups = Math.ceil(size / 8);
		pass.dispatchWorkgroups(groups, groups, 6);
	}
	pass.end();
	device.queue.submit([encoder.finish()]);
	// Freed once the submitted prefilter has run.
	source.destroy();
	for (const b of buffers) b.destroy();
	return { cube, faceSize, mipLevelCount };
}

function contentKey(source: Uint8Array | DecodedHdrImage): string {
	const known = objectKeys.get(source);
	if (known) return known;
	const hash = createHash("sha1");
	if (source instanceof Uint8Array) {
		hash.update(source);
	} else {
		hash.update(`${source.width}x${source.height}`);
		hash.update(
			new Uint8Array(
				source.data.buffer,
				source.data.byteOffset,
				source.data.byteLength,
			),
		);
	}
	const key = `sha1:${hash.digest("hex")}`;
	objectKeys.set(source, key);
	return key;
}

/**
 * The prefiltered cubemap and irradiance SH for a `.hdr` path, its bytes or a
 * decoded panorama, built once per device. A bounded LRU destroys evicted
 * cubemaps so long renders never leak VRAM; a path keys on its modification
 * time too, so an edited panorama reloads.
 */
export function getOrCreateHdrEnvironment(
	device: GPUDevice,
	source: string | Uint8Array | DecodedHdrImage,
	cacheKey?: string,
): HdrEnvironment {
	const key =
		cacheKey ??
		(typeof source === "string"
			? `${source}@${statSync(source).mtimeMs}`
			: contentKey(source));
	let map = deviceCaches.get(device);
	if (!map) {
		map = new Map();
		deviceCaches.set(device, map);
	}
	const existing = map.get(key);
	if (existing) {
		map.delete(key);
		map.set(key, existing);
		return existing;
	}
	const image =
		typeof source === "string" || source instanceof Uint8Array
			? decodeHdrSource(source)
			: source;
	const entry: HdrEnvironment = {
		...prefilterCube(device, image, key),
		sh: projectIrradianceSh(image),
		importance: buildEnvImportance(image),
	};
	if (map.size >= MAX_HDR_CACHE_ENTRIES) {
		const oldest = map.keys().next().value;
		if (oldest !== undefined) {
			map.get(oldest)?.cube.destroy();
			map.delete(oldest);
		}
	}
	map.set(key, entry);
	return entry;
}
