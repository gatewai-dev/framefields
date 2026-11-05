/**
 * Lumen-lite screen-space indirect light, traced from one radiance pass:
 *
 *  1. Hi-Z: a min-depth pyramid over the resolved geometry buffer.
 *  2. SSR: every pixel marches its mirror reflection through the pyramid,
 *     skipping empty space a whole cell at a time, and stores the pixel it
 *     hit with a confidence (screen edge, back faces, thickness). Glossy
 *     surfaces do not jitter rays: the shading pass reads the radiance
 *     pyramid at the level matching their reflection cone, so reflections
 *     are noise-free and identical from frame to frame.
 *  3. GI: a horizon scan around each pixel gathers ambient visibility and
 *     the light leaving the surfaces that rise above the horizon (one
 *     diffuse bounce), then a depth- and normal-aware blur denoises it.
 *
 * The shading pass (see `screenIndirectAt` in lighting3d.ts) folds both into
 * each material's environment terms before tone mapping and fog.
 */

import type { ResolvedGi, ResolvedSsr } from "../math3d/index.js";
import { BufferPool } from "../renderer2d/buffer-pool.js";
import { cameraUniformsWgsl } from "../shaders/lighting3d.js";

/** Reflection hits: pixel positions need full float precision at 4K. */
export const SSR_HIT_FORMAT: GPUTextureFormat = "rgba32float";
export const SCREEN_RADIANCE_FORMAT: GPUTextureFormat = "rgba16float";
export const SCREEN_GI_FORMAT: GPUTextureFormat = "rgba16float";
/** Hi-Z: r = nearest, g = farthest depth in each cell. */
export const HIZ_FORMAT: GPUTextureFormat = "rg32float";
/** Hi-Z levels: down to 64 px cells. */
export const HIZ_LEVELS = 7;
/** Radiance pyramid levels: enough for a rough lobe's footprint. */
export const RADIANCE_LEVELS = 7;
const PARAMS_BYTES = 48;

/** Mip levels of a full chain for `width`×`height`, capped at `max`. */
export function mipLevels(width: number, height: number, max: number): number {
	return Math.min(max, Math.floor(Math.log2(Math.max(width, height))) + 1);
}

const geometryWgsl = /* wgsl */ `
${cameraUniformsWgsl}
struct Params {
    size      : vec2<f32>,
    maxLevel  : f32,
    steps     : f32,
    thickness : f32,
    ssrOn     : f32,
    giRadius  : f32,
    giSamples : f32,
    blurDir   : vec2<f32>,
    _pad      : vec2<f32>,
};
@group(0) @binding(0) var<uniform> cam : CameraUniforms;
@group(0) @binding(1) var<uniform> params : Params;
@group(0) @binding(2) var geometry : texture_2d<f32>;

const PI = 3.14159265359;

fn isBackground(depth: f32) -> bool {
    return depth >= min(cam.cameraDir.w, 65504.0) * 0.999;
}

// Inverse of geometryPixel's octahedral encoding.
fn decodeNormal(e: vec2<f32>) -> vec3<f32> {
    let f = e * 2.0 - 1.0;
    var n = vec3<f32>(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
    let t = max(-n.z, 0.0);
    n.x += select(t, -t, n.x >= 0.0);
    n.y += select(t, -t, n.y >= 0.0);
    return normalize(n);
}

struct PixelRay {
    origin : vec3<f32>,
    dir    : vec3<f32>,
};

// The camera ray through a pixel position; perspective or orthographic.
fn pixelRay(px: vec2<f32>) -> PixelRay {
    let ndc = vec2<f32>(px.x / params.size.x * 2.0 - 1.0, 1.0 - px.y / params.size.y * 2.0);
    let a = cam.invViewProjMatrix * vec4<f32>(ndc, 0.0, 1.0);
    let b = cam.invViewProjMatrix * vec4<f32>(ndc, 1.0, 1.0);
    var r: PixelRay;
    r.origin = a.xyz / a.w;
    r.dir = normalize(b.xyz / b.w - r.origin);
    return r;
}

fn linearDepth(p: vec3<f32>) -> f32 {
    return dot(p - cam.cameraPos.xyz, cam.cameraDir.xyz);
}

// The world point at linear depth \`depth\` along a pixel's camera ray.
fn worldOnRay(r: PixelRay, depth: f32) -> vec3<f32> {
    return r.origin + r.dir * ((depth - linearDepth(r.origin)) / dot(r.dir, cam.cameraDir.xyz));
}

// Pixel position (xy) and clip w of a world point.
fn project(p: vec3<f32>) -> vec3<f32> {
    let c = cam.viewProjMatrix * vec4<f32>(p, 1.0);
    let ndc = c.xy / c.w;
    return vec3<f32>((ndc.x * 0.5 + 0.5) * params.size.x, (0.5 - ndc.y * 0.5) * params.size.y, c.w);
}

// A surface normal turned toward the camera ray that sees it.
fn facing(n: vec3<f32>, viewDir: vec3<f32>) -> vec3<f32> {
    return select(n, -n, dot(n, viewDir) > 0.0);
}
`;

const hizWgsl = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rg32float, write>;

@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) id : vec3<u32>) {
    let size = textureDimensions(dst);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let d = textureLoad(src, id.xy, 0).r;
    textureStore(dst, id.xy, vec4<f32>(d, d, 0.0, 0.0));
}

// Min and max over the 2x2 (2x3 / 3x3 at an odd edge) source texels a cell covers.
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id : vec3<u32>) {
    let size = textureDimensions(dst);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let srcSize = vec2<i32>(textureDimensions(src));
    let base = vec2<i32>(id.xy) * 2;
    let extra = vec2<i32>(
        select(1, 2, id.x == size.x - 1u && (srcSize.x & 1) == 1),
        select(1, 2, id.y == size.y - 1u && (srcSize.y & 1) == 1),
    );
    var lo = 3.0e38;
    var hi = 0.0;
    for (var y = 0; y <= extra.y; y++) {
        for (var x = 0; x <= extra.x; x++) {
            let d = textureLoad(src, min(base + vec2<i32>(x, y), srcSize - 1), 0).rg;
            lo = min(lo, d.x);
            hi = max(hi, d.y);
        }
    }
    textureStore(dst, id.xy, vec4<f32>(lo, hi, 0.0, 0.0));
}
`;

const radianceWgsl = /* wgsl */ `
@group(0) @binding(0) var src : texture_2d<f32>;
@group(0) @binding(1) var dst : texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(8, 8)
fn init(@builtin(global_invocation_id) id : vec3<u32>) {
    let size = textureDimensions(dst);
    if (id.x >= size.x || id.y >= size.y) { return; }
    textureStore(dst, id.xy, textureLoad(src, id.xy, 0));
}

// Premultiplied box filter: coverage averages with the light, so reading
// rgb / a later recovers the radiance of what is there.
@compute @workgroup_size(8, 8)
fn down(@builtin(global_invocation_id) id : vec3<u32>) {
    let size = textureDimensions(dst);
    if (id.x >= size.x || id.y >= size.y) { return; }
    let srcMax = vec2<i32>(textureDimensions(src)) - 1;
    let base = vec2<i32>(id.xy) * 2;
    var sum = vec4<f32>(0.0);
    for (var y = 0; y < 2; y++) {
        for (var x = 0; x < 2; x++) {
            sum += textureLoad(src, min(base + vec2<i32>(x, y), srcMax), 0);
        }
    }
    textureStore(dst, id.xy, sum * 0.25);
}
`;

const traceWgsl = /* wgsl */ `
${geometryWgsl}
@group(0) @binding(3) var hiz : texture_2d<f32>;
@group(0) @binding(4) var hits : texture_storage_2d<rgba32float, write>;

struct ScreenRay {
    s0   : vec2<f32>,
    d    : vec2<f32>,
    // Linear depth over screen distance is perspective-correct as
    // (depth / w, 1 / w), both linear in screen space.
    zk0  : f32,
    zk1  : f32,
    k0   : f32,
    k1   : f32,
    tMax : f32,
};

fn depthAt(r: ScreenRay, t: f32) -> f32 {
    return mix(r.zk0, r.zk1, t) / mix(r.k0, r.k1, t);
}

// Screen parameter where the segment leaves the viewport.
fn viewportExit(s0: vec2<f32>, d: vec2<f32>) -> f32 {
    var t = 1.0;
    if (d.x > 1e-6) { t = min(t, (params.size.x - s0.x) / d.x); }
    if (d.x < -1e-6) { t = min(t, -s0.x / d.x); }
    if (d.y > 1e-6) { t = min(t, (params.size.y - s0.y) / d.y); }
    if (d.y < -1e-6) { t = min(t, -s0.y / d.y); }
    return t;
}

// The reflected ray from P along R as a screen segment, clipped to the
// near plane and the viewport. tMax <= 0: nothing on screen to hit.
fn screenRay(P: vec3<f32>, R: vec3<f32>, depth: f32) -> ScreenRay {
    var r: ScreenRay;
    let near = cam.cameraPos.w;
    let rdz = dot(R, cam.cameraDir.xyz);
    var len = cam.cameraDir.w;
    if (rdz < 0.0) {
        len = min(len, (depth - near * 1.5) / -rdz);
    }
    r.tMax = 0.0;
    if (len <= 0.0) { return r; }
    let a = project(P);
    let end = P + R * len;
    let b = project(end);
    r.s0 = a.xy;
    r.d = b.xy - a.xy;
    r.k0 = 1.0 / a.z;
    r.k1 = 1.0 / b.z;
    r.zk0 = depth * r.k0;
    r.zk1 = linearDepth(end) * r.k1;
    if (length(r.d) < 1.0) { return r; }
    r.tMax = viewportExit(r.s0, r.d);
    return r;
}

// Hi-Z march: climb while the ray passes a whole cell in front of its
// nearest surface, or behind its farthest by more than any pixel in it
// could still count as a hit; descend when it might touch one; classify the
// pixel at the finest level. \`steps\` budgets the cells the ray advances through;
// descending into a cell is free (at most maxLevel times per advance).
// Returns the hit pixel (xy) and its confidence in w (0: a miss).
fn hizTrace(r: ScreenRay, P: vec3<f32>, R: vec3<f32>) -> vec4<f32> {
    let invLen = 1.0 / length(r.d);
    let eps = 0.02 * invLen;
    let towardPositive = r.d > vec2<f32>(0.0);
    let maxLevel = i32(params.maxLevel);
    let advances = i32(params.steps);
    var t = 1.5 * invLen;
    var level = 0;
    var advanced = 0;
    // Whether the ray has been in front of the scene since it left its
    // surface. One that starts out behind its neighbors is inside its own
    // body (a grazing ray off a convex surface): those are not hits.
    var seenFront = false;
    for (var i = 0; i < advances * (maxLevel + 1) && advanced < advances; i++) {
        if (t >= r.tMax) { break; }
        let pos = r.s0 + r.d * t;
        let cellSize = f32(1 << u32(level));
        let cell = floor(pos / cellSize);
        let boundary = (cell + select(vec2<f32>(0.0), vec2<f32>(1.0), towardPositive)) * cellSize;
        let tx = select(1e9, (boundary.x - r.s0.x) / r.d.x, abs(r.d.x) > 1e-6);
        let ty = select(1e9, (boundary.y - r.s0.y) / r.d.y, abs(r.d.y) > 1e-6);
        let tExit = min(min(tx, ty), r.tMax);
        let zEnter = depthAt(r, t);
        let zExit = depthAt(r, tExit);
        let levelMax = vec2<i32>(textureDimensions(hiz, level)) - 1;
        let depths = textureLoad(hiz, clamp(vec2<i32>(cell), vec2<i32>(0), levelMax), level).rg;
        let zMin = depths.x;
        let rayNear = min(zEnter, zExit);
        let span = abs(zExit - zEnter);
        let inFront = max(zEnter, zExit) < zMin;
        if (inFront || rayNear - depths.y - span > params.thickness) {
            t = tExit + eps;
            level = min(level + 1, maxLevel);
            advanced++;
            seenFront = seenFront || inFront;
            continue;
        }
        if (level > 0) {
            level -= 1;
            continue;
        }
        let behind = rayNear - zMin;
        if (behind <= 0.0) {
            // The ray crosses the pixel's depth inside the pixel.
            return vec4<f32>(cell + 0.5, 0.0, 1.0);
        }
        // Behind the pixel's surface: it either met that surface on the way
        // (its tangent plane meets the ray over this pixel) or is passing
        // behind it. Pixel depths alone cannot tell, the surface's plane can.
        let pixel = cell + 0.5;
        let hitRay = pixelRay(pixel);
        let hn = facing(decodeNormal(textureLoad(geometry, vec2<i32>(cell), 0).gb), hitRay.dir);
        let Q = worldOnRay(hitRay, zMin);
        let denom = dot(R, hn);
        // Near a silhouette the plane runs along the view ray, where it
        // meets the reflected ray says little: leave those to the thickness.
        if (denom < -1e-4 && abs(dot(hn, hitRay.dir)) > 0.25) {
            let X = project(P + R * (dot(Q - P, hn) / denom)).xy;
            if (distance(X, pixel) <= 1.5 && distance(X, r.s0) >= 1.5) {
                return vec4<f32>(pixel, 0.0, 1.0);
            }
        }
        // Otherwise a hit within the surface's assumed thickness, trusted less
        // the deeper the ray is. A ray covers |zExit - zEnter| of depth per
        // pixel, so it may have crossed anywhere in that span since its last
        // step: only depth beyond it counts against the thickness.
        let past = max(behind - span, 0.0);
        if (seenFront && past <= params.thickness) {
            return vec4<f32>(pixel, 0.0, 1.0 - past / params.thickness);
        }
        t = tExit + eps;
        advanced++;
    }
    return vec4<f32>(0.0);
}

@compute @workgroup_size(8, 8)
fn trace(@builtin(global_invocation_id) id : vec3<u32>) {
    if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
    let ip = vec2<i32>(id.xy);
    let g = textureLoad(geometry, ip, 0);
    if (isBackground(g.r)) {
        textureStore(hits, ip, vec4<f32>(0.0));
        return;
    }
    // z always carries the traced surface's depth: the shading pass checks
    // it to tell that surface from a transparent one drawn over it.
    var out = vec4<f32>(0.0, 0.0, g.r, 0.0);
    if (params.ssrOn > 0.5) {
        let px = vec2<f32>(id.xy) + 0.5;
        let ray = pixelRay(px);
        let P = worldOnRay(ray, g.r);
        let N = facing(decodeNormal(g.gb), ray.dir);
        let R = reflect(ray.dir, N);
        let sr = screenRay(P, R, g.r);
        if (sr.tMax > 0.0) {
            let hit = hizTrace(sr, P, R);
            if (hit.w > 0.0) {
                let hg = textureLoad(geometry, vec2<i32>(hit.xy), 0);
                let hitRay = pixelRay(hit.xy);
                // The camera sees the side of the hit facing it; a ray that
                // reaches the other side would show light it cannot see.
                let hn = facing(decodeNormal(hg.gb), hitRay.dir);
                let frontFace = 1.0 - smoothstep(-0.2, 0.0, dot(hn, R));
                let edge = min(hit.xy, params.size - hit.xy) / (0.08 * min(params.size.x, params.size.y));
                let edgeFade = clamp(min(edge.x, edge.y), 0.0, 1.0);
                // Rays back toward the camera leave the screen's knowledge fast.
                let toward = 1.0 - smoothstep(0.5, 0.9, dot(R, -cam.cameraDir.xyz));
                out = vec4<f32>(hit.xy, g.r, hit.w * frontFace * edgeFade * toward);
            }
        }
    }
    textureStore(hits, ip, out);
}
`;

const giWgsl = /* wgsl */ `
${geometryWgsl}
@group(0) @binding(3) var radiance : texture_2d<f32>;
@group(0) @binding(4) var radianceSampler : sampler;
@group(0) @binding(5) var gi : texture_storage_2d<rgba16float, write>;

const STEPS = 8;

// Jimenez's interleaved gradient noise: a fixed per-pixel rotation, so the
// same frame always renders the same and the blur removes the pattern.
fn ign(p: vec2<f32>) -> f32 {
    return fract(52.9829189 * fract(dot(p, vec2<f32>(0.06711056, 0.00583715))));
}

@compute @workgroup_size(8, 8)
fn gather(@builtin(global_invocation_id) id : vec3<u32>) {
    if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
    let ip = vec2<i32>(id.xy);
    let g = textureLoad(geometry, ip, 0);
    if (isBackground(g.r)) {
        textureStore(gi, ip, vec4<f32>(0.0, 0.0, 0.0, 1.0));
        return;
    }
    let px = vec2<f32>(id.xy) + 0.5;
    let ray = pixelRay(px);
    let P = worldOnRay(ray, g.r);
    let N = facing(decodeNormal(g.gb), ray.dir);
    let right = normalize(vec3<f32>(cam.viewMatrix[0][0], cam.viewMatrix[1][0], cam.viewMatrix[2][0]));
    let radiusPx = clamp(distance(project(P + right * params.giRadius).xy, px), 2.0, 0.5 * min(params.size.x, params.size.y));
    let rotation = ign(px);
    let jitter = ign(px + vec2<f32>(5.588, 3.17));
    let dirs = i32(params.giSamples);
    let maxMip = f32(textureNumLevels(radiance) - 1u);
    var occlusion = 0.0;
    var bounce = vec3<f32>(0.0);
    for (var di = 0; di < dirs; di++) {
        let phi = (f32(di) + rotation) / f32(dirs) * PI;
        let dir = vec2<f32>(cos(phi), sin(phi));
        for (var side = -1.0; side <= 1.0; side += 2.0) {
            // Sine of the horizon's elevation above the tangent plane. The
            // cosine-weighted share of the hemisphere between elevations
            // a and b is sin^2 b - sin^2 a, so each surface that rises above
            // the horizon blocks, and sends its light through, that band.
            var horizon = 0.0;
            for (var k = 0; k < STEPS; k++) {
                let f = (f32(k) + jitter) / f32(STEPS);
                let rPx = max(1.5, f * f * radiusPx);
                let sp = px + dir * side * rPx;
                if (any(sp < vec2<f32>(0.0)) || any(sp >= params.size)) { break; }
                let sip = vec2<i32>(sp);
                let sg = textureLoad(geometry, sip, 0);
                if (isBackground(sg.r)) { continue; }
                let sray = pixelRay(vec2<f32>(sip) + 0.5);
                let S = worldOnRay(sray, sg.r);
                let w = S - P;
                let dist = length(w);
                if (dist < 1e-3) { continue; }
                let h = w / dist;
                let falloff = 1.0 - smoothstep(0.5 * params.giRadius, params.giRadius, dist);
                // A small bias keeps flat surfaces from shadowing themselves
                // through depth quantization.
                let e = (dot(h, N) - 0.05) * falloff;
                if (e > horizon) {
                    let sn = facing(decodeNormal(sg.gb), sray.dir);
                    let towardP = max(dot(sn, -h), 0.0);
                    let mip = clamp(log2(max(rPx / f32(STEPS), 1.0)), 0.0, maxMip);
                    let c = textureSampleLevel(radiance, radianceSampler, sp / params.size, mip);
                    let L = select(vec3<f32>(0.0), c.rgb / c.a, c.a > 1e-3);
                    bounce += L * towardP * (e * e - horizon * horizon);
                    horizon = e;
                }
            }
            occlusion += horizon * horizon;
        }
    }
    let count = f32(dirs * 2);
    textureStore(gi, ip, vec4<f32>(bounce / count, 1.0 - occlusion / count));
}
`;

const blurWgsl = /* wgsl */ `
${geometryWgsl}
@group(0) @binding(3) var src : texture_2d<f32>;
@group(0) @binding(4) var dst : texture_storage_2d<rgba16float, write>;

const RADIUS = 5;

// Separable bilateral blur: weights fall off with distance, with depth
// difference relative to depth, and with normal difference.
@compute @workgroup_size(8, 8)
fn blur(@builtin(global_invocation_id) id : vec3<u32>) {
    if (f32(id.x) >= params.size.x || f32(id.y) >= params.size.y) { return; }
    let ip = vec2<i32>(id.xy);
    let g = textureLoad(geometry, ip, 0);
    if (isBackground(g.r)) {
        textureStore(dst, ip, textureLoad(src, ip, 0));
        return;
    }
    let n = decodeNormal(g.gb);
    let maxIp = vec2<i32>(params.size) - 1;
    let step = vec2<i32>(params.blurDir);
    var sum = vec4<f32>(0.0);
    var wsum = 0.0;
    for (var i = -RADIUS; i <= RADIUS; i++) {
        let q = clamp(ip + step * i, vec2<i32>(0), maxIp);
        let qg = textureLoad(geometry, q, 0);
        if (isBackground(qg.r)) { continue; }
        let fi = f32(i);
        let spatial = exp(-fi * fi / (2.0 * 3.0 * 3.0));
        let dz = abs(qg.r - g.r) / max(g.r, 1.0);
        let depthW = exp(-dz * 60.0);
        let normalW = pow(max(abs(dot(decodeNormal(qg.gb), n)), 0.0), 16.0);
        let w = spatial * depthW * normalW;
        sum += textureLoad(src, q, 0) * w;
        wsum += w;
    }
    textureStore(dst, ip, sum / max(wsum, 1e-5));
}
`;

/** What `SsrGiPipeline.run` reads and where it writes. */
export interface SsrGiInputs {
	encoder: GPUCommandEncoder;
	/** Camera uniform buffer of the radiance pass (`CameraUniforms`). */
	cameraBuffer: GPUBuffer;
	/** Resolved single-sample geometry buffer: r = linear depth, gb = octahedral normal. */
	geometry: GPUTexture;
	/** Premultiplied linear scene radiance of the radiance pass. */
	radiance: GPUTexture;
	/** Full-resolution reflection hits (`SSR_HIT_FORMAT`, storage). */
	hits: GPUTexture;
	/** Radiance pyramid (`SCREEN_RADIANCE_FORMAT`, storage, full mip chain). */
	radiancePyramid: GPUTexture;
	/** Diffuse bounce + visibility (`SCREEN_GI_FORMAT`, storage). */
	bounce: GPUTexture;
	/** Intermediate of the separable blur, same format and size as `bounce`. */
	bounceScratch: GPUTexture;
	/** Min/max depth pyramid (`HIZ_FORMAT`, storage, full mip chain). */
	hiz: GPUTexture;
	ssr?: ResolvedSsr;
	gi?: ResolvedGi;
}

export class SsrGiPipeline {
	private params = new BufferPool(
		PARAMS_BYTES,
		GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	);
	private sampler: GPUSampler;
	private hizInit: GPUComputePipeline;
	private hizDown: GPUComputePipeline;
	private radInit: GPUComputePipeline;
	private radDown: GPUComputePipeline;
	private trace: GPUComputePipeline;
	private gather: GPUComputePipeline;
	private blur: GPUComputePipeline;

	constructor(private device: GPUDevice) {
		const compute = (label: string, code: string, entryPoint: string) =>
			device.createComputePipeline({
				label: `SsrGi.${label}`,
				layout: "auto",
				compute: {
					module: device.createShaderModule({ label: `ssr-gi-${label}`, code }),
					entryPoint,
				},
			});
		this.hizInit = compute("hizInit", hizWgsl, "init");
		this.hizDown = compute("hizDown", hizWgsl, "down");
		this.radInit = compute("radianceInit", radianceWgsl, "init");
		this.radDown = compute("radianceDown", radianceWgsl, "down");
		this.trace = compute("trace", traceWgsl, "trace");
		this.gather = compute("gather", giWgsl, "gather");
		this.blur = compute("blur", blurWgsl, "blur");
		this.sampler = device.createSampler({
			label: "SsrGiRadianceSampler",
			magFilter: "linear",
			minFilter: "linear",
			mipmapFilter: "linear",
			addressModeU: "clamp-to-edge",
			addressModeV: "clamp-to-edge",
		});
	}

	run(inputs: SsrGiInputs): void {
		const { encoder, geometry, hits } = inputs;
		const width = hits.width;
		const height = hits.height;
		const groups = (w: number, h: number): [number, number] => [
			Math.ceil(w / 8),
			Math.ceil(h / 8),
		];
		const pass = encoder.beginComputePass({ label: "SsrGi" });

		this.buildPyramid(pass, this.hizInit, this.hizDown, geometry, inputs.hiz);
		this.buildPyramid(
			pass,
			this.radInit,
			this.radDown,
			inputs.radiance,
			inputs.radiancePyramid,
		);

		const params = (blurDir: [number, number]) => {
			const data = new Float32Array(PARAMS_BYTES / 4);
			data.set([
				width,
				height,
				inputs.hiz.mipLevelCount - 1,
				inputs.ssr?.steps ?? 0,
				inputs.ssr?.thickness ?? 0,
				inputs.ssr ? 1 : 0,
				inputs.gi?.radius ?? 0,
				inputs.gi?.samples ?? 0,
				blurDir[0],
				blurDir[1],
			]);
			return this.params.getBuffer(this.device, data);
		};
		const shared = (
			pipeline: GPUComputePipeline,
			paramsBuffer: GPUBuffer,
			extra: GPUBindGroupEntry[],
		) =>
			this.device.createBindGroup({
				layout: pipeline.getBindGroupLayout(0),
				entries: [
					{ binding: 0, resource: { buffer: inputs.cameraBuffer } },
					{ binding: 1, resource: { buffer: paramsBuffer } },
					{ binding: 2, resource: geometry.createView() },
					...extra,
				],
			});
		const base = params([0, 0]);

		pass.setPipeline(this.trace);
		pass.setBindGroup(
			0,
			shared(this.trace, base, [
				{ binding: 3, resource: inputs.hiz.createView() },
				{ binding: 4, resource: hits.createView() },
			]),
		);
		pass.dispatchWorkgroups(...groups(width, height));

		if (inputs.gi) {
			pass.setPipeline(this.gather);
			pass.setBindGroup(
				0,
				shared(this.gather, base, [
					{ binding: 3, resource: inputs.radiancePyramid.createView() },
					{ binding: 4, resource: this.sampler },
					{ binding: 5, resource: inputs.bounce.createView() },
				]),
			);
			pass.dispatchWorkgroups(...groups(width, height));
			for (const [dir, from, to] of [
				[[1, 0], inputs.bounce, inputs.bounceScratch],
				[[0, 1], inputs.bounceScratch, inputs.bounce],
			] as const) {
				pass.setPipeline(this.blur);
				pass.setBindGroup(
					0,
					shared(this.blur, params([dir[0], dir[1]]), [
						{ binding: 3, resource: from.createView() },
						{ binding: 4, resource: to.createView() },
					]),
				);
				pass.dispatchWorkgroups(...groups(width, height));
			}
		}
		pass.end();
	}

	/** Level 0 copies `source`; each level after reduces the one before. */
	private buildPyramid(
		pass: GPUComputePassEncoder,
		init: GPUComputePipeline,
		down: GPUComputePipeline,
		source: GPUTexture,
		pyramid: GPUTexture,
	): void {
		const level = (mip: number) =>
			pyramid.createView({ baseMipLevel: mip, mipLevelCount: 1 });
		for (let mip = 0; mip < pyramid.mipLevelCount; mip++) {
			const pipeline = mip === 0 ? init : down;
			pass.setPipeline(pipeline);
			pass.setBindGroup(
				0,
				this.device.createBindGroup({
					layout: pipeline.getBindGroupLayout(0),
					entries: [
						{
							binding: 0,
							resource: mip === 0 ? source.createView() : level(mip - 1),
						},
						{ binding: 1, resource: level(mip) },
					],
				}),
			);
			pass.dispatchWorkgroups(
				Math.ceil(Math.max(1, pyramid.width >> mip) / 8),
				Math.ceil(Math.max(1, pyramid.height >> mip) / 8),
			);
		}
	}

	resetPools(): void {
		this.params.reset();
	}

	destroy(): void {
		this.params.destroy();
	}
}
