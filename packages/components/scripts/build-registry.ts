/**
 * Builds the component registry `framefields add` installs from: one JSON
 * item per component folder, holding its source rewritten for a user's
 * project, plus an index of them all. Written to `dist/registry/`, which
 * the `framefields` build ships inside its own dist.
 *
 * The rewrite is import-only: `../core/*` and `zod` become one import from
 * `framefields/components` (the toolkit, which re-exports framefields' own
 * zod so schemas share its instance), `@framefields/compositions/program`
 * becomes `framefields`, and sibling components stay relative and become
 * registry dependencies. The folder's `index.ts` gains the bound factory.
 * Tests and `meta.ts` are left out; the meta travels as item fields.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ComponentMeta, FontNeed } from "../src/core/meta.js";
import { collectMeta } from "./build-meta.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const NOT_COMPONENTS = new Set(["core", "test"]);
export const TOOLKIT = "framefields/components";
export const RUNTIME = "framefields";

export interface RegistryFile {
	/** Relative to the components directory, e.g. `counter/plan.ts`. */
	path: string;
	content: string;
}

export interface RegistryEntry
	extends Pick<ComponentMeta, "summary" | "tags" | "example"> {
	/** Folder name, what `framefields add` takes: `logo-reveal`. */
	name: string;
	/** The factory the item exports: `LogoReveal`. */
	title: string;
	/** Other registry items it imports, installed with it. */
	registryDependencies: string[];
}

export interface RegistryItem extends RegistryEntry {
	parts: readonly string[];
	cues: readonly string[];
	/** Fonts to install with it (`framefields add` fetches them). */
	fonts?: readonly FontNeed[];
	files: RegistryFile[];
}

const IMPORT = /^import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)";[ \t]*\n/gm;
const SIBLING = /^\.\.\/([a-z0-9-]+)\/[a-z0-9-]+\.js$/;

/** Rewrite one source file's imports; returns the sibling folders it reads. */
export function rewriteImports(
	source: string,
	file: string,
	extra: string[] = [],
): { content: string; siblings: string[] } {
	const toolkit = new Set<string>(extra);
	const runtime = new Set<string>();
	const siblings = new Set<string>();
	let first: number | undefined;
	let runtimeAt: number | undefined;
	const kept = source.replace(
		IMPORT,
		(whole, typeOnly: string | undefined, names: string, from: string, at) => {
			const specs = names
				.split(",")
				.map((n) => n.trim())
				.filter(Boolean)
				.map((n) => (typeOnly && !n.startsWith("type ") ? `type ${n}` : n));
			const sibling = SIBLING.exec(from)?.[1];
			if (sibling && sibling !== "core") siblings.add(sibling);
			let into: Set<string> | undefined;
			if (from.startsWith("../core/") || from === "zod") into = toolkit;
			else if (from === "@framefields/compositions/program") into = runtime;
			else if (from.startsWith("@framefields/"))
				throw new Error(`${file}: cannot rewrite import from "${from}"`);
			if (!into) return whole;
			for (const s of specs) into.add(s);
			// The merged imports go where the first rewritten one was.
			if (first === undefined) first = at as number;
			if (into === runtime && runtimeAt === undefined) runtimeAt = at as number;
			return "\0";
		},
	);
	const block = [
		runtime.size > 0 ? importLine(runtime, RUNTIME) : "",
		toolkit.size > 0 ? importLine(toolkit, TOOLKIT) : "",
	].join("");
	let content: string;
	if (first === undefined) {
		// Nothing to replace: the new import goes after the last existing one.
		const lastImport = [...source.matchAll(IMPORT)].at(-1);
		const end = lastImport ? (lastImport.index ?? 0) + lastImport[0].length : 0;
		content = source.slice(0, end) + block + source.slice(end);
	} else {
		let placed = false;
		content = kept.replace(/\0/g, () => {
			if (placed) return "";
			placed = true;
			return block;
		});
	}
	// Inline type imports: `import("../core/host.js").Host`.
	content = content.replace(
		/import\("\.\.\/core\/[a-z]+\.js"\)/g,
		`import("${TOOLKIT}")`,
	);
	if (/["']\.\.\/core\//.test(content))
		throw new Error(`${file}: a "../core/" reference survived the rewrite`);
	return { content, siblings: [...siblings] };
}

function importLine(names: Set<string>, from: string): string {
	const sorted = [...names].sort((a, b) => {
		const x = a.replace(/^type /, "");
		const y = b.replace(/^type /, "");
		return (
			x.localeCompare(y, "en", { sensitivity: "base" }) || (x < y ? -1 : 1)
		);
	});
	// All types: `import type { A, B }`, as the linter wants it.
	const typeOnly = sorted.every((n) => n.startsWith("type "));
	const specs = typeOnly ? sorted.map((n) => n.slice(5)) : sorted;
	const head = typeOnly ? "import type" : "import";
	const one = `${head} { ${specs.join(", ")} } from "${from}";\n`;
	if (one.length <= 81) return one;
	return `${head} {\n${specs.map((n) => `\t${n},\n`).join("")}} from "${from}";\n`;
}

/** A JSDoc block wrapped at 80 columns. */
function docComment(text: string): string {
	if (text.length <= 74) return `/** ${text} */\n`;
	const lines: string[] = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (line && line.length + word.length + 1 > 77) {
			lines.push(line);
			line = word;
		} else line = line ? `${line} ${word}` : word;
	}
	lines.push(line);
	return `/**\n${lines.map((l) => ` * ${l}\n`).join("")} */\n`;
}

/** `LogoReveal` → `logoReveal`: the definition each folder exports. */
const definitionName = (title: string) =>
	title.charAt(0).toLowerCase() + title.slice(1);

/** One component folder as a registry item. */
export function registryItem(
	src: string,
	name: string,
	meta: ComponentMeta,
): RegistryItem {
	const dir = join(src, name);
	const def = definitionName(meta.name);
	const files: RegistryFile[] = [];
	const deps = new Set<string>();
	for (const f of readdirSync(dir).sort()) {
		if (!f.endsWith(".ts") || f.endsWith(".test.ts") || f === "meta.ts")
			continue;
		const source = readFileSync(join(dir, f), "utf8");
		const isIndex = f === "index.ts";
		if (isIndex && !new RegExp(`export const ${def}\\b`).test(source))
			throw new Error(`${name}/index.ts does not export \`${def}\``);
		const { content, siblings } = rewriteImports(
			source,
			`${name}/${f}`,
			isIndex ? ["bindComponent"] : [],
		);
		for (const s of siblings) deps.add(s);
		files.push({
			path: `${name}/${f}`,
			content: isIndex
				? `${content.trimEnd()}\n\n${docComment(meta.summary)}export const ${meta.name} = /* @__PURE__ */ bindComponent(${def});\n`
				: content,
		});
	}
	return {
		name,
		title: meta.name,
		summary: meta.summary,
		tags: meta.tags,
		example: meta.example,
		parts: meta.parts,
		cues: meta.cues,
		...(meta.fonts && { fonts: meta.fonts }),
		registryDependencies: [...deps].sort(),
		files,
	};
}

/** Every component folder under `src`, sorted by name. */
export async function buildRegistry(src = SRC): Promise<RegistryItem[]> {
	await collectMeta(src); // every folder has a meta, names are unique
	const items: RegistryItem[] = [];
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (!entry.isDirectory() || NOT_COMPONENTS.has(entry.name)) continue;
		const mod = (await import(
			pathToFileURL(join(src, entry.name, "meta.ts")).href
		)) as { default: ComponentMeta };
		items.push(registryItem(src, entry.name, mod.default));
	}
	const names = new Set(items.map((i) => i.name));
	for (const item of items)
		for (const d of item.registryDependencies)
			if (!names.has(d))
				throw new Error(
					`${item.name} imports "${d}", which is not a component`,
				);
	return items.sort((a, b) => a.name.localeCompare(b.name));
}

/** Write `index.json` and one `<name>.json` per item into `out`. */
export function writeRegistry(items: RegistryItem[], out: string): void {
	mkdirSync(out, { recursive: true });
	const index: RegistryEntry[] = items.map(
		({ name, title, summary, tags, example, registryDependencies }) => ({
			name,
			title,
			summary,
			tags,
			example,
			registryDependencies,
		}),
	);
	writeFileSync(
		join(out, "index.json"),
		`${JSON.stringify(index, null, "\t")}\n`,
	);
	for (const item of items)
		writeFileSync(
			join(out, `${item.name}.json`),
			`${JSON.stringify(item, null, "\t")}\n`,
		);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const items = await buildRegistry();
	const out = fileURLToPath(new URL("../dist/registry", import.meta.url));
	writeRegistry(items, out);
	console.log(`registry: ${items.length} component(s)`);
}
