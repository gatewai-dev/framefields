/**
 * Custom WGSL fragment shader (`Layer.shader`) rendering a deep luxury
 * obsidian cosmos with restrained, silk-like neon cyan, sapphire, and
 * plasma-magenta aurora wisps, subtle horizon reflection, and fine starlight
 * dust. Keeps dark negative space rich so foreground 3D neon geometry pops.
 */
export const NEON_FIELD_WGSL = /* wgsl */ `
const PI : f32 = 3.14159265;

fn hash21(p : vec2<f32>) -> f32 {
	var q = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
	q += dot(q, q.yzx + 33.33);
	return fract((q.x + q.y) * q.z);
}

fn noise2(p : vec2<f32>) -> f32 {
	let i = floor(p);
	let f = fract(p);
	let w = f * f * (3.0 - 2.0 * f);
	let a = hash21(i);
	let b = hash21(i + vec2<f32>(1.0, 0.0));
	let c = hash21(i + vec2<f32>(0.0, 1.0));
	let d = hash21(i + vec2<f32>(1.0, 1.0));
	return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(p : vec2<f32>) -> f32 {
	var q = p;
	var sum = 0.0;
	var amp = 0.5;
	let rot = mat2x2<f32>(0.8, 0.6, -0.6, 0.8);
	for (var i = 0; i < 4; i++) {
		sum += amp * noise2(q);
		q = rot * q * 2.04 + vec2<f32>(7.3, 4.1);
		amp *= 0.5;
	}
	return sum;
}

fn aces(x : vec3<f32>) -> vec3<f32> {
	let c = max(x, vec3<f32>(0.0));
	return (c * (2.51 * c + 0.03)) / (c * (2.43 * c + 0.59) + 0.14);
}

fn shade(uv : vec2<f32>) -> vec4<f32> {
	let aspect = u.resolution.x / u.resolution.y;
	let p = (uv - vec2<f32>(0.5, 0.46)) * vec2<f32>(aspect, 1.0);
	let t = u.time * 0.38 + u.phase;

	// Deep luxury obsidian canvas with subtle midnight zenith tint.
	var col = mix(vec3<f32>(0.004, 0.007, 0.018), vec3<f32>(0.0015, 0.002, 0.005), smoothstep(0.0, 1.0, uv.y));

	// Restrained domain-warped silk aurora wisps (high contrast, never milky).
	let w1 = vec2<f32>(
		fbm(p * 1.4 + vec2<f32>(t * 0.28, -t * 0.18)),
		fbm(p * 1.4 + vec2<f32>(-t * 0.22 + 3.7, t * 0.24 + 1.9))
	);
	let caustic = fbm(p * 2.1 + w1 * 1.45 - vec2<f32>(0.0, t * 0.2));
	let ridge = pow(max(0.0, 1.0 - abs(caustic * 2.0 - 1.0)), 4.6);

	let cyan = vec3<f32>(0.0, 0.85, 1.0);
	let sapphire = vec3<f32>(0.12, 0.38, 1.0);
	let magenta = vec3<f32>(0.85, 0.12, 0.65);
	let bandColor = mix(
		mix(cyan, sapphire, smoothstep(-0.7, 0.15, p.x + sin(t) * 0.15)),
		magenta,
		smoothstep(0.05, 0.9, p.x * u.magentaMix + w1.y * 0.6)
	);

	// Soft upper-atmosphere aurora ribbon keeping lower third deep obsidian for text legibility.
	let upperMask = smoothstep(0.76, 0.25, uv.y);
	let horizonY = p.y + 0.04 - 0.07 * sin(p.x * 2.2 + t);
	let ribbon = exp(-horizonY * horizonY * 10.0) * upperMask;
	col += bandColor * ridge * ribbon * (0.2 + 0.24 * u.energy) * u.intensity;

	// Subtle radial aura & crisp beat flare rays behind hero 3D geometry.
	let r = length(p);
	let angle = atan2(p.y, p.x);
	let rays = pow(0.5 + 0.5 * sin(angle * 4.0 + u.raySpin), 8.0) * exp(-r * 2.8);
	let coreGlow = exp(-r * r * 6.5);
	col += mix(sapphire, cyan, 0.45) * coreGlow * (0.08 + 0.38 * u.flare) * u.intensity;
	col += mix(cyan, magenta, 0.5) * rays * (0.05 + 0.42 * u.flare) * u.intensity;

	// Razor-thin architectural horizon hairline.
	let hLine = exp(-abs(uv.y - 0.675) * 220.0) * exp(-p.x * p.x * 1.4);
	col += mix(cyan, sapphire, 0.5) * hLine * (0.08 + 0.2 * u.energy) * u.horizon;

	// Fine distant pinprick stars in the upper void.
	let grid = p * 34.0 + vec2<f32>(0.0, -t * 0.25);
	let cell = floor(grid);
	let rnd = hash21(cell);
	if (rnd > 0.974 && uv.y < 0.68) {
		let center = fract(grid) - vec2<f32>(0.5);
		let twinkle = 0.5 + 0.5 * sin(u.time * 3.8 + rnd * 60.0);
		let dotGlow = exp(-dot(center, center) * 90.0) * twinkle;
		col += mix(cyan, vec3<f32>(0.92, 0.96, 1.0), fract(rnd * 13.7)) * dotGlow * 0.28 * u.intensity;
	}

	let mapped = pow(clamp(aces(col), vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / 2.2));
	let dither = (hash21(uv * u.resolution + vec2<f32>(u.frame * 1.37, 0.0)) - 0.5) / 255.0;
	return vec4<f32>(mapped + dither, 1.0);
}
`;
