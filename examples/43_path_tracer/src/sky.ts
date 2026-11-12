/**
 * A clear-day sky as an equirectangular Radiance `.hdr`: a blue gradient,
 * a hazy horizon, warm ground and a sun about half a degree wide carrying
 * most of the light, which is what makes light sampling matter: a path
 * that finds the sun by chance is a firefly.
 *
 * Layout matches the engine's (y down, u = 0.5 looks down -z, the top row
 * is straight up).
 */
const WIDTH = 2048;
const HEIGHT = 1024;

/** Sun direction in the panorama: elevation and azimuth, degrees. */
const SUN = { elevation: 32, azimuth: -40 };
const SUN_RADIUS_DEG = 0.6;
/** Sun radiance; with its disk it lights a level surface about 3x as much as the sky does. */
const SUN_RADIANCE = 9000;

function direction(u: number, v: number): [number, number, number] {
	const theta = v * Math.PI;
	const phi = (u - 0.5) * 2 * Math.PI;
	return [
		Math.sin(theta) * Math.sin(phi),
		-Math.cos(theta),
		-Math.sin(theta) * Math.cos(phi),
	];
}

function sky(d: [number, number, number]): [number, number, number] {
	const up = -d[1];
	if (up < 0) {
		// Ground: warm, darker toward the nadir.
		const k = 0.35 + 0.25 * (1 + up);
		return [0.32 * k, 0.26 * k, 0.2 * k];
	}
	const zenith = [0.18, 0.36, 0.85];
	const horizon = [0.85, 0.9, 1.0];
	const t = (1 - up) ** 4;
	return [0, 1, 2].map(
		(i) => (zenith[i] + (horizon[i] - zenith[i]) * t) * 1.2,
	) as [number, number, number];
}

/** The sky's linear RGB pixels. */
export function sunSky(): {
	width: number;
	height: number;
	data: Float32Array;
} {
	const el = (SUN.elevation * Math.PI) / 180;
	const az = (SUN.azimuth * Math.PI) / 180;
	const sun: [number, number, number] = [
		Math.cos(el) * Math.sin(az),
		-Math.sin(el),
		-Math.cos(el) * Math.cos(az),
	];
	const cosSun = Math.cos((SUN_RADIUS_DEG * Math.PI) / 180);
	const data = new Float32Array(WIDTH * HEIGHT * 3);
	for (let y = 0; y < HEIGHT; y++) {
		for (let x = 0; x < WIDTH; x++) {
			const d = direction((x + 0.5) / WIDTH, (y + 0.5) / HEIGHT);
			const c = sky(d);
			const cosA = d[0] * sun[0] + d[1] * sun[1] + d[2] * sun[2];
			// A glow around the disk, then the disk itself.
			const glow = Math.max(0, cosA) ** 400 * 6;
			const disk = cosA >= cosSun ? SUN_RADIANCE : 0;
			const o = (y * WIDTH + x) * 3;
			data[o] = c[0] + glow + disk;
			data[o + 1] = c[1] + glow * 0.95 + disk * 0.93;
			data[o + 2] = c[2] + glow * 0.85 + disk * 0.82;
		}
	}
	return { width: WIDTH, height: HEIGHT, data };
}

/** Flat (uncompressed) RGBE scanlines. */
export function encodeRgbe(
	width: number,
	height: number,
	rgb: Float32Array,
): Uint8Array {
	const header = new TextEncoder().encode(
		`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`,
	);
	const out = new Uint8Array(header.length + width * height * 4);
	out.set(header);
	for (let i = 0; i < width * height; i++) {
		const r = rgb[i * 3];
		const g = rgb[i * 3 + 1];
		const b = rgb[i * 3 + 2];
		const m = Math.max(r, g, b);
		const o = header.length + i * 4;
		if (m < 1e-32) continue;
		const e = Math.ceil(Math.log2(m) + 1e-9);
		const scale = 256 / 2 ** e;
		out[o] = Math.min(255, Math.floor(r * scale));
		out[o + 1] = Math.min(255, Math.floor(g * scale));
		out[o + 2] = Math.min(255, Math.floor(b * scale));
		out[o + 3] = e + 128;
	}
	return out;
}
