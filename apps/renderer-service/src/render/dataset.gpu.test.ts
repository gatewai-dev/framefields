/**
 * kind=dataset end to end with the project's own framefields: two part jobs
 * render their seeds into one shard and a manifest each, and a finish job
 * merges the manifests into the dataset card. Needs a GPU (FF_GPU_TESTS=1).
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const gpu = describe.skipIf(process.env.FF_GPU_TESTS !== "1");
const ENGINE = path.resolve(
	import.meta.dirname,
	"../../node_modules/framefields",
);
let ws = "";

const ENV = `import { Composition, Layer, Layer3D } from "framefields";
import { random } from "framefields/datasets";
export const dots = {
	name: "dots",
	description: "A sphere at a seeded place.",
	fps: 24, frames: 2, width: 64, height: 48,
	params: (seed: number) => ({ x: Math.round(random(seed).range(-20, 20)) }),
	build: async (p: { x: number }) => {
		const c = new Composition({ width: 64, height: 48, fps: 24, durationFrames: 2 });
		c.add([
			Layer.camera({ x: 0, y: 0, z: -300, targetX: 0, targetY: 0, targetZ: 0 }),
			Layer.ambientLight("#ffffff", 1),
			Layer3D.sphere({ id: "dot", label: "sphere", radius: 12, x: p.x, color: "#ff0000" }),
		]);
		return [{ name: "front", composition: c }];
	},
};
export const notAnEnv = { name: "x" };`;

beforeAll(async () => {
	ws = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ff-ds-")));
	await fs.mkdir(path.join(ws, "p/node_modules"), { recursive: true });
	await fs.writeFile(
		path.join(ws, "p/package.json"),
		'{ "name": "envs", "type": "module", "dependencies": { "framefields": "*" } }',
	);
	await fs.symlink(ENGINE, path.join(ws, "p/node_modules/framefields"));
	await fs.writeFile(path.join(ws, "p/envs.ts"), ENV);
});
afterAll(async () => {
	await fs.rm(ws, { recursive: true, force: true });
});

function harness(exportName: string): Record<string, unknown> {
	const tsx = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
	const script = path.resolve(
		import.meta.dirname,
		"../../test/dataset-harness.ts",
	);
	const out = execFileSync(
		tsx,
		[
			script,
			ws,
			"p",
			"envs.ts",
			exportName,
			path.join(ws, `out-${exportName}`),
		],
		{ encoding: "utf8", env: { ...process.env, NODE_ENV: "test" } },
	);
	const line =
		out
			.trim()
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.at(-1) ?? "{}";
	return JSON.parse(line) as Record<string, unknown>;
}

gpu("dataset jobs", () => {
	it("renders parts with the project's engine and finishes them into a card", () => {
		const result = harness("dots");
		expect(result).toMatchObject({
			ok: true,
			// Seeds 0 | 1, 2: one view, two frames each.
			samples: [2, 4],
			readme: true,
		});
		const parts = result.parts as Array<Array<{ name: string; ext: string }>>;
		expect(
			parts.map((files) => files.map((f) => `${f.name}.${f.ext}`)),
		).toEqual([
			["shard-p000of002-000000.tar", "part-p000of002.json"],
			["shard-p001of002-000000.tar", "part-p001of002.json"],
		]);
		expect(result.card).toMatchObject([{ name: "README", ext: "md" }]);
	}, 120_000);

	it("refuses an export that is not an env", () => {
		expect(harness("notAnEnv")).toMatchObject({
			ok: false,
			code: "EXPORT_INVALID",
		});
	}, 120_000);
});
