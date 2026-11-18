/**
 * Iconic 4-point Gemini Star geometry:
 *  - Smooth cubic-Bezier SVG path for 2D vector marks and `Layer3D.extrude`
 *  - Deterministic 3D volume/contour point sampler for the Act V swarm
 *    convergence into the glowing Gemini 4 Neon emblem.
 */
import { hash } from "./theme.js";

/**
 * Generates a crisp concave 4-point Gemini star SVG path centered at (0, 0)
 * with tip radius `radius` and inner waist pull `waist` (default 0.16).
 */
export function geminiStarPath(radius: number, waist = 0.16): string {
	const r = radius;
	const k = radius * waist;
	return [
		`M 0 ${-r}`,
		`C ${k} ${-k} ${k} ${-k} ${r} 0`,
		`C ${k} ${k} ${k} ${k} 0 ${r}`,
		`C ${-k} ${k} ${-k} ${k} ${-r} 0`,
		`C ${-k} ${-k} ${-k} ${-k} 0 ${-r}`,
		"Z",
	].join(" ");
}

/**
 * Generates a 4-point star path shifted into [0..size] box coordinates for
 * `Layer.shape("path", { width: size, height: size })`.
 */
export function geminiStarBoxPath(size: number, waist = 0.16): string {
	const c = size / 2;
	const r = size * 0.48;
	const k = r * waist;
	return [
		`M ${c} ${c - r}`,
		`C ${c + k} ${c - k} ${c + k} ${c - k} ${c + r} ${c}`,
		`C ${c + k} ${c + k} ${c + k} ${c + k} ${c} ${c + r}`,
		`C ${c - k} ${c + k} ${c - k} ${c + k} ${c - r} ${c}`,
		`C ${c - k} ${c - k} ${c - k} ${c - k} ${c} ${c - r}`,
		"Z",
	].join(" ");
}

/**
 * Hollow 4-point Gemini star ring path (outer clockwise, inner counter-clockwise)
 * for beveled neon chrome frames via `Layer3D.extrude`.
 */
export function geminiStarFramePath(
	outerRadius: number,
	innerRadius: number,
	waist = 0.16,
): string {
	const outer = geminiStarPath(outerRadius, waist);
	const r = innerRadius;
	const k = innerRadius * waist;
	// Reverse winding for hole cutout.
	const inner = [
		`M 0 ${-r}`,
		`C ${-k} ${-k} ${-k} ${-k} ${-r} 0`,
		`C ${-k} ${k} ${-k} ${k} 0 ${r}`,
		`C ${k} ${k} ${k} ${k} ${r} 0`,
		`C ${k} ${-k} ${k} ${-k} 0 ${-r}`,
		"Z",
	].join(" ");
	return `${outer} ${inner}`;
}

export interface StarSlot {
	readonly x: number;
	readonly y: number;
	readonly z: number;
	/** 0 = center core, 1 = bright outer rim edge. */
	readonly rim: number;
	/** Normalized angular hue blend 0..1 across the star (cyan → sapphire → magenta). */
	readonly spectrum: number;
	/** Stagger arrival phase 0..1. */
	readonly order: number;
}

/** Evaluates whether (u, v) in [-1, 1]^2 lies inside the astroid-like Gemini star. */
function starField(u: number, v: number): number {
	// |u|^p + |v|^p <= 1 with p = 0.56 yields the exact sleek concave 4-point Gemini silhouette.
	return Math.abs(u) ** 0.56 + Math.abs(v) ** 0.56;
}

/**
 * Samples `count` balanced 3D target slots forming a sculptural faceted
 * 4-point Gemini star centered at (0, 0, 0) with half-span `radius` and
 * central thickness `depth`. Emphasizes crisp luminous contour edges plus
 * rich sculpted interior volume.
 */
export function sampleGeminiStarSlots(
	count: number,
	radius: number,
	depth: number,
): StarSlot[] {
	const slots: StarSlot[] = [];
	// 35% sharp luminous outline perimeter, 65% faceted sculptural interior.
	const rimCount = Math.floor(count * 0.35);

	for (let i = 0; i < rimCount; i++) {
		const angle = (i / rimCount) * Math.PI * 2;
		const ca = Math.cos(angle);
		const sa = Math.sin(angle);
		const norm = (Math.abs(ca) ** 0.56 + Math.abs(sa) ** 0.56) ** (1 / 0.56);
		const u = ca / norm;
		const v = sa / norm;
		const jitter = (hash(i, 11) - 0.5) * 0.03;
		const x = (u + jitter) * radius;
		const y = (v + jitter) * radius;
		const z = (hash(i, 17) - 0.5) * depth * 0.28;
		slots.push({
			x,
			y,
			z,
			rim: 1,
			spectrum: 0.5 + 0.5 * (u * 0.65 - v * 0.35),
			order: hash(i, 23) * 0.55,
		});
	}

	let seed = 1000;
	while (slots.length < count) {
		seed += 1;
		const u = hash(seed, 1) * 2 - 1;
		const v = hash(seed, 2) * 2 - 1;
		const d = starField(u, v);
		if (d > 0.96) continue;
		const dome = Math.max(0.08, 1 - d);
		const zSign = hash(seed, 3) < 0.5 ? -1 : 1;
		const z = zSign * dome * depth * (0.45 + 0.55 * hash(seed, 4));
		slots.push({
			x: u * radius,
			y: v * radius,
			z,
			rim: Math.min(1, d),
			spectrum: 0.5 + 0.5 * (u * 0.65 - v * 0.35),
			order: 0.25 + 0.75 * d,
		});
	}
	return slots;
}
