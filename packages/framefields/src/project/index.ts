/**
 * `framefields.json`, the project manifest: names a project's compositions so
 * tools (the `ff` CLI, the preview, Framefields Cloud, agents) can tell what is
 * previewable without running code. Each composition is the `{ entry, export }`
 * pair `startPreview` already takes, under a stable id.
 *
 * This module only reads JSON and imports entries on request; it never loads
 * the engine itself, so the CLI can bundle it.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Composition } from "../index.js";

export const MANIFEST_FILE = "framefields.json";
export const MANIFEST_SCHEMA_URL =
	"https://framefields.dev/schemas/project.v1.json";

/** Used when a project has no manifest: the layout `ff init` scaffolds. */
export const DEFAULT_COMPOSITION = {
	id: "film",
	entry: "src/film.ts",
	export: "buildFilm",
} as const;

const COMPOSITION_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ENTRY_EXT = /\.(ts|tsx|mts|js|mjs)$/;

const isInsidePath = (p: string) =>
	!p.startsWith("/") &&
	!/^[A-Za-z]:/.test(p) &&
	!p.split(/[\\/]/).includes("..");

const entryPath = z
	.string()
	.min(1)
	.refine(isInsidePath, "entry must be a path inside the project")
	.regex(ENTRY_EXT, "entry must be a .ts, .tsx, .mts, .js or .mjs file");

const compositionSchema = z.looseObject({
	entry: entryPath,
	export: z
		.string()
		.regex(IDENTIFIER, "export must be a JavaScript identifier")
		.default("default"),
	title: z.string().max(120).optional(),
	description: z.string().max(500).optional(),
	/** Groups compositions in pickers, e.g. "Steps" or "Scenes". */
	group: z.string().max(60).optional(),
	/** The composition opened and rendered when none is named. At most one. */
	default: z.boolean().optional(),
});

const assetsSchema = z.looseObject({
	directory: z
		.string()
		.min(1)
		.refine(isInsidePath, "assets.directory must be inside the project")
		.optional(),
	exclude: z.array(z.string().min(1)).optional(),
});

export const projectManifestSchema = z.looseObject({
	$schema: z.string().optional(),
	version: z.literal(1).default(1),
	compositions: z
		.record(
			z
				.string()
				.regex(
					COMPOSITION_ID,
					"composition ids are lowercase letters, digits and dashes (max 63)",
				),
			compositionSchema,
		)
		.refine(
			(c) => Object.keys(c).length > 0,
			"declare at least one composition",
		)
		.refine(
			(c) => Object.values(c).filter((x) => x.default).length <= 1,
			"only one composition can be the default",
		),
	assets: assetsSchema.optional(),
	output: z
		.string()
		.min(1)
		.refine(isInsidePath, "output must be inside the project")
		.optional(),
});

export type ProjectManifest = z.input<typeof projectManifestSchema>;

export interface ResolvedComposition {
	id: string;
	entry: string;
	export: string;
	title: string;
	description: string | null;
	group: string | null;
	default: boolean;
}

export interface Project {
	/** Directory containing framefields.json (or package.json). */
	root: string;
	source: "manifest" | "default";
	compositions: ResolvedComposition[];
	defaultId: string;
	assets: { directory: string; exclude: string[] };
	output: string;
}

export type ProjectErrorKind =
	/** No framefields.json or package.json above the directory. */
	| "not-found"
	/** framefields.json is not valid JSON or breaks a rule. */
	| "invalid"
	/** A `<composition>` reference names nothing in the project. */
	| "unknown-composition"
	/** The entry could not be imported, or its export isn't a composition. */
	| "build";

/** A problem with a project, its manifest or a composition reference. */
export class ProjectError extends Error {
	override name = "ProjectError";
	constructor(
		message: string,
		readonly kind: ProjectErrorKind,
		/** The file the problem is in, when there is one. */
		readonly path?: string,
		/** A follow-up the user can run or check. */
		readonly hint?: string,
	) {
		super(message);
	}
}

/** `step-1` → `Step 1`. */
export const humanize = (id: string) =>
	id.replace(/-+/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/**
 * Parses manifest JSON (already decoded) into a project at `root`. Exposed for
 * readers that get the file from elsewhere, such as a git tree.
 */
export function resolveManifest(json: unknown, root: string): Project {
	const file = path.join(root, MANIFEST_FILE);
	const parsed = projectManifestSchema.safeParse(json);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
		throw new ProjectError(
			`${MANIFEST_FILE}${where}: ${issue?.message ?? "invalid"}`,
			"invalid",
			file,
		);
	}
	const data = parsed.data;
	const entries = Object.entries(data.compositions);
	const defaultId =
		entries.find(([, c]) => c.default)?.[0] ?? (entries[0]?.[0] as string);
	return {
		root,
		source: "manifest",
		defaultId,
		compositions: entries.map(([id, c]) => ({
			id,
			entry: normalizeEntry(c.entry),
			export: c.export,
			title: c.title ?? humanize(id),
			description: c.description ?? null,
			group: c.group ?? null,
			default: id === defaultId,
		})),
		assets: {
			directory: data.assets?.directory ?? "assets",
			exclude: data.assets?.exclude ?? ["**/.DS_Store"],
		},
		output: data.output ?? "output",
	};
}

/** The project of a directory with no manifest: one composition, `film`. */
export function defaultProject(root: string): Project {
	const c = DEFAULT_COMPOSITION;
	return {
		root,
		source: "default",
		defaultId: c.id,
		compositions: [
			{
				...c,
				title: humanize(c.id),
				description: null,
				group: null,
				default: true,
			},
		],
		assets: { directory: "assets", exclude: ["**/.DS_Store"] },
		output: "output",
	};
}

/**
 * Finds the project root from `cwd` upwards and resolves its manifest. The
 * root is the nearest directory holding `framefields.json` or `package.json`;
 * a package without a manifest gets the default `film` composition.
 */
export async function loadProject(cwd = process.cwd()): Promise<Project> {
	const start = path.resolve(cwd);
	for (let dir = start; ; dir = path.dirname(dir)) {
		const manifest = path.join(dir, MANIFEST_FILE);
		if (fs.existsSync(manifest)) {
			const raw = await fs.promises.readFile(manifest, "utf8");
			let json: unknown;
			try {
				json = JSON.parse(raw);
			} catch (err) {
				throw new ProjectError(
					`${MANIFEST_FILE} is not valid JSON: ${(err as Error).message}`,
					"invalid",
					manifest,
				);
			}
			return resolveManifest(json, dir);
		}
		if (fs.existsSync(path.join(dir, "package.json")))
			return defaultProject(dir);
		if (path.dirname(dir) === dir) break;
	}
	throw new ProjectError(
		`no framefields project found in ${start} or any parent directory`,
		"not-found",
		undefined,
		"ff init",
	);
}

/** True when `ref` is a `file#export` or file reference rather than an id. */
export function isFileReference(ref: string): boolean {
	const file = ref.split("#")[0] ?? "";
	return ref.includes("#") || ENTRY_EXT.test(file) || file.includes("/");
}

/**
 * Resolves `<composition>` (an id, `file#export`, a bare file, or undefined
 * for the default) against a project.
 */
export function resolveComposition(
	project: Project,
	ref?: string,
): ResolvedComposition {
	if (ref === undefined || ref === "") {
		const found = project.compositions.find((c) => c.id === project.defaultId);
		if (found) return found;
		throw new ProjectError("the project has no default composition", "invalid");
	}
	if (isFileReference(ref)) return adHocComposition(project, ref);
	const found = project.compositions.find((c) => c.id === ref);
	if (found) return found;
	throw new ProjectError(
		`unknown composition '${ref}'`,
		"unknown-composition",
		undefined,
		`compositions${project.source === "manifest" ? ` in ${MANIFEST_FILE}` : ""}: ${listIds(project)} (ff ls)`,
	);
}

/** `a, b, c` or `a, b … h` for long lists. */
function listIds(project: Project): string {
	const ids = project.compositions.map((c) => c.id);
	return ids.length > 4
		? `${ids.slice(0, 2).join(", ")} … ${ids[ids.length - 1]}`
		: ids.join(", ");
}

function adHocComposition(project: Project, ref: string): ResolvedComposition {
	const hash = ref.indexOf("#");
	const file = hash === -1 ? ref : ref.slice(0, hash);
	const exportName = hash === -1 ? "default" : ref.slice(hash + 1);
	const abs = path.resolve(project.root, file);
	const entry = normalizeEntry(path.relative(project.root, abs));
	if (entry.startsWith("..") || path.isAbsolute(entry)) {
		throw new ProjectError(
			`'${file}' is outside the project (${project.root})`,
			"unknown-composition",
		);
	}
	if (!ENTRY_EXT.test(entry)) {
		throw new ProjectError(
			`'${file}' is not a .ts, .tsx, .mts, .js or .mjs file`,
			"unknown-composition",
		);
	}
	if (!IDENTIFIER.test(exportName)) {
		throw new ProjectError(
			`'${exportName}' is not a JavaScript identifier`,
			"unknown-composition",
		);
	}
	const listed = project.compositions.find(
		(c) => c.entry === entry && c.export === exportName,
	);
	if (listed) return listed;
	const base = path
		.basename(entry)
		.replace(ENTRY_EXT, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-");
	const suffix =
		exportName === "default"
			? ""
			: `-${exportName
					.replace(/([a-z0-9])([A-Z])/g, "$1-$2")
					.toLowerCase()
					.replace(/[^a-z0-9]+/g, "-")}`;
	const id =
		`${base}${suffix}`.replace(/^-+|-+$/g, "").slice(0, 63) || "composition";
	return {
		id,
		entry,
		export: exportName,
		title: `${entry}#${exportName}`,
		description: null,
		group: null,
		default: false,
	};
}

function normalizeEntry(entry: string): string {
	return entry.split(path.sep).join("/").replace(/^\.\//, "");
}

/**
 * Imports the entry and calls the export: the one place that turns a
 * reference into a Composition. TypeScript entries need a loader (tsx, or a
 * Node that strips types); the `ff` CLI registers one.
 */
export async function buildComposition(
	project: Project,
	ref?: string,
): Promise<Composition> {
	const target = resolveComposition(project, ref);
	const file = path.join(project.root, target.entry);
	const where = `${target.entry}#${target.export}`;
	if (!fs.existsSync(file)) {
		throw new ProjectError(
			`${target.entry} does not exist (composition '${target.id}')`,
			"build",
			file,
			project.source === "default"
				? `create it, or list your compositions in ${MANIFEST_FILE}`
				: undefined,
		);
	}
	let mod: Record<string, unknown>;
	try {
		mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
	} catch (err) {
		throw new ProjectError(
			`could not import ${target.entry}: ${errorMessage(err)}`,
			"build",
			file,
		);
	}
	const exported = mod[target.export];
	if (exported === undefined) {
		const names = Object.keys(mod).filter((k) => typeof mod[k] === "function");
		throw new ProjectError(
			`${target.entry} has no export named '${target.export}'`,
			"build",
			file,
			names.length ? `function exports: ${names.join(", ")}` : undefined,
		);
	}
	let value: unknown;
	try {
		value =
			typeof exported === "function"
				? await (exported as () => unknown)()
				: exported;
	} catch (err) {
		const error = new ProjectError(
			`${where} threw: ${errorMessage(err)}`,
			"build",
			file,
		);
		error.cause = err;
		throw error;
	}
	if (!isComposition(value)) {
		throw new ProjectError(
			`${where} did not return a Composition`,
			"build",
			file,
		);
	}
	return value as Composition;
}

function isComposition(value: unknown): boolean {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { toSpec?: unknown }).toSpec === "function" &&
		typeof (value as { renderFrame?: unknown }).renderFrame === "function"
	);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}
