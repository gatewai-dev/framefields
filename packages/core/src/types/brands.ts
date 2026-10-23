declare const BrandTag: unique symbol;

/**
 * Compile-time zero-cost nominal typing tag ("newtype" pattern).
 * Prevents accidental cross-assignment of semantically incompatible primitives
 * (e.g. milliseconds to seconds, handle labels to handle IDs, or fractional frames).
 */
export type Brand<T, B extends string> = T & { readonly [BrandTag]: B };

/** Timeline frame number (must be a non-negative integer). */
export type FrameIndex = Brand<number, "FrameIndex">;

/** Time in seconds. */
export type Seconds = Brand<number, "Seconds">;

/** Time in milliseconds. */
export type Milliseconds = Brand<number, "Milliseconds">;

/** Frame rate in frames per second. */
export type Fps = Brand<number, "Fps">;

/** Normalized scalar in the range [0.0, 1.0]. */
export type Normalized = Brand<number, "Normalized">;

/** Angle in degrees (0 to 360). */
export type Degrees = Brand<number, "Degrees">;

/** Angle in radians (0 to 2*PI). */
export type Radians = Brand<number, "Radians">;

/** Dimension in screen/canvas pixels. */
export type Pixels = Brand<number, "Pixels">;

/** Live compositor dynamic input/output handle identifier. */
export type HandleId = Brand<string, "HandleId">;

/** Human-readable handle label (distinct from HandleId to prevent runtime lookup failure). */
export type HandleLabel = Brand<string, "HandleLabel">;

/** Unique layout node identifier. */
export type NodeId = Brand<string, "NodeId">;

/** Asserts and casts a number to an integer FrameIndex. */
export function frame(n: number): FrameIndex {
	if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
		throw new RangeError(
			`FrameIndex must be a non-negative finite integer, got ${n}`,
		);
	}
	return n as FrameIndex;
}

/** Asserts and casts a number to Seconds. */
export function seconds(s: number): Seconds {
	if (!Number.isFinite(s)) {
		throw new TypeError(`Seconds must be a finite number, got ${s}`);
	}
	return s as Seconds;
}

/** Asserts and casts a number to Milliseconds. */
export function ms(m: number): Milliseconds {
	if (!Number.isFinite(m)) {
		throw new TypeError(`Milliseconds must be a finite number, got ${m}`);
	}
	return m as Milliseconds;
}

/** Asserts and casts a number to Fps. */
export function fps(f: number): Fps {
	if (!Number.isFinite(f) || f <= 0) {
		throw new RangeError(`Fps must be a positive finite number, got ${f}`);
	}
	return f as Fps;
}

/** Clamps and casts a number to Normalized [0.0, 1.0]. */
export function normalized(n: number): Normalized {
	if (!Number.isFinite(n)) {
		throw new TypeError(`Normalized must be a finite number, got ${n}`);
	}
	const clamped = Math.max(0, Math.min(1, n));
	return clamped as Normalized;
}

/** Asserts and casts a number to Degrees. */
export function degrees(deg: number): Degrees {
	if (!Number.isFinite(deg)) {
		throw new TypeError(`Degrees must be a finite number, got ${deg}`);
	}
	return deg as Degrees;
}

/** Asserts and casts a number to Radians. */
export function radians(rad: number): Radians {
	if (!Number.isFinite(rad)) {
		throw new TypeError(`Radians must be a finite number, got ${rad}`);
	}
	return rad as Radians;
}

/** Asserts and casts a number to Pixels. */
export function pixels(px: number): Pixels {
	if (!Number.isFinite(px)) {
		throw new TypeError(`Pixels must be a finite number, got ${px}`);
	}
	return px as Pixels;
}

/** Casts a string to HandleId. */
export function handleId(id: string): HandleId {
	if (!id) {
		throw new TypeError("HandleId cannot be empty");
	}
	return id as HandleId;
}

/** Casts a string to HandleLabel. */
export function handleLabel(label: string): HandleLabel {
	if (!label) {
		throw new TypeError("HandleLabel cannot be empty");
	}
	return label as HandleLabel;
}

/** Casts a string to NodeId. */
export function nodeId(id: string): NodeId {
	if (!id) {
		throw new TypeError("NodeId cannot be empty");
	}
	return id as NodeId;
}

/** Type guard checking if a number is a valid FrameIndex. */
export function isFrameIndex(val: unknown): val is FrameIndex {
	return typeof val === "number" && Number.isInteger(val) && val >= 0;
}

/** Type guard checking if a number is in the Normalized [0, 1] range. */
export function isNormalized(val: unknown): val is Normalized {
	return (
		typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 1
	);
}
