import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import { CrashJournal } from "../jobs/journal.js";
import { testConfig } from "../test-helpers.js";
import { recycleReason } from "../worker/recycle.js";
import { buildPlan, isRenderable } from "./load.js";
import { classifyRenderError } from "./render-step.js";
import { ExitTrap, openSandbox } from "./sandbox.js";

let ws: string;

async function write(rel: string, content: string) {
	const file = path.join(ws, rel);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content);
}

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "no error";
	} catch (err) {
		return err instanceof RenderError
			? err.code
			: `not a RenderError: ${String(err)}`;
	}
}

/** The framefields this package tests against, standing in for a project's install. */
const ENGINE = path.resolve(
	import.meta.dirname,
	"../../node_modules/framefields",
);

beforeAll(async () => {
	ws = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "ff-ws-")));
	// Workspace "a" installed framefields; workspace "b" (another repo on the
	// same version) gets it through the bound engine.
	await write(
		"a/package.json",
		'{ "name": "film", "type": "module", "dependencies": { "framefields": "*" } }',
	);
	await fs.mkdir(path.join(ws, "a/node_modules"), { recursive: true });
	await fs.symlink(ENGINE, path.join(ws, "a/node_modules/framefields"));
	await write("b/package.json", '{ "name": "other", "type": "module" }');
});
afterAll(async () => {
	await fs.rm(ws, { recursive: true, force: true });
});

const fake = () => ({
	renderVideo: async () => ({}),
	renderFrame: async () => Buffer.alloc(0),
});

/** Runs the loader in a real Node process (see test/load-harness.ts). */
function harness(
	workdir: string,
	entry: string,
	token: string,
	exportName = "",
	bindFrom = "",
) {
	const tsx = path.resolve(import.meta.dirname, "../../node_modules/.bin/tsx");
	const script = path.resolve(
		import.meta.dirname,
		"../../test/load-harness.ts",
	);
	const args = [
		script,
		ws,
		workdir,
		entry,
		token,
		exportName,
		...(bindFrom ? [path.join(ws, bindFrom)] : []),
	];
	const out = execFileSync(tsx, args, {
		encoding: "utf8",
		env: { ...process.env, NODE_ENV: "test" },
	});
	const line =
		out
			.trim()
			.split("\n")
			.filter((l) => l.startsWith("{"))
			.at(-1) ?? "{}";
	return JSON.parse(line) as Record<string, unknown>;
}

const FILM = `import { Composition } from "framefields";
	 const n: number = 1;
	 export const Ctor = Composition;
	 export const buildFilm = () => new Composition({ width: 64, height: 64, fps: 24, durationFrames: n });`;

describe("entry loading (real Node loader)", () => {
	it("renders with the project's own framefields once it's bound", async () => {
		await write("a/src/film.ts", FILM);
		expect(
			harness("a", "src/film.ts", "job-a", "buildFilm", "a"),
		).toMatchObject({
			ok: true,
			sameComposition: true,
			plan: [{ name: "main", isEngineComposition: true }],
		});
	}, 60_000);

	it("shares the bound engine with another repo on the same version", async () => {
		await write("b/src/film.ts", FILM);
		expect(harness("b", "src/film.ts", "job-b2", "", "a")).toMatchObject({
			ok: true,
			sameComposition: true,
		});
	}, 60_000);

	it("fails to load framefields when the project didn't install it and nothing is bound", async () => {
		expect(harness("b", "src/film.ts", "job-b3")).toMatchObject({
			ok: false,
			code: "ENTRY_COMPILE_FAILED",
		});
	}, 60_000);

	it('gives the same instance to a package without "type": "module"', async () => {
		await write("a/cjs/package.json", '{ "name": "legacy" }');
		await write(
			"a/cjs/film.ts",
			'import { Composition } from "framefields"; export const Ctor = Composition;',
		);
		expect(harness("a/cjs", "film.ts", "job-cjs", "", "a")).toMatchObject({
			ok: true,
			sameComposition: true,
		});
	}, 60_000);

	it("loads changed code at the same path under a new job token", async () => {
		await write(
			"a/src/v.ts",
			'import { dep } from "./dep-v.js"; export const v = dep;',
		);
		await write("a/src/dep-v.ts", "export const dep = 1;");
		expect(harness("a", "src/v.ts", "job-b").v).toBe(1);
		await write("a/src/dep-v.ts", "export const dep = 2;");
		expect(harness("a", "src/v.ts", "job-c").v).toBe(2);
	}, 60_000);

	it.each([
		["src/missing.ts", "", "ENTRY_NOT_FOUND"],
		["src/broken.ts", "export const = ;", "ENTRY_COMPILE_FAILED"],
		[
			"src/dep.ts",
			'import x from "not-installed-anywhere"; export default x;',
			"ENTRY_COMPILE_FAILED",
		],
		[
			"src/throws.ts",
			'throw new Error("boom at import");',
			"COMPOSITION_BUILD_FAILED",
		],
		[
			"src/quickstart.ts",
			"console.log('rendering…'); process.exit(0);",
			"EXPORT_SIDE_EFFECT",
		],
		["../outside.ts", "", "PATH_ESCAPE"],
	])(
		"classifies %s",
		async (entry, source, code) => {
			if (source) await write(path.join("a", entry), source);
			expect(harness("a", entry, "job-d")).toMatchObject({ ok: false, code });
		},
		60_000,
	);
});

describe("buildPlan", () => {
	it("accepts a composition, a record, and a render plan", async () => {
		expect(
			(
				await buildPlan({ default: fake() }, "default", undefined, undefined)
			).map((o) => o.name),
		).toEqual(["main"]);
		expect(
			(
				await buildPlan(
					{ films: { main: fake(), teaser: fake() } },
					"films",
					undefined,
					["teaser"],
				)
			).map((o) => o.name),
		).toEqual(["teaser"]);
		const plan = await buildPlan(
			{
				plan: async (args: { n: number }) => ({
					outputs: [
						{
							name: `cut-${args.n}`,
							composition: fake(),
							render: { kind: "frames", frames: [1] },
						},
					],
				}),
			},
			"plan",
			{ n: 3 },
			undefined,
		);
		expect(plan[0]).toMatchObject({
			name: "cut-3",
			render: { kind: "frames" },
		});
	});

	it.each([
		[{ a: 1 }, "nope", "EXPORT_NOT_FOUND"],
		[{ a: 42 }, "a", "EXPORT_INVALID"],
		[{ a: { x: fake(), y: 1 } }, "a", "EXPORT_INVALID"],
		[
			{ a: { outputs: [{ name: "../evil", composition: fake() }] } },
			"a",
			"EXPORT_INVALID",
		],
		[
			{
				a: () => {
					throw new Error("bad args");
				},
			},
			"a",
			"COMPOSITION_BUILD_FAILED",
		],
	])("rejects %o (export %s)", async (mod, name, code) => {
		expect(
			await codeOf(
				buildPlan(mod as Record<string, unknown>, name, undefined, undefined),
			),
		).toBe(code);
	});

	it("rejects unknown select names", async () => {
		expect(
			await codeOf(
				buildPlan({ f: { main: fake() } }, "f", undefined, ["nope"]),
			),
		).toBe("JOB_INVALID");
	});

	it("recognises renderables by shape", () => {
		expect(isRenderable(fake())).toBe(true);
		expect(isRenderable({ renderVideo: 1 })).toBe(false);
	});
});

describe("job sandbox", () => {
	it("sets and restores cwd, env, argv and process.exit", () => {
		const before = {
			cwd: process.cwd(),
			argv: process.argv,
			exit: process.exit,
		};
		const sandbox = openSandbox({
			cwd: ws,
			argv1: path.join(ws, "src/film.ts"),
			env: { LOCALE: "tr" },
		});
		expect(process.cwd()).toBe(ws);
		expect(process.env.LOCALE).toBe("tr");
		expect(process.argv[1]).toBe(path.join(ws, "src/film.ts"));
		expect(() => process.exit(1)).toThrow(ExitTrap);
		sandbox.restore();
		expect(process.cwd()).toBe(before.cwd);
		expect(process.env.LOCALE).toBeUndefined();
		expect(process.argv).toBe(before.argv);
		expect(process.exit).toBe(before.exit);
	});

	it("refuses to nest", () => {
		const sandbox = openSandbox({ cwd: ws, argv1: "x", env: {} });
		try {
			expect(() => openSandbox({ cwd: ws, argv1: "x", env: {} })).toThrow(
				/already open/,
			);
		} finally {
			sandbox.restore();
		}
	});
});

describe("render error classification", () => {
	it.each([
		["GPUDevice was lost: reason unknown", "GPU_DEVICE_LOST"],
		["Failed to allocate texture: out of memory", "RENDER_OOM"],
		['Cannot open local media file "/ws/assets/a.mp4"', "ASSET_NOT_FOUND"],
		["UnsupportedInputFormatError: cannot detect", "ASSET_NOT_FOUND"],
		["something else", "RENDER_FAILED"],
	])("%s → %s", (message, code) => {
		expect(classifyRenderError(new Error(message), "/ws").code).toBe(code);
	});

	it("keeps only project stack frames, repo-relative", () => {
		const err = new Error("x");
		err.stack =
			"Error: x\n    at a (/ws/src/film.ts:3:1)\n    at b (/ws/node_modules/z/i.js:1:1)\n    at c (node:internal/x:1:1)";
		expect(classifyRenderError(err, "/ws").details?.stack).toBe(
			"at a (<repo>/src/film.ts:3:1)",
		);
	});
});

describe("recycling", () => {
	const config = testConfig({
		FF_MAX_JOBS_PER_WORKER: "3",
		FF_RECYCLE_HEAP_MB: "100",
	});
	const stats = {
		completedJobs: 1,
		heapUsedMb: 50,
		rssMb: 200,
		strayErrors: 0,
		leakedHandles: 0,
	};
	it.each([
		[{}, undefined],
		[{ completedJobs: 3 }, "completed 3 jobs"],
		[{ heapUsedMb: 150 }, "heap 150MB > 100MB"],
		[{ strayErrors: 3 }, "3 errors from repo code outside any job"],
		[{ leakedHandles: 51 }, "51 timers/handles left behind by repo code"],
		[{ requested: "GPU device lost" }, "GPU device lost"],
	])("%o → %s", (patch, reason) => {
		expect(recycleReason({ ...stats, ...patch }, config)).toBe(reason);
	});
});

describe("event-loop watchdog", () => {
	it("kills a process stuck in a sync loop and records why", async () => {
		const journalPath = path.join(ws, "watchdog.json");
		const tsx = path.resolve(
			import.meta.dirname,
			"../../node_modules/.bin/tsx",
		);
		const script = path.resolve(
			import.meta.dirname,
			"../../test/watchdog-harness.ts",
		);
		let killed = false;
		try {
			execFileSync(tsx, [script, journalPath], {
				timeout: 30_000,
				stdio: "ignore",
			});
		} catch (err) {
			// tsx's CLI wrapper reports its child's SIGKILL as exit status 137.
			const e = err as { signal: string | null; status: number | null };
			killed = e.signal === "SIGKILL" || e.status === 137;
		}
		expect(killed).toBe(true);
		const record = new CrashJournal(journalPath).recover();
		expect(record?.error?.message).toMatch(/event loop blocked/);
	}, 40_000);
});

describe("crash journal", () => {
	it("reports the job a dead process left behind, once", async () => {
		const journal = new CrashJournal(path.join(ws, "inflight.json"));
		journal.begin({
			jobId: "j1",
			createdAt: "2026-01-01T00:00:00Z",
			startedAt: "2026-01-01T00:00:01Z",
		});
		const record = journal.recover();
		expect(record).toMatchObject({
			id: "j1",
			status: "FAILED",
			error: { code: "RENDER_CRASHED", retryable: true },
		});
		expect(journal.recover()).toBeUndefined();

		journal.begin({
			jobId: "j2",
			createdAt: "x",
			startedAt: "y",
			exitReason: "JavaScript heap out of memory",
		});
		expect(journal.recover()?.error?.code).toBe("RENDER_OOM");

		journal.begin({ jobId: "j3", createdAt: "x", startedAt: "y" });
		journal.end();
		expect(journal.recover()).toBeUndefined();
	});
});
