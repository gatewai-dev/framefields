/// <reference types="webgpu" />
import type { SignalData } from "@framefields/core";
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import { signalRegistry } from "@framefields/webgpu-renderers";

interface ProceduralVFXYOp {
	op: "ProceduralVFX";
	effectType?: string;
	outputType?: "Image" | "Video";
	width?: number;
	height?: number;
	density?: number;
	scale?: number;
	speed?: number;
	intensity?: number;
	seed?: number;
	colorStart?: string;
	colorEnd?: string;
	durationMs?: number;
	fps?: number;

	densityHandleId?: string | null;
	scaleHandleId?: string | null;
	speedHandleId?: string | null;
	intensityHandleId?: string | null;
	seedHandleId?: string | null;

	inputs?: Record<
		string,
		{
			connectionValid: boolean;
			outputItem: {
				type: string;
				data: unknown;
			} | null;
		}
	>;
}

type VFXSignalData = SignalData & { nodeId?: string };

const VFX_SHADER = `
struct VFXUniforms {
    effectType             : f32,
    outputType             : f32,
    time                   : f32,
    _pad0                  : f32,

    density                : f32,
    scale                  : f32,
    speed                  : f32,
    intensity              : f32,

    seed                   : f32,
    hasSigDensity          : f32,
    hasSigScale            : f32,
    hasSigSpeed            : f32,

    hasSigIntensity        : f32,
    hasSigSeed             : f32,
    _pad1                  : f32,
    _pad2                  : f32,

    colorStart             : vec4<f32>,
    colorEnd               : vec4<f32>,
};

@group(0) @binding(0) var<uniform> u : VFXUniforms;

@group(1) @binding(0) var densityTex   : texture_2d<f32>;
@group(1) @binding(1) var scaleTex     : texture_2d<f32>;
@group(1) @binding(2) var speedTex     : texture_2d<f32>;
@group(1) @binding(3) var intensityTex : texture_2d<f32>;
@group(1) @binding(4) var seedTex      : texture_2d<f32>;
@group(1) @binding(5) var signalSamp   : sampler;

struct VSOut {
    @builtin(position) pos : vec4<f32>,
    @location(0) uv        : vec2<f32>,
};

@vertex fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, 1.0),
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0)
    );
    var uv = array<vec2<f32>, 4>(
        vec2<f32>(0.0, 0.0),
        vec2<f32>(1.0, 0.0),
        vec2<f32>(0.0, 1.0),
        vec2<f32>(1.0, 1.0)
    );
    return VSOut(vec4<f32>(pos[vi], 0.0, 1.0), uv[vi]);
}

// ---- hashing & noise primitives -------------------------------------------
fn hash21(p: vec2<f32>) -> vec2<f32> {
    let p3 = fract(vec3<f32>(p.xyx) * vec3<f32>(0.1031, 0.1030, 0.0973));
    let p4 = p3 + dot(p3, p3.yzx + 33.33);
    return fract((p4.xx + p4.yz) * p4.zy);
}

fn hash1(n: f32) -> f32 {
    return fract(sin(n) * 43758.5453);
}

fn valueNoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash1(dot(i, vec2<f32>(127.1, 311.7)));
    let b = hash1(dot(i + vec2<f32>(1.0, 0.0), vec2<f32>(127.1, 311.7)));
    let c = hash1(dot(i + vec2<f32>(0.0, 1.0), vec2<f32>(127.1, 311.7)));
    let d = hash1(dot(i + vec2<f32>(1.0, 1.0), vec2<f32>(127.1, 311.7)));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
    var value = 0.0;
    var amp = 0.5;
    var freq = 1.0;
    for (var i = 0; i < 8; i++) {
        if (i >= octaves) { break; }
        value += amp * valueNoise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return value;
}

fn get_field(val: f32, hasSig: f32, tex: texture_2d<f32>, samp: sampler) -> f32 {
    if (hasSig > 0.5) {
        return textureSampleLevel(tex, samp, vec2<f32>(0.5, 0.5), 0.0).r;
    }
    return val;
}

// ---- effect synthesizers (return straight-alpha RGBA) ----------------------
fn fxSmoke(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let sp = p * scl;
    // Domain-warped FBM gives structured puffs instead of a solid fill.
    let q = vec2<f32>(fbm(sp + time * 0.10, 4), fbm(sp + vec2<f32>(5.2, 1.3) + time * 0.08, 4));
    let f = fbm(sp + 4.0 * q + vec2<f32>(1.7, 9.2) + time * 0.05, 4); // ~[0, 0.94]
    // Billowing plume: denser at the base (bottom, p.y=0), dissipating toward the top.
    let vgrad = 1.0 - smoothstep(0.45, 0.9, p.y);
    let n = f * 2.0 - 1.0; // remap to [-1, 1]
    // Thresholded so only bright fbm patches are opaque -> reads as puffs, not solid.
    let cov = smoothstep(0.28, 0.6, n) * dens * (0.25 + 0.75 * vgrad);
    let alpha = cov * inten;
    let col = mix(cB * 0.35, cA, clamp(f + vgrad * 0.5, 0.0, 1.0));
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
}

fn fxFire(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let pn = vec2<f32>(p.x * 1.5, p.y) * scl;
    let n = fbm(pn * 6.0 + vec2<f32>(time * 2.0, time * 3.0), 4);
    // Heat concentrated near base, flickering upward
    let heat = n * smoothstep(1.0, 0.0 + (1.0 - dens) * 0.3, p.y);
    // Channeled vertical columns
    let columns = smoothstep(0.45, 0.9, n + 0.4 * sin(p.x * (20.0 + 40.0 * dens) * scl + time * 8.0));
    let d = clamp(heat * inten + columns * 0.3 * inten, 0.0, 1.0);
    // Fire color ramp mapped dynamically to cA and cB
    let dark = cB * 0.15;
    let orange = cB;
    let yellow = mix(cB, cA, 0.5);
    let white = cA;
    var col = mix(dark, orange, smoothstep(0.0, 0.4, d));
    col = mix(col, yellow, smoothstep(0.4, 0.75, d));
    col = mix(col, white, smoothstep(0.75, 1.0, d));
    let alpha = smoothstep(0.0, 0.3, d) * inten;
    return vec4<f32>(col, clamp(alpha, 0.0, 1.0));
}

fn fxRain(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let n = (60.0 * dens + 4.0) * scl;
    let gx = floor(p.x * n);
    let h = hash1(gx);
    let speed = 0.8 + h;
    let yFrac = fract(p.y * 8.0 - time * speed);
    let dropY = abs(yFrac - 0.5);
    let reveal = step(0.35, yFrac);
    let st = smoothstep(0.18, 0.02, dropY);
    let d = st * reveal;
    let g = smoothstep(0.18, 0.02, abs(fract(p.x * n) + h * 0.2 - 0.5));
    let a = d * g * inten;
    let col = mix(cA, cB, h);
    return vec4<f32>(col, clamp(a, 0.0, 1.0));
}

fn fxSnow(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let n = (50.0 * dens + 6.0) * scl;
    let cell = floor(p * n);
    let f = fract(p * n);
    let h = hash21(cell);
    let center = vec2<f32>(0.5, 0.5) + 0.3 * hash21(cell + 7.0);
    let sway = 0.1 * sin(time * 1.2 + cell.y * 3.0);
    // Fall downward (toward p.y=0, the bottom): subtract an advancing phase.
    let fall = fract(time * (0.25 + 0.45 * h.y) + h.x);
    let pos = vec2<f32>(f.x - center.x - sway, f.y - center.y) - vec2<f32>(0.0, fall);
    let d = length(pos);
    let size = 0.05 + 0.07 * h.x;
    let a = smoothstep(size, size * 0.4, d) * inten;
    let col = mix(cA, cB, h.x);
    return vec4<f32>(col, clamp(a, 0.0, 1.0));
}

fn fxDust(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let n = (90.0 * dens + 6.0) * scl;
    let cell = floor(p * n);
    let f = fract(p * n);
    let h = hash21(cell);
    let center = h;
    let drift = fract(time * 0.05 * (0.5 + h.y) + cell.x * 0.01);
    let pos = vec2<f32>(f.x - center.x, f.y - center.y) + vec2<f32>((drift - 0.5) * 0.03, 0.0);
    let d = length(pos);
    let a = smoothstep(0.12, 0.0, d) * smoothstep(0.0, 0.3, dens) * inten * 0.6;
    let col = mix(cA, cB, h.y);
    return vec4<f32>(col, clamp(a, 0.0, 1.0));
}

fn fxEmbers(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let n = (50.0 * dens + 4.0) * scl;
    let cell = floor(p * n);
    let f = fract(p * n);
    let h = hash21(cell);
    let sway = 0.12 * sin(time * 2.0 + cell.y * 2.0);
    let rise = fract(time * 0.18 * (0.7 + h.y) + cell.y * 0.12);
    // Rising: as rise grows, move toward p.y=1 (top).
    let pos = vec2<f32>(f.x - 0.5 - sway, f.y + rise * 1.2);
    let d = length(pos);
    let a = smoothstep(0.12, 0.0, d) * (1.0 - rise) * inten;
    let col = mix(cA, cB, clamp(rise, 0.0, 1.0));
    return vec4<f32>(col, clamp(a, 0.0, 1.0));
}

fn fxSparks(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    // Burst radiating from a low-center source; travel grows over time so it expands outward.
    let src = vec2<f32>(0.5, 0.15);
    let dir = p - src;
    let dist = length(dir);
    let ang = atan2(dir.y, dir.x);
    let n = (20.0 * dens + 5.0) * scl;
    let seg = floor(ang * n);
    let tFrame = floor(time * 3.0);
    let timeVal = tFrame - 10000.0 * floor(tFrame / 10000.0);
    let h = hash1(seg + timeVal * 97.0);
    let launch = fract(0.5 + h + time * 0.5);
    let travel = launch * 0.8;
    let trail = smoothstep(0.9, 0.4, dist - travel);
    let w = 0.02 + 0.02 * h;
    let blast = smoothstep(0.0, w * 2.0, dist - travel) * trail;
    let streak = smoothstep(w, 0.0, abs(dist - travel)) * trail;
    let a = clamp(max(streak, blast * 0.4), 0.0, 1.0) * inten;
    let col = mix(cA, cB, clamp(h, 0.0, 1.0));
    return vec4<f32>(col, clamp(a, 0.0, 1.0));
}

fn fxMagic(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let dv = p - center;
    let r = length(dv);
    let ang = atan2(dv.y, dv.x);
    let swirl = fbm(vec2<f32>(r * 8.0 * scl + time * 0.5, ang * 3.0 + time * 0.8), 4);
    let halo = smoothstep(0.5, 0.1, r) * 0.4 * dens;
    let wisp = smoothstep(1.0 - dens * 0.8, 1.5 - dens * 0.8, swirl) * (0.5 + 0.5 * sin(r * 20.0 * scl - time * 3.0));
    let a = clamp((halo + wisp * 0.8) * inten, 0.0, 1.0);
    let col = mix(cA, cB, clamp(swirl, 0.0, 1.0));
    return vec4<f32>(col * 0.8 + vec3<f32>(1.0) * halo * 0.4, a);
}

fn fxLensFlare(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let center = vec2<f32>(0.5, 0.5);
    let dv = p - center;
    let r = length(dv) * scl;
    let ang = atan2(dv.y, dv.x);
    // Radial streak
    let streakCount = 2.0 * floor(1.0 + dens * 3.0);
    let streak = smoothstep(0.35, 0.6, fract(ang / 3.14159 * streakCount + 0.5)) * pow(1.0 - r, 3.0);
    // Concentric halos / chromatic rings
    let rings = (0.5 + 0.5 * sin(r * 40.0 - time * 2.0)) * dens;
    let core = smoothstep(0.25, 0.0, r);
    let chroma = mix(cA, cB, 0.5 + 0.5 * cos(ang * 3.0 + r * 30.0));
    let a = clamp((core * 0.9 + streak * 0.5 * dens + rings * 0.15 * (1.0 - r)) * inten, 0.0, 1.0);
    return vec4<f32>(chroma, a);
}

fn fxLightning(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    // Periodic bolt striking vertically, flickering briefly
    let period = mix(4.0, 0.6, clamp(dens, 0.0, 1.0));
    let cycle = fract(time / period);
    let flashWindow = mix(0.05, 0.35, clamp(dens, 0.0, 1.0));
    let flash = smoothstep(flashWindow, 0.0, cycle);
    
    let tFlicker = floor(time * 60.0);
    let flickerVal = tFlicker - 10000.0 * floor(tFlicker / 10000.0);
    let flicker = step(hash1(flickerVal * 1.7), 0.8); // rapid on/off shimmer

    // Jitter a vertical bolt with per-row hashes and interpolate between rows
    let rows = 18.0 * scl;
    let rg = p.y * rows;
    let row = floor(rg);
    let fr = fract(rg);
    
    let tLightning = floor(time * 24.0);
    let lightningVal = tLightning - 10000.0 * floor(tLightning / 10000.0);
    let x0 = 0.3 + 0.4 * hash1(row * 13.7 + lightningVal * 3.1);
    let x1 = 0.3 + 0.4 * hash1((row + 1.0) * 13.7 + lightningVal * 3.1);
    let boltX = mix(x0, x1, fr);

    // Secondary tiny forks
    let forkDrift = (hash1(row * 7.3) - 0.5) * 0.12 * smoothstep(0.0, 0.6, 1.0 - p.y);
    let boltDist = abs(p.x - (boltX + forkDrift)) * scl;
    let core = smoothstep(0.012, 0.0, boltDist);
    let glow = smoothstep(0.07, 0.0, boltDist) * 0.5;
    let a = clamp((core + glow) * flash * flicker * inten, 0.0, 1.0);
    let col = mix(cA, cB, clamp(boltDist * 8.0, 0.0, 1.0) + 0.3 * flash);
    // Soft ambient flash behind the bolt
    let amb = smoothstep(0.35, 0.0, length(p - vec2<f32>(boltX, p.y)) * scl) * flash * 0.15;
    return vec4<f32>(col * (1.0 + amb), clamp(a + amb, 0.0, 1.0));
}

fn fxEnergyBeam(p: vec2<f32>, time: f32, scl: f32, dens: f32, inten: f32, cA: vec3<f32>, cB: vec3<f32>) -> vec4<f32> {
    let src = vec2<f32>(0.15, 0.5);
    let dirv = vec2<f32>(1.0, 0.0);
    let w = p - src;
    let along = dot(w, dirv) * scl;
    let perp = dot(w, vec2<f32>(-dirv.y, dirv.x)) * scl;
    let beamWidth = 0.01 + 0.03 * dens;
    let glowWidth = 0.05 + 0.1 * dens;
    let core = smoothstep(beamWidth, 0.0, abs(perp));
    let glow = smoothstep(glowWidth, 0.0, abs(perp)) * 0.4 * dens;
    let falloff = smoothstep(0.0, 1.0, along);
    let pulse = 0.7 + 0.3 * sin(along * 30.0 - time * 10.0);
    let a = clamp((core + glow) * falloff * pulse * inten, 0.0, 1.0);
    let col = mix(cA, cB, clamp(along, 0.0, 1.0));
    return vec4<f32>(col * (1.0 + glow * 2.0), a);
}

// ---- main dispatch ---------------------------------------------------------
@fragment fn fs(in : VSOut) -> @location(0) vec4<f32> {
    let density   = get_field(u.density,   u.hasSigDensity,   densityTex,   signalSamp);
    let scale     = get_field(u.scale,     u.hasSigScale,     scaleTex,     signalSamp);
    let speed     = get_field(u.speed,     u.hasSigSpeed,     speedTex,     signalSamp);
    let intensity = get_field(u.intensity, u.hasSigIntensity, intensityTex, signalSamp);
    let seed      = get_field(u.seed,      u.hasSigSeed,      seedTex,      signalSamp);

    let isVideo = u.outputType > 0.5;
    let time = select(0.0, u.time * max(speed, 1e-4), isVideo);
    let seedOff = fract(seed * 1.618033);

    // Aspect correction
    let uv = in.uv;
    let p = vec2<f32>(uv.x, uv.y);

    // Move to a seed-scrambled space so different seeds look different
    let sp = p + vec2<f32>(seedOff * 17.0, seedOff * 31.0);

    var eff = vec4<f32>(0.0, 0.0, 0.0, 0.0);
    let cA = u.colorStart.rgb;
    let cB = u.colorEnd.rgb;
    let scl = max(scale, 1e-4);
    let factor = scl * 100.0;

    if (u.effectType < 0.5) {
        eff = fxSmoke(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 1.5) {
        eff = fxFire(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 2.5) {
        eff = fxRain(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 3.5) {
        eff = fxSparks(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 4.5) {
        eff = fxSnow(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 5.5) {
        eff = fxDust(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 6.5) {
        eff = fxLightning(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 7.5) {
        eff = fxMagic(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 8.5) {
        eff = fxLensFlare(sp, time, factor, density, intensity, cA, cB);
    } else if (u.effectType < 9.5) {
        eff = fxEmbers(sp, time, factor, density, intensity, cA, cB);
    } else {
        eff = fxEnergyBeam(sp, time, factor, density, intensity, cA, cB);
    }

    // Straight alpha is fine for compositing onto a transparent canvas.
    let a = clamp(eff.a, 0.0, 1.0);
    return vec4<f32>(clamp(eff.rgb, vec3<f32>(0.0), vec3<f32>(1.0)) * a, a);
}
`;

interface DeviceVFXResources {
	uniformLayout: GPUBindGroupLayout;
	signalsLayout: GPUBindGroupLayout;
	pipelineCache: Map<string, GPURenderPipeline>;
}

const deviceResourceCache = new WeakMap<GPUDevice, DeviceVFXResources>();
const vfxUniformData = new Float32Array(24);

function getDeviceLayouts(device: GPUDevice): DeviceVFXResources {
	let res = deviceResourceCache.get(device);
	if (res) return res;

	const uniformLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
		],
	});

	const signalsLayout = device.createBindGroupLayout({
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 3,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 4,
				visibility: GPUShaderStage.FRAGMENT,
				texture: { sampleType: "float" },
			},
			{
				binding: 5,
				visibility: GPUShaderStage.FRAGMENT,
				sampler: { type: "filtering" },
			},
		],
	});

	res = {
		uniformLayout,
		signalsLayout,
		pipelineCache: new Map(),
	};
	deviceResourceCache.set(device, res);
	return res;
}

function getVFXResources(device: GPUDevice, format: GPUTextureFormat) {
	const layouts = getDeviceLayouts(device);

	const cacheKey = `procedural_vfx_${format}`;
	let pipeline = layouts.pipelineCache.get(cacheKey);
	if (!pipeline) {
		const vfxModule = device.createShaderModule({
			label: `procedural_vfx_${format}.wgsl`,
			code: VFX_SHADER,
		});

		pipeline = device.createRenderPipeline({
			label: `ProceduralVFXPipeline_${format}`,
			layout: device.createPipelineLayout({
				bindGroupLayouts: [layouts.uniformLayout, layouts.signalsLayout],
			}),
			vertex: { module: vfxModule, entryPoint: "vs" },
			fragment: {
				module: vfxModule,
				entryPoint: "fs",
				targets: [{ format }],
			},
			primitive: { topology: "triangle-strip" },
		});
		layouts.pipelineCache.set(cacheKey, pipeline);
	}

	return {
		vfxPipeline: pipeline,
		uniformLayout: layouts.uniformLayout,
		signalsLayout: layouts.signalsLayout,
	};
}

function hexToRgba(hex: string): [number, number, number, number] {
	let h = hex.replace("#", "");
	if (h.length === 3 || h.length === 4) {
		h = h
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const r = parseInt(h.substring(0, 2), 16) / 255;
	const g = parseInt(h.substring(2, 4), 16) / 255;
	const b = parseInt(h.substring(4, 6), 16) / 255;
	let a = 1.0;
	if (h.length === 8) {
		a = parseInt(h.substring(6, 8), 16) / 255;
	}
	return [r, g, b, a];
}

const VFX_EFFECT_INDEX: Record<string, number> = {
	Smoke: 0,
	Fire: 1,
	Rain: 2,
	Sparks: 3,
	Snow: 4,
	Dust: 5,
	Lightning: 6,
	Magic: 7,
	LensFlare: 8,
	Embers: 9,
	EnergyBeam: 10,
};

function resolveVFXField(
	op: ProceduralVFXYOp,
	fieldName: "density" | "scale" | "speed" | "intensity" | "seed",
	defaultValue: number,
): { hasSignal: boolean; sd: any; value: number } {
	const handleIdKey = `${fieldName}HandleId` as keyof ProceduralVFXYOp;
	const handleId = op[handleIdKey] as string | null | undefined;
	const signalInput = handleId ? op.inputs?.[handleId] : null;

	const hasSignal = !!(
		signalInput?.connectionValid &&
		(signalInput.outputItem?.type === "Signal" ||
			signalInput.outputItem?.type === "Numeric")
	);
	const sd = hasSignal ? signalInput?.outputItem?.data : null;

	let value = defaultValue;
	if (!hasSignal) {
		if (
			signalInput?.connectionValid &&
			signalInput.outputItem?.type === "Number"
		) {
			value = Number(signalInput.outputItem.data ?? defaultValue);
		} else {
			value = Number(op[fieldName] ?? defaultValue);
		}
	} else if (sd && typeof sd === "object" && "offset" in sd) {
		value = Number(sd.offset ?? defaultValue);
	}

	return { hasSignal, sd, value };
}

export const ProceduralVFXWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, encoder, pass, targetWidth, targetHeight, props } = args;

	const op = props.virtualMedia?.operation as ProceduralVFXYOp | undefined;
	if (op?.op !== "ProceduralVFX" || !op) return;

	const {
		vfxPipeline: pipeline,
		uniformLayout: uLayout,
		signalsLayout: sigLayout,
	} = getVFXResources(ctx.device, ctx.renderer.format);

	const frame = props.frame ?? 0;
	const fps = props.fps || 30;

	const densityInfo = resolveVFXField(op, "density", 0.6);
	const scaleInfo = resolveVFXField(op, "scale", 0.01);
	const speedInfo = resolveVFXField(op, "speed", 1.0);
	const intensityInfo = resolveVFXField(op, "intensity", 0.8);
	const seedInfo = resolveVFXField(op, "seed", 1234);

	const effectIndex = VFX_EFFECT_INDEX[op.effectType ?? "Smoke"] ?? 0;
	const outputTypeVal = op.outputType === "Video" ? 1.0 : 0.0;

	const elapsedSeconds =
		props.elapsedMs !== undefined ? props.elapsedMs / 1000 : frame / fps;
	const durationSeconds = props.virtualMedia?.metadata?.durationMs
		? props.virtualMedia.metadata.durationMs / 1000
		: props.durationMs !== undefined
			? props.durationMs / 1000
			: 0;

	const colorStartVal = hexToRgba(op.colorStart ?? "#ffffff");
	const colorEndVal = hexToRgba(op.colorEnd ?? "#ff5500");

	// Fill uniforms array
	vfxUniformData[0] = effectIndex;
	vfxUniformData[1] = outputTypeVal;
	vfxUniformData[2] = elapsedSeconds;
	vfxUniformData[3] = 0.0; // padding

	vfxUniformData[4] = densityInfo.value;
	vfxUniformData[5] = scaleInfo.value;
	vfxUniformData[6] = speedInfo.value;
	vfxUniformData[7] = intensityInfo.value;

	vfxUniformData[8] = seedInfo.value;
	vfxUniformData[9] = densityInfo.hasSignal ? 1.0 : 0.0;
	vfxUniformData[10] = scaleInfo.hasSignal ? 1.0 : 0.0;
	vfxUniformData[11] = speedInfo.hasSignal ? 1.0 : 0.0;

	vfxUniformData[12] = intensityInfo.hasSignal ? 1.0 : 0.0;
	vfxUniformData[13] = seedInfo.hasSignal ? 1.0 : 0.0;
	vfxUniformData[14] = 0.0; // padding
	vfxUniformData[15] = 0.0; // padding

	vfxUniformData[16] = colorStartVal[0];
	vfxUniformData[17] = colorStartVal[1];
	vfxUniformData[18] = colorStartVal[2];
	vfxUniformData[19] = colorStartVal[3];

	vfxUniformData[20] = colorEndVal[0];
	vfxUniformData[21] = colorEndVal[1];
	vfxUniformData[22] = colorEndVal[2];
	vfxUniformData[23] = colorEndVal[3];

	const uniformBuffer = ctx.renderer.getTemporaryBuffer(vfxUniformData);

	// Load or create views for signals
	const signalFields = [
		{ name: "density", info: densityInfo },
		{ name: "scale", info: scaleInfo },
		{ name: "speed", info: speedInfo },
		{ name: "intensity", info: intensityInfo },
		{ name: "seed", info: seedInfo },
	];

	const signalViews: GPUTextureView[] = [];
	const sampler = ctx.renderer.samplerCache.getSampler(ctx.device);

	for (const f of signalFields) {
		const isGenerator = !!(f.info.hasSignal && f.info.sd);
		if (isGenerator) {
			const view = signalRegistry.getOrCreate2DTextureView(
				ctx.device,
				encoder,
				f.info.sd.nodeId ?? `procedural_vfx_${f.name}_sig`,
				elapsedSeconds,
				durationSeconds,
				f.info.sd as VFXSignalData,
				targetWidth,
				targetHeight,
				props.renderId,
				frame,
				fps,
			);
			signalViews.push(view);
		} else {
			signalViews.push(signalRegistry.getDummy1x1TextureView(ctx.device));
		}
	}

	pass.setPipeline(pipeline);
	pass.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: uLayout,
			entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
		}),
	);
	pass.setBindGroup(
		1,
		ctx.device.createBindGroup({
			layout: sigLayout,
			entries: [
				{ binding: 0, resource: signalViews[0] }, // density
				{ binding: 1, resource: signalViews[1] }, // scale
				{ binding: 2, resource: signalViews[2] }, // speed
				{ binding: 3, resource: signalViews[3] }, // intensity
				{ binding: 4, resource: signalViews[4] }, // seed
				{ binding: 5, resource: sampler },
			],
		}),
	);

	pass.draw(4);
};
