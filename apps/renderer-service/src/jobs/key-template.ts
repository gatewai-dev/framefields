import { RenderError } from "../errors.js";
import { hasControlChars } from "../paths.js";

export interface KeyVars {
	jobId: string;
	sha: string;
	ref: string;
	ext: string;
	name: string;
	index: number;
	date?: Date;
}

const VAR = /\{(\w+)\}/g;
const KNOWN = new Set([
	"jobId",
	"sha",
	"shortSha",
	"ref",
	"date",
	"ext",
	"name",
	"index",
]);

/** Throws JOB_INVALID for templates that use unknown variables. */
export function checkKeyTemplate(template: string): void {
	for (const [, name] of template.matchAll(VAR)) {
		if (!KNOWN.has(name)) {
			throw new RenderError(
				"JOB_INVALID",
				`Unknown variable {${name}} in output key "${template}".`,
				{ hint: `Use one of ${[...KNOWN].map((k) => `{${k}}`).join(", ")}.` },
			);
		}
	}
}

/** Lowercase, `/`-free slug for refs like `feature/Intro v2`. */
export function slug(value: string): string {
	return (
		value
			.toLowerCase()
			.replace(/^refs\/(heads|tags)\//, "")
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^-+|-+$/g, "") || "x"
	);
}

/**
 * Renders an output key (or local path) and rejects results that could
 * escape their bucket/dir: `..` segments, a leading `/`, control characters.
 */
export function renderKey(template: string, vars: KeyVars): string {
	checkKeyTemplate(template);
	const date = (vars.date ?? new Date()).toISOString().slice(0, 10);
	const values: Record<string, string> = {
		jobId: vars.jobId,
		sha: vars.sha,
		shortSha: vars.sha.slice(0, 7),
		ref: slug(vars.ref),
		date,
		ext: vars.ext,
		name: slug(vars.name),
		index: String(vars.index),
	};
	const key = template
		.replace(VAR, (_, name: string) => values[name])
		.replace(/\/{2,}/g, "/");

	if (
		key.startsWith("/") ||
		hasControlChars(key) ||
		key.split("/").some((seg) => seg === ".." || seg === ".")
	) {
		throw new RenderError("PATH_ESCAPE", `Output key "${key}" is not allowed.`);
	}
	return key;
}

/** Renders one key per output and fails if two outputs would collide. */
export function renderKeys(
	template: string,
	outputs: readonly { name: string; ext: string }[],
	vars: Omit<KeyVars, "name" | "ext" | "index">,
): string[] {
	const keys = outputs.map((o, index) =>
		renderKey(template, { ...vars, name: o.name, ext: o.ext, index }),
	);
	const seen = new Set<string>();
	for (const key of keys) {
		if (seen.has(key)) {
			throw new RenderError(
				"JOB_INVALID",
				`Output key template "${template}" maps several outputs to "${key}".`,
				{ hint: "Add {name} or {index} to the key." },
			);
		}
		seen.add(key);
	}
	return keys;
}
