import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { runCheck } from "./check.js";

const exec = promisify(execFile);
const dirs: string[] = [];
const sdk = new URL("../index.ts", import.meta.url).href;

async function fixture(body: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "ff-check-"));
	dirs.push(dir);
	const entry = join(dir, "film.mts");
	await writeFile(
		entry,
		`import { Composition, Layer } from ${JSON.stringify(sdk)};\n${body}`,
	);
	return entry;
}

afterEach(async () => {
	await Promise.all(
		dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
	);
});

describe("agent preflight", () => {
	it("returns structured schema and lint failures with source paths", async () => {
		const entry = await fixture(
			'export function buildFilm() { const c = new Composition({width:32,height:32,fps:30,durationFrames:2}); c.add(Layer.box({id:"bad",width:32,height:32,background:"definitely-invalid-color"})); return c; }',
		);
		const report = await runCheck({ entry });
		expect(report.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "unknown_color",
					layerId: "bad",
					stage: "lint",
				}),
			]),
		);
		expect(report.status).toBe("passed");
		expect((await runCheck({ entry, warningsAsErrors: true })).status).toBe(
			"failed",
		);
		const invalid = await fixture(
			'export function buildFilm() { const c = new Composition({width:32,height:32}); c.add({id:"bad",kind:"box",startFrame:-1}); return c; }',
		);
		expect((await runCheck({ entry: invalid })).diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid_spec",
					path: "layout.0.startFrame",
				}),
			]),
		);
	});
	it("reports builder errors and a timeout as failures", async () => {
		const entry = await fixture(
			'export function buildFilm() { throw new Error("broken builder"); }',
		);
		expect((await runCheck({ entry })).diagnostics[0]).toMatchObject({
			code: "build_failed",
			message: expect.stringContaining("broken builder"),
		});
		const hanging = await fixture(
			"export async function buildFilm() { await new Promise(() => {}); }",
		);
		expect(
			(await runCheck({ entry: hanging, timeoutMs: 5000 })).diagnostics[0].code,
		).toBe("check_timeout");
	});
	it("reports a missing local source before rendering", async () => {
		const entry = await fixture(
			'export function buildFilm() { const c = new Composition({width:32,height:32,fps:30,durationFrames:2}); c.add(Layer.image("./missing-preflight-image.png", {id:"missing",width:32,height:32})); return c; }',
		);
		const report = await runCheck({ entry });
		expect(report.status).toBe("failed");
		expect(report.diagnostics).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "missing_local_asset",
					layerId: "missing",
					stage: "assets",
				}),
			]),
		);
	});
	it("keeps CLI stdout as one JSON object despite a noisy builder", async () => {
		const entry = await fixture(
			'console.log("builder log"); export function buildFilm() { return new Composition({width:32,height:32,fps:30,durationFrames:2}); }',
		);
		const { stdout, stderr } = await exec(
			process.execPath,
			[
				"--import",
				"tsx",
				"--conditions=development",
				fileURLToPath(new URL("../cli.ts", import.meta.url)),
				"check",
				entry,
				"--json",
			],
			{ timeout: 20000 },
		);
		expect(JSON.parse(stdout)).toMatchObject({
			schemaVersion: 1,
			status: "passed",
			timeline: { totalFrames: 2 },
			render: "not_requested",
		});
		expect(stderr).toContain("builder log");
	});
});
