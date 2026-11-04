/**
 * Relativistic observer: what a camera moving at a fraction `β` of the speed
 * of light sees of a scene at rest.
 *
 * Aberration: a ray arriving at angle θ' from the direction of motion left
 * the scene at θ, with cos θ = (cos θ' − β) / (1 − β cos θ'). The Doppler
 * factor D = γ (1 + β cos θ') scales every frequency, and spectral radiance
 * transforms as L'(λ') = D⁵ L(D λ') (the "searchlight": ahead is brighter).
 *
 * A pixel only stores a colour, so its spectrum is modelled: the colour is a
 * reflectance (three smooth bands that sum to one, held flat past the visible
 * range, so red surfaces stay red into the infrared) lit by daylight (a
 * 5778 K black body). Shifting that spectrum and integrating it against the
 * CIE 1931 observer gives the colour seen. `dopplerColorMatrix(D)` is the
 * resulting linear map on linear sRGB, exactly the identity at D = 1.
 */

/** Wavelength range integrated by the observer, nm. */
const LAMBDA_MIN = 360;
const LAMBDA_MAX = 830;
const LAMBDA_STEP = 1;
/** Daylight: the Sun's effective temperature, K. */
const DAYLIGHT_KELVIN = 5778;
/** Second radiation constant hc/k in nm·K. */
const C2 = 1.4387769e7;

/** Piecewise Gaussian used by the CIE fit. */
function lobe(l: number, mu: number, below: number, above: number): number {
	const t = (l - mu) / (l < mu ? below : above);
	return Math.exp(-0.5 * t * t);
}

/**
 * CIE 1931 2° colour matching functions, multi-lobe fit of Wyman, Sloan and
 * Shirley (JCGT 2013).
 */
function cieXyz(l: number): [number, number, number] {
	return [
		1.056 * lobe(l, 599.8, 37.9, 31.0) +
			0.362 * lobe(l, 442.0, 16.0, 26.7) -
			0.065 * lobe(l, 501.1, 20.4, 26.2),
		0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
		1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
	];
}

/** XYZ → linear sRGB (D65). */
const XYZ_TO_RGB = [
	[3.2406, -1.5372, -0.4986],
	[-0.9689, 1.8758, 0.0415],
	[0.0557, -0.204, 1.057],
] as const;

function smoothstep(a: number, b: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
}

/** The blue, green and red reflectance bands at wavelength `l` (sum to 1). */
function bands(l: number): [number, number, number] {
	const blueToGreen = smoothstep(440, 510, l);
	const greenToRed = smoothstep(570, 630, l);
	return [1 - blueToGreen, blueToGreen * (1 - greenToRed), greenToRed];
}

/** Black-body spectral radiance shape at wavelength `l` nm (unnormalised). */
function planck(l: number, kelvin: number): number {
	const x = C2 / (l * kelvin);
	// Far in the ultraviolet the exponential overflows: there is no light.
	if (x > 700) return 0;
	return 1 / (l ** 5 * Math.expm1(x));
}

/**
 * K[k][i]: channel k of linear sRGB seen from band i at Doppler factor `d`,
 * with the D⁵ searchlight factor when `beaming`.
 */
function bandResponse(d: number, beaming: boolean): number[][] {
	const k = [
		[0, 0, 0],
		[0, 0, 0],
		[0, 0, 0],
	];
	const scale = beaming ? d ** 5 : 1;
	for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += LAMBDA_STEP) {
		const xyz = cieXyz(l);
		const source = l * d;
		const b = bands(source);
		const e = planck(source, DAYLIGHT_KELVIN) * scale;
		for (let c = 0; c < 3; c++) {
			const bar =
				XYZ_TO_RGB[c][0] * xyz[0] +
				XYZ_TO_RGB[c][1] * xyz[1] +
				XYZ_TO_RGB[c][2] * xyz[2];
			for (let i = 0; i < 3; i++) k[c][i] += bar * b[i] * e;
		}
	}
	return k;
}

function invert3(m: number[][]): number[][] {
	const [[a, b, c], [d, e, f], [g, h, i]] = m;
	const A = e * i - f * h;
	const B = -(d * i - f * g);
	const C = d * h - e * g;
	const det = a * A + b * B + c * C;
	if (Math.abs(det) < 1e-12) throw new Error("Singular colour basis");
	const s = 1 / det;
	return [
		[A * s, -(b * i - c * h) * s, (b * f - c * e) * s],
		[B * s, (a * i - c * g) * s, -(a * f - c * d) * s],
		[C * s, -(a * h - b * g) * s, (a * e - b * d) * s],
	];
}

function multiply3(a: number[][], b: number[][]): number[][] {
	return a.map((row) =>
		[0, 1, 2].map(
			(j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j],
		),
	);
}

let restFrame: { white: number[]; toBands: number[][] } | null = null;

/** The rest-frame response, white-balanced so white reflectance is white. */
function rest(): { white: number[]; toBands: number[][] } {
	if (restFrame) return restFrame;
	const k = bandResponse(1, false);
	const white = k.map((row) => row[0] + row[1] + row[2]);
	const balanced = k.map((row, c) => row.map((v) => v / white[c]));
	restFrame = { white, toBands: invert3(balanced) };
	return restFrame;
}

/**
 * The linear-sRGB matrix (row-major 3×3) that turns a colour at rest into the
 * colour seen at Doppler factor `d` (> 1 towards the direction of motion).
 */
export function dopplerColorMatrix(d: number, beaming = true): number[][] {
	const { white, toBands } = rest();
	const k = bandResponse(d, beaming).map((row, c) =>
		row.map((v) => v / white[c]),
	);
	return multiply3(k, toBands);
}

/** Largest Doppler factor the lookup table covers (β ≈ 0.99995). */
export const DOPPLER_LUT_MAX = 200;
/** Entries in the lookup table, evenly spaced in ln D. */
export const DOPPLER_LUT_SIZE = 256;

const luts = new Map<boolean, Float32Array>();

/**
 * `dopplerColorMatrix` sampled at DOPPLER_LUT_SIZE factors evenly spaced in
 * ln D over [1/DOPPLER_LUT_MAX, DOPPLER_LUT_MAX]: three vec4 rows per entry.
 */
export function dopplerLut(beaming: boolean): Float32Array {
	const cached = luts.get(beaming);
	if (cached) return cached;
	const data = new Float32Array(DOPPLER_LUT_SIZE * 12);
	const span = Math.log(DOPPLER_LUT_MAX);
	for (let n = 0; n < DOPPLER_LUT_SIZE; n++) {
		const lnD = -span + (2 * span * n) / (DOPPLER_LUT_SIZE - 1);
		const m = dopplerColorMatrix(Math.exp(lnD), beaming);
		for (let r = 0; r < 3; r++) data.set(m[r], n * 12 + r * 4);
	}
	luts.set(beaming, data);
	return data;
}

/** Rec. 709 luminance of a linear-sRGB colour. */
const luminance = (c: number[]) =>
	0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * How much brighter a neutral surface looks at Doppler factor `d`: the gain
 * an exposure meter would compensate for.
 */
export function dopplerLuminanceGain(
	d: number,
	doppler: boolean,
	beaming: boolean,
): number {
	if (!doppler) return beaming ? d ** 4 : 1;
	const m = dopplerColorMatrix(d, beaming);
	return luminance(m.map((row) => row[0] + row[1] + row[2]));
}

/** Lorentz factor of speed β. */
export function lorentzFactor(beta: number): number {
	return 1 / Math.sqrt(1 - beta * beta);
}

/**
 * Where a ray seen at angle `observedCos` (cosine to the direction of motion)
 * left the scene at rest, and its Doppler factor.
 */
export function aberrate(
	observedCos: number,
	beta: number,
): { sourceCos: number; doppler: number } {
	return {
		sourceCos: (observedCos - beta) / (1 - beta * observedCos),
		doppler: lorentzFactor(beta) * (1 + beta * observedCos),
	};
}
