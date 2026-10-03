#!/usr/bin/env node
// Generates the gitframes-effects skill catalog from the Effect subclass source.
//
//   pnpm run sync:effects-catalog           # write the catalog
//   pnpm run sync:effects-catalog -- --check  # fail if the committed catalog is stale
//
// Sources:
//   - packages/gitframes/src/effects/generated/catalog.json, written by
//     scripts/generate-effects.mts from the node packages (op, props, defaults, ranges).
//   - packages/gitframes/src/effects/classes.ts for the classes that are still
//     hand-written. That half disappears once every class is generated
//     (spec/sync-node.md, Phase 2).
// `scripts/validate-agent-plugin.mjs` runs the --check mode so a new effect cannot ship undocumented.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLASSES_FILE = join(
	repoRoot,
	"packages",
	"gitframes",
	"src",
	"effects",
	"classes.ts",
);
const EFFECTS_DIR = dirname(CLASSES_FILE);
const GENERATED_CATALOG = join(EFFECTS_DIR, "generated", "catalog.json");
const NODES_DIR = join(repoRoot, "nodes");
const OUTPUT = join(
	repoRoot,
	"skills",
	"gitframes-effects",
	"references",
	"effects-catalog.md",
);

const source = readFileSync(CLASSES_FILE, "utf8");

/** Split an interface body into `name?: Type` entries, tolerating multi-line union types. */
function parseProps(body) {
	const entries = [];
	let current = null;
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (
			!trimmed ||
			trimmed.startsWith("//") ||
			trimmed.startsWith("*") ||
			trimmed.startsWith("/*")
		)
			continue;
		current = current === null ? trimmed : `${current} ${trimmed}`;
		if (!current.endsWith(";")) continue;
		const match = current.match(/^([A-Za-z_][\w]*)\??:\s*([\s\S]+);$/);
		if (match)
			entries.push({ name: match[1], type: match[2].replace(/\s+/g, " ") });
		current = null;
	}
	return entries;
}

function collectInterfaces() {
	const interfaces = new Map();
	const re = /export interface (\w+)Props \{([\s\S]*?)\n\}/g;
	for (const match of source.matchAll(re))
		interfaces.set(`${match[1]}Props`, parseProps(match[2]));
	return interfaces;
}

/** Brace-matched class bodies, so nested `super({ ... })` objects do not truncate the scan. */
function collectClasses() {
	const classes = [];
	const re = /export class (\w+) extends Effect<(\w+)> \{/g;
	for (const match of source.matchAll(re)) {
		const start = match.index + match[0].length;
		let depth = 1;
		let i = start;
		while (i < source.length && depth > 0) {
			const ch = source[i];
			if (ch === "{") depth += 1;
			else if (ch === "}") depth -= 1;
			i += 1;
		}
		classes.push({
			name: match[1],
			propsInterface: match[2],
			body: source.slice(start, i - 1),
		});
	}
	return classes;
}

function defaultsOf(body) {
	const defaults = new Map();
	// Literal `??` fallbacks in the constructor's super({ ... }) call. Computed defaults
	// (track-dependent expressions, locals) are intentionally left out rather than guessed.
	const re = /(\w+):\s*(?:config|rest)\.\w+\s*\?\?\s*([^,\n]+),/g;
	for (const match of body.matchAll(re))
		defaults.set(match[1], match[2].trim());
	return defaults;
}

/** Effects emitted by scripts/generate-effects.mts, in the catalog's own entry shape. */
function collectGenerated() {
	if (!existsSync(GENERATED_CATALOG)) return [];
	const { effects } = JSON.parse(readFileSync(GENERATED_CATALOG, "utf8"));
	return effects.map((effect) => {
		const props = effect.props.map((prop) => ({
			name: prop.name,
			type: prop.type,
			default: "default" in prop ? JSON.stringify(prop.default) : undefined,
			notes: notesOf(prop),
		}));
		// Props a hand-written subclass adds on top of the generated base.
		if (effect.custom) {
			const custom = readFileSync(join(EFFECTS_DIR, effect.custom), "utf8");
			const extra = custom.match(
				new RegExp(
					`export interface ${effect.name}Props extends \\w+ \\{([\\s\\S]*?)\\n\\}`,
				),
			);
			for (const prop of extra ? parseProps(extra[1]) : [])
				props.push({
					...prop,
					default: undefined,
					notes: `Added by \`${effect.custom}\`.`,
				});
		}
		return { name: effect.name, op: effect.op, props };
	});
}

function notesOf(prop) {
	const notes = [];
	if (prop.min !== undefined && prop.max !== undefined)
		notes.push(`Range ${prop.min} to ${prop.max}.`);
	else if (prop.min !== undefined) notes.push(`Minimum ${prop.min}.`);
	else if (prop.max !== undefined) notes.push(`Maximum ${prop.max}.`);
	if (prop.description) notes.push(prop.description);
	return notes.join(" ");
}

function buildCatalog() {
	const interfaces = collectInterfaces();
	const generated = collectGenerated();
	const legacy = collectClasses().map((entry) => {
		const defaults = defaultsOf(entry.body);
		return {
			name: entry.name,
			op: opOf(entry.body),
			props: (interfaces.get(entry.propsInterface) ?? []).map((prop) => ({
				...prop,
				default: defaults.get(prop.name),
			})),
		};
	});
	const classes = [...generated, ...legacy];
	const lines = [];

	lines.push("# gitframes effect catalog");
	lines.push("");
	lines.push(
		"> Generated by `pnpm run sync:effects-catalog` from the node schemas (via `pnpm run generate:effects`) and `packages/gitframes/src/effects/classes.ts`.",
	);
	lines.push(
		"> Do not edit by hand — a stale catalog fails `pnpm run check:plugins`.",
	);
	lines.push("");
	lines.push(
		`${classes.length} effect classes are available from the package root and the \`/effects\` subpath:`,
	);
	lines.push("");
	lines.push("```ts");
	lines.push('import { Blur, Curves, FilmGrain } from "gitframes";');
	lines.push('import { Blur, Curves, FilmGrain } from "gitframes/effects";');
	lines.push("```");
	lines.push("");
	lines.push(
		"Attach one with `layer.withEffect(effect)`, `layer.withEffects([...])`, `comp.apply(effect)`",
	);
	lines.push(
		"for a whole composition, `new Media(comp.toVirtualMedia()).apply(effect)` inside a media chain,",
	);
	lines.push(
		"or `comp.section({ effects: [...] })` for a spatial or tracked region. Every prop is an",
	);
	lines.push(
		"`EffectProp<T>`: a plain value, a reactive signal, or a function hook — see `sections.md`.",
	);
	lines.push("");
	lines.push(
		"Defaults come from the node's schema, or from the constructor for classes that are still",
	);
	lines.push(
		"hand-written; a `—` means the value is computed (often track-dependent) or defaulted downstream.",
	);
	lines.push(
		"Set `GITFRAMES_STRICT_PROPS=1` to make an unknown prop or an out-of-range value throw instead of warn.",
	);
	lines.push("");
	lines.push("| Effect | `op` | Props |");
	lines.push("| --- | --- | --- |");
	for (const entry of classes) {
		lines.push(
			`| \`${entry.name}\` | \`${entry.op}\` | ${entry.props.map((p) => `\`${p.name}\``).join(", ") || "—"} |`,
		);
	}
	lines.push("");
	lines.push("## Prop defaults");
	lines.push("");
	for (const entry of classes) {
		const props = entry.props;
		const defaults = new Map(
			props
				.filter((p) => p.default !== undefined)
				.map((p) => [p.name, p.default]),
		);
		const withNotes = props.some((p) => p.notes);
		lines.push(`### ${entry.name}`);
		lines.push("");
		lines.push("```ts");
		lines.push(`import { ${entry.name} } from "gitframes/effects";`);
		lines.push("");
		lines.push(
			`new ${entry.name}({ ${firstDefault(entry.name, props, defaults)} });`,
		);
		lines.push("```");
		lines.push("");
		if (props.length === 0) {
			lines.push("No configurable props.");
			lines.push("");
			continue;
		}
		lines.push(`| Prop | Type | Default |${withNotes ? " Notes |" : ""}`);
		lines.push(`| --- | --- | --- |${withNotes ? " --- |" : ""}`);
		for (const prop of props) {
			const type = prop.type.replaceAll("|", "\\|");
			const value = defaults.get(prop.name);
			lines.push(
				`| \`${prop.name}\` | \`${type}\` | ${value === undefined ? "—" : `\`${value.replaceAll("|", "\\|")}\``} |${withNotes ? ` ${(prop.notes ?? "").replaceAll("|", "\\|")} |` : ""}`,
			);
		}
		lines.push("");
	}
	lines.push("## Node packages");
	lines.push("");
	lines.push(
		"Beyond these classes, the engine ships node plugins under `nodes/` (audio DSP, generators,",
	);
	lines.push(
		"signal maths, vision). Each is a package named `@gitframes/node-<name>`:",
	);
	lines.push("");
	lines.push(
		readdirSync(NODES_DIR, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => `\`${d.name}\``)
			.sort()
			.join(", "),
	);
	lines.push("");
	return `${lines.join("\n")}`;
}

function opOf(body) {
	const match = body.match(/public readonly op = "([^"]+)"/);
	return match ? match[1] : "?";
}

function firstDefault(name, props, defaults) {
	// Prefer scalar defaults: an object literal makes a poor one-line example.
	const scalar = props.filter(
		(p) => defaults.has(p.name) && !/^[{[]/.test(defaults.get(p.name)),
	);
	const withDefault = scalar.slice(0, 3);
	if (withDefault.length === 0) return "/* props */";
	return withDefault
		.map((p) => `${p.name}: ${defaults.get(p.name)}`)
		.join(", ");
}

const catalog = buildCatalog();
const check = process.argv.includes("--check");

if (check) {
	if (!existsSync(OUTPUT)) {
		console.error(`effects catalog is missing: ${OUTPUT}`);
		process.exit(1);
	}
	const current = readFileSync(OUTPUT, "utf8");
	if (current !== catalog) {
		console.error(
			`effects catalog is stale: ${OUTPUT} — run \`pnpm run sync:effects-catalog\``,
		);
		process.exit(1);
	}
	console.log("effects catalog up to date");
} else {
	mkdirSync(dirname(OUTPUT), { recursive: true });
	writeFileSync(OUTPUT, catalog);
	console.log(`wrote ${OUTPUT}`);
}
