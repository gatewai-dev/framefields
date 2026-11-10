/**
 * A Schwarzschild black hole, ray traced. Every pixel's light ray is bent by
 * integrating the exact photon equation for that metric (in units of the
 * horizon radius, a = -3/2 h² x / r⁵ with h the ray's angular momentum), so
 * the shadow, the photon ring, the lensed sky and the far side of the disk
 * folded over the top all come out of the geometry, not a painting.
 *
 * The disk is thin, orbits at Keplerian speed, and is beamed and shifted by
 * its motion and by gravity, which is why the approaching side is brighter.
 * The Hawking glow and the particles streaming away are, of course, not to
 * scale: the real thing is far too faint to see.
 *
 * Uniforms: camDist, camIncl, camAz, roll, focal, offX, offY (camera, in
 * horizon radii and radians), rs (the hole's size; 0 removes it), disk, glow,
 * heat, particles, flash, stars, exposure.
 */
import { COMMON } from "./common.js";

export const BLACK_HOLE_UNIFORMS = {
	camDist: 30,
	camIncl: 0.12,
	camAz: 0,
	roll: 0,
	focal: 1.6,
	offX: 0,
	offY: 0,
	rs: 1,
	disk: 1,
	glow: 0,
	heat: 0,
	particles: 0,
	flash: 0,
	stars: 1,
	exposure: 1,
};

export type BlackHoleUniform = keyof typeof BLACK_HOLE_UNIFORMS;

export const BLACK_HOLE = /* wgsl */ `${COMMON}
const STEPS : i32 = 320;
/** The disk, from the innermost stable orbit outward, in horizon radii. */
const DISK_IN : f32 = 3.0;
const DISK_OUT : f32 = 13.0;
/** The impact parameter below which light is captured: 3√3/2 horizon radii. */
const CRITICAL : f32 = 2.5980762;

/** Light the disk sends along \`toEye\` from the point \`at\` on it; alpha is how opaque it is there. */
fn diskLight(at : vec3<f32>, toEye : vec3<f32>) -> vec4<f32> {
	let r = length(at.xz);
	let phi = atan2(at.z, at.x);
	let edge = smoothstep(DISK_IN, DISK_IN + 0.5, r) * (1.0 - smoothstep(DISK_OUT * 0.45, DISK_OUT, r));
	if (edge <= 0.0) { return vec4<f32>(0.0); }

	// Gas nearer the hole orbits faster, which winds the texture into streaks.
	let turn = phi - 2.2 * pow(r, -1.5) * u.time;
	let ring = vec3<f32>(cos(turn), sin(turn), 0.0);
	let streaks = fbm3(vec3<f32>(ring.x * 1.6, ring.y * 1.6, r * 3.4));
	let clumps = fbm3(vec3<f32>(ring.x * 4.5 + 9.0, ring.y * 4.5, r * 0.9));
	let density = edge * (0.12 + 1.9 * pow(streaks, 2.2)) * (0.45 + 1.1 * clumps);

	// Motion toward the eye brightens and blues the gas; climbing out of the well reddens it.
	let speed = sqrt(0.5 / (r - 1.0));
	let orbit = vec3<f32>(-sin(phi), 0.0, cos(phi));
	let lorentz = 1.0 / sqrt(1.0 - speed * speed);
	let doppler = 1.0 / (lorentz * (1.0 - speed * dot(orbit, toEye)));
	let shift = doppler * sqrt(1.0 - 1.0 / r);

	let temperature = pow(DISK_IN / r, 0.75);
	let color = heatColor(0.04 + 0.5 * temperature * shift);
	let power = pow(shift, 3.5) * pow(temperature, 2.6) * 3.2;
	return vec4<f32>(color * power * density, clamp(density * 0.85, 0.0, 0.96));
}

/** Particles leaving the hole, drawn in screen space around its shadow of radius \`shadow\`. */
fn radiation(p : vec2<f32>, shadow : f32) -> vec3<f32> {
	if (u.particles <= 0.0) { return vec3<f32>(0.0); }
	let angle = atan2(p.y, p.x);
	var light = 0.0;
	for (var layer = 0; layer < 2; layer++) {
		let count = 40.0 + 34.0 * f32(layer);
		let cell = floor((angle / TAU + 0.5) * count);
		for (var k = -2; k <= 2; k++) {
			let slot = cell + f32(k);
			// The same particle on both sides of the seam at ±π.
			let id = slot - count * floor(slot / count);
			for (var n = 0; n < 2; n++) {
				let seed = hash22(vec2<f32>(id + 131.0 * f32(layer), 7.0 + 3.0 * f32(n)));
				if (seed.x > u.particles) { continue; }
				let speed = (0.05 + 0.07 * seed.y) * (1.0 + 2.5 * u.heat);
				let life = fract(u.time * speed + hash11(id * 3.1 + f32(n) * 17.0 + 5.0 * f32(layer)));
				let radius = shadow * (1.0 + 0.1 * seed.y) + life * (0.3 + 0.55 * seed.y);
				let at = ((slot + 0.5 + (seed.y - 0.5) * 0.8) / count - 0.5) * TAU;
				let d = length(p - radius * vec2<f32>(cos(at), sin(at)));
				let size = 0.0022 + 0.0022 * hash11(id * 9.7 + f32(n));
				let fade = smoothstep(0.0, 0.05, life) * pow(1.0 - life, 1.5);
				light += fade * exp(-d * d / (size * size));
			}
		}
	}
	return light * 2.2 * mix(vec3<f32>(1.0, 0.74, 0.38), vec3<f32>(0.82, 0.9, 1.0), u.heat);
}

fn shade(uv : vec2<f32>) -> vec4<f32> {
	let p = centered(uv) - vec2<f32>(u.offX, u.offY);

	// The camera orbits the origin; the disk lies in the plane y = 0.
	let eye = u.camDist * vec3<f32>(cos(u.camIncl) * sin(u.camAz), sin(u.camIncl), cos(u.camIncl) * cos(u.camAz));
	let forward = normalize(-eye);
	let side = normalize(cross(forward, vec3<f32>(0.0, 1.0, 0.0)));
	let above = cross(side, forward);
	let right = side * cos(u.roll) + above * sin(u.roll);
	let up = above * cos(u.roll) - side * sin(u.roll);
	let ray = normalize(forward * u.focal + right * p.x + up * p.y);

	// Whether a ray is captured is known exactly, without tracing it: it falls in
	// when its impact parameter is under the critical 3√3/2 horizon radii. Using
	// that, and how fast it changes across a pixel, gives the shadow a true,
	// anti-aliased edge; rays right at it circle the hole for longer than any
	// step budget, so counting on the trace there leaves a ragged rim.
	let start = eye / max(u.rs, 0.002);
	let turnAt = cross(start, ray);
	let reach = length(start);
	let impact = inverseSqrt(max(1.0 / dot(turnAt, turnAt) - 1.0 / (reach * reach * reach), 1e-9));
	let inward = step(dot(start, ray), 0.0) * step(0.002, u.rs);
	let pixel = max(fwidth(impact), 1e-5);
	let escapes = mix(1.0, smoothstep(-pixel, pixel, impact - CRITICAL), inward);

	var light = vec3<f32>(0.0);
	var through = 1.0;
	var halo = 0.0;
	var haze = 0.0;
	var out = ray;

	if (u.rs > 0.002) {
		// Work in horizon radii: a smaller hole is the same hole seen from further away.
		var x = start;
		var v = ray;
		let spin = cross(x, v);
		let h2 = dot(spin, spin);
		let far = max(length(x) * 1.05, 24.0);
		for (var i = 0; i < STEPS; i++) {
			let r2 = dot(x, x);
			let r = sqrt(r2);
			if (r < 1.0) { break; }
			if (r > far && dot(x, v) > 0.0) { break; }
			let dt = clamp(0.07 * (r - 0.55), 0.012, 1.6);
			v += -1.5 * h2 * x / (r2 * r2 * r) * dt;
			let next = x + v * dt;
			if (u.disk > 0.0 && x.y * next.y < 0.0) {
				let hit = mix(x, next, x.y / (x.y - next.y));
				let lit = diskLight(hit, normalize(-v));
				light += through * lit.rgb * u.disk;
				through *= 1.0 - lit.a * min(u.disk, 1.0);
			}
			halo += (exp(-(r - 1.0) * 5.0) + 0.1 * exp(-(r - 1.0) * 1.1)) * dt;
			// Light scattered by thin gas above and below the disk: a soft bloom around it.
			let flat = length(x.xz);
			haze += exp(-abs(x.y) * 2.6) * smoothstep(DISK_IN - 0.6, DISK_IN + 1.0, flat) * exp(-flat * 0.42) * through * dt;
			x = next;
		}
		out = normalize(v);
	}

	light += through * escapes * sky(out) * u.stars;
	// Rays that graze the hole gather the most glow, which draws its bright rim.
	light += escapes * heatColor(u.heat) * (1.0 - exp(-halo * 1.4)) * u.glow;
	light += vec3<f32>(1.0, 0.55, 0.22) * haze * 0.16 * u.disk;

	let shadow = u.focal * 2.6 * u.rs / u.camDist;
	light += radiation(p, shadow);
	let d2 = dot(p, p);
	light += u.flash * (vec3<f32>(1.0, 0.96, 0.9) * (5.0 * exp(-d2 * 9.0) + 0.22) + vec3<f32>(0.5, 0.65, 1.0) * exp(-d2 * 1.2));
	return display(light * u.exposure, uv);
}
`;
