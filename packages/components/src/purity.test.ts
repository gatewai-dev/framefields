/**
 * Package-wide rules the spec relies on: seeded randomness only, and an
 * index made of re-exports so every export tree-shakes on its own.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = new URL(".", import.meta.url).pathname;

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = join(dir, e.name);
		if (e.isDirectory()) return e.name === "test" ? [] : sources(p);
		return e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") ? [p] : [];
	});
}

describe("package rules", () => {
	it("never uses Math.random or wall-clock time", () => {
		for (const file of sources(SRC)) {
			const code = readFileSync(file, "utf8")
				.replace(/\/\*[\s\S]*?\*\//g, "")
				.replace(/\/\/.*$/gm, "");
			expect(code, file).not.toMatch(/Math\.random|Date\.now|performance\.now/);
		}
	});

	it("index.ts only re-exports", () => {
		const code = readFileSync(join(SRC, "index.ts"), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.replace(/\/\/.*$/gm, "");
		const statements = code
			.split(/;\s*/)
			.map((s) => s.trim())
			.filter(Boolean);
		for (const s of statements)
			expect(s).toMatch(/^export (type )?\{[\s\S]*\} from "\.\/[^"]+"$/);
	});
});
