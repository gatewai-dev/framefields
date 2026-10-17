import { describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import { redact, registerSecret } from "../redact.js";
import { testConfig, testJob } from "../test-helpers.js";
import { renderKey, renderKeys, slug } from "./key-template.js";
import { JobQueue } from "./queue.js";
import { JobStore } from "./store.js";
import { validateJob } from "./validate.js";

const codeOf = (fn: () => unknown) => {
	try {
		fn();
	} catch (err) {
		return err instanceof RenderError ? err.code : String(err);
	}
	return "no error";
};

describe("validateJob", () => {
	const config = testConfig();

	it("accepts a minimal job and fills defaults", () => {
		const job = validateJob(testJob(), config);
		expect(job.repo.id).toBe("github.com/acme/films");
		expect(job.input.render.kind).toBe("video");
		expect(job.input.source.workdir).toBe(".");
		expect(job.timeoutSec).toBe(config.limits.jobTimeoutMaxSec);
	});

	it("points legacy virtualMedia payloads at v2", () => {
		try {
			validateJob(
				{ virtualMedia: {}, type: "Video", bucket: "b", key: "k" },
				config,
			);
		} catch (err) {
			expect((err as RenderError).hint).toMatch(/virtualMedia/);
			return;
		}
		throw new Error("expected JOB_INVALID");
	});

	it.each([
		[
			"a repo outside the allowlist",
			{ source: { repo: "https://github.com/evil/x" } },
			"REPO_NOT_ALLOWED",
		],
		[
			"plain http",
			{ source: { repo: "http://github.com/acme/films" } },
			"REPO_NOT_ALLOWED",
		],
		[
			"a workdir escaping the repo",
			{ source: { repo: "https://github.com/acme/f", workdir: "../x" } },
			"JOB_INVALID",
		],
		[
			"an absolute entry",
			{ target: { entry: "/etc/passwd.js" } },
			"JOB_INVALID",
		],
		[
			"a non-module entry",
			{ target: { entry: "src/film.json" } },
			"JOB_INVALID",
		],
		[
			"a bad export name",
			{ target: { entry: "a.ts", export: "x; process.exit()" } },
			"JOB_INVALID",
		],
		[
			"a ref with ..",
			{ source: { repo: "https://github.com/acme/f", ref: "main..x" } },
			"JOB_INVALID",
		],
		[
			"a ref that looks like an option",
			{ source: { repo: "https://github.com/acme/f", ref: "--upload-pack=x" } },
			"JOB_INVALID",
		],
		["reserved env", { env: { NODE_OPTIONS: "--require x" } }, "JOB_INVALID"],
		[
			"job credentials when disabled",
			{ source: { repo: "https://github.com/acme/f", auth: { token: "x" } } },
			"JOB_INVALID",
		],
		[
			"s3 output without s3 storage",
			{ output: { type: "s3", key: "a.mp4" } },
			"JOB_INVALID",
		],
		[
			"frames without a frame list",
			{ render: { kind: "frames" } },
			"JOB_INVALID",
		],
	])("rejects %s", (_, overrides, code) => {
		expect(codeOf(() => validateJob(testJob(overrides), config))).toBe(code);
	});

	it("enforces the bucket allowlist", () => {
		const s3 = testConfig({
			STORAGE_ENDPOINT: "https://s3.example.com",
			STORAGE_ACCESS_KEY_ID: "key",
			STORAGE_SECRET_ACCESS_KEY: "secret",
			STORAGE_BUCKET: "renders",
		});
		expect(
			codeOf(() =>
				validateJob(
					testJob({ output: { type: "s3", bucket: "other", key: "x" } }),
					s3,
				),
			),
		).toBe("BUCKET_NOT_ALLOWED");
		expect(
			codeOf(() =>
				validateJob(
					testJob({ output: { type: "s3", key: "{jobId}.{ext}" } }),
					s3,
				),
			),
		).toBe("no error");
		expect(
			codeOf(() =>
				validateJob(testJob({ output: { type: "s3", key: "{nope}" } }), s3),
			),
		).toBe("JOB_INVALID");
	});

	it("caps the timeout", () => {
		const job = validateJob(testJob({ timeoutSec: 999_999 }), config);
		expect(job.timeoutSec).toBe(config.limits.jobTimeoutMaxSec);
	});
});

describe("key templates", () => {
	const vars = {
		jobId: "j1",
		sha: "9f2c1e4abcdef",
		ref: "refs/heads/Feature/Intro v2",
		date: new Date("2026-10-14T10:00:00Z"),
	};

	it("renders variables", () => {
		expect(
			renderKey("acme/{ref}/{shortSha}/{date}/{name}-{index}.{ext}", {
				...vars,
				name: "main",
				ext: "mp4",
				index: 0,
			}),
		).toBe("acme/feature-intro-v2/9f2c1e4/2026-10-14/main-0.mp4");
	});

	it("rejects keys that escape", () => {
		expect(() =>
			renderKey("/{name}", { ...vars, name: "a", ext: "mp4", index: 0 }),
		).toThrow();
		expect(() =>
			renderKey("a/../{name}", { ...vars, name: "a", ext: "mp4", index: 0 }),
		).toThrow();
	});

	it("rejects templates that collide across outputs", () => {
		const outputs = [
			{ name: "main", ext: "mp4" },
			{ name: "teaser", ext: "mp4" },
		];
		expect(() => renderKeys("{jobId}.{ext}", outputs, vars)).toThrow(
			/several outputs/,
		);
		expect(renderKeys("{jobId}/{name}.{ext}", outputs, vars)).toEqual([
			"j1/main.mp4",
			"j1/teaser.mp4",
		]);
	});

	it("slugs refs", () => {
		expect(slug("refs/tags/v1.2.0")).toBe("v1.2.0");
	});
});

describe("redact", () => {
	it("strips URL credentials, signed queries and registered secrets", () => {
		registerSecret("ghp_supersecret123");
		expect(
			redact("fetch https://x-access-token:abc@github.com/a/b.git failed"),
		).toBe("fetch https://***@github.com/a/b.git failed");
		expect(
			redact("PUT https://b.r2.dev/k.mp4?X-Amz-Signature=abc&X-Amz-Date=1 403"),
		).toBe("PUT https://b.r2.dev/k.mp4?*** 403");
		expect(redact("token ghp_supersecret123 leaked")).toBe("token *** leaked");
	});
});

describe("JobStore", () => {
	it("evicts finished jobs after the TTL and never touches active ones", () => {
		let now = 0;
		const store = new JobStore(1000, 10, () => now);
		store.create("a");
		store.create("b");
		store.update("a", { status: "COMPLETED" });
		now = 5000;
		store.prune();
		expect(store.get("a")).toBeUndefined();
		expect(store.get("b")).toBeDefined();
	});

	it("caps history by evicting the oldest finished jobs", () => {
		const store = new JobStore(60_000, 2);
		for (const id of ["a", "b", "c"]) {
			store.create(id);
			store.update(id, { status: "FAILED" });
		}
		store.create("d");
		expect(store.size).toBe(2);
		expect(store.get("d")).toBeDefined();
	});

	it("ignores updates after a job finished", () => {
		const store = new JobStore(60_000, 10);
		store.create("a");
		store.update("a", { status: "CANCELLED" });
		store.update("a", { status: "COMPLETED" });
		expect(store.get("a")?.status).toBe("CANCELLED");
	});

	it("drops inline payloads after the inline TTL but keeps the record", () => {
		let now = 0;
		const store = new JobStore(60_000, 10, () => now, 1000);
		store.create("a");
		store.update("a", {
			status: "COMPLETED",
			result: { outputs: [{ name: "film", base64: "AAAA" }] },
		});
		now = 500;
		expect(store.get("a")?.result?.outputs).toEqual([
			{ name: "film", base64: "AAAA" },
		]);
		now = 2000;
		expect(store.get("a")?.result?.outputs).toEqual([
			{ name: "film", base64Expired: true },
		]);
	});
});

describe("JobQueue", () => {
	const deferred = () => {
		let resolve!: () => void;
		const promise = new Promise<void>((r) => {
			resolve = r;
		});
		return { promise, resolve };
	};

	it("runs one job at a time and rejects past the cap", async () => {
		const queue = new JobQueue(1);
		const order: string[] = [];
		const gate = deferred();
		queue.enqueue({
			id: "a",
			run: async () => {
				order.push("a:start");
				await gate.promise;
				order.push("a:end");
			},
			onCancelledWhileQueued: () => {},
		});
		queue.enqueue({
			id: "b",
			run: async () => void order.push("b"),
			onCancelledWhileQueued: () => {},
		});
		expect(() =>
			queue.enqueue({
				id: "c",
				run: async () => {},
				onCancelledWhileQueued: () => {},
			}),
		).toThrow(/Queue full/);

		gate.resolve();
		await queue.idle();
		expect(order).toEqual(["a:start", "a:end", "b"]);
	});

	it("cancels waiting jobs without running them and aborts the active one", async () => {
		const queue = new JobQueue(5);
		const cancelled: string[] = [];
		let activeSignal: AbortSignal | undefined;
		queue.enqueue({
			id: "a",
			run: (signal) =>
				new Promise<void>((resolve) => {
					activeSignal = signal;
					signal.addEventListener("abort", () => resolve());
				}),
			onCancelledWhileQueued: () => cancelled.push("a"),
		});
		queue.enqueue({
			id: "b",
			run: async () => {},
			onCancelledWhileQueued: () => cancelled.push("b"),
		});

		expect(queue.cancel("b", new RenderError("CANCELLED", "x"))).toBe(true);
		expect(queue.cancel("a", new RenderError("CANCELLED", "x"))).toBe(true);
		await queue.idle();
		expect(cancelled).toEqual(["b"]);
		expect(activeSignal?.aborted).toBe(true);
		expect(queue.cancel("zzz", new RenderError("CANCELLED", "x"))).toBe(false);
	});
});
