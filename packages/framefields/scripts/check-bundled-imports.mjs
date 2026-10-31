// Fails the build when anything published in dist (code or types) still imports an
// @framefields/* workspace package. framefields bundles every one of them and publishes
// none, so such an import breaks at install or runtime (code) or silently becomes `any`
// (types). Declaring the package as a dependency or peer does not make it installable.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const leaks = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const file = join(dir, entry.name);
		if (entry.isDirectory()) walk(file);
		else if (/\.(mjs|d\.mts)$/.test(entry.name)) {
			const source = readFileSync(file, "utf8");
			for (const m of source.matchAll(
				/(?:from\s*|import\s*\(\s*|require\s*\(\s*)["'](@framefields\/[^"']+)["']/g,
			))
				leaks.push(`${file}: ${m[1]}`);
		}
	}
};
walk("dist");

if (leaks.length > 0) {
	console.error(
		`dist imports unpublished @framefields packages:\n${leaks.join("\n")}`,
	);
	console.error(
		"Bundle them: keep them out of tsdown's `external` and in `dts.resolve`.",
	);
	process.exit(1);
}
