/**
 * Generates the style library from the framefields-styles skill:
 *   src/style-library/catalog.json   what `framefields/styles` exports
 *   skills/framefields-styles/SKILL.md  its tables
 *
 *   pnpm run sync:style-library           # write both
 *   pnpm run sync:style-library -- --check  # fail if either is stale
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	readStyleLibrary,
	STYLE_SKILL_DIR,
	withSkillTables,
} from "../src/style-library/build.ts";

const CATALOG = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../src/style-library/catalog.json",
);
const SKILL = path.join(STYLE_SKILL_DIR, "SKILL.md");

const check = process.argv.includes("--check");
const library = readStyleLibrary();
// The catalog compares by content, so Biome's JSON formatting never makes it stale.
const sameJson = (a: string, b: string) =>
	JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b));
const outputs = [
	[CATALOG, `${JSON.stringify(library, null, "\t")}\n`, sameJson],
	[
		SKILL,
		withSkillTables(readFileSync(SKILL, "utf8"), library),
		(a: string, b: string) => a === b,
	],
] as const;

const read = (file: string) => {
	try {
		return readFileSync(file, "utf8");
	} catch {
		return "{}";
	}
};

let stale = false;
for (const [file, text, same] of outputs) {
	if (same(read(file), text)) continue;
	if (check) {
		console.error(`stale: ${path.relative(process.cwd(), file)}`);
		stale = true;
	} else {
		writeFileSync(file, text);
		console.log(`wrote ${path.relative(process.cwd(), file)}`);
	}
}
if (stale) console.error("Run pnpm run sync:style-library.");
process.exit(stale ? 1 : 0);
