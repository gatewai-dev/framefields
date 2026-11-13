/**
 * The packed layout both clay evaluators read (the CPU reference in
 * `eval.ts`, the WGSL one in `field.wgsl.ts`).
 *
 * A record is five vec4: [type, mode, smoothness, -], three vec4 of
 * parameters, then the color (rgba, display 0..1).
 *  solids   p1 = center, size   p2 = inverse rotation (quaternion)   p3 = shape
 *  segment  p1 = A, radius      p2 = B (control), t limit            p3 = C, radius
 *  warps    p1 = center, radius p2 = vector, reach
 *  inflate  p1 = center, radius p2 = amount
 *  detail   p1 = center, radius p2 = amplitude, 1 / scale, octaves, seed
 *           p3 = persistence, lacunarity, ridged
 */

/** Floats per operation record. */
export const OP_FLOATS = 20;

export const OP = {
	sphere: 1,
	box: 2,
	cylinder: 3,
	capsule: 4,
	torus: 5,
	segment: 6,
	grab: 7,
	twist: 8,
	bulge: 9,
	inflate: 10,
	detail: 11,
} as const;

export const isWarp = (type: number) => type >= OP.grab && type <= OP.bulge;

/** The field's value where there is no material yet. */
export const CLAY_EMPTY = 1e9;
/** Most warps one evaluation walks back through. */
export const MAX_WARPS = 12;
/** A list entry's top bit: the last record of its group in this list. */
export const GROUP_END = 0x80000000;

/**
 * Bytes per brick record: origin (vec3), size, list offset, count, warps,
 * step scale, then relief, detailed step scale, the relief of detail that
 * is not at the list's end, and the count of detail records at its end.
 */
export const BRICK_BYTES = 48;
