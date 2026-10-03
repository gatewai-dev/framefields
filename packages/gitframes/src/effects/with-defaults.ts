import { isSignal } from "@gitframes/core";

/** Literal metadata for one prop, emitted into `generated/meta.ts`. */
export interface PropMeta {
	readonly min?: number;
	readonly max?: number;
	readonly enum?: readonly (string | number | boolean)[];
	/** Members of a nested object prop. */
	readonly props?: EffectMeta;
}

export type EffectMeta = Readonly<Record<string, PropMeta>>;

function env(name: string): string | undefined {
	return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

/** Throw instead of warn. Recommended for agent harnesses and CI. */
function isStrict(): boolean {
	const flag = env("GITFRAMES_STRICT_PROPS");
	return flag === "1" || flag === "true";
}

function checksEnabled(): boolean {
	return isStrict() || env("NODE_ENV") !== "production";
}

const reported = new Set<string>();

function report(message: string): void {
	if (isStrict()) throw new Error(message);
	if (reported.has(message)) return;
	reported.add(message);
	console.warn(`[gitframes] ${message}`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (typeof value !== "object" || value === null) return false;
	if (Array.isArray(value) || isSignal(value)) return false;
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
}

/** Levenshtein distance, for "did you mean" suggestions on small key sets. */
function distance(a: string, b: string): number {
	const row = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let prev = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const current = row[j];
			row[j] = Math.min(
				row[j] + 1,
				row[j - 1] + 1,
				prev + (a[i - 1] === b[j - 1] ? 0 : 1),
			);
			prev = current;
		}
	}
	return row[b.length];
}

function suggest(key: string, known: readonly string[]): string {
	let best: string | undefined;
	let bestScore = Number.POSITIVE_INFINITY;
	const lower = key.toLowerCase();
	for (const candidate of known) {
		const candidateLower = candidate.toLowerCase();
		const score =
			candidateLower.includes(lower) || lower.includes(candidateLower)
				? 1
				: distance(lower, candidateLower);
		if (score < bestScore) {
			bestScore = score;
			best = candidate;
		}
	}
	const close = best && bestScore <= Math.max(2, Math.ceil(key.length / 2));
	return close
		? ` Did you mean "${best}"?`
		: ` Known props: ${known.join(", ")}.`;
}

function checkValue(path: string, value: unknown, meta: PropMeta): void {
	if (typeof value === "number") {
		const { min, max } = meta;
		const below = min !== undefined && value < min;
		const above = max !== undefined && value > max;
		if (below || above || Number.isNaN(value)) {
			const range =
				min !== undefined && max !== undefined
					? `${min} to ${max}`
					: min !== undefined
						? `≥ ${min}`
						: `≤ ${max}`;
			report(
				Number.isNaN(value)
					? `${path} is NaN`
					: `${path} = ${value} is outside ${range}`,
			);
		}
		return;
	}
	if (
		meta.enum &&
		(typeof value === "string" || typeof value === "boolean") &&
		!meta.enum.includes(value)
	) {
		report(
			`${path} = ${JSON.stringify(value)} is not one of ${meta.enum
				.map((v) => JSON.stringify(v))
				.join(", ")}`,
		);
	}
}

function checkProps(
	path: string,
	config: Record<string, unknown>,
	meta: EffectMeta,
): void {
	const known = Object.keys(meta);
	for (const [key, value] of Object.entries(config)) {
		if (value === undefined) continue;
		const propMeta = meta[key];
		if (!propMeta) {
			report(`${path}: unknown prop "${key}".${suggest(key, known)}`);
			continue;
		}
		// Signals and frame functions are sampled per frame; only static values
		// can be checked here.
		if (isSignal(value) || typeof value === "function") continue;
		if (propMeta.props && isPlainObject(value)) {
			checkProps(`${path}.${key}`, value, propMeta.props);
		} else {
			checkValue(`${path}.${key}`, value, propMeta);
		}
	}
}

function cloneDefault<T>(value: T): T {
	return typeof value === "object" && value !== null
		? structuredClone(value)
		: value;
}

/**
 * Builds the initial config of a generated effect class.
 *
 * - `undefined` entries in `config` keep the default instead of overwriting it.
 * - When both the default and the supplied value are plain objects, they are
 *   merged one level deep, so `new ColorBalance({ shadows: { cyanRed: 10 } })`
 *   keeps the other two channels at their defaults.
 * - Object defaults are cloned per instance.
 * - Outside production, unknown props and out-of-range static values are
 *   reported: a `console.warn` once per message, or a thrown `Error` when
 *   `GITFRAMES_STRICT_PROPS=1`. Unknown props are still passed through.
 */
export function withDefaults<T extends object>(
	op: string,
	defaults: Readonly<Partial<T>>,
	config: T,
	meta: EffectMeta,
): T {
	const supplied = config as Record<string, unknown>;
	if (checksEnabled()) checkProps(op, supplied, meta);

	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(defaults)) {
		result[key] = cloneDefault(value);
	}
	for (const [key, value] of Object.entries(supplied)) {
		if (value === undefined) continue;
		const base = result[key];
		result[key] =
			isPlainObject(base) && isPlainObject(value)
				? {
						...base,
						...Object.fromEntries(
							Object.entries(value).filter(([, v]) => v !== undefined),
						),
					}
				: value;
	}
	return result as T;
}
