/**
 * The zoom: one continuous dive from the stars, through an atom's electron
 * cloud, to its nucleus, and on into the vacuum. `depth` is the logarithm of
 * the magnification, so a steady change in it is a steady zoom.
 *
 * The atom is drawn as what quantum mechanics says it is, a cloud of places
 * the electron might be found, and the nucleus as a ray-marched cluster of
 * protons and neutrons. The real nucleus is about 100,000 times smaller than
 * its atom; here it is a few hundred times smaller, so the dive takes seconds.
 *
 * Uniforms: depth, exposure.
 */
import { COMMON } from "./common.js";

/** Depth at which the atom, then the nucleus, fills the frame. */
export const ATOM_DEPTH = 3;
export const NUCLEUS_DEPTH = 8.2;
/** Depth by which only the vacuum is left. */
export const VACUUM_DEPTH = 11.6;

export const JOURNEY_UNIFORMS = { depth: 0, exposure: 1 };

export const JOURNEY = /* wgsl */ `${COMMON}
const ATOM_AT : f32 = ${ATOM_DEPTH.toFixed(1)};
const NUCLEUS_AT : f32 = ${NUCLEUS_DEPTH.toFixed(1)};
const VACUUM_AT : f32 = ${VACUUM_DEPTH.toFixed(1)};
/** The cloud's radius, and the nucleus's, in frame heights at magnification 1. */
const ATOM_SIZE : f32 = 0.3;
const NUCLEUS_SIZE : f32 = 0.2;
const NUCLEON : f32 = 0.43;

/** Twelve nucleons on an icosahedron and one in the middle. */
const NUCLEONS = array<vec3<f32>, 13>(
	vec3<f32>(0.0, 0.0, 0.0),
	vec3<f32>(0.0, 0.526, 0.851), vec3<f32>(0.0, -0.526, 0.851),
	vec3<f32>(0.0, 0.526, -0.851), vec3<f32>(0.0, -0.526, -0.851),
	vec3<f32>(0.526, 0.851, 0.0), vec3<f32>(-0.526, 0.851, 0.0),
	vec3<f32>(0.526, -0.851, 0.0), vec3<f32>(-0.526, -0.851, 0.0),
	vec3<f32>(0.851, 0.0, 0.526), vec3<f32>(-0.851, 0.0, 0.526),
	vec3<f32>(0.851, 0.0, -0.526), vec3<f32>(-0.851, 0.0, -0.526),
);

/** 0 for a proton, 1 for a neutron: seven and six, mixed. */
const KINDS = array<f32, 13>(0.0, 1.0, 0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 0.0, 1.0, 1.0, 0.0);

fn turn(a : f32) -> mat2x2<f32> {
	let c = cos(a);
	let s = sin(a);
	return mat2x2<f32>(c, s, -s, c);
}

/** How likely the electron is at \`a\` (in cloud radii): a dense core, a shell and two lobes. */
fn cloud(a : vec2<f32>) -> f32 {
	let r = length(a);
	let core = exp(-r * 7.0);
	let shell = 0.5 * exp(-pow((r - 0.62) / 0.2, 2.0));
	let lobes = 0.55 * pow(abs(a.y) / max(r, 0.001), 2.0) * exp(-pow((r - 0.4) / 0.17, 2.0));
	return core + shell + lobes;
}

/** The electron cloud at magnification \`k\`: a glow, and the dots where it might be. */
fn atom(p : vec2<f32>, k : f32) -> vec3<f32> {
	let a = turn(0.12 * u.time) * p / (ATOM_SIZE * k);
	let density = cloud(a);
	// Seen from afar the atom is one fuzzy point; up close it thins into dots.
	let near = smoothstep(0.03, 0.5, k);
	var light = vec3<f32>(0.07, 0.26, 1.0) * density * mix(2.6, 0.55, near) / (1.0 + 0.6 * k);
	// Closer in, the same cloud is mostly empty space.
	let thin = mix(1.0, 0.12, smoothstep(1.3, 6.0, k));
	for (var layer = 0; layer < 3; layer++) {
		let grid = 46.0 * (1.0 + 0.6 * f32(layer));
		let g = a * grid + vec2<f32>(11.0 * f32(layer));
		let cell = floor(g);
		// Each spot blinks on for a moment, more often where the cloud is dense.
		let tick = floor(u.time * (3.0 + f32(layer)) + 7.0 * hash21(cell));
		let seed = hash22(cell + tick * 0.618 + 31.0 * f32(layer));
		let chance = cloud((cell + 0.5 - vec2<f32>(11.0 * f32(layer))) / grid);
		if (seed.x < chance * 0.75 * thin) {
			let d = length(fract(g) - 0.5 - (seed - 0.5) * 0.5) / grid * ATOM_SIZE * k;
			let size = 0.0022 + 0.0012 * f32(layer);
			light += near * vec3<f32>(0.22, 0.52, 1.0) * exp(-d * d / (size * size)) * 0.9;
		}
	}
	return light * (1.0 - smoothstep(3.0, 16.0, k));
}

struct Surface {
	distance : f32,
	center : vec3<f32>,
	kind : f32,
}

/** The nearest nucleon to \`q\`, each jostling a little. */
fn nucleus(q : vec3<f32>) -> Surface {
	var best = Surface(1e9, vec3<f32>(0.0), 0.0);
	for (var i = 0; i < 13; i++) {
		let f = f32(i);
		let wobble = 0.035 * vec3<f32>(sin(u.time * 2.3 + f * 1.7), sin(u.time * 1.9 + f * 2.9), sin(u.time * 2.7 + f * 0.9));
		let center = NUCLEONS[i] * 0.66 + wobble;
		let d = length(q - center) - NUCLEON;
		if (d < best.distance) {
			// Protons and neutrons, mixed.
			best = Surface(d, center, KINDS[i]);
		}
	}
	return best;
}

/** The nucleus at magnification \`k\`; alpha is its coverage. */
fn nucleons(p : vec2<f32>, k : f32) -> vec4<f32> {
	let n = p / (NUCLEUS_SIZE * k);
	let reach = length(n);
	let halo = vec3<f32>(1.0, 0.5, 0.25) * 0.16 * exp(-max(reach - 1.0, 0.0) * 3.5) * smoothstep(0.0, 0.3, k);
	if (reach > 1.25) { return vec4<f32>(halo, 0.0); }

	let spinY = turn(0.25 * u.time + 0.6);
	let spinX = turn(0.35);
	var origin = vec3<f32>(n, 3.0);
	var ray = vec3<f32>(0.0, 0.0, -1.0);
	let oyz = spinX * origin.yz;
	let ryz = spinX * ray.yz;
	origin = vec3<f32>(origin.x, oyz.x, oyz.y);
	ray = vec3<f32>(ray.x, ryz.x, ryz.y);
	let oxz = spinY * origin.xz;
	let rxz = spinY * ray.xz;
	origin = vec3<f32>(oxz.x, origin.y, oxz.y);
	ray = vec3<f32>(rxz.x, ray.y, rxz.y);

	var travelled = 1.4;
	var surface = Surface(1e9, vec3<f32>(0.0), 0.0);
	var found = false;
	for (var i = 0; i < 40; i++) {
		surface = nucleus(origin + ray * travelled);
		if (surface.distance < 0.002) { found = true; break; }
		travelled += surface.distance;
		if (travelled > 4.6) { break; }
	}
	if (!found) { return vec4<f32>(halo, 0.0); }

	let at = origin + ray * travelled;
	let normal = normalize(at - surface.center);
	let key = normalize(vec3<f32>(0.5, 0.7, 0.55));
	let fill = normalize(vec3<f32>(-0.7, -0.2, 0.4));
	// Neighbours shade each other: sample the field a little off the surface.
	let open = clamp(nucleus(at + normal * 0.22).distance / 0.22, 0.0, 1.0);
	let base = mix(vec3<f32>(0.95, 0.16, 0.07), vec3<f32>(0.12, 0.3, 0.9), surface.kind);
	let rim = pow(1.0 - max(dot(normal, -ray), 0.0), 3.0);
	let shine = pow(max(dot(reflect(-key, normal), -ray), 0.0), 40.0);
	var light = base * (0.035 + 0.85 * max(dot(normal, key), 0.0) * (0.25 + 0.75 * open));
	light += base * 0.16 * max(dot(normal, fill), 0.0) * open;
	light += mix(vec3<f32>(1.0, 0.7, 0.45), vec3<f32>(0.6, 0.8, 1.0), surface.kind) * rim * 0.4;
	light += vec3<f32>(1.0) * shine * 0.55 * open;
	return vec4<f32>(light, 1.0);
}

fn shade(uv : vec2<f32>) -> vec4<f32> {
	let p = turn(0.03 * u.depth) * centered(uv);
	let atomScale = exp(u.depth - ATOM_AT);
	let nucleusScale = exp(u.depth - NUCLEUS_AT);

	// The stars slide outward and dim as the frame closes in on one point.
	let dir = normalize(vec3<f32>(p / (1.0 + 0.5 * u.depth), 1.5));
	var light = sky(dir) * (1.0 - smoothstep(0.6, ATOM_AT, u.depth));

	let deep = smoothstep(NUCLEUS_AT + 0.6, VACUUM_AT, u.depth);
	light += vacuum(p, 2.2) * smoothstep(ATOM_AT + 1.5, NUCLEUS_AT, u.depth);
	light += atom(p, atomScale);

	if (nucleusScale > 0.004) {
		let body = nucleons(p, nucleusScale);
		// Far away it is a spark at the atom's heart.
		let spark = vec3<f32>(1.0, 0.7, 0.5) * exp(-dot(p, p) / 0.00003) * 3.0 * (1.0 - smoothstep(0.03, 0.12, nucleusScale));
		let fade = 1.0 - deep;
		light = mix(light, body.rgb, body.a * fade) + (body.rgb * (1.0 - body.a) + spark) * fade;
	}
	return display(light * u.exposure, uv);
}
`;
