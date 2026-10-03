/**
 * @file packages/compositions/src/program/text-animations/math.ts
 * Mathematical formulations, closed-form physics, affine matrices, and evaluation algorithms.
 */

import type {
	AudioSpectrumTypography,
	ExpressionEvaluationContext,
	KineticMarqueeConfig,
	TextAnchorConfig,
	VolumetricFormationConfig,
} from "./advanced-types.js";

/**
 * Evaluates closed-form underdamped harmonic oscillator for spring physics:
 *
 *   x(t) = target + (x0 - target) * exp(-zeta * omega_n * t) *
 *          [ cos(omega_d * t) + (zeta / sqrt(1 - zeta^2)) * sin(omega_d * t) ]
 *
 * @param t Time in seconds since excitation
 * @param stiffness Spring stiffness (k)
 * @param damping Damping coefficient (c)
 * @param mass Mass of glyph (m)
 * @param initialVelocity Initial velocity (v0)
 * @returns Settled scalar progress in [0, 1] with overshoot
 */
export function evaluateSpringProgress(
	t: number,
	stiffness = 180,
	damping = 12,
	mass = 1.0,
	initialVelocity = 0,
): number {
	if (t <= 0) return 0;

	const omega_n = Math.sqrt(Math.max(1e-4, stiffness) / Math.max(1e-4, mass)); // Natural frequency
	const zeta = damping / (2 * Math.sqrt(Math.max(1e-4, stiffness * mass))); // Damping ratio

	if (zeta < 1.0) {
		// Underdamped (oscillates and overshoots target)
		const omega_d = omega_n * Math.sqrt(1.0 - zeta * zeta); // Damped frequency
		const decay = Math.exp(-zeta * omega_n * t);
		const c1 = -1.0;
		const c2 =
			(initialVelocity - zeta * omega_n * -1.0) / Math.max(1e-6, omega_d);
		const displacement =
			decay * (c1 * Math.cos(omega_d * t) + c2 * Math.sin(omega_d * t));
		return Math.min(2.0, Math.max(-1.0, 1.0 + displacement));
	} else if (Math.abs(zeta - 1.0) < 1e-4) {
		// Critically damped (fastest settle without overshoot)
		const decay = Math.exp(-omega_n * t);
		const displacement = (-1.0 + (initialVelocity - omega_n) * t) * decay;
		return 1.0 + displacement;
	} else {
		// Overdamped
		const s1 = -omega_n * (zeta - Math.sqrt(zeta * zeta - 1.0));
		const s2 = -omega_n * (zeta + Math.sqrt(zeta * zeta - 1.0));
		const c1 = (initialVelocity + s2) / Math.max(1e-6, s1 - s2);
		const c2 = -1.0 - c1;
		return 1.0 + (c1 * Math.exp(s1 * t) + c2 * Math.exp(s2 * t));
	}
}

/**
 * Evaluates 2D Directional Skew matrix components:
 *
 *   S(theta, phi) = R(phi) * [ 1  tan(theta) ] * R(-phi)
 *                            [ 0      1     ]
 *
 * @param skewDeg Skew angle in degrees
 * @param skewAxisDeg Skew axis in degrees
 * @returns 2x2 affine shear matrix components [m00, m01, m10, m11]
 */
export function evaluateSkewMatrix(
	skewDeg: number,
	skewAxisDeg = 0,
): [number, number, number, number] {
	if (skewDeg === 0) return [1, 0, 0, 1];

	const theta = (skewDeg * Math.PI) / 180;
	const phi = (skewAxisDeg * Math.PI) / 180;

	const cosPhi = Math.cos(phi);
	const sinPhi = Math.sin(phi);
	const tanTheta = Math.tan(theta);

	// Multiplied rotation and shear matrices
	const m00 = 1 - tanTheta * cosPhi * sinPhi;
	const m01 = tanTheta * cosPhi * cosPhi;
	const m10 = -tanTheta * sinPhi * sinPhi;
	const m11 = 1 + tanTheta * sinPhi * cosPhi;

	return [m00, m01, m10, m11];
}

/**
 * Computes anchor pivot coordinates relative to glyph bounding box:
 *
 * @param bbox Glyph bounding box { width, height, ascender, descender }
 * @param config Text anchor configuration
 * @returns Pivot offset (px, py) relative to glyph quad center
 */
export function computeAnchorPivotOffset(
	bbox: { width: number; height: number; ascender: number; descender: number },
	config: TextAnchorConfig,
): { px: number; py: number } {
	let normX = config.anchorX;
	let normY = config.anchorY;

	switch (config.preset) {
		case "center":
			normX = 0.5;
			normY = 0.5;
			break;
		case "baseline":
			normX = 0.5;
			normY = bbox.height > 0 ? bbox.ascender / bbox.height : 0.8;
			break;
		case "bottom_left":
			normX = 0.0;
			normY = 1.0;
			break;
		case "bottom_center":
			normX = 0.5;
			normY = 1.0;
			break;
		case "bottom_right":
			normX = 1.0;
			normY = 1.0;
			break;
		case "top_left":
			normX = 0.0;
			normY = 0.0;
			break;
		case "top_center":
			normX = 0.5;
			normY = 0.0;
			break;
		case "top_right":
			normX = 1.0;
			normY = 0.0;
			break;
		default:
			normX = 0.5;
			normY = 0.5;
			break;
	}

	// Offset relative to quad center (-0.5 to +0.5 of quad dimensions)
	const px = (normX - 0.5) * bbox.width + config.offsetX;
	const py = (normY - 0.5) * bbox.height + config.offsetY;

	return { px, py };
}

/**
 * Computes leading displacement per line based on lineAnchor:
 *
 * @param lineIndex 0-based index of current line
 * @param lineCount Total lines in paragraph
 * @param lineSpacing Additional leading in pixels
 * @param lineAnchor Pivot line anchor in [0, 1]
 * @returns Y displacement in pixels
 */
export function computeLineLeadingDisplacement(
	lineIndex: number,
	lineCount: number,
	lineSpacing: number,
	lineAnchor = 0,
): number {
	if (lineSpacing === 0 || lineCount <= 1) return 0;
	const pivotIndex = lineAnchor * (lineCount - 1);
	return (lineIndex - pivotIndex) * lineSpacing;
}

/**
 * Evaluates an Expression Selector formula safely in a sandboxed numeric scope.
 *
 * @param expression Formula string (e.g. "Math.sin(time * 4 + textIndex * 0.2)")
 * @param ctx Glyph evaluation context
 * @returns Numeric selector weight clamped to [-1, 1]
 */
export function evaluateExpressionSelector(
	expression: string,
	ctx: ExpressionEvaluationContext,
): number {
	try {
		const scope = {
			textIndex: ctx.charIndex,
			textTotal: Math.max(1, ctx.totalChars),
			wordIndex: ctx.wordIndex,
			wordTotal: Math.max(1, ctx.totalWords),
			lineIndex: ctx.lineIndex,
			lineTotal: Math.max(1, ctx.totalLines),
			time: ctx.time,
			frame: ctx.frame,
			fps: ctx.fps,
			sin: Math.sin,
			cos: Math.cos,
			tan: Math.tan,
			exp: Math.exp,
			log: Math.log,
			abs: Math.abs,
			min: Math.min,
			max: Math.max,
			sqrt: Math.sqrt,
			pow: Math.pow,
			floor: Math.floor,
			ceil: Math.ceil,
			round: Math.round,
			PI: Math.PI,
			clamp: (v: number, lo: number, hi: number) =>
				Math.max(lo, Math.min(hi, v)),
			noise: (seed: number) => {
				const n = Math.sin(seed * 12.9898 + ctx.frame * 0.1) * 43758.5453;
				return (n - Math.floor(n)) * 2 - 1;
			},
			signals: ctx.signals ?? {},
		};

		const keys = Object.keys(scope);
		const values = Object.values(scope);
		const fn = new Function(...keys, `return (${expression});`);
		const result = Number(fn(...values));

		return Number.isFinite(result) ? Math.max(-1, Math.min(1, result)) : 0;
	} catch {
		return 0;
	}
}

/**
 * 3D Volumetric arrangement transformation output.
 */
export interface Volumetric3DTransform {
	x: number;
	y: number;
	z: number;
	rotX: number;
	rotY: number;
	rotZ: number;
	scaleMult: number;
	depthOpacity?: number;
}

/**
 * Evaluates 3D Volumetric Formation parametric coordinates.
 */
export function evaluateVolumetricFormation(
	glyphIndex: number,
	totalGlyphs: number,
	config: VolumetricFormationConfig,
): Volumetric3DTransform {
	const n = Math.max(1, totalGlyphs);
	const norm = n > 1 ? glyphIndex / (n - 1) : 0;
	const totalAngleRad = (config.totalAngle * Math.PI) / 180;
	const phi = norm * totalAngleRad;

	let x = 0;
	let y = 0;
	let z = 0;
	let rotX = 0;
	let rotY = 0;
	let rotZ = 0;
	let depthOpacity = 1.0;

	switch (config.mode) {
		case "cylinder": {
			// Center arc around front-facing camera when totalAngle < 360; otherwise sweep full circle
			const theta =
				config.totalAngle < 360 ? (norm - 0.5) * totalAngleRad : phi;
			if (config.axis === "y") {
				x = config.radius * Math.sin(theta);
				z = config.radius * Math.cos(theta) - config.radius;
				rotY = (theta * 180) / Math.PI;
			} else if (config.axis === "x") {
				y = config.radius * Math.sin(theta);
				z = config.radius * Math.cos(theta) - config.radius;
				rotX = (theta * 180) / Math.PI;
			} else {
				x = config.radius * Math.sin(theta);
				y = config.radius * Math.cos(theta);
				rotZ = (theta * 180) / Math.PI;
			}
			const facing = Math.cos(theta);
			depthOpacity = Math.max(0.25, (facing + 1) * 0.5);
			break;
		}
		case "vortex": {
			const startAngleRad = -Math.PI / 2; // Start upright at 12 o'clock
			const spiralPhi = startAngleRad + phi;
			// Smooth radius decay from R down to 0.65 * R to keep inner characters cleanly separated
			const r = config.radius * (1 - norm * 0.35);
			x = r * Math.cos(spiralPhi);
			y = r * Math.sin(spiralPhi);
			z = -glyphIndex * config.pitch || 0;

			// Exact analytical tangent orientation along spiral curve
			const dr = (-0.35 * config.radius) / (totalAngleRad || 1);
			const dx = dr * Math.cos(spiralPhi) - r * Math.sin(spiralPhi);
			const dy = dr * Math.sin(spiralPhi) + r * Math.cos(spiralPhi);
			rotZ = (Math.atan2(dy, dx) * 180) / Math.PI;

			depthOpacity = Math.max(0.65, 1 - norm * 0.35);
			break;
		}
		case "helix": {
			if (config.axis === "x") {
				// Horizontal DNA ribbon advancing along reading axis X
				const pitchX = config.pitch > 10 ? config.pitch : 28;
				x = (glyphIndex - (n - 1) / 2) * pitchX;
				y = config.radius * Math.sin(phi);
				z = config.radius * Math.cos(phi) - config.radius;
				// Subtle 3D wave tilt (max 22°) along surface normal
				rotX = Math.sin(phi) * 22;
				const facing = Math.cos(phi);
				depthOpacity = 0.75 + 0.25 * ((facing + 1) * 0.5);
			} else {
				// Vertical helix advancing along Y
				const theta = (norm - 0.5) * totalAngleRad;
				x = config.radius * Math.sin(theta);
				y = (glyphIndex - (n - 1) / 2) * config.pitch;
				z = config.radius * Math.cos(theta) - config.radius;
				rotY = (theta * 180) / Math.PI;
				const facing = Math.cos(theta);
				depthOpacity = Math.max(0.65, (facing + 1) * 0.5);
			}
			break;
		}
		default: {
			z = 0;
			break;
		}
	}

	const perspective = Math.max(100, config.perspective ?? 1200);
	const depthDist = perspective - z;
	const scaleMult = depthDist > 1 ? perspective / depthDist : 1;

	return {
		x: x * scaleMult,
		y: y * scaleMult,
		z,
		rotX,
		rotY,
		rotZ,
		scaleMult: Math.max(0.1, scaleMult),
		depthOpacity,
	};
}

/**
 * Evaluates infinite kinetic marquee translation and snapping.
 */
export function evaluateMarqueeOffset(
	baseX: number,
	containerWidth: number,
	contentWidth: number,
	config: KineticMarqueeConfig,
	elapsedSec: number,
): number {
	const effectiveWidth =
		containerWidth > 0 ? Math.max(containerWidth, contentWidth) : contentWidth;
	const totalSpan = effectiveWidth + config.repeatGap;
	if (totalSpan <= 0) return baseX;

	let travel = config.velocity * elapsedSec;

	if (config.snap?.enabled) {
		const targetStop = config.snap.stopIndex ?? 0;
		const snapUnit = config.snap.granularity === "character" ? 40 : 120;
		const targetPos = targetStop * snapUnit;
		const decelFactor = Math.min(1.0, elapsedSec * 1.5);
		travel = travel * (1.0 - decelFactor) + targetPos * decelFactor;
	}

	if (config.direction === "right" || config.direction === "down") {
		travel = -travel;
	}

	if (config.loop) {
		const wrapped = (baseX - travel) % totalSpan;
		return wrapped < -contentWidth ? wrapped + totalSpan : wrapped;
	}

	return baseX - travel;
}

/**
 * Samples audio FFT frequency bin and computes scale factor for Audio Spectrum Typography.
 */
export function sampleAudioSpectrumScale(
	glyphIndex: number,
	totalGlyphs: number,
	config: AudioSpectrumTypography,
	signals: Record<string, unknown> | undefined,
	frame: number,
	fps: number,
): number {
	const n = Math.max(1, totalGlyphs);
	const norm = n > 1 ? glyphIndex / (n - 1) : 0.5;

	const minFreq = Math.max(20, config.minFreqHz);
	const maxFreq = Math.max(minFreq + 100, config.maxFreqHz);
	const targetFreq = minFreq * (maxFreq / minFreq) ** norm;

	let magnitude = 0;

	if (signals) {
		const sig = signals[config.signalChannel];
		if (typeof sig === "number") {
			magnitude = sig;
		} else if (typeof sig === "function") {
			magnitude = Number(sig(frame, fps, targetFreq)) || 0;
		} else if (typeof sig === "object" && sig !== null) {
			const sObj = sig as Record<string, unknown>;
			if (typeof sObj.get === "function") {
				magnitude =
					Number(
						(sObj.get as (ctx: unknown) => unknown)({
							frame,
							fps,
							freq: targetFreq,
						}),
					) || 0;
			} else if (
				Array.isArray(sObj.samples) ||
				ArrayBuffer.isView(sObj.samples)
			) {
				const arr = sObj.samples as ArrayLike<number>;
				const binIdx = Math.floor(norm * (arr.length - 1));
				magnitude = Number(arr[binIdx]) || 0;
			}
		}
	}

	const clampedMag = Math.max(0, Math.min(1, magnitude));
	return config.minScale + clampedMag * (config.maxScale - config.minScale);
}
