/**
 * Collects every component's `meta.ts` (default export) into
 * `dist/components.json`: the list docs and the skills generator read.
 * Run with `pnpm --filter @framefields/components meta` (also part of build).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ComponentMeta } from "../src/core/meta.js";

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const NOT_COMPONENTS = new Set(["core", "test"]);

export async function collectMeta(src = SRC): Promise<ComponentMeta[]> {
	const metas: ComponentMeta[] = [];
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
		metas.push(mod.default);
	}
	const names = new Set<string>();
	for (const m of metas) {
		if (names.has(m.name))
			throw new Error(`Duplicate component name "${m.name}"`);
		names.add(m.name);
	}
	return metas.sort((a, b) => a.name.localeCompare(b.name));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	const metas = await collectMeta();
	const out = fileURLToPath(new URL("../dist", import.meta.url));
	mkdirSync(out, { recursive: true });
	writeFileSync(
		join(out, "components.json"),
		`${JSON.stringify(metas, null, "\t")}\n`,
	);
	console.log(`components.json: ${metas.length} component(s)`);
}
