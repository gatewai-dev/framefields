// Fails the build when a published .d.mts still imports an unpublished
// @gitframes/* package: consumers would silently get `any` for those types.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const leaks = [];
const walk = (dir) => {
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const file = join(dir, entry.name);
		if (entry.isDirectory()) walk(file);
		else if (entry.name.endsWith(".d.mts")) {
			for (const m of readFileSync(file, "utf8").matchAll(
				/from "(@gitframes\/[^"]+)"/g,
			)) {
				leaks.push(`${file}: ${m[1]}`);
			}
		}
	}
};
walk("dist");

if (leaks.length > 0) {
	console.error(
		`Type bundle imports unpublished packages:\n${leaks.join("\n")}`,
	);
	console.error(
		"Declare @gitframes/core (or the missing package) in the upstream package.json.",
	);
	process.exit(1);
}
