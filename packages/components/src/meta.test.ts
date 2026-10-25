import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComponentMeta } from "./core/meta.js";
import { cases } from "./test/cases.js";

/**
 * `meta.ts` is what docs and agents read: its cue and part names must match
 * what the component builds. Patterns like `line-<n>` stand for any suffix.
 */
const SRC = new URL(".", import.meta.url).pathname;
const folders = readdirSync(SRC, { withFileTypes: true })
	.filter((e) => e.isDirectory() && e.name !== "core" && e.name !== "test")
	.map((e) => e.name);
const metas = new Map<string, ComponentMeta>();
for (const folder of folders) {
	const mod = (await import(`./${folder}/meta.ts`)) as {
		default: ComponentMeta;
	};
	metas.set(mod.default.name, mod.default);
}

const nameOf = (label: string) => label.split(" ")[0] as string;
const pattern = (part: string) =>
	new RegExp(`^${part.replace(/<[a-z]+>/g, "[\\w-]+")}$`);

interface Built {
	cues: Record<string, unknown>;
	partNames: readonly string[];
}

describe("component meta", () => {
	it("every component folder has a case in test/cases.ts", () => {
		const covered = new Set(cases.map(([label]) => nameOf(label)));
		expect([...metas.keys()].filter((n) => !covered.has(n))).toEqual([]);
	});

	for (const [label, build] of cases) {
		const meta = metas.get(nameOf(label));
		it(`${label}: cues match meta.cues`, () => {
			expect(meta).toBeDefined();
			const node = build() as Built;
			expect(Object.keys(node.cues).sort()).toEqual(
				[...(meta?.cues ?? [])].sort(),
			);
		});
		it(`${label}: every part is named in meta.parts`, () => {
			const node = build() as Built;
			const listed = (meta?.parts ?? []).map(pattern);
			const unlisted = node.partNames.filter(
				(p) =>
					p !== "root" && p !== "stage" && !listed.some((re) => re.test(p)),
			);
			expect(unlisted).toEqual([]);
		});
	}
});
