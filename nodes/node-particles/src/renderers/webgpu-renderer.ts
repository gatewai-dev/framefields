/// <reference types="webgpu" />
/**
 * GPU particles: a compute pass spawns and simulates every particle, then
 * one instanced draw renders them all. State lives on the GPU and is
 * stepped frame by frame; snapshots every SNAPSHOT_EVERY frames make
 * scrubbing back (preview) a restore plus a few steps instead of a replay
 * from the start. Same GPU, same frames, same result.
 */
import type { WebGPUNodeRenderer } from "@framefields/node-sdk";
import {
	isParticleProgram,
	type ParticleFrame,
	type ParticleMask,
	type ParticleProgram,
	type ParticleStatic,
} from "../shared/program.js";

const PARTICLE_BYTES = 32;
const PARAM_VEC4S = 32;
const MAX_ATTRACTORS = 8;
const MAX_COLORS = 8;
const SNAPSHOT_EVERY = 24;
const MAX_SNAPSHOTS = 64;
const WORKGROUP = 64;

const COMMON_WGSL = /* wgsl */ `
struct Particle {
	pos : vec2<f32>,
	vel : vec2<f32>,
	age : f32,
	life : f32,
	jitter : f32,
	_pad : f32,
};

struct Params { v : array<vec4<f32>, ${PARAM_VEC4S}> };
`;

const SIM_WGSL = /* wgsl */ `
${COMMON_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(2) var<storage, read> mask : array<f32>;

fn pcg(v : u32) -> u32 {
	let state = v * 747796405u + 2891336453u;
	let word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
	return (word >> 22u) ^ word;
}
fn rnd(idx : u32, channel : u32, seed : u32) -> f32 {
	return f32(pcg(idx * 16u + channel + pcg(seed))) / 4294967295.0;
}

fn hash2(p : vec2<f32>) -> f32 {
	let q = fract(p * vec2<f32>(0.1031, 0.1030));
	let r = q + dot(q, q.yx + 33.33);
	return fract((r.x + r.y) * r.x);
}
fn vnoise(p : vec2<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let u = f * f * (3.0 - 2.0 * f);
	let a = hash2(i);
	let b = hash2(i + vec2<f32>(1.0, 0.0));
	let c = hash2(i + vec2<f32>(0.0, 1.0));
	let d = hash2(i + vec2<f32>(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn fbm(p : vec2<f32>) -> f32 {
	return vnoise(p) * 0.6 + vnoise(p * 2.03 + 17.0) * 0.3 + vnoise(p * 4.01 + 41.0) * 0.1;
}
// Divergence-free flow: the curl of a scalar noise field.
fn curl(p : vec2<f32>) -> vec2<f32> {
	let e = 0.02;
	let dx = fbm(p + vec2<f32>(e, 0.0)) - fbm(p - vec2<f32>(e, 0.0));
	let dy = fbm(p + vec2<f32>(0.0, e)) - fbm(p - vec2<f32>(0.0, e));
	return vec2<f32>(dy, -dx) / (2.0 * e);
}

fn maskAt(cell : vec2<f32>, offset : u32) -> f32 {
	let w = i32(P.v[18].x);
	let h = i32(P.v[18].y);
	let c0 = vec2<i32>(floor(cell));
	let t = cell - floor(cell);
	var s = 0.0;
	for (var k = 0; k < 4; k++) {
		let o = vec2<i32>(k & 1, k >> 1);
		let c = c0 + o;
		var v = 0.0;
		if (c.x >= 0 && c.y >= 0 && c.x < w && c.y < h) {
			v = mask[offset + u32(c.y * w + c.x)];
		}
		let wx = select(1.0 - t.x, t.x, o.x == 1);
		let wy = select(1.0 - t.y, t.y, o.y == 1);
		s += v * wx * wy;
	}
	return s;
}

fn spawn(i : u32, idx : u32, birthFrac : f32) {
	let birthAge = birthFrac * P.v[1].z;
	let seed = u32(P.v[1].y);
	let shape = u32(P.v[4].x);
	let ex = P.v[4].y; let ey = P.v[4].z; let ew = P.v[4].w;
	let eh = P.v[5].x; let er = P.v[5].y;
	let r0 = rnd(idx, 0u, seed); let r1 = rnd(idx, 1u, seed);
	var pos = vec2<f32>(ex, ey);
	var center = vec2<f32>(ex, ey);
	if (shape == 1u) { pos = vec2<f32>(ex + ew * r0, ey + eh * r0); center = vec2<f32>(ex + ew * 0.5, ey + eh * 0.5); }
	else if (shape == 2u) { pos = vec2<f32>(ex + ew * r0, ey + eh * r1); center = vec2<f32>(ex + ew * 0.5, ey + eh * 0.5); }
	else if (shape == 3u) {
		let a = r0 * 6.2831853; let rr = er * sqrt(r1);
		pos = vec2<f32>(ex + cos(a) * rr, ey + sin(a) * rr);
	} else if (shape == 4u) {
		let a = r0 * 6.2831853;
		pos = vec2<f32>(ex + cos(a) * er, ey + sin(a) * er);
	}
	let radial = P.v[1].w > 0.5;
	var dir = P.v[6].x + (rnd(idx, 2u, seed) - 0.5) * P.v[6].y;
	if (radial) {
		let d = pos - center;
		if (dot(d, d) > 1e-6) { dir = atan2(d.y, d.x) + (rnd(idx, 2u, seed) - 0.5) * P.v[6].y; }
	}
	// A moving emitter: older births of the frame start nearer last frame's spot.
	if (P.v[30].z > 0.5) { pos += (P.v[30].xy - vec2<f32>(ex, ey)) * birthFrac; }
	let speed = mix(P.v[5].z, P.v[5].w, rnd(idx, 3u, seed));
	let vel = vec2<f32>(cos(dir), sin(dir)) * speed;
	var p : Particle;
	p.vel = vel;
	p.pos = pos + vel * birthAge;
	p.age = birthAge;
	p.life = mix(P.v[6].z, P.v[6].w, rnd(idx, 4u, seed));
	p.jitter = 1.0 - P.v[16].w * rnd(idx, 5u, seed);
	p._pad = 0.0;
	particles[i] = p;
}

@compute @workgroup_size(${WORKGROUP})
fn simulate(@builtin(global_invocation_id) gid : vec3<u32>) {
	let i = gid.x;
	let maxN = u32(P.v[1].x);
	if (i >= maxN) { return; }
	let dt = P.v[0].x;
	let time = P.v[0].y;
	let emitStart = u32(P.v[0].z);
	let emitCount = u32(P.v[0].w);
	let frameDt = P.v[1].z;

	if (emitCount > 0u) {
		let k = (i + maxN - (emitStart % maxN)) % maxN;
		if (k < emitCount) {
			// Births spread over the frame, oldest first.
			spawn(i, emitStart + k, 1.0 - (f32(k) + 0.5) / f32(emitCount));
			return;
		}
	}

	var p = particles[i];
	if (p.life <= 0.0) { return; }
	p.age += dt;
	if (p.age >= p.life) { p.life = 0.0; particles[i] = p; return; }

	var acc = vec2<f32>(P.v[2].z, P.v[2].w);
	let ns = P.v[3].y;
	if (ns != 0.0) {
		let sc = max(P.v[3].z, 1.0);
		acc += curl(p.pos / sc + vec2<f32>(time * P.v[3].w, time * P.v[3].w * 0.7)) * ns;
	}
	let nAttr = u32(P.v[7].w);
	for (var a = 0u; a < nAttr; a++) {
		let at = P.v[8u + a];
		let d = at.xy - p.pos;
		let dist = length(d) + 1e-3;
		let fall = exp(-(dist * dist) / max(at.w * at.w, 1.0));
		acc += d / dist * at.z * fall;
	}
	if (P.v[16].x > 0.5) {
		// Silhouette push: out along the gradient, harder where it just arrived.
		let comp = p.pos + P.v[18].zw;
		let cell = (comp - P.v[17].xy) / P.v[17].zw - 0.5;
		let cellCount = u32(P.v[18].x * P.v[18].y);
		let a0 = maskAt(cell, 0u);
		if (a0 > 0.02) {
			let gx = maskAt(cell + vec2<f32>(1.0, 0.0), 0u) - maskAt(cell - vec2<f32>(1.0, 0.0), 0u);
			let gy = maskAt(cell + vec2<f32>(0.0, 1.0), 0u) - maskAt(cell - vec2<f32>(0.0, 1.0), 0u);
			let g = vec2<f32>(gx, gy);
			let gl = length(g);
			if (gl > 1e-5) {
				let before = maskAt(cell, cellCount);
				let k = a0 * P.v[16].y + max(0.0, a0 - before) * P.v[16].z;
				acc -= g / gl * k;
			}
		}
	}

	p.vel += acc * dt;
	p.vel *= exp(-P.v[3].x * dt);
	p.pos += p.vel * dt;

	let w = P.v[2].x; let h = P.v[2].y;
	let floorY = P.v[7].y;
	let bounce = P.v[7].z;
	if (floorY >= 0.0 && p.pos.y > floorY) { p.pos.y = floorY; p.vel.y = -abs(p.vel.y) * bounce; p.vel.x *= 0.9; }
	let mode = u32(P.v[7].x);
	if (mode == 1u) {
		if (p.pos.x < 0.0 || p.pos.y < 0.0 || p.pos.x > w || p.pos.y > h) { p.life = 0.0; }
	} else if (mode == 2u) {
		if (p.pos.x < 0.0) { p.pos.x = 0.0; p.vel.x = abs(p.vel.x) * bounce; }
		if (p.pos.x > w) { p.pos.x = w; p.vel.x = -abs(p.vel.x) * bounce; }
		if (p.pos.y < 0.0) { p.pos.y = 0.0; p.vel.y = abs(p.vel.y) * bounce; }
		if (p.pos.y > h) { p.pos.y = h; p.vel.y = -abs(p.vel.y) * bounce; }
	} else if (mode == 3u) {
		p.pos = vec2<f32>(p.pos.x - floor(p.pos.x / w) * w, p.pos.y - floor(p.pos.y / h) * h);
	}
	particles[i] = p;
}
`;

const DRAW_WGSL = /* wgsl */ `
${COMMON_WGSL}
@group(0) @binding(0) var<uniform> P : Params;
@group(0) @binding(1) var<storage, read> particles : array<Particle>;

struct VOut {
	@builtin(position) pos : vec4<f32>,
	@location(0) uv : vec2<f32>,
	@location(1) color : vec4<f32>,
	@location(2) aspect : f32,
};

fn gradient(t : f32) -> vec4<f32> {
	let n = i32(P.v[21].x);
	if (n <= 1) { return P.v[22]; }
	let x = clamp(t, 0.0, 1.0) * f32(n - 1);
	let i = min(i32(floor(x)), n - 2);
	return mix(P.v[22 + i], P.v[23 + i], x - f32(i));
}

@vertex
fn vs(@builtin(vertex_index) vi : u32, @builtin(instance_index) ii : u32) -> VOut {
	var out : VOut;
	let p = particles[ii];
	if (p.life <= 0.0) {
		out.pos = vec4<f32>(2.0, 2.0, 0.0, 1.0);
		out.color = vec4<f32>(0.0);
		return out;
	}
	let t = p.age / p.life;
	let size = mix(P.v[19].x, P.v[19].y, t) * p.jitter;
	var corner = vec2<f32>(0.0);
	switch (vi) {
		case 0u: { corner = vec2<f32>(-1.0, -1.0); }
		case 1u: { corner = vec2<f32>(1.0, -1.0); }
		case 2u: { corner = vec2<f32>(-1.0, 1.0); }
		case 3u: { corner = vec2<f32>(-1.0, 1.0); }
		case 4u: { corner = vec2<f32>(1.0, -1.0); }
		default: { corner = vec2<f32>(1.0, 1.0); }
	}
	let speed = length(p.vel);
	var axisX = vec2<f32>(1.0, 0.0);
	var halfLen = size * 0.5;
	let shape = u32(P.v[20].x);
	if (shape == 3u && speed > 1e-3) {
		axisX = p.vel / speed;
		halfLen = size * 0.5 + speed * P.v[20].y * 0.5;
	}
	let axisY = vec2<f32>(-axisX.y, axisX.x);
	let local = axisX * corner.x * halfLen + axisY * corner.y * size * 0.5;
	let px = (p.pos + local) * P.v[21].yz;
	let tsize = P.v[2].xy * P.v[21].yz;
	out.pos = vec4<f32>(px.x / tsize.x * 2.0 - 1.0, 1.0 - px.y / tsize.y * 2.0, 0.0, 1.0);
	out.uv = corner;
	out.aspect = halfLen / max(size * 0.5, 1e-3);

	var c = gradient(t);
	if (P.v[20].z > 0.5) { c = gradient(speed / max(P.v[20].w, 1e-3)); }
	let fadeIn = max(P.v[19].z, 1e-4);
	let fadeOut = max(P.v[19].w, 1e-4);
	let a = c.a * smoothstep(0.0, fadeIn, t) * (1.0 - smoothstep(1.0 - fadeOut, 1.0, t)) * P.v[21].w;
	out.color = vec4<f32>(c.rgb * a, a);
	return out;
}

@fragment
fn fs(in : VOut) -> @location(0) vec4<f32> {
	let shape = u32(P.v[20].x);
	var m = 1.0;
	if (shape == 0u) {
		let d = length(in.uv);
		let e = max(fwidth(d), 1e-3);
		m = 1.0 - smoothstep(1.0 - e, 1.0, d);
	} else if (shape == 1u) {
		let d = length(in.uv);
		m = exp(-3.5 * d * d) * (1.0 - smoothstep(0.9, 1.0, d));
	} else if (shape == 3u) {
		// A capsule along the motion, soft at the sides.
		let ax = abs(in.uv.x) * in.aspect;
		let ex = max(ax - (in.aspect - 1.0), 0.0);
		let d = length(vec2<f32>(ex, in.uv.y));
		m = 1.0 - smoothstep(0.5, 1.0, d);
	}
	return in.color * m;
}
`;

interface SystemState {
	device: GPUDevice;
	particles: GPUBuffer;
	/** Frame the GPU buffer holds, relative to the layer's start; -1 = empty. */
	frame: number;
	/** Particles born so far (the next birth's index) and the fractional carry. */
	emitted: number;
	carry: number;
	snapshots: Map<number, { buffer: GPUBuffer; emitted: number; carry: number }>;
	maskBuffer: GPUBuffer | null;
	maskSize: number;
	ubo: GPUBuffer;
}

interface Pipelines {
	simLayout: GPUBindGroupLayout;
	sim: GPUComputePipeline;
	drawLayout: GPUBindGroupLayout;
	draw: Map<string, GPURenderPipeline>;
	drawModule: GPUShaderModule;
}

const pipelines = new WeakMap<GPUDevice, Pipelines>();

function getPipelines(device: GPUDevice): Pipelines {
	let p = pipelines.get(device);
	if (p) return p;
	const simLayout = device.createBindGroupLayout({
		label: "particles_sim_layout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "uniform" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "storage" },
			},
			{
				binding: 2,
				visibility: GPUShaderStage.COMPUTE,
				buffer: { type: "read-only-storage" },
			},
		],
	});
	const sim = device.createComputePipeline({
		label: "particles_sim",
		layout: device.createPipelineLayout({ bindGroupLayouts: [simLayout] }),
		compute: {
			module: device.createShaderModule({
				label: "particles_sim.wgsl",
				code: SIM_WGSL,
			}),
			entryPoint: "simulate",
		},
	});
	const drawLayout = device.createBindGroupLayout({
		label: "particles_draw_layout",
		entries: [
			{
				binding: 0,
				visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
				buffer: { type: "uniform" },
			},
			{
				binding: 1,
				visibility: GPUShaderStage.VERTEX,
				buffer: { type: "read-only-storage" },
			},
		],
	});
	p = {
		simLayout,
		sim,
		drawLayout,
		draw: new Map(),
		drawModule: device.createShaderModule({
			label: "particles_draw.wgsl",
			code: DRAW_WGSL,
		}),
	};
	pipelines.set(device, p);
	return p;
}

const BLENDS: Record<ParticleStatic["blend"], GPUBlendState> = {
	normal: {
		color: {
			srcFactor: "one",
			dstFactor: "one-minus-src-alpha",
			operation: "add",
		},
		alpha: {
			srcFactor: "one",
			dstFactor: "one-minus-src-alpha",
			operation: "add",
		},
	},
	add: {
		color: { srcFactor: "one", dstFactor: "one", operation: "add" },
		alpha: { srcFactor: "one", dstFactor: "one", operation: "add" },
	},
	screen: {
		color: { srcFactor: "one", dstFactor: "one-minus-src", operation: "add" },
		alpha: {
			srcFactor: "one",
			dstFactor: "one-minus-src-alpha",
			operation: "add",
		},
	},
};

function drawPipeline(
	device: GPUDevice,
	format: GPUTextureFormat,
	blend: ParticleStatic["blend"],
): GPURenderPipeline {
	const p = getPipelines(device);
	const key = `${format}|${blend}`;
	let pipe = p.draw.get(key);
	if (!pipe) {
		pipe = device.createRenderPipeline({
			label: `particles_draw_${blend}`,
			layout: device.createPipelineLayout({ bindGroupLayouts: [p.drawLayout] }),
			vertex: { module: p.drawModule, entryPoint: "vs" },
			fragment: {
				module: p.drawModule,
				entryPoint: "fs",
				targets: [{ format, blend: BLENDS[blend] }],
			},
			primitive: { topology: "triangle-list" },
		});
		p.draw.set(key, pipe);
	}
	return pipe;
}

const SHAPES = { circle: 0, soft: 1, square: 2, spark: 3 } as const;
const EMITTERS = { point: 0, line: 1, rect: 2, circle: 3, ring: 4 } as const;
const BOUNDS = { none: 0, kill: 1, bounce: 2, wrap: 3 } as const;

/** Packs static settings and one frame's inputs into the shared parameter block. */
function packParams(
	s: ParticleStatic,
	f: ParticleFrame,
	out: Float32Array,
	sim: {
		dt: number;
		time: number;
		emitStart: number;
		emitCount: number;
		frameDt: number;
	},
	view: { scaleX: number; scaleY: number },
): void {
	out.fill(0);
	const v = (i: number, a: number, b: number, c: number, d: number) =>
		out.set([a, b, c, d], i * 4);
	const deg = Math.PI / 180;
	v(0, sim.dt, sim.time, sim.emitStart, sim.emitCount);
	v(1, s.max, s.seed, sim.frameDt, s.emitter.radial ? 1 : 0);
	v(2, s.layer.width, s.layer.height, f.gravity[0], f.gravity[1]);
	v(3, f.drag, f.noise.strength, f.noise.scale, f.noise.speed);
	const e = s.emitter;
	const ex = f.emitter?.x ?? e.x;
	const ey = f.emitter?.y ?? e.y;
	v(4, EMITTERS[e.shape], ex, ey, e.width);
	if (f.emitter) v(30, f.emitter.previousX, f.emitter.previousY, 1, 0);
	v(5, e.height, e.radius, s.speed[0], s.speed[1]);
	v(6, s.direction * deg, s.spread * deg, s.lifetime[0], s.lifetime[1]);
	const attractors = f.attractors.slice(0, MAX_ATTRACTORS);
	v(7, BOUNDS[s.bounds], s.floor ?? -1, s.bounce, attractors.length);
	for (const [i, a] of attractors.entries()) {
		v(8 + i, a.x, a.y, a.strength, a.radius);
	}
	const m = f.push?.mask;
	v(16, m ? 1 : 0, f.push?.strength ?? 0, f.push?.sweep ?? 0, s.sizeJitter);
	v(17, m?.originX ?? 0, m?.originY ?? 0, m?.scaleX ?? 1, m?.scaleY ?? 1);
	v(18, m?.width ?? 0, m?.height ?? 0, s.layer.x, s.layer.y);
	v(19, s.size[0], s.size[1], s.fade[0], s.fade[1]);
	v(
		20,
		SHAPES[s.shape],
		s.stretch,
		s.colorBySpeed !== null ? 1 : 0,
		s.colorBySpeed ?? 1,
	);
	const colors = s.colors.slice(0, MAX_COLORS);
	v(21, colors.length, view.scaleX, view.scaleY, s.opacity);
	for (const [i, c] of colors.entries()) v(22 + i, c[0], c[1], c[2], c[3]);
}

function stateFor(program: ParticleProgram, device: GPUDevice): SystemState {
	const existing = program.particleState as SystemState | undefined;
	if (existing && existing.device === device) return existing;
	const s = program.particleStatic;
	const state: SystemState = {
		device,
		particles: device.createBuffer({
			label: "particles",
			size: s.max * PARTICLE_BYTES,
			usage:
				GPUBufferUsage.STORAGE |
				GPUBufferUsage.COPY_SRC |
				GPUBufferUsage.COPY_DST,
		}),
		frame: -1,
		emitted: 0,
		carry: 0,
		snapshots: new Map(),
		maskBuffer: null,
		maskSize: 0,
		ubo: device.createBuffer({
			label: "particles_params",
			size: PARAM_VEC4S * 16,
			usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
		}),
	};
	program.particleState = state;
	return state;
}

/** Uploads this frame's (and the previous frame's) silhouette; a 1-float buffer when there is none. */
function uploadMask(state: SystemState, f: ParticleFrame): GPUBuffer {
	const m = f.push?.mask;
	const cells = m ? m.width * m.height : 0;
	const size = Math.max(16, cells * 2 * 4);
	if (!state.maskBuffer || state.maskSize < size) {
		state.maskBuffer?.destroy();
		state.maskBuffer = state.device.createBuffer({
			label: "particles_mask",
			size,
			usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
		});
		state.maskSize = size;
	}
	if (m) {
		const both = new Float32Array(cells * 2);
		both.set(m.data.subarray(0, cells));
		both.set((f.push?.previous ?? m).data.subarray(0, cells), cells);
		state.device.queue.writeBuffer(state.maskBuffer, 0, both);
	}
	return state.maskBuffer;
}

/** Steps the system from the frame it holds to `frame` (layer-local), restoring a snapshot to go back. */
function advance(
	program: ParticleProgram,
	state: SystemState,
	frame: number,
	compositionStart: number,
	fps: number,
): void {
	const { device } = state;
	const s = program.particleStatic;
	if (frame < state.frame || state.frame < 0) {
		let best = -1;
		for (const k of state.snapshots.keys())
			if (k <= frame && k > best) best = k;
		const encoder = device.createCommandEncoder({ label: "particles_restore" });
		if (best >= 0) {
			const snap = state.snapshots.get(best) as {
				buffer: GPUBuffer;
				emitted: number;
				carry: number;
			};
			encoder.copyBufferToBuffer(
				snap.buffer,
				0,
				state.particles,
				0,
				s.max * PARTICLE_BYTES,
			);
			state.emitted = snap.emitted;
			state.carry = snap.carry;
			state.frame = best;
		} else {
			encoder.clearBuffer(state.particles);
			state.emitted = 0;
			state.carry = 0;
			state.frame = -1;
		}
		device.queue.submit([encoder.finish()]);
	}

	const p = getPipelines(device);
	const params = new Float32Array(PARAM_VEC4S * 4);
	const substeps = Math.max(1, Math.round(s.substeps));
	const frameDt = 1 / fps;
	const prewarmFrames = Math.round(s.prewarm * fps);

	// state.frame = -1 means "before the first frame": prewarm first, then frame 0.
	for (let f = state.frame + 1; f <= frame; f++) {
		const steps = f === 0 ? prewarmFrames + 1 : 1;
		for (let w = 0; w < steps; w++) {
			const simFrame = f === 0 ? w - prewarmFrames : f;
			const inputs = program.particleFrame(
				compositionStart + Math.max(0, simFrame),
				fps,
			);
			state.carry += Math.max(0, inputs.rate) * frameDt;
			let born = Math.floor(state.carry);
			state.carry -= born;
			born += Math.max(0, Math.round(inputs.burst));
			born = Math.min(born, s.max);
			const mask = uploadMask(state, inputs);
			const bindGroup = device.createBindGroup({
				layout: p.simLayout,
				entries: [
					{ binding: 0, resource: { buffer: state.ubo } },
					{ binding: 1, resource: { buffer: state.particles } },
					{ binding: 2, resource: { buffer: mask } },
				],
			});
			// One submit per substep: queue writes are ordered with submits, so
			// each substep reads its own parameters.
			for (let k = 0; k < substeps; k++) {
				packParams(
					s,
					inputs,
					params,
					{
						dt: frameDt / substeps,
						time: (simFrame + k / substeps) * frameDt,
						emitStart: state.emitted,
						emitCount: k === 0 ? born : 0,
						frameDt,
					},
					{ scaleX: 1, scaleY: 1 },
				);
				device.queue.writeBuffer(state.ubo, 0, params);
				const encoder = device.createCommandEncoder({
					label: "particles_step",
				});
				const pass = encoder.beginComputePass({ label: "particles_sim" });
				pass.setPipeline(p.sim);
				pass.setBindGroup(0, bindGroup);
				pass.dispatchWorkgroups(Math.ceil(s.max / WORKGROUP));
				pass.end();
				device.queue.submit([encoder.finish()]);
			}
			state.emitted += born;
		}
		state.frame = f;
		if (
			f % SNAPSHOT_EVERY === 0 &&
			!state.snapshots.has(f) &&
			state.snapshots.size < MAX_SNAPSHOTS
		) {
			const buffer = device.createBuffer({
				label: `particles_snapshot_${f}`,
				size: s.max * PARTICLE_BYTES,
				usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
			});
			const encoder = device.createCommandEncoder({
				label: "particles_snapshot",
			});
			encoder.copyBufferToBuffer(
				state.particles,
				0,
				buffer,
				0,
				s.max * PARTICLE_BYTES,
			);
			device.queue.submit([encoder.finish()]);
			state.snapshots.set(f, {
				buffer,
				emitted: state.emitted,
				carry: state.carry,
			});
		}
	}
}

export const ParticlesWebGPURenderer: WebGPUNodeRenderer = async (args) => {
	const { ctx, encoder, pass, targetView, targetWidth, targetHeight, props } =
		args;
	const op = props.virtualMedia?.operation as
		| { op?: string; effect?: unknown }
		| undefined;
	if (op?.op !== "Particles" || !isParticleProgram(op.effect)) return;
	const program = op.effect;
	const s = program.particleStatic;

	const fps = props.fps || 30;
	const local = Math.max(0, Math.round(props.frame ?? 0));
	const compositionFrame = Math.round(props.compositionFrame ?? local);
	const compositionStart = compositionFrame - local;

	// Simulation runs in its own submissions, ahead of this frame's draw.
	const state = stateFor(program, ctx.device);
	advance(program, state, local, compositionStart, fps);

	pass.end();
	const params = new Float32Array(PARAM_VEC4S * 4);
	packParams(
		s,
		program.particleFrame(compositionFrame, fps),
		params,
		{ dt: 0, time: 0, emitStart: 0, emitCount: 0, frameDt: 1 / fps },
		{
			scaleX: targetWidth / s.layer.width,
			scaleY: targetHeight / s.layer.height,
		},
	);
	const ubo = ctx.renderer.getTemporaryBuffer(params);
	const draw = ctx.renderer.beginFrame(
		encoder,
		targetView,
		{ r: 0, g: 0, b: 0, a: 0 },
		targetWidth,
		targetHeight,
		"load",
	);
	draw.setPipeline(drawPipeline(ctx.device, ctx.renderer.format, s.blend));
	draw.setBindGroup(
		0,
		ctx.device.createBindGroup({
			layout: getPipelines(ctx.device).drawLayout,
			entries: [
				{ binding: 0, resource: { buffer: ubo } },
				{ binding: 1, resource: { buffer: state.particles } },
			],
		}),
	);
	draw.draw(6, s.max);
	draw.end();
};

export type { ParticleMask };
