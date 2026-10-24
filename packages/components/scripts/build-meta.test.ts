import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectMeta } from "./build-meta.js";

const meta = (name: string) =>
	`export default ${JSON.stringify({ name, summary: "s", tags: [], parts: [], cues: [], example: "", since: "M1" })};`;

function fixture(components: Record<string, string | null>) {
	const dir = mkdtempSync(join(tmpdir(), "ff-meta-"));
	mkdirSync(join(dir, "core"));
	for (const [folder, source] of Object.entries(components)) {
		mkdirSync(join(dir, folder));
		if (source !== null) writeFileSync(join(dir, folder, "meta.ts"), source);
	}
	return dir;
}

describe("collectMeta", () => {
	it("is empty before any component exists", async () => {
		expect(await collectMeta()).toEqual(expect.any(Array));
	});

	it("collects, sorts, and rejects missing or duplicate metas", async () => {
		const ok = await collectMeta(
			fixture({ zeta: meta("Zeta"), alpha: meta("Alpha") }),
		);
		expect(ok.map((m) => m.name)).toEqual(["Alpha", "Zeta"]);
		await expect(collectMeta(fixture({ broken: null }))).rejects.toThrow(
			/no meta.ts/,
		);
		await expect(
			collectMeta(fixture({ a: meta("Same"), b: meta("Same") })),
		).rejects.toThrow(/Duplicate/);
	});
});
