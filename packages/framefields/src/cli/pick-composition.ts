import type { Composition } from "../index.js";

export interface PickOptions {
	export: string;
	args?: unknown;
	select?: string;
}

/**
 * The composition an export yields, read the way the cloud worker reads it:
 * a Composition, a function returning one (called with `args`), or several
 * by name (a record, or `{ outputs: [{ name, composition }] }`) picked with
 * `select`.
 */
export async function pickComposition(
	mod: Record<string, unknown>,
	job: PickOptions,
): Promise<Composition> {
	if (!(job.export in mod))
		throw new Error(
			`The module has no export named "${job.export}". Exports: ${Object.keys(mod).join(", ") || "none"}.`,
		);
	let value = mod[job.export];
	if (typeof value === "function" && !isComposition(value))
		value = await (value as (args: unknown) => unknown)(job.args);
	if (isComposition(value)) return value;
	const named = namedOutputs(value);
	if (!named)
		throw new Error(
			`Export "${job.export}" must be a Composition, a function returning one, or compositions by name.`,
		);
	const names = Object.keys(named);
	const pick = job.select ?? (names.length === 1 ? names[0] : undefined);
	if (!pick || !named[pick])
		throw new Error(
			`Export "${job.export}" returns several compositions (${names.join(", ")}): name one with "select".`,
		);
	return named[pick];
}

function namedOutputs(value: unknown): Record<string, Composition> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const outputs = (value as { outputs?: unknown }).outputs;
	const entries = Array.isArray(outputs)
		? outputs.map((o: { name?: string; composition?: unknown }, i) => [
				o?.name ?? `output-${i}`,
				o?.composition,
			])
		: Object.entries(value);
	if (!entries.length || !entries.every(([, c]) => isComposition(c)))
		return undefined;
	return Object.fromEntries(entries) as Record<string, Composition>;
}

/** Duck-typed: the project may load its own copy of framefields. */
function isComposition(value: unknown): value is Composition {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Composition).renderVideo === "function" &&
		typeof (value as Composition).toSpec === "function"
	);
}
