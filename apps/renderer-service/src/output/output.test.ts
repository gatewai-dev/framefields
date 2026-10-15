import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenderError } from "../errors.js";
import type { RenderedFile, StepContext } from "../jobs/pipeline.js";
import { jobSchema } from "../jobs/schema.js";
import { testConfig } from "../test-helpers.js";
import { deliver, findExisting } from "./deliver.js";
import { qaFailures, verifyFile } from "./verify.js";

let tmp: string;
let server: http.Server;
let base: string;
const objects = new Map<string, { body: Buffer; headers: http.IncomingHttpHeaders }>();
/** Scripted responses for presigned PUTs, consumed in order. */
const presignedPlan: number[] = [];

beforeAll(async () => {
	tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ff-output-"));
	// A tiny path-style S3 (PUT/GET/HEAD object) plus a presigned PUT endpoint.
	server = http.createServer(async (req, res) => {
		const chunks: Buffer[] = [];
		for await (const c of req) chunks.push(c as Buffer);
		const url = new URL(req.url ?? "/", "http://x");
		const key = decodeURIComponent(url.pathname);
		if (key.startsWith("/presigned/")) {
			const status = presignedPlan.shift() ?? 200;
			if (status === 200) objects.set(key, { body: Buffer.concat(chunks), headers: req.headers });
			res.writeHead(status).end(status === 403 ? "<Error><Message>Request has expired</Message></Error>" : "");
			return;
		}
		if (req.method === "PUT") {
			objects.set(key, { body: Buffer.concat(chunks), headers: req.headers });
			res.writeHead(200, { etag: '"x"' }).end();
		} else if (objects.has(key)) {
			const o = objects.get(key)!;
			res.writeHead(200, { "content-length": o.body.length, "content-type": "application/octet-stream" });
			res.end(req.method === "HEAD" ? undefined : o.body);
		} else {
			res.writeHead(404, { "content-type": "application/xml" });
			res.end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code><Message>nope</Message></Error>");
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
	server.close();
	await fs.rm(tmp, { recursive: true, force: true });
});

const hasFfmpeg = (() => {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

async function file(name: string, content: string | Buffer, ext = "bin"): Promise<RenderedFile> {
	const p = path.join(tmp, `${name}.${ext}`);
	await fs.writeFile(p, content);
	return { name, path: p, ext, contentType: "application/octet-stream" };
}

function mp4(name: string, frames: number): RenderedFile {
	const p = path.join(tmp, `${name}.mp4`);
	execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=64x64:r=24", "-frames:v", String(frames), "-pix_fmt", "yuv420p", p]);
	return { name, path: p, ext: "mp4", contentType: "video/mp4", expectedFrames: frames };
}

async function codeOf(promise: Promise<unknown>) {
	try {
		await promise;
		return "no error";
	} catch (err) {
		return err instanceof RenderError ? err.code : String(err);
	}
}

describe("verifyFile", () => {
	it("hashes and sizes a file", async () => {
		const f = await verifyFile(await file("a", "hello"), { maxBytes: 100 });
		expect(f).toMatchObject({ bytes: 5, sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824" });
	});

	it.each([
		["missing", async () => ({ name: "x", path: path.join(tmp, "nope"), ext: "bin", contentType: "" }), "OUTPUT_MISSING"],
		["empty", () => file("empty", ""), "OUTPUT_INVALID"],
		["too large", () => file("big", "0123456789"), "OUTPUT_TOO_LARGE"],
		["not media", () => file("fake", "not a video", "mp4"), "OUTPUT_INVALID"],
	])("rejects %s output", async (_, make, code) => {
		expect(await codeOf(verifyFile(await make(), { maxBytes: 5 + (code === "OUTPUT_TOO_LARGE" ? 0 : 100) }))).toBe(code);
	});

	it.skipIf(!hasFfmpeg)("probes media and checks the frame count", async () => {
		const ok = await verifyFile(mp4("clip", 24), { maxBytes: 0 });
		expect(ok).toMatchObject({ frames: 24, durationMs: 1000 });
		const wrong = { ...mp4("short", 10), expectedFrames: 24 };
		expect(await codeOf(verifyFile(wrong, { maxBytes: 0 }))).toBe("OUTPUT_INVALID");
	});

	it("matches QA issues by code or severity", () => {
		const report = {
			issues: [
				{ severity: "warning", code: "black_frames" },
				{ severity: "info", code: "loudness_off_target" },
			],
		};
		expect(qaFailures(report, ["black_frames"])).toHaveLength(1);
		expect(qaFailures(report, ["warning"])).toHaveLength(1);
		expect(qaFailures(report, ["frozen_video"])).toHaveLength(0);
		expect(qaFailures(report, undefined)).toHaveLength(0);
	});
});

describe("deliver", () => {
	const storageEnv = () => ({
		STORAGE_ENDPOINT: base,
		STORAGE_ACCESS_KEY_ID: "key",
		STORAGE_SECRET_ACCESS_KEY: "secret",
		STORAGE_BUCKET: "renders",
		STORAGE_FORCE_PATH_STYLE: "true",
		STORAGE_PUBLIC_BASE_URL: "https://cdn.example.com",
		FF_OUTPUT_DIR: path.join(tmp, "out"),
	});

	function run(output: unknown, files: RenderedFile[], extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
		const ctx: StepContext = {
			jobId: "job1",
			config: testConfig({ ...storageEnv(), ...env }),
			signal: new AbortController().signal,
			jobDir: tmp,
			progress: () => {},
			warn: () => {},
		};
		const input = jobSchema.parse({
			version: 2,
			source: { repo: "https://github.com/acme/films" },
			target: { entry: "src/film.ts" },
			output,
			...extra,
		});
		return { promise: deliver(files, { input, sha: "9f2c1e4abcdef", ref: "main" }, ctx), input, ctx };
	}

	it("uploads to S3 with templated keys, metadata and public URLs", async () => {
		const files = [await file("main", "AAA", "mp4b"), await file("teaser", "BB", "mp4b")];
		const out = await run({ type: "s3", key: "acme/{shortSha}/{name}.{ext}" }, files).promise;
		expect(out.map((o) => o.key)).toEqual(["acme/9f2c1e4/main.mp4b", "acme/9f2c1e4/teaser.mp4b"]);
		expect(out[0].url).toBe("https://cdn.example.com/acme/9f2c1e4/main.mp4b");
		const stored = objects.get("/renders/acme/9f2c1e4/main.mp4b");
		expect(stored?.body.toString()).toBe("AAA");
		expect(stored?.headers["x-amz-meta-ff-sha"]).toBe("9f2c1e4abcdef");
	});

	it("writes an idempotency manifest that findExisting returns for the same commit", async () => {
		const files = [await file("main", "CCC", "mp4b")];
		const { promise, input, ctx } = run({ type: "s3", key: "idem/{name}.{ext}" }, files, { idempotencyKey: "launch-v12" });
		const delivered = await promise;
		expect(await findExisting?.(input, "9f2c1e4abcdef", ctx)).toEqual(delivered);
		expect(await findExisting?.(input, "0000000different", ctx)).toBeUndefined();
		// An output deleted from the bucket invalidates the manifest.
		objects.delete("/renders/idem/main.mp4b");
		expect(await findExisting?.(input, "9f2c1e4abcdef", ctx)).toBeUndefined();
	});

	it("PUTs presigned URLs, retrying 5xx and failing fast on expiry", async () => {
		presignedPlan.push(503, 200);
		const ok = await run({ type: "presigned", urls: [`${base}/presigned/a?X-Amz-Signature=s`] }, [await file("p", "PPP")]).promise;
		expect(ok[0].url).toBe(`${base}/presigned/a`);
		expect(objects.get("/presigned/a")?.body.toString()).toBe("PPP");

		presignedPlan.push(403);
		expect(await codeOf(run({ type: "presigned", urls: [`${base}/presigned/b`] }, [await file("p2", "x")]).promise)).toBe(
			"UPLOAD_URL_EXPIRED",
		);
		expect(
			await codeOf(run({ type: "presigned", urls: [`${base}/presigned/c`] }, [await file("q1", "x"), await file("q2", "y")]).promise),
		).toBe("JOB_INVALID");
	});

	it("copies to FF_OUTPUT_DIR and refuses to collide or escape", async () => {
		const out = await run({ type: "local", path: "{ref}/{name}.{ext}" }, [await file("loc", "LLL")]).promise;
		expect(await fs.readFile(path.join(tmp, "out/main/loc.bin"), "utf8")).toBe("LLL");
		expect(out[0].path).toBe("main/loc.bin");
		expect(
			await codeOf(run({ type: "local", path: "same.{ext}" }, [await file("l1", "1"), await file("l2", "2")]).promise),
		).toBe("JOB_INVALID");
	});

	it("returns small outputs inline and refuses large ones", async () => {
		const out = await run({ type: "inline" }, [await file("i", "hi")]).promise;
		expect(Buffer.from(out[0].base64 ?? "", "base64").toString()).toBe("hi");
		expect(
			await codeOf(run({ type: "inline" }, [await file("big", "x".repeat(100))], {}, { FF_INLINE_MAX_BYTES: "50" }).promise),
		).toBe("OUTPUT_TOO_LARGE");
	});

	it("fails with QA_FAILED after delivering, unless uploads are blocked", async () => {
		const qa = { issues: [{ severity: "warning", code: "frozen_video", message: "frozen" }] };
		const files = [{ ...(await file("qa", "QQQ")), qa }];
		const render = { render: { qa: { failOn: ["frozen_video"] } } };
		try {
			await run({ type: "inline" }, files, render).promise;
			throw new Error("expected QA_FAILED");
		} catch (err) {
			expect((err as RenderError).code).toBe("QA_FAILED");
			expect((err as RenderError).details?.outputs).toHaveLength(1);
		}
		try {
			await run({ type: "inline" }, files, render, { FF_QA_BLOCK_UPLOAD: "true" }).promise;
		} catch (err) {
			expect((err as RenderError).details?.outputs).toEqual([]);
		}
	});
});
