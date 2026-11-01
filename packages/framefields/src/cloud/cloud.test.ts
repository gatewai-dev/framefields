import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { duration, narrator, progressLine, usd } from "../cli/cloud.js";
import {
	CloudRenderError,
	type CloudRenderStatus,
	renderCloud,
	resolveGitSource,
	toHttps,
} from "./index.js";

describe("toHttps", () => {
	it("turns git remotes into URLs a cloud worker can fetch", () => {
		expect(toHttps("git@github.com:acme/films.git")).toBe(
			"https://github.com/acme/films.git",
		);
		expect(toHttps("ssh://git@gitlab.com/acme/films.git")).toBe(
			"https://gitlab.com/acme/films.git",
		);
		expect(toHttps("https://token@github.com/acme/films.git")).toBe(
			"https://github.com/acme/films.git",
		);
		expect(toHttps("https://github.com/acme/films")).toBe(
			"https://github.com/acme/films",
		);
	});
});

describe("resolveGitSource", () => {
	let dir: string;
	let work: string;
	const git = (cwd: string, ...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}).trim();

	beforeEach(async () => {
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "ff-cloud-git-"));
		const remote = path.join(dir, "remote.git");
		work = path.join(dir, "work");
		git(dir, "init", "--bare", "-b", "main", remote);
		git(dir, "clone", remote, work);
		for (const [k, v] of [
			["user.email", "t@example.com"],
			["user.name", "t"],
			["commit.gpgsign", "false"],
		])
			git(work, "config", k, v);
		await fs.mkdir(path.join(work, "films/launch/src"), { recursive: true });
		await fs.writeFile(
			path.join(work, "films/launch/src/film.ts"),
			"export const buildFilm = () => null;\n",
		);
		git(work, "add", ".");
		git(work, "commit", "-m", "film");
		git(work, "push", "-u", "origin", "main");
		git(work, "remote", "set-url", "origin", "git@github.com:acme/films.git");
	});
	afterEach(() => fs.rm(dir, { recursive: true, force: true }));

	it("reads repo, branch, pushed commit and the project folder", () => {
		const project = path.join(work, "films/launch");
		const sha = git(work, "rev-parse", "HEAD");
		expect(resolveGitSource(project, "src/film.ts")).toEqual({
			source: {
				repo: "https://github.com/acme/films.git",
				ref: "main",
				commit: sha,
				workdir: "films/launch",
			},
			entry: "src/film.ts",
			warnings: [],
		});
	});

	it("warns that uncommitted changes are not rendered", async () => {
		await fs.writeFile(
			path.join(work, "films/launch/src/film.ts"),
			"export const buildFilm = () => 1;\n",
		);
		const { warnings } = resolveGitSource(
			path.join(work, "films/launch"),
			"src/film.ts",
		);
		expect(warnings[0]).toMatch(/Uncommitted changes are not rendered/);
	});

	it("refuses a commit that is not pushed", async () => {
		await fs.writeFile(path.join(work, "x.txt"), "x");
		git(work, "add", ".");
		git(work, "commit", "-m", "local only");
		expect(() => resolveGitSource(work, "films/launch/src/film.ts")).toThrow(
			/is not on origin\. Push it first/,
		);
	});

	it("refuses an entry outside the project", () => {
		expect(() =>
			resolveGitSource(path.join(work, "films/launch"), "../other.ts"),
		).toThrow(/outside/);
	});
});

describe("renderCloud", () => {
	let server: http.Server;
	let url: string;
	let requests: { method: string; path: string; body?: unknown }[];
	/** Statuses the fake API returns, one per GET. */
	let script: Partial<Record<string, unknown>>[];

	const status = (over: Record<string, unknown>) => ({
		id: "r1",
		status: "rendering",
		workers: 3,
		progress: { frames: 0, total_frames: 3000, eta_sec: null },
		cost_usd: 0,
		gpu_seconds: 0,
		...over,
	});

	beforeEach(async () => {
		requests = [];
		script = [];
		server = http.createServer(async (req, res) => {
			let raw = "";
			for await (const chunk of req) raw += chunk;
			requests.push({
				method: req.method ?? "",
				path: req.url ?? "",
				...(raw && { body: JSON.parse(raw) }),
			});
			if (req.url === "/files/render.mp4") {
				res.end("video-bytes");
				return;
			}
			if (req.headers.authorization !== "Bearer ff_test_key") {
				res.writeHead(401).end(
					JSON.stringify({
						error: { type: "invalid_api_key", message: "API key is invalid" },
					}),
				);
				return;
			}
			const body =
				req.method === "POST"
					? status({ status: "probing", workers: 1 })
					: req.method === "DELETE"
						? status({ status: "cancelled", cost_usd: 0.12 })
						: (script.shift() ?? status({}));
			res
				.writeHead(req.method === "POST" ? 202 : 200, {
					"content-type": "application/json",
				})
				.end(JSON.stringify(body));
		});
		await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
		url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	});
	afterEach(() => new Promise<void>((r) => server.close(() => r())));

	const source = {
		repo: "https://github.com/acme/films",
		commit: "abc1234",
		workdir: ".",
	};

	it("submits, polls until done and downloads the video", async () => {
		const out = path.join(
			await fs.mkdtemp(path.join(os.tmpdir(), "ff-cloud-")),
			"out/film.mp4",
		);
		script = [
			status({
				plan: { workers: 3, work_sec: 1800, eta_sec: 700, chunks: [] },
				estimate_usd: 1.9,
			}),
			status({ status: "stitching" }),
			status({
				status: "completed",
				gpu_seconds: 2100,
				cost_usd: 1.86,
				output: { url: `${url}/files/render.mp4`, bytes: 11 },
			}),
		];
		const seen: CloudRenderStatus[] = [];
		const result = await renderCloud({
			entry: "src/film.ts",
			workers: "auto",
			source,
			outputPath: out,
			apiKey: "ff_test_key",
			apiUrl: url,
			pollMs: 1,
			onProgress: (s) => seen.push(s),
		});
		expect(requests[0]).toEqual({
			method: "POST",
			path: "/v1/render",
			body: {
				source,
				target: { entry: "src/film.ts", export: "buildFilm" },
				render: { codec: "h264" },
				workers: "auto",
				dry_run: false,
			},
		});
		expect(seen.map((s) => s.status)).toEqual([
			"probing",
			"rendering",
			"stitching",
			"completed",
		]);
		expect(seen[1].plan).toEqual({
			workers: 3,
			workSec: 1800,
			etaSec: 700,
			chunks: [],
		});
		expect(result).toMatchObject({
			status: "completed",
			costUsd: 1.86,
			gpuSeconds: 2100,
			filePath: out,
		});
		expect(await fs.readFile(out, "utf8")).toBe("video-bytes");
	});

	it("throws with the render's error when it fails", async () => {
		script = [
			status({
				status: "failed",
				error: {
					code: "ASSET_NOT_FOUND",
					message: "chunk-1: missing logo.png",
				},
				cost_usd: 0.3,
			}),
		];
		const failed = renderCloud({
			entry: "src/film.ts",
			source,
			apiKey: "ff_test_key",
			apiUrl: url,
			pollMs: 1,
		});
		await expect(failed).rejects.toThrow(
			"Cloud render failed: chunk-1: missing logo.png (ASSET_NOT_FOUND)",
		);
		await expect(failed).rejects.toBeInstanceOf(CloudRenderError);
	});

	it("cancels the cloud render when the signal aborts", async () => {
		const controller = new AbortController();
		const render = renderCloud({
			entry: "src/film.ts",
			source,
			apiKey: "ff_test_key",
			apiUrl: url,
			pollMs: 60_000,
			signal: controller.signal,
		});
		setTimeout(() => controller.abort(new Error("stop")), 50);
		const err = (await render.catch((e) => e)) as CloudRenderError;
		expect(err.code).toBe("cancelled");
		expect(err.status?.costUsd).toBe(0.12);
		expect(requests.at(-1)).toMatchObject({
			method: "DELETE",
			path: "/v1/render/r1",
		});
	});

	it("reports the API's refusal", async () => {
		await expect(
			renderCloud({
				entry: "src/film.ts",
				source,
				apiKey: "ff_test_bad",
				apiUrl: url,
			}),
		).rejects.toMatchObject({
			code: "invalid_api_key",
			message: "API key is invalid",
		});
	});

	it("needs an API key", async () => {
		const saved = process.env.FRAMEFIELDS_API_KEY;
		delete process.env.FRAMEFIELDS_API_KEY;
		try {
			await expect(
				renderCloud({ entry: "src/film.ts", source, apiUrl: url }),
			).rejects.toThrow(/FRAMEFIELDS_API_KEY/);
		} finally {
			if (saved !== undefined) process.env.FRAMEFIELDS_API_KEY = saved;
		}
	});
});

describe("render --cloud output", () => {
	const s = (over: Partial<CloudRenderStatus>): CloudRenderStatus => ({
		id: "r1",
		status: "rendering",
		workers: 10,
		progress: { frames: 0, totalFrames: 324_000, etaSec: null },
		costUsd: 0,
		gpuSeconds: 0,
		...over,
	});

	it("prints each phase once and throttles frame progress", () => {
		const lines: string[] = [];
		let clock = 0;
		const narrate = narrator(
			(l) => lines.push(l),
			() => clock,
		);
		narrate(s({ status: "probing", workers: 1 }));
		narrate(s({ status: "probing", workers: 1 }));
		narrate(
			s({
				plan: { workers: 10, workSec: 10_800, etaSec: 1170, chunks: [] },
				estimateUsd: 4.2,
			}),
		);
		clock = 5_000;
		narrate(
			s({ progress: { frames: 1000, totalFrames: 324_000, etaSec: 1100 } }),
		);
		clock = 12_000;
		narrate(
			s({
				progress: { frames: 162_000, totalFrames: 324_000, etaSec: 540 },
				costUsd: 2.1,
			}),
		);
		narrate(s({ status: "stitching" }));
		expect(lines).toEqual([
			"Cloud render r1 started.",
			"Measuring frame costs on one worker to plan the split…",
			"Plan: 10 workers, 3 h 0 min of render work, ready in about 20 min, estimated $4.20.",
			"Rendering 10 chunks and the audio in parallel…",
			"Rendering 50% (162000/324000 frames), about 9 min left, $2.10 so far.",
			"Joining 10 chunks…",
		]);
	});

	it("formats durations and money", () => {
		expect(duration(40)).toBe("40 s");
		expect(duration(14 * 60)).toBe("14 min");
		expect(duration(6120)).toBe("1 h 42 min");
		expect(usd(0.004)).toBe("<$0.01");
		expect(usd(1.861)).toBe("$1.86");
		expect(
			progressLine(
				s({ progress: { frames: 5, totalFrames: null, etaSec: null } }),
			),
		).toBe("Rendering 5 frames, $0.00 so far.");
	});
});
