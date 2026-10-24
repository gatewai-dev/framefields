/**
 * CSS gradients (`linear-gradient`, `radial-gradient`, `conic-gradient`) as
 * values for any `background` or shape `fill`, plus `Gradient` helpers that
 * write them. Colors blend perceptually (OKLab), not through muddy sRGB.
 */
import { parseCssColor, type Rgba, rgbToOklab } from "./color.js";

export type GradientType = "linear" | "radial" | "conic";

export interface ParsedGradientStop {
	/** 0..1 along the gradient line / radius / turn. */
	offset: number;
	/** Straight sRGB 0..1. */
	color: Rgba;
}

export type RadialExtent =
	| "closest-side"
	| "closest-corner"
	| "farthest-side"
	| "farthest-corner";

export interface ParsedGradient {
	type: GradientType;
	/** Linear: CSS angle in degrees (0 = to top, 90 = to right, 180 = to bottom). */
	angle: number;
	/** Radial / conic center as a fraction of the box (0.5, 0.5 = middle). */
	center: [number, number];
	/** Radial: circle or ellipse, sized by `extent` unless `radius` gives px radii. */
	shape: "circle" | "ellipse";
	radius?: [number, number];
	/** Radial size keyword (CSS): where the last stop lands. Default farthest-corner. */
	extent?: RadialExtent;
	/** Conic: start angle in degrees (0 = top, clockwise). */
	from: number;
	stops: ParsedGradientStop[];
}

/** Gradients this renderer draws at most this many stops (extra ones are resampled). */
export const MAX_GRADIENT_STOPS = 8;

const GRADIENT_RE = /^\s*(linear|radial|conic)-gradient\(\s*([\s\S]*)\)\s*$/i;

export function isCssGradient(value: unknown): value is string {
	return typeof value === "string" && GRADIENT_RE.test(value);
}

/** Splits on commas that are not inside parentheses. */
function splitTopLevel(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let cur = "";
	for (const ch of s) {
		if (ch === "(") depth++;
		if (ch === ")") depth--;
		if (ch === "," && depth === 0) {
			out.push(cur.trim());
			cur = "";
		} else cur += ch;
	}
	if (cur.trim()) out.push(cur.trim());
	return out;
}

function parseAngle(tok: string): number | null {
	const m = /^(-?[\d.]+)(deg|turn|rad|grad)?$/i.exec(tok.trim());
	if (!m) return null;
	const v = parseFloat(m[1]);
	switch ((m[2] ?? "deg").toLowerCase()) {
		case "turn":
			return v * 360;
		case "rad":
			return (v * 180) / Math.PI;
		case "grad":
			return v * 0.9;
		default:
			return v;
	}
}

const SIDE_ANGLES: Record<string, number> = {
	top: 0,
	right: 90,
	bottom: 180,
	left: 270,
	"top right": 45,
	"right top": 45,
	"bottom right": 135,
	"right bottom": 135,
	"bottom left": 225,
	"left bottom": 225,
	"top left": 315,
	"left top": 315,
};

const POSITION_KEYWORDS: Record<string, number> = {
	left: 0,
	top: 0,
	center: 0.5,
	right: 1,
	bottom: 1,
};

/** `at 30% 70%`, `at left top`, `at center`. */
function parsePosition(tokens: string[]): [number, number] {
	const vals = tokens.map((t) =>
		t in POSITION_KEYWORDS
			? {
					v: POSITION_KEYWORDS[t],
					axis:
						t === "top" || t === "bottom"
							? "y"
							: t === "left" || t === "right"
								? "x"
								: "any",
				}
			: { v: t.endsWith("%") ? parseFloat(t) / 100 : 0.5, axis: "any" },
	);
	let x = 0.5;
	let y = 0.5;
	if (vals.length === 1) {
		if (vals[0].axis === "y") y = vals[0].v;
		else x = vals[0].v;
	} else if (vals.length >= 2) {
		if (vals[0].axis === "y" || vals[1].axis === "x") {
			y = vals[0].v;
			x = vals[1].v;
		} else {
			x = vals[0].v;
			y = vals[1].v;
		}
	}
	return [x, y];
}

/** Parses one `color [pos] [pos]` stop list entry; positions in 0..1 (or px later). */
function parseStop(s: string): { color: Rgba; positions: number[] } | null {
	// The color is a leading function call or word; the rest are positions.
	const m = /^((?:[a-z]+\([^)]*\))|#[0-9a-f]+|[a-z]+)\s*(.*)$/i.exec(s.trim());
	if (!m) return null;
	const color = parseCssColor(m[1]);
	if (!color) return null;
	// Percentages anywhere; angles on conic gradients (as a fraction of a turn).
	const positions: number[] = [];
	for (const p of m[2].split(/\s+/).filter(Boolean)) {
		if (p.endsWith("%")) positions.push(parseFloat(p) / 100);
		else if (p === "0")
			positions.push(0); // CSS allows a unitless zero
		else if (/(deg|turn|rad|grad)$/i.test(p)) {
			const a = parseAngle(p);
			if (a !== null) positions.push(a / 360);
		}
	}
	return { color, positions: positions.filter((p) => Number.isFinite(p)) };
}

/** CSS stop fixup: clamp ascending, spread unpositioned stops evenly. */
function resolveStops(
	raw: Array<{ color: Rgba; position?: number }>,
): ParsedGradientStop[] {
	const n = raw.length;
	if (n === 0) return [];
	const pos: (number | undefined)[] = raw.map((r) => r.position);
	if (pos[0] === undefined) pos[0] = 0;
	if (pos[n - 1] === undefined) pos[n - 1] = 1;
	let maxSoFar = -Infinity;
	for (let i = 0; i < n; i++) {
		const p = pos[i];
		if (p !== undefined) {
			pos[i] = Math.max(p, maxSoFar);
			maxSoFar = pos[i] as number;
		}
	}
	for (let i = 1; i < n; i++) {
		if (pos[i] !== undefined) continue;
		let j = i;
		while (pos[j] === undefined) j++;
		const a = pos[i - 1] as number;
		const b = pos[j] as number;
		for (let k = i; k < j; k++)
			pos[k] = a + ((b - a) * (k - i + 1)) / (j - i + 1);
	}
	return raw.map((r, i) => ({ offset: pos[i] as number, color: r.color }));
}

const cache = new Map<string, ParsedGradient | null>();

/** Parses a CSS gradient string; `null` when it is not one this engine draws. */
export function parseCssGradient(input: string): ParsedGradient | null {
	const hit = cache.get(input);
	if (hit !== undefined) return hit;
	const result = parseUncached(input);
	if (cache.size > 512) cache.clear();
	cache.set(input, result);
	return result;
}

function parseUncached(input: string): ParsedGradient | null {
	const m = GRADIENT_RE.exec(input);
	if (!m) return null;
	const type = m[1].toLowerCase() as GradientType;
	const parts = splitTopLevel(m[2]);
	const g: ParsedGradient = {
		type,
		angle: 180,
		center: [0.5, 0.5],
		shape: "ellipse",
		from: 0,
		stops: [],
	};
	const first = parts[0]?.toLowerCase().trim() ?? "";
	let consumedFirst = false;
	if (type === "linear") {
		if (first.startsWith("to ")) {
			const side = first.slice(3).trim().replace(/\s+/g, " ");
			if (side in SIDE_ANGLES) {
				g.angle = SIDE_ANGLES[side];
				consumedFirst = true;
			}
		} else {
			const a = parseAngle(first);
			if (a !== null) {
				g.angle = a;
				consumedFirst = true;
			}
		}
	} else {
		const tokens = first.split(/\s+/).filter(Boolean);
		const at = tokens.indexOf("at");
		const before = at >= 0 ? tokens.slice(0, at) : tokens;
		const isConfig =
			at >= 0 ||
			before.some(
				(t) =>
					t === "circle" ||
					t === "ellipse" ||
					t === "from" ||
					/^closest|^farthest/.test(t) ||
					(type === "radial" && /px$/.test(t)),
			);
		if (isConfig) {
			consumedFirst = true;
			if (at >= 0) g.center = parsePosition(tokens.slice(at + 1));
			if (type === "radial") {
				if (before.includes("circle")) g.shape = "circle";
				const extent = before.find((t) =>
					/^(closest|farthest)-(side|corner)$/.test(t),
				);
				if (extent) g.extent = extent as RadialExtent;
				const px = before
					.filter((t) => /px$/.test(t))
					.map((t) => parseFloat(t));
				if (px.length === 1) {
					g.shape = "circle";
					g.radius = [px[0], px[0]];
				} else if (px.length >= 2) g.radius = [px[0], px[1]];
			} else {
				const f = before.indexOf("from");
				if (f >= 0 && before[f + 1]) g.from = parseAngle(before[f + 1]) ?? 0;
			}
		}
	}
	const raw: Array<{ color: Rgba; position?: number }> = [];
	for (const p of consumedFirst ? parts.slice(1) : parts) {
		const stop = parseStop(p);
		if (!stop) return null;
		if (stop.positions.length === 0) raw.push({ color: stop.color });
		for (const pos of stop.positions)
			raw.push({ color: stop.color, position: pos });
	}
	if (raw.length === 0) return null;
	if (raw.length === 1) raw.push({ ...raw[0] });
	g.stops = resolveStops(raw);
	return g;
}

/** Up to MAX_GRADIENT_STOPS stops: longer lists are resampled evenly. */
export function limitGradientStops(
	stops: ParsedGradientStop[],
): ParsedGradientStop[] {
	if (stops.length <= MAX_GRADIENT_STOPS) return stops;
	const out: ParsedGradientStop[] = [];
	const lo = stops[0].offset;
	const hi = stops[stops.length - 1].offset;
	for (let i = 0; i < MAX_GRADIENT_STOPS; i++) {
		const t = lo + ((hi - lo) * i) / (MAX_GRADIENT_STOPS - 1);
		let k = 1;
		while (k < stops.length - 1 && stops[k].offset < t) k++;
		const a = stops[k - 1];
		const b = stops[k];
		const span = b.offset - a.offset;
		const f = span > 0 ? Math.min(1, Math.max(0, (t - a.offset) / span)) : 1;
		out.push({
			offset: t,
			color: a.color.map((v, j) => v + (b.color[j] - v) * f) as Rgba,
		});
	}
	return out;
}

/**
 * Stops as OKLab + alpha for the GPU. A transparent stop borrows its
 * neighbor's color, so fading to `transparent` keeps the hue instead of
 * passing through grey (CSS premultiplied interpolation does the same).
 */
export function gradientStopsToOklab(
	stops: ParsedGradientStop[],
): Array<[number, number, number, number]> {
	const lab = stops.map((s) => rgbToOklab(s.color[0], s.color[1], s.color[2]));
	return stops.map((s, i) => {
		let src = lab[i];
		if (s.color[3] < 1e-4) {
			const prev = stops
				.slice(0, i)
				.reverse()
				.findIndex((p) => p.color[3] > 1e-4);
			const next = stops.slice(i + 1).findIndex((p) => p.color[3] > 1e-4);
			const pi = prev >= 0 ? i - 1 - prev : -1;
			const ni = next >= 0 ? i + 1 + next : -1;
			if (pi >= 0 && ni >= 0) {
				const a = lab[pi];
				const b = lab[ni];
				src = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
			} else if (pi >= 0) src = lab[pi];
			else if (ni >= 0) src = lab[ni];
		}
		return [src[0], src[1], src[2], s.color[3]];
	});
}

type StopInput = string | { color: string; offset: number };

function stopList(stops: readonly StopInput[]): string {
	return stops
		.map((s) =>
			typeof s === "string"
				? s
				: `${s.color} ${Math.round(s.offset * 10000) / 100}%`,
		)
		.join(", ");
}

/**
 * Writes CSS gradient strings for `background` / `fill`:
 *
 * ```ts
 * Layer.box({ background: Gradient.linear(["#ff5a1f", "#7c3aed"], 135) })
 * Layer.shape("circle", { fill: Gradient.radial(["#fff", "transparent"]) })
 * Gradient.conic(["red", "yellow", "lime", "aqua", "blue", "magenta", "red"])
 * ```
 * Plain strings work too: `"linear-gradient(to right, #000, #fff 80%)"`.
 */
export const Gradient = {
	/** `angle` in degrees: 0 = bottom→top, 90 = left→right, 180 = top→bottom (default). */
	linear(stops: readonly StopInput[], angle = 180): string {
		return `linear-gradient(${angle}deg, ${stopList(stops)})`;
	},
	/** Ellipse to the farthest corner, centered unless `at` ([0..1, 0..1]) says otherwise. */
	radial(
		stops: readonly StopInput[],
		options: { at?: [number, number]; circle?: boolean; radius?: number } = {},
	): string {
		const at = options.at ?? [0.5, 0.5];
		const shape =
			options.radius !== undefined
				? `${options.radius}px`
				: options.circle
					? "circle"
					: "ellipse";
		return `radial-gradient(${shape} at ${at[0] * 100}% ${at[1] * 100}%, ${stopList(stops)})`;
	},
	/** A sweep around `at`, starting at `from` degrees (0 = top, clockwise). */
	conic(
		stops: readonly StopInput[],
		options: { from?: number; at?: [number, number] } = {},
	): string {
		const at = options.at ?? [0.5, 0.5];
		return `conic-gradient(from ${options.from ?? 0}deg at ${at[0] * 100}% ${at[1] * 100}%, ${stopList(stops)})`;
	},
	parse: parseCssGradient,
	is: isCssGradient,
} as const;
