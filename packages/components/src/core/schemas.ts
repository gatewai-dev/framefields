/**
 * Shared prop schemas. Built on first use, never at import: a schema built at
 * module load is a side effect bundlers must keep, which would ship every
 * component to anyone importing one.
 */
import { z } from "zod";
import type { Target } from "./targets.js";

let target: z.ZodType<Target> | undefined;

/** Any `Target`: [x, y], a rect, { node }, { text }, { track }, or (frame) => point. */
export function targetSchema(): z.ZodType<Target> {
	target ??= z.custom<Target>(
		(v) =>
			v !== null &&
			v !== undefined &&
			(Array.isArray(v) || typeof v === "object" || typeof v === "function"),
		{
			message:
				"Expected a target: [x, y], a rect, { node }, { text }, { track } or (frame) => point",
		},
	);
	return target;
}
