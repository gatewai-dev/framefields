// Repairs a type-bundler slip in dist/*.d.mts: when the short alias it
// picks for a chunk export equals a name already declared in that chunk
// (framefields' own `Ai` interface, say), it can emit the export as
// `type fn as Ai`, and consumers then get "cannot be used as a value".
// A name the chunk declares as a function, const, class or enum is a value,
// so its `type` modifier is dropped.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function fixDtsAliases(dir = "dist") {
	const fixed = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const file = join(dir, entry.name);
		if (entry.isDirectory()) {
			fixed.push(...fixDtsAliases(file));
			continue;
		}
		if (!entry.name.endsWith(".d.mts")) continue;
		const code = readFileSync(file, "utf8");
		const out = code.replace(
			/\btype ([A-Za-z_$][\w$]*) as ([\w$]+)/g,
			(whole, name, alias) => {
				const value = new RegExp(
					`declare (?:function|const|let|var|class|enum|abstract class) ${name.replace(/\$/g, "\\$")}\\b`,
				);
				if (!value.test(code)) return whole;
				fixed.push(`${file}: ${name} as ${alias}`);
				return `${name} as ${alias}`;
			},
		);
		if (out !== code) writeFileSync(file, out);
	}
	return fixed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	for (const f of fixDtsAliases())
		console.log(`fixed type-only value export ${f}`);
}
