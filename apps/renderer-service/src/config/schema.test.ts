import { describe, expect, it } from "vitest";
import { buildConfig } from "./schema.js";

const probe = (exists = false) => ({
	exists: () => exists,
	tmpdir: () => "/tmp",
	homedir: () => "/home/u",
});

describe("buildConfig", () => {
	it("reports every problem at once", () => {
		const result = buildConfig(
			{ FF_MODE: "http", STORAGE_DRIVER: "s3" },
			probe(),
		);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		const keys = result.problems.map((p) => p.key);
		expect(keys).toEqual(
			expect.arrayContaining([
				"RENDERER_API_KEY",
				"FF_REPO_ALLOWLIST",
				"STORAGE_ENDPOINT",
				"STORAGE_ACCESS_KEY_ID",
				"STORAGE_SECRET_ACCESS_KEY",
				"STORAGE_BUCKET",
			]),
		);
	});

	it("rejects ambiguous booleans instead of treating them as true", () => {
		const result = buildConfig(
			{ FF_HTTP_INSECURE: "nope", FF_REPO_ALLOWLIST: "github.com/a/*" },
			probe(),
		);
		expect(result.ok).toBe(false);
	});

	it("derives the allowlist from FF_DEFAULT_REPO", () => {
		const result = buildConfig(
			{
				FF_MODE: "runpod-serverless",
				FF_DEFAULT_REPO: "git@github.com:Acme/Films.git",
			},
			probe(),
		);
		expect(result.ok && result.config.source.allowlist).toEqual([
			"github.com/Acme/Films",
		]);
	});

	it("defaults to serverless mode on RunPod, bound to localhost", () => {
		const result = buildConfig(
			{ RUNPOD_POD_ID: "abc", FF_REPO_ALLOWLIST: "github.com/a/*" },
			probe(true),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config.mode).toBe("runpod-serverless");
		expect(result.config.http.host).toBe("127.0.0.1");
		expect(result.config.paths.cacheDir).toBe("/runpod-volume/framefields");
	});

	it("parses JSON credentials and host kinds", () => {
		const result = buildConfig(
			{
				FF_MODE: "cli",
				FF_REPO_ALLOWLIST: "git.acme.dev/**",
				FF_GIT_CREDENTIALS:
					'{"git.acme.dev":{"username":"bot","token":"t0ken123"}}',
				FF_GIT_HOSTS: '{"git.acme.dev":"gitea"}',
			},
			probe(),
		);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.config.git.hosts["git.acme.dev"]).toBe("gitea");
		expect(Object.isFrozen(result.config.git)).toBe(true);
	});

	it("flags malformed JSON", () => {
		const result = buildConfig(
			{ FF_MODE: "cli", FF_REPO_ALLOWLIST: "x/*", FF_GIT_HOSTS: "{oops" },
			probe(),
		);
		expect(result.ok).toBe(false);
	});

	it("defaults output buckets to STORAGE_BUCKET", () => {
		const result = buildConfig(
			{
				FF_MODE: "cli",
				FF_REPO_ALLOWLIST: "github.com/a/*",
				STORAGE_ENDPOINT: "https://s3.example.com",
				STORAGE_ACCESS_KEY_ID: "key",
				STORAGE_SECRET_ACCESS_KEY: "secret",
				STORAGE_BUCKET: "renders",
			},
			probe(),
		);
		expect(result.ok && result.config.storage).toMatchObject({
			driver: "s3",
			outputBuckets: ["renders"],
		});
	});
});
