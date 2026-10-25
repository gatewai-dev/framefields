/**
 * Collects every component's `meta.ts` (default export) into
 * `dist/components.json`: the list docs and the skills generator read. Each
 * entry also carries its props (type, default, description: see
 * `props-doc.ts`); the props every component shares go to
 * `dist/base-props.json`.
 * Run with `pnpm --filter @framefields/components meta` (also part of build).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { z } from "zod";
import { basePropsSchema } from "../src/core/contract.js";
import type { ComponentMeta } from "../src/core/meta.js";
import { type PropDoc, propComments, propDocs } from "./props-doc.js";

/** A component's meta plus its documented props. */
export type CollectedMeta = ComponentMeta & { props?: PropDoc[] };

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const NOT_COMPONENTS = new Set(["core", "test"]);

export async function collectMeta(src = SRC): Promise<CollectedMeta[]> {
	const metas: CollectedMeta[] = [];
	for (const entry of readdirSync(src, { withFileTypes: true })) {
		if (!entry.isDirectory() || NOT_COMPONENTS.has(entry.name)) continue;
		const file = join(src, entry.name, "meta.ts");
		if (!existsSync(file)) {
			throw new Error(`Component folder "${entry.name}" has no meta.ts`);
		}
		const mod = (await import(pathToFileURL(file).href)) as {
			default?: ComponentMeta;
		};
		if (!mod.default) throw new Error(`${file} has no default export`);
		const index = join(src, entry.name, "index.ts");
		metas.push(
			existsSync(index)
				? {
						...mod.default,
						props: await componentProps(index, mod.default.name),
					}
				: mod.default,
		);
	}
	const names = new Set<string>();
	for (const m of metas) {
		if (names.has(m.name))
			throw new Error(`Duplicate component name "${m.name}"`);
		names.add(m.name);
	}
	return metas.sort((a, b) => a.name.localeCompare(b.name));
}

/** Props of the definition `index` exports under `name`. */
async function componentProps(index: string, name: string): Promise<PropDoc[]> {
	const mod = (await import(pathToFileURL(index).href)) as Record<
		string,
		unknown
	>;
	const definition = Object.values(mod).find(
		(v): v is { name: string; props: () => Record<string, z.ZodType> } =>
			typeof v === "object" &&
			v !== null &&
			(v as { name?: unknown }).name === name &&
			typeof (v as { props?: unknown }).props === "function",
	);
	if (!definition)
		throw new Error(`${index} exports no definition named ${name}`);
	return propDocs(definition.props(), propComments(index));
}

/** The props every component accepts. */
export function baseProps(): PropDoc[] {
	return propDocs(
		basePropsSchema().shape as Record<string, z.ZodType>,
		propComments(
			fileURLToPath(new URL("../src/core/contract.ts", import.meta.url)),
			"BaseProps",
		),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const metas = await collectMeta();
	const out = fileURLToPath(new URL("../dist", import.meta.url));
	mkdirSync(out, { recursive: true });
	writeFileSync(
		join(out, "components.json"),
		`${JSON.stringify(metas, null, "\t")}\n`,
	);
	writeFileSync(
		join(out, "base-props.json"),
		`${JSON.stringify(baseProps(), null, "\t")}\n`,
	);
	console.log(`components.json: ${metas.length} component(s)`);
}
