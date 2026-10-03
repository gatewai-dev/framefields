/**
 * Default ids for nodes created without one. A counter per prefix rather than
 * a random suffix: the same composition script builds the same ids on every
 * run and in every render worker, so specs, caches and diffs stay stable.
 */
const counters = new Map<string, number>();

export function autoId(prefix: string): string {
	const n = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, n);
	return `${prefix}-auto-${n}`;
}
