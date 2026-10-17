import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";
import { RenderError } from "../errors.js";
import type { RenderSettings } from "../jobs/schema.js";
import { resolveInside } from "../paths.js";
import { JOB_PARAM } from "./engine-alias.js";

/** What the worker can render: a framefields Composition or Media. */
export interface Renderable {
	renderVideo(options?: Record<string, unknown>): Promise<{
		filePath: string;
		cleanup: () => Promise<void>;
		qa?: unknown;
	}>;
	renderFrame(options: Record<string, unknown>): Promise<Buffer>;
	renderFrameGrid?(options: Record<string, unknown>): Promise<Buffer>;
	toVirtualMedia?(): unknown;
	virtualMedia?: unknown;
}

export interface PlanOutput {
	name: string;
	target: Renderable;
	render: Partial<RenderSettings>;
}

const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;

export function isRenderable(value: unknown): value is Renderable {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as Renderable).renderVideo === "function" &&
		typeof (value as Renderable).renderFrame === "function"
	);
}

export interface LoadedEntry {
	mod: Record<string, unknown>;
	/** Removes this job's TypeScript loader; call when the job is done. */
	dispose(): Promise<void>;
}

/**
 * Imports the entry with tsx, using the workdir's tsconfig. The import URL
 * carries a job token that the engine alias propagates through the repo's
 * own modules, so a job never sees modules cached by a previous one, while
 * framefields itself stays the worker's single instance (PLAN.md §8.1).
 */
export async function importEntry(
	workdir: string,
	entry: string,
	jobToken: string,
): Promise<LoadedEntry> {
	const file = await resolveInside(workdir, entry).catch((err) => {
		if (err instanceof RenderError) throw err;
		throw new RenderError(
			"ENTRY_NOT_FOUND",
			`Entry ${entry} does not exist in the workdir.`,
			{ phase: "load" },
		);
	});
	const tsconfig = path.join(workdir, "tsconfig.json");
	const unregister = register({
		tsconfig: existsSync(tsconfig) ? tsconfig : false,
	});
	const url = new URL(pathToFileURL(file).href);
	url.searchParams.set(JOB_PARAM, jobToken);
	try {
		const mod = (await import(/* @vite-ignore */ url.href)) as Record<
			string,
			unknown
		>;
		return { mod, dispose: unregister };
	} catch (err) {
		await unregister();
		throw classifyLoadError(err, file);
	}
}

export function classifyLoadError(
	err: unknown,
	entryFile: string,
): RenderError {
	if (err instanceof RenderError) return err;
	const e = err as NodeJS.ErrnoException & { url?: string };
	const message = e?.message ?? String(err);
	if (
		e?.code === "ERR_MODULE_NOT_FOUND" ||
		/Cannot find (module|package)/.test(message)
	) {
		const missing =
			/Cannot find (?:module|package) '([^']+)'/.exec(message)?.[1] ?? "";
		const missingEntry =
			missing.split("?")[0] === entryFile ||
			missing.split("?")[0] === pathToFileURL(entryFile).href;
		return new RenderError(
			missingEntry ? "ENTRY_NOT_FOUND" : "ENTRY_COMPILE_FAILED",
			message,
			{
				phase: "load",
				hint: missingEntry
					? undefined
					: "An import couldn't be resolved: is the dependency in package.json and the lockfile?",
				cause: err,
			},
		);
	}
	if (
		e instanceof SyntaxError ||
		/Transform failed|Expected .* but found|Unexpected token|ERR_UNKNOWN_FILE_EXTENSION/.test(
			message,
		)
	) {
		return new RenderError("ENTRY_COMPILE_FAILED", message, {
			phase: "load",
			cause: err,
		});
	}
	return new RenderError("COMPOSITION_BUILD_FAILED", message, {
		phase: "load",
		cause: err,
	});
}

/**
 * Reads the export, calls it with `args` when it is a function, and turns the
 * result into a list of named outputs (PLAN.md §4 "Export shapes").
 */
export async function buildPlan(
	mod: Record<string, unknown>,
	exportName: string,
	args: unknown,
	select: string[] | undefined,
): Promise<PlanOutput[]> {
	if (!(exportName in mod)) {
		const available = Object.keys(mod).filter((k) => k !== "__esModule");
		throw new RenderError(
			"EXPORT_NOT_FOUND",
			`The entry has no export named "${exportName}".`,
			{
				phase: "load",
				hint: available.length
					? `Exports: ${available.slice(0, 10).join(", ")}`
					: "The module exports nothing.",
			},
		);
	}
	let value = mod[exportName];
	if (typeof value === "function" && !isRenderable(value)) {
		try {
			value = await (value as (a: unknown) => unknown)(args);
		} catch (err) {
			if (err instanceof RenderError) throw err;
			throw new RenderError(
				"COMPOSITION_BUILD_FAILED",
				`${exportName}() threw: ${err instanceof Error ? err.message : String(err)}`,
				{ phase: "load", cause: err },
			);
		}
	}

	let outputs: PlanOutput[];
	if (isRenderable(value)) {
		outputs = [{ name: "main", target: value, render: {} }];
	} else if (isPlan(value)) {
		outputs = value.outputs.map((o, i) => {
			if (!isRenderable(o?.composition)) {
				throw invalid(`outputs[${i}].composition is not a Composition.`);
			}
			return {
				name: String(o.name ?? `output-${i}`),
				target: o.composition,
				render: o.render ?? {},
			};
		});
	} else if (value && typeof value === "object" && !Array.isArray(value)) {
		const entries = Object.entries(value);
		if (entries.length === 0 || !entries.every(([, v]) => isRenderable(v))) {
			throw invalid(describe(value));
		}
		outputs = entries.map(([name, target]) => ({
			name,
			target: target as Renderable,
			render: {},
		}));
	} else {
		throw invalid(describe(value));
	}

	for (const o of outputs) {
		if (!NAME.test(o.name))
			throw invalid(`Output name "${o.name}" must match ${NAME}.`);
	}
	if (new Set(outputs.map((o) => o.name)).size !== outputs.length) {
		throw invalid("Output names must be unique.");
	}
	if (select) {
		const missing = select.filter((s) => !outputs.some((o) => o.name === s));
		if (missing.length) {
			throw new RenderError(
				"JOB_INVALID",
				`target.select names unknown outputs: ${missing.join(", ")}.`,
				{
					phase: "load",
					hint: `Available: ${outputs.map((o) => o.name).join(", ")}`,
				},
			);
		}
		outputs = outputs.filter((o) => select.includes(o.name));
	}
	return outputs;
}

interface PlanShape {
	outputs: {
		name?: unknown;
		composition?: unknown;
		render?: Partial<RenderSettings>;
	}[];
}

function isPlan(value: unknown): value is PlanShape {
	return (
		typeof value === "object" &&
		value !== null &&
		Array.isArray((value as PlanShape).outputs) &&
		(value as PlanShape).outputs.length > 0
	);
}

function describe(value: unknown): string {
	const kind =
		value === null ? "null" : Array.isArray(value) ? "an array" : typeof value;
	return `The export resolved to ${kind}, not a Composition, a record of compositions, or { outputs: [...] }.`;
}

function invalid(message: string): RenderError {
	return new RenderError("EXPORT_INVALID", message, { phase: "load" });
}
