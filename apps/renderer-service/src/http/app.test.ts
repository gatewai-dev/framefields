import { describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import type { Pipeline } from "../jobs/pipeline.js";
import { JobRunner } from "../jobs/runner.js";
import { testConfig, testJob } from "../test-helpers.js";
import { createApp } from "./app.js";

const API_KEY = "k".repeat(32);

function fakePipeline(overrides: Partial<Pipeline> = {}): Pipeline {
	return {
		checkout: async () => ({
			root: "/tmp/ws",
			workdir: "/tmp/ws",
			sha: "9f2c1e4abcdef0123456789abcdef0123456789",
			cache: { mirror: "hit" },
			release: async () => {},
		}),
		install: async () => ({ skipped: true, cache: { install: "skipped" } }),
		render: async () => ({
			files: [
				{
					name: "main",
					path: "/tmp/x.mp4",
					ext: "mp4",
					contentType: "video/mp4",
				},
			],
			engine: { framefields: "2.1.3", source: "bundled" },
		}),
		deliver: async () => [
			{
				name: "main",
				bytes: 10,
				sha256: "abc",
				contentType: "video/mp4",
				base64: "AAAA",
			},
		],
		...overrides,
	};
}

function setup(pipeline = fakePipeline(), ready = true) {
	const config = testConfig({
		FF_HTTP_INSECURE: "false",
		RENDERER_API_KEY: API_KEY,
	});
	const runner = new JobRunner(config, pipeline);
	const app = createApp(config, runner, {
		health: () => ({
			ok: ready,
			body: { status: ready ? "ok" : "initializing" },
		}),
		draining: () => false,
	});
	const call = (
		path: string,
		init: RequestInit = {},
		key: string | null = API_KEY,
	) =>
		app.request(path, {
			...init,
			headers: {
				"content-type": "application/json",
				...(key && { authorization: `Bearer ${key}` }),
			},
		});
	return { runner, call };
}

const waitDone = async (runner: JobRunner, id: string) => {
	for (let i = 0; i < 100; i++) {
		const job = runner.store.get(id);
		if (job && ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status))
			return job;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error("job did not finish");
};

describe("HTTP v2", () => {
	it("requires the API key on job routes but not on health", async () => {
		const { call } = setup();
		expect(
			(await call("/v2/jobs", { method: "POST", body: "{}" }, null)).status,
		).toBe(401);
		expect(
			(await call("/v2/jobs", { method: "POST", body: "{}" }, "wrong")).status,
		).toBe(401);
		expect((await call("/health", {}, null)).status).toBe(200);
	});

	it("runs a job to completion and reports the result", async () => {
		const { call, runner } = setup();
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		expect(res.status).toBe(202);
		const { id } = (await res.json()) as { id: string };

		const job = await waitDone(runner, id);
		expect(job.status).toBe("COMPLETED");
		expect(job.result).toMatchObject({
			source: { repo: "github.com/acme/films", ref: "main" },
			outputs: [{ name: "main" }],
			cache: { mirror: "hit", install: "skipped" },
		});

		const fetched = await call(`/v2/jobs/${id}`);
		expect(((await fetched.json()) as { status: string }).status).toBe(
			"COMPLETED",
		);
	});

	it("returns structured validation errors", async () => {
		const { call } = setup();
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(
				testJob({ source: { repo: "https://github.com/evil/x" } }),
			),
		});
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			error: { code: "REPO_NOT_ALLOWED", retryable: false },
		});
	});

	it("refuses jobs until the GPU is ready", async () => {
		const { call } = setup(fakePipeline(), false);
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		expect(res.status).toBe(503);
	});

	it("records step failures with their code and redacts secrets", async () => {
		const { call, runner } = setup(
			fakePipeline({
				checkout: async () => {
					throw new RenderError(
						"GIT_AUTH_FAILED",
						"fatal: could not read from https://x-access-token:ghp_x1@github.com/acme/films",
					);
				},
			}),
		);
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		const { id } = (await res.json()) as { id: string };
		const job = await waitDone(runner, id);
		expect(job.status).toBe("FAILED");
		expect(job.error?.code).toBe("GIT_AUTH_FAILED");
		expect(job.error?.message).not.toContain("ghp_x1");
	});

	it("cancels a running job", async () => {
		const { call, runner } = setup(
			fakePipeline({
				render: (_c, _i, ctx) =>
					new Promise((_resolve, reject) => {
						ctx.signal.addEventListener("abort", () =>
							reject(ctx.signal.reason),
						);
					}),
			}),
		);
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		const { id } = (await res.json()) as { id: string };
		await new Promise((r) => setTimeout(r, 10));
		expect(
			(await call(`/v2/jobs/${id}/cancel`, { method: "POST" })).status,
		).toBe(202);
		const job = await waitDone(runner, id);
		expect(job.status).toBe("CANCELLED");
		expect(
			(await call(`/v2/jobs/${id}/cancel`, { method: "POST" })).status,
		).toBe(409);
	});

	it("404s unknown jobs", async () => {
		const { call } = setup();
		expect((await call("/v2/jobs/nope")).status).toBe(404);
	});
});

describe("SSE events", () => {
	it("streams progress and always ends with the terminal event", async () => {
		const { call, runner } = setup(
			fakePipeline({
				render: async (_c, _i, ctx) => {
					ctx.progress({ phase: "rendering", frame: 1, total: 2 });
					await new Promise((r) => setTimeout(r, 20));
					ctx.progress({ phase: "rendering", frame: 2, total: 2 });
					return {
						files: [
							{
								name: "main",
								path: "/tmp/x.mp4",
								ext: "mp4",
								contentType: "video/mp4",
							},
						],
						engine: {},
					};
				},
			}),
		);
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		const { id } = (await res.json()) as { id: string };
		const events = await (await call(`/v2/jobs/${id}/events`)).text();
		const statuses = [...events.matchAll(/"status":"(\w+)"/g)].map((m) => m[1]);
		expect(statuses.at(-1)).toBe("COMPLETED");
		expect(events).toContain('"frame":2');
		expect(runner.store.get(id)?.status).toBe("COMPLETED");
	});
});

describe("idempotency", () => {
	it("skips install, render and upload when an earlier attempt delivered this commit", async () => {
		const calls: string[] = [];
		const { call, runner } = setup(
			fakePipeline({
				findExisting: async () => [
					{
						name: "main",
						bytes: 1,
						sha256: "abc",
						contentType: "video/mp4",
						key: "k.mp4",
					},
				],
				install: async () => {
					calls.push("install");
					return { skipped: true, cache: {} };
				},
			}),
		);
		const res = await call("/v2/jobs", {
			method: "POST",
			body: JSON.stringify(testJob()),
		});
		const { id } = (await res.json()) as { id: string };
		const job = await waitDone(runner, id);
		expect(job.status).toBe("COMPLETED");
		expect(job.result).toMatchObject({
			cache: { output: "hit" },
			outputs: [{ key: "k.mp4" }],
		});
		expect(calls).toEqual([]);
	});
});
