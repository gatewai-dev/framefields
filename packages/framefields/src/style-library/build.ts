/**
 * Reads the style library from the `framefields-styles` skill: one markdown
 * file per part, frontmatter for the facts and `##` sections for guidance.
 * Used by `scripts/sync-style-library.ts` and the tests, never at runtime
 * (the runtime reads the generated `catalog.json`).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
	KIND_DIRS,
	type Preset,
	SECTIONS,
	type StyleKind,
	type StyleLibrary,
	type StylePart,
	type StylePartKind,
	type StyleSection,
} from "./types.js";

/** `plugins/framefields/skills/framefields-styles` in this repo. */
export const STYLE_SKILL_DIR = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../../plugins/framefields/skills/framefields-styles",
);

const id = z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const ref = z
	.string()
	.regex(/^(look|format|genre|medium)\/[a-z0-9-]+$/)
	.transform((s) => s as `${StylePartKind}/${string}`);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const seconds = z.number().positive();

const base = {
	id,
	name: z.string().min(1),
	summary: z.string().min(1),
	tags: z.array(z.string()).default([]),
	pairsWell: z.array(ref).default([]),
	clashes: z.array(ref).default([]),
};

const SCHEMAS = {
	look: z.strictObject({
		...base,
		palette: z.array(hex).min(2),
		fonts: z.strictObject({
			display: z.string(),
			body: z.string(),
			mono: z.string().optional(),
		}),
		ai: z.strictObject({
			direction: z.string().min(1),
			avoid: z.string().min(1),
			motion: z.string().min(1),
		}),
	}),
	format: z.strictObject({
		...base,
		width: z.number().int().positive(),
		height: z.number().int().positive(),
		fps: z.number().int().positive(),
		durationSec: z.strictObject({ min: seconds, max: seconds }),
		safeArea: z
			.strictObject({
				top: z.number().nonnegative(),
				right: z.number().nonnegative(),
				bottom: z.number().nonnegative(),
				left: z.number().nonnegative(),
			})
			.default({ top: 0, right: 0, bottom: 0, left: 0 }),
	}),
	genre: z.strictObject({
		...base,
		beats: z.array(z.string()).min(2),
		audio: z.array(z.enum(["voice", "music", "lyrics", "sound"])),
	}),
	medium: z.strictObject({
		...base,
		credit: z.boolean(),
		models: z.record(z.string(), z.string()).default({}),
	}),
	preset: z.strictObject({
		id,
		name: z.string().min(1),
		summary: z.string().min(1),
		featured: z.boolean().default(false),
		look: id,
		format: id,
		genre: id,
	}),
} as const;

/** Splits a file into its YAML frontmatter and markdown body. */
function splitFrontmatter(text: string, file: string) {
	const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
	if (!match) throw new Error(`${file}: no frontmatter`);
	try {
		return { data: parseYaml(match[1]) as unknown, body: match[2].trim() };
	} catch (error) {
		throw new Error(`${file}: ${(error as Error).message}`);
	}
}

/** `## Title` sections; text before the first heading is not allowed. */
function splitSections(body: string, file: string): StyleSection[] {
	const parts = body.split(/^## /m);
	if (parts[0].trim())
		throw new Error(`${file}: text before the first ## section`);
	return parts.slice(1).map((part) => {
		const newline = part.indexOf("\n");
		const title = (newline < 0 ? part : part.slice(0, newline)).trim();
		return { title, body: newline < 0 ? "" : part.slice(newline + 1).trim() };
	});
}

/** Each kind writes only its own headings, required ones present, in order. */
function checkSections(
	kind: StylePartKind,
	list: StyleSection[],
	file: string,
) {
	const spec = SECTIONS[kind];
	const order = spec.map((s) => s.title);
	let last = -1;
	for (const section of list) {
		const at = order.indexOf(section.title);
		if (at < 0)
			throw new Error(
				`${file}: "## ${section.title}" is not a ${kind} section (allowed: ${order.join(", ")})`,
			);
		if (at <= last)
			throw new Error(`${file}: "## ${section.title}" is out of order`);
		if (!section.body)
			throw new Error(`${file}: "## ${section.title}" is empty`);
		last = at;
	}
	for (const s of spec)
		if (s.required && !list.some((x) => x.title === s.title))
			throw new Error(`${file}: missing "## ${s.title}"`);
}

function parseFile(kind: StyleKind, file: string): StylePart | Preset {
	const name = path.basename(file, ".md");
	const { data, body } = splitFrontmatter(readFileSync(file, "utf8"), file);
	const result = SCHEMAS[kind].safeParse(data);
	if (!result.success)
		throw new Error(`${file}: ${z.prettifyError(result.error)}`);
	if (result.data.id !== name)
		throw new Error(`${file}: id "${result.data.id}" must match the file name`);
	if (kind === "preset") {
		const note = body.replace(/^## Note\s*/, "").trim();
		if (body && !/^## Note\b/.test(body))
			throw new Error(`${file}: a preset's only section is "## Note"`);
		return { kind, ...(result.data as z.infer<typeof SCHEMAS.preset>), note };
	}
	const sections = splitSections(body, file);
	checkSections(kind, sections, file);
	return { kind, ...result.data, sections } as StylePart;
}

function readKind(dir: string, kind: StyleKind) {
	const folder = path.join(dir, KIND_DIRS[kind]);
	return readdirSync(folder)
		.filter((f) => f.endsWith(".md"))
		.sort()
		.map((f) => parseFile(kind, path.join(folder, f)));
}

/** Every reference between parts points at a part that exists. */
function checkRefs(library: StyleLibrary) {
	const parts: StylePart[] = [
		...library.looks,
		...library.formats,
		...library.genres,
		...library.media,
	];
	const known = new Set(parts.map((p) => `${p.kind}/${p.id}`));
	const missing = (r: string) => !known.has(r);
	for (const part of parts)
		for (const r of [...part.pairsWell, ...part.clashes].filter(missing))
			throw new Error(`${part.kind}/${part.id}: unknown part ${r}`);
	for (const p of library.presets) {
		const refs = [`look/${p.look}`, `format/${p.format}`, `genre/${p.genre}`];
		for (const r of refs.filter(missing))
			throw new Error(`preset/${p.id}: unknown part ${r}`);
	}
}

/** Parses and checks the whole library. Throws on the first problem, naming the file. */
export function readStyleLibrary(dir = STYLE_SKILL_DIR): StyleLibrary {
	const library = {
		looks: readKind(dir, "look"),
		formats: readKind(dir, "format"),
		genres: readKind(dir, "genre"),
		media: readKind(dir, "medium"),
		presets: readKind(dir, "preset"),
	} as StyleLibrary;
	checkRefs(library);
	return library;
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

function table(head: string[], rows: string[][]): string {
	return [
		`| ${head.join(" | ")} |`,
		`|${head.map(() => "---").join("|")}|`,
		...rows.map((r) => `| ${r.map(cell).join(" | ")} |`),
	].join("\n");
}

const link = (dir: string, p: { id: string; name: string }) =>
	`[${p.name}](${dir}/${p.id}.md)`;

/** The generated part of SKILL.md: one table per kind. */
export function renderSkillTables(library: StyleLibrary): string {
	return [
		"### Looks",
		table(
			["Look", "What it is", "Tags"],
			library.looks.map((l) => [
				link("looks", l),
				l.summary,
				l.tags.join(", "),
			]),
		),
		"### Formats",
		table(
			["Format", "Frame", "Length", "What it is"],
			library.formats.map((f) => [
				link("formats", f),
				`${f.width}×${f.height}, ${f.fps} fps`,
				`${f.durationSec.min}–${f.durationSec.max} s`,
				f.summary,
			]),
		),
		"### Genres",
		table(
			["Genre", "Beats", "Audio"],
			library.genres.map((g) => [
				link("genres", g),
				g.beats.join(" → "),
				g.audio.join(", ") || "none",
			]),
		),
		"### Media",
		table(
			["Medium", "What it is", "Uses credit"],
			library.media.map((m) => [
				link("media", m),
				m.summary,
				m.credit ? "yes" : "no",
			]),
		),
		"### Presets",
		table(
			["Preset", "Look", "Format", "Genre"],
			library.presets.map((p) => [
				link("presets", p),
				p.look,
				p.format,
				p.genre,
			]),
		),
	].join("\n\n");
}

export const TABLES_START =
	"<!-- style-library:start (generated by pnpm run sync:style-library) -->";
export const TABLES_END = "<!-- style-library:end -->";

/** SKILL.md with its generated tables replaced. */
export function withSkillTables(skill: string, library: StyleLibrary): string {
	const start = skill.indexOf(TABLES_START);
	const end = skill.indexOf(TABLES_END);
	if (start < 0 || end < start)
		throw new Error("SKILL.md: missing the style-library markers");
	return `${skill.slice(0, start + TABLES_START.length)}\n\n${renderSkillTables(library)}\n\n${skill.slice(end)}`;
}
