/**
 * `framefields.json` at the project root: where installed components live,
 * which fonts `framefields add` / `framefields fonts add` installed, and the
 * project's named renders.
 *
 * ```json
 * {
 *   "components": "src/components",
 *   "renders": {
 *     "film": {
 *       "title": "Launch film",
 *       "entry": "src/film.ts",
 *       "export": "buildFilm",
 *       "workers": "auto"
 *     }
 *   }
 * }
 * ```
 *
 * A named render is what `framefields render film --cloud`, `framefields
 * check film`, `renderCloud({ render: "film" })` and the dashboard's New
 * render dialog pick, so nobody chooses files and exports by hand.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_FILE = "framefields.json";

/** One renderable piece of the project: an export of a module, with its defaults. */
export interface RenderSpec {
	/** The module that builds the composition, relative to the project root. */
	entry: string;
	/** A Composition, or a function returning one. Default `buildFilm`. */
	export?: string;
	/** Shown in the dashboard and `framefields renders`. Default: the name. */
	title?: string;
	description?: string;
	/** Passed to the export when it is a function. */
	args?: unknown;
	/** When the export returns several compositions, the one to render. */
	select?: string;
	/** Cloud workers: 1, a number, or "auto" to split long films. Default 1. */
	workers?: number | "auto";
	maxWorkers?: number;
	codec?: "h264" | "vp9";
	quality?: "very_low" | "low" | "high" | "very_high";
	/** Where `framefields render <name> --cloud` writes the video. */
	output?: string;
}

export interface ProjectConfig {
	/** Components directory, relative to the project root. */
	components: string;
	/**
	 * Font files by role (`emoji`), relative to the project root. A role
	 * set here counts as installed: point it at your own font to use that.
	 */
	fonts?: Partial<Record<string, string>>;
	/** Named renders, by name (letters, digits, `-`, `_`, `.`). */
	renders?: Record<string, RenderSpec>;
}

export const RENDER_NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const QUALITIES = ["very_low", "low", "high", "very_high"];

/**
 * The project's config, or the default it would get: `src/components` when
 * there is a `src`. `saved` is whether the file records a components folder.
 */
export function readConfig(cwd: string): {
	config: ProjectConfig;
	saved: boolean;
} {
	const file = join(cwd, CONFIG_FILE);
	const fallback = existsSync(join(cwd, "src"))
		? "src/components"
		: "components";
	if (!existsSync(file))
		return { config: { components: fallback }, saved: false };
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(file, "utf8"));
	} catch (err) {
		throw new Error(
			`${CONFIG_FILE} is not valid JSON: ${(err as Error).message}`,
		);
	}
	if (!isRecord(raw)) throw new Error(`${CONFIG_FILE} must be a JSON object`);
	const { components, fonts, renders } = raw;
	if (components !== undefined && typeof components !== "string")
		throw new Error(`${CONFIG_FILE}: "components" must be a directory path`);
	if (
		fonts !== undefined &&
		(!isRecord(fonts) ||
			Object.values(fonts).some((v) => typeof v !== "string"))
	)
		throw new Error(
			`${CONFIG_FILE}: "fonts" must map roles to font file paths, e.g. { "emoji": "assets/fonts/NotoColorEmoji.ttf" }`,
		);
	// Other keys (a `$schema`, say) survive a rewrite.
	const config = {
		...raw,
		components: components ?? fallback,
		...(renders !== undefined && { renders: parseRenders(renders) }),
	} as ProjectConfig;
	return { config, saved: components !== undefined };
}

export function writeConfig(cwd: string, config: ProjectConfig): void {
	writeFileSync(
		join(cwd, CONFIG_FILE),
		`${JSON.stringify(config, null, "\t")}\n`,
	);
}

/** Validates the `renders` map; errors name the render and field at fault. */
export function parseRenders(value: unknown): Record<string, RenderSpec> {
	if (!isRecord(value))
		throw new Error(
			`${CONFIG_FILE}: "renders" must map names to renders, e.g. { "film": { "entry": "src/film.ts" } }`,
		);
	const out: Record<string, RenderSpec> = {};
	for (const [name, spec] of Object.entries(value)) {
		const fail = (message: string) => {
			throw new Error(`${CONFIG_FILE}: renders.${name} ${message}`);
		};
		if (!RENDER_NAME.test(name))
			fail("has an invalid name: use letters, digits, -, _ and . (at most 64)");
		if (!isRecord(spec)) fail("must be an object with an entry");
		const s = spec as Record<string, unknown>;
		if (!isRelativePath(s.entry))
			fail(
				'needs "entry": the module path inside the project, e.g. "src/film.ts"',
			);
		if (
			s.export !== undefined &&
			!(typeof s.export === "string" && IDENTIFIER.test(s.export))
		)
			fail('"export" must be a JavaScript identifier');
		for (const key of ["title", "description", "select"] as const)
			if (s[key] !== undefined && typeof s[key] !== "string")
				fail(`"${key}" must be a string`);
		if (s.workers !== undefined && s.workers !== "auto" && !isCount(s.workers))
			fail('"workers" must be "auto" or a positive whole number');
		if (s.maxWorkers !== undefined && !isCount(s.maxWorkers))
			fail('"maxWorkers" must be a positive whole number');
		if (s.codec !== undefined && s.codec !== "h264" && s.codec !== "vp9")
			fail('"codec" must be "h264" or "vp9"');
		if (s.quality !== undefined && !QUALITIES.includes(s.quality as string))
			fail(`"quality" must be one of ${QUALITIES.join(", ")}`);
		if (s.output !== undefined && typeof s.output !== "string")
			fail('"output" must be a file path');
		out[name] = s as unknown as RenderSpec;
	}
	return out;
}

/**
 * The named render `name` of the project at `cwd`, or undefined when there
 * is no render by that name (an entry path, say).
 */
export function findRender(
	cwd: string,
	name: string,
): (RenderSpec & { name: string }) | undefined {
	const spec = readConfig(cwd).config.renders?.[name];
	return spec && { ...spec, name };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): boolean {
	return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isRelativePath(value: unknown): boolean {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		!value.startsWith("/") &&
		!value.split(/[/\\]/).includes("..")
	);
}
