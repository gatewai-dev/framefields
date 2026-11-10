/**
 * The vacuum up close: pairs of particles that appear, drift apart and
 * annihilate, in three depths. Raise `horizon` and the edge of a black hole
 * climbs into the frame; pairs born just above it (as many as `stream`
 * allows) no longer meet again: one partner falls in, the other escapes.
 *
 * This is the picture Hawking himself offered as a heuristic, not a literal
 * film of what happens; the narration says so.
 *
 * The hero pair is placed by the film (`heroGold*`, `heroBlue*`, in frame
 * heights from the center, y up) so labels can follow it.
 *
 * `focus` pulls focus onto the hero pair: everything behind it goes soft
 * and dim, as through a lens focused on the pair.
 *
 * Uniforms: zoom, pairs, horizon, stream, hero, heroGoldX, heroGoldY,
 * heroBlueX, heroBlueY, link, focus, stars, field, exposure.
 */
import { COMMON } from "./common.js";

export const QUANTUM_UNIFORMS = {
	zoom: 1,
	pairs: 0.5,
	horizon: 0,
	stream: 0,
	hero: 0,
	heroGoldX: 0,
	heroGoldY: 0,
	heroBlueX: 0,
	heroBlueY: 0,
	link: 0,
	focus: 0,
	stars: 0.25,
	field: 1,
	exposure: 1,
};

/** The horizon's radius, and where its top sits when down and when fully risen, in frame heights. */
export const HORIZON_RADIUS = 3.2;
export const HORIZON_TOP = { down: -0.95, up: -0.2 };

export const QUANTUM = /* wgsl */ `${COMMON}
const HORIZON_R : f32 = ${HORIZON_RADIUS.toFixed(2)};
const GOLD : vec3<f32> = vec3<f32>(1.0, 0.62, 0.2);
const BLUE : vec3<f32> = vec3<f32>(0.22, 0.52, 1.0);

/** A particle out of focus: a wide, faint disc of light with a soft edge. */
fn bokeh(delta : vec2<f32>, r : f32, tint : vec3<f32>) -> vec3<f32> {
	let x = length(delta) / (r * 3.4);
	return tint * 0.13 * (1.0 - smoothstep(0.55, 1.0, x)) * (0.8 + 0.2 * x);
}

/** A small glowing sphere of radius \`r\`, \`delta\` away. */
fn ball(delta : vec2<f32>, r : f32, tint : vec3<f32>) -> vec3<f32> {
	let x = length(delta) / r;
	let glow = tint * (0.5 * exp(-x * x * 0.3) + 0.1 * exp(-x * 0.8));
	if (x >= 1.0) { return glow; }
	let normal = vec3<f32>(delta / r, sqrt(1.0 - x * x));
	let key = normalize(vec3<f32>(-0.45, 0.6, 0.66));
	let lit = 0.5 + 0.8 * max(dot(normal, key), 0.0);
	let shine = pow(max(dot(reflect(-key, normal), vec3<f32>(0.0, 0.0, 1.0)), 0.0), 26.0);
	let body = tint * lit * 1.25 + vec3<f32>(shine * 0.8);
	return mix(glow, body + glow * 0.4, smoothstep(1.0, 0.88, x));
}

/** How close \`p\` is to the segment a–b, as a soft line of width \`w\`. */
fn thread(p : vec2<f32>, a : vec2<f32>, b : vec2<f32>, w : f32) -> f32 {
	let ab = b - a;
	let t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
	let d = length(p - a - ab * t);
	return exp(-d * d / (w * w));
}

/** One depth of pairs: \`scale\` cells per frame height, particles of radius \`r\`. */
fn pairs(p : vec2<f32>, scale : f32, layer : f32, r : f32, center : vec2<f32>) -> vec3<f32> {
	let shift = vec2<f32>(17.3, 9.1) * layer;
	let g = p * scale + shift;
	let cell = floor(g);
	var light = vec3<f32>(0.0);
	for (var y = -1; y <= 1; y++) {
		for (var x = -1; x <= 1; x++) {
			let c = cell + vec2<f32>(f32(x), f32(y));
			let seed = hash22(c + 41.0 * layer);
			if (seed.x > u.pairs) { continue; }
			let period = 1.5 + 2.0 * seed.y;
			let t = u.time / period + hash21(c * 1.7 + 3.0);
			let cycle = floor(t);
			let life = fract(t);
			// A new place and direction every time the pair is born.
			let again = hash22(c + cycle * 0.731 + 5.0);
			let born = (c + 0.3 + 0.4 * again - shift) / scale;
			let out = born - center;
			let height = length(out) - HORIZON_R;
			if (height < 0.012) { continue; }
			var gold = born;
			var blue = born;
			var goldFade = 0.0;
			var blueFade = 0.0;
			if (height < 0.12 && hash21(c * 2.3 + cycle) < u.stream) {
				// Too close to the edge: the partners are pulled apart for good.
				let away = out / length(out);
				let appear = smoothstep(0.0, 0.06, life);
				gold = born + away * (0.012 + 0.6 * life * life);
				blue = born - away * (height + 0.03) * smoothstep(0.04, 0.55, life);
				goldFade = appear * (1.0 - smoothstep(0.7, 1.0, life));
				blueFade = appear * (1.0 - smoothstep(0.4, 0.58, life));
			} else {
				if (life > 0.6) { continue; }
				let f = life / 0.6;
				let angle = TAU * hash21(c + cycle * 1.3);
				let apart = vec2<f32>(cos(angle), sin(angle)) * 0.2 * pow(sin(PI * f), 0.7) / scale;
				gold = born + apart;
				blue = born - apart;
				goldFade = smoothstep(0.0, 0.1, f) * (1.0 - smoothstep(0.9, 1.0, f));
				blueFade = goldFade;
				// A flash where they appear, and another where they annihilate.
				let d = length(p - born) / (r * 2.6);
				light += (1.0 - u.focus) * vec3<f32>(0.9, 0.95, 1.0) * (exp(-f * f * 500.0) + exp(-(1.0 - f) * (1.0 - f) * 500.0)) * exp(-d * d) * 1.4;
				light += (1.0 - u.focus) * vec3<f32>(0.6, 0.7, 1.0) * thread(p, gold, blue, r * 0.14) * 0.22 * goldFade;
			}
			light += mix(ball(p - gold, r, GOLD), bokeh(p - gold, r, GOLD), u.focus) * goldFade;
			light += mix(ball(p - blue, r, BLUE), bokeh(p - blue, r, BLUE), u.focus) * blueFade;
		}
	}
	return light;
}

fn shade(uv : vec2<f32>) -> vec4<f32> {
	let p = centered(uv);
	let top = mix(${HORIZON_TOP.down.toFixed(2)}, ${HORIZON_TOP.up.toFixed(2)}, u.horizon);
	let center = vec2<f32>(0.0, top - HORIZON_R);
	let out = p - center;
	let height = length(out) - HORIZON_R;

	// Light from behind is squeezed toward the edge, as the hole bends it.
	let bent = center + out / length(out) * (HORIZON_R + height * height / (height + 0.05));
	let dim = mix(1.0, 0.4, u.focus);
	var light = sky(normalize(vec3<f32>(bent * 0.8, 1.5))) * u.stars * dim;
	light += vacuum(bent, u.zoom * 2.2) * u.field * dim;

	light += pairs(p, u.zoom * 8.5, 2.0, 0.0042, center) * 0.4;
	light += pairs(p, u.zoom * 5.2, 1.0, 0.0072, center) * 0.65;
	light += pairs(p, u.zoom * 3.1, 0.0, 0.0125, center);

	if (u.hero > 0.0) {
		let gold = vec2<f32>(u.heroGoldX, u.heroGoldY);
		let blue = vec2<f32>(u.heroBlueX, u.heroBlueY);
		light += vec3<f32>(0.6, 0.7, 1.0) * thread(p, gold, blue, 0.0025) * 0.5 * u.link * u.hero;
		light += ball(p - gold, 0.024, GOLD) * u.hero * 1.2;
		// The falling partner dims and reddens as it nears the edge.
		let depth = length(blue - center) - HORIZON_R;
		let sink = smoothstep(-0.01, 0.07, depth);
		light += ball(p - blue, 0.024, mix(vec3<f32>(0.35, 0.1, 0.25), BLUE, sink)) * u.hero * 1.2 * mix(0.25, 1.0, sink);
	}

	let outside = smoothstep(0.0, 0.006, height);
	light *= outside;
	let rim = exp(-max(height, 0.0) * 60.0) * 1.1 + exp(-max(height, 0.0) * 6.0) * 0.1;
	light += vec3<f32>(0.5, 0.68, 1.0) * rim * outside * smoothstep(0.0, 0.25, u.horizon);
	return display(light * u.exposure, uv);
}
`;
