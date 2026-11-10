/**
 * WGSL shared by the film's three shaders: hashes, value noise, a star field
 * looked up by direction, a blackbody-like ramp and the display transform.
 */
export const COMMON = /* wgsl */ `
const PI : f32 = 3.14159265;
const TAU : f32 = 6.2831853;

fn hash11(n : f32) -> f32 {
	var x = fract(n * 0.1031);
	x *= x + 33.33;
	x *= x + x;
	return fract(x);
}
fn hash21(p : vec2<f32>) -> f32 {
	var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}
fn hash22(p : vec2<f32>) -> vec2<f32> {
	var q = fract(vec3<f32>(p.x, p.y, p.x) * vec3<f32>(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yzx + 33.33);
	return fract((q.xx + q.yz) * q.zy);
}
fn hash31(p : vec3<f32>) -> f32 {
	var q = fract(p * 0.1031);
	q += dot(q, q.zyx + 31.32);
	return fract((q.x + q.y) * q.z);
}
fn hash33(p : vec3<f32>) -> vec3<f32> {
	var q = fract(p * vec3<f32>(0.1031, 0.1030, 0.0973));
	q += dot(q, q.yxz + 33.33);
	return fract((q.xxy + q.yxx) * q.zyx);
}

fn noise3(p : vec3<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let w = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(
			mix(hash31(i), hash31(i + vec3<f32>(1.0, 0.0, 0.0)), w.x),
			mix(hash31(i + vec3<f32>(0.0, 1.0, 0.0)), hash31(i + vec3<f32>(1.0, 1.0, 0.0)), w.x),
			w.y,
		),
		mix(
			mix(hash31(i + vec3<f32>(0.0, 0.0, 1.0)), hash31(i + vec3<f32>(1.0, 0.0, 1.0)), w.x),
			mix(hash31(i + vec3<f32>(0.0, 1.0, 1.0)), hash31(i + vec3<f32>(1.0, 1.0, 1.0)), w.x),
			w.y,
		),
		w.z,
	);
}
fn fbm3(p : vec3<f32>) -> f32 {
	var q = p;
	var sum = 0.0;
	var amp = 0.5;
	for (var i = 0; i < 4; i++) {
		sum += amp * noise3(q);
		q = q * 2.03 + vec3<f32>(17.1, 3.7, 9.2);
		amp *= 0.5;
	}
	return sum;
}

/** One octave of stars: a jittered point per cell of a grid the direction passes through. */
fn starLayer(dir : vec3<f32>, cells : f32, keep : f32) -> vec3<f32> {
	let p = dir * cells;
	let cell = floor(p);
	var light = vec3<f32>(0.0);
	for (var z = -1; z <= 1; z++) {
		for (var y = -1; y <= 1; y++) {
			for (var x = -1; x <= 1; x++) {
				let c = cell + vec3<f32>(f32(x), f32(y), f32(z));
				let seed = hash33(c);
				if (seed.x > keep) { continue; }
				// Stars sit on the unit sphere, so only cells it crosses are lit.
				let star = normalize(c + 0.15 + seed.yzx * 0.7) * cells;
				let d = length(p - star);
				let size = 0.014 + 0.034 * seed.y * seed.y * seed.y;
				let glow = exp(-d * d / (size * size));
				let tint = mix(vec3<f32>(1.0, 0.82, 0.66), vec3<f32>(0.72, 0.84, 1.0), seed.z);
				light += tint * glow * (0.5 + 3.5 * seed.y * seed.y * seed.y);
			}
		}
	}
	return light;
}

/** The sky in direction \`dir\`: three octaves of stars and a faint band of dust. */
fn sky(dir : vec3<f32>) -> vec3<f32> {
	var light = starLayer(dir, 34.0, 0.1) * 1.4;
	light += starLayer(dir, 71.0, 0.12) * 0.8;
	light += starLayer(dir, 143.0, 0.16) * 0.5;
	// A tilted band, like a galaxy seen edge-on.
	let axis = normalize(vec3<f32>(0.35, 0.9, 0.25));
	let band = exp(-pow(dot(dir, axis) * 3.2, 2.0));
	let dust = fbm3(dir * 3.1 + vec3<f32>(4.0, 1.0, 7.0));
	let fine = fbm3(dir * 9.0);
	light += band * dust * dust * (0.35 + fine) * vec3<f32>(0.035, 0.045, 0.085);
	light += band * pow(dust, 4.0) * vec3<f32>(0.1, 0.05, 0.04);
	return light;
}

/** Glow color from cool (0, deep red) to hot (1, blue-white). */
fn heatColor(t : f32) -> vec3<f32> {
	let x = clamp(t, 0.0, 1.0) * 4.0;
	let c0 = vec3<f32>(0.85, 0.1, 0.02);
	let c1 = vec3<f32>(1.0, 0.42, 0.1);
	let c2 = vec3<f32>(1.0, 0.8, 0.5);
	let c3 = vec3<f32>(0.95, 0.96, 1.0);
	let c4 = vec3<f32>(0.62, 0.78, 1.0);
	if (x < 1.0) { return mix(c0, c1, x); }
	if (x < 2.0) { return mix(c1, c2, x - 1.0); }
	if (x < 3.0) { return mix(c2, c3, x - 2.0); }
	return mix(c3, c4, x - 3.0);
}

/** Scene light to display: filmic roll-off, gamma, and a dither against banding. */
fn display(light : vec3<f32>, uv : vec2<f32>) -> vec4<f32> {
	let x = max(light, vec3<f32>(0.0));
	let mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
	let encoded = pow(clamp(mapped, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
	let dither = (hash21(uv * u.resolution + vec2<f32>(u.frame * 1.7, 0.0)) - 0.5) / 255.0;
	return vec4<f32>(encoded + dither, 1.0);
}

/** The restless vacuum behind everything small: slow dark ripples and pinprick flickers. */
fn vacuum(p : vec2<f32>, scale : f32) -> vec3<f32> {
	let q = p * scale;
	let slow = fbm3(vec3<f32>(q * 0.9, u.time * 0.22));
	let quick = fbm3(vec3<f32>(q * 2.6 + vec2<f32>(5.0, 2.0), u.time * 0.45));
	var light = vec3<f32>(0.004, 0.006, 0.014);
	light += pow(slow, 3.0) * vec3<f32>(0.035, 0.07, 0.2);
	light += pow(quick, 4.0) * vec3<f32>(0.14, 0.05, 0.22);
	let cell = floor(q * 26.0);
	let tick = floor(u.time * 7.0 + 9.0 * hash21(cell));
	let spark = step(0.992, hash21(cell + tick * 0.37));
	let d = length(fract(q * 26.0) - vec2<f32>(0.5));
	light += spark * exp(-d * d * 60.0) * vec3<f32>(0.35, 0.5, 0.9);
	return light;
}

/** Centered coordinates with y up, one unit per frame height. */
fn centered(uv : vec2<f32>) -> vec2<f32> {
	return (uv - vec2<f32>(0.5)) * vec2<f32>(u.resolution.x / u.resolution.y, -1.0);
}
`;
