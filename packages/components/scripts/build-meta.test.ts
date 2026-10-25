import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { baseProps, collectMeta } from "./build-meta.js";

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

	it("documents each component's props from its schema and JSDoc", async () => {
		const lower = (await collectMeta()).find((m) => m.name === "LowerThird");
		const props = new Map(lower?.props?.map((p) => [p.name, p]));
		expect(props.get("name")).toMatchObject({ type: "string", required: true });
		expect(props.get("layout")).toMatchObject({
			type: '"bar" | "stacked" | "tag" | "line"',
			default: "bar",
			required: false,
		});
		expect(props.get("stay")?.description).toMatch(/Stay on screen/);
		const base = new Map(baseProps().map((p) => [p.name, p]));
		expect(base.get("canvas")?.description).toMatch(/Composition size/);
		expect(base.get("at")?.type).toBe("number");
	});
});
