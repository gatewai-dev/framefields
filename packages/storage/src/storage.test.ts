import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	AssetError,
	Bucket,
	credentialsFromEnv,
	downloadVerified,
	hashFile,
	parseAssets,
	parseStorage,
	readUrl,
	type StorageRemote,
} from "./index.js";

let dir: string;
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ff-storage-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const sha = (data: Uint8Array) =>
	createHash("sha256").update(data).digest("hex");

const r2: StorageRemote = {
	endpoint: "https://acct.r2.cloudflarestorage.com",
	bucket: "films",
	prefix: "launch/",
	publicUrl: "https://media.example.com/",
};

/** An in-memory S3 that verifies payload hashes the way S3 and R2 do. */
function fakeS3() {
	const objects = new Map<
		string,
		{ body: Buffer; type: string | null; cache: string | null }
	>();
	const uploads = new Map<string, Map<number, Buffer>>();
	const requests: string[] = [];
	const handler = async (input: Request | string | URL): Promise<Response> => {
		const req = input as Request;
		const url = new URL(req.url);
		const key = decodeURIComponent(url.pathname);
		requests.push(
			`${req.method} ${url.pathname}${url.search ? `?${[...url.searchParams.keys()].join("&")}` : ""}`,
		);
		expect(req.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 /);
		const body = Buffer.from(await req.arrayBuffer());
		if (req.method === "HEAD") {
			const o = objects.get(key);
			return o
				? new Response(null, {
						headers: { "content-length": String(o.body.length) },
					})
				: new Response(null, { status: 404 });
		}
		if (req.method === "PUT") {
			if (req.headers.get("x-amz-content-sha256") !== sha(body))
				return new Response(
					"<Error><Code>XAmzContentSHA256Mismatch</Code></Error>",
					{ status: 400 },
				);
			const uploadId = url.searchParams.get("uploadId");
			if (uploadId) {
				uploads
					.get(uploadId)
					?.set(Number(url.searchParams.get("partNumber")), body);
				return new Response(null, {
					headers: { etag: `"${sha(body).slice(0, 8)}"` },
				});
			}
			objects.set(key, {
				body,
				type: req.headers.get("content-type"),
				cache: req.headers.get("cache-control"),
			});
			return new Response(null);
		}
		if (req.method === "POST" && url.searchParams.has("uploads")) {
			uploads.set("u1", new Map());
			objects.set(`${key}#meta`, {
				body: Buffer.alloc(0),
				type: req.headers.get("content-type"),
				cache: req.headers.get("cache-control"),
			});
			return new Response(
				"<InitiateMultipartUploadResult><UploadId>u1</UploadId></InitiateMultipartUploadResult>",
			);
		}
		if (req.method === "POST") {
			const parts = uploads.get(url.searchParams.get("uploadId") ?? "");
			const numbers = [
				...body.toString().matchAll(/<PartNumber>(\d+)<\/PartNumber>/g),
			].map((m) => Number(m[1]));
			const joined = Buffer.concat(
				numbers.map((n) => parts?.get(n) ?? Buffer.alloc(0)),
			);
			const meta = objects.get(`${key}#meta`);
			objects.set(key, {
				body: joined,
				type: meta?.type ?? null,
				cache: meta?.cache ?? null,
			});
			return new Response("<CompleteMultipartUploadResult/>");
		}
		return new Response(null, { status: 405 });
	};
	return { fetch: handler as typeof fetch, objects, requests };
}

const creds = { accessKeyId: "AKID", secretAccessKey: "secret" };

describe("Bucket", () => {
	it("uploads by content, immutable and typed for a CDN, and skips what it has", async () => {
		const s3 = fakeS3();
		const bucket = new Bucket(r2, creds, { fetch: s3.fetch });
		const file = join(dir, "clip.mp4");
		writeFileSync(file, "frames");
		const digest = await hashFile(file);
		expect(await bucket.has(digest.sha256, digest.size)).toBe(false);
		await bucket.upload(file, digest);
		const key = `/films/launch/sha256/${digest.sha256.slice(0, 2)}/${digest.sha256}`;
		expect(s3.objects.get(key)).toEqual({
			body: Buffer.from("frames"),
			type: "video/mp4",
			cache: "public, max-age=31536000, immutable",
		});
		expect(await bucket.has(digest.sha256, digest.size)).toBe(true);
		expect(await bucket.has(digest.sha256, digest.size + 1)).toBe(false);
	});

	it("uploads large files in hash-checked parts", async () => {
		const s3 = fakeS3();
		const bucket = new Bucket(r2, creds, {
			fetch: s3.fetch,
			multipartThreshold: 10,
			partSize: 1,
		});
		const data = Buffer.alloc(12 * 1024 * 1024, 7);
		data.write("head", 0);
		data.write("tail", data.length - 4);
		const file = join(dir, "long.mov");
		writeFileSync(file, data);
		const digest = await hashFile(file);
		const seen: number[] = [];
		await bucket.upload(file, digest, (p) => seen.push(p.sent));
		const stored = s3.objects.get(`/films/${bucket.keyFor(digest.sha256)}`);
		expect(stored?.body.equals(data)).toBe(true);
		expect(stored?.type).toBe("video/quicktime");
		// 5 MiB minimum parts: 5 + 5 + 2.
		expect(s3.requests.filter((r) => r.includes("partNumber"))).toHaveLength(3);
		expect(seen.at(-1)).toBe(data.length);
	});

	it("presigns GETs without exposing keys and caps them at 7 days", async () => {
		const bucket = new Bucket(r2, creds);
		const url = new URL(await bucket.presign("ab".repeat(32), 30 * 86_400));
		expect(url.origin + url.pathname).toBe(
			`https://acct.r2.cloudflarestorage.com/films/launch/sha256/ab/${"ab".repeat(32)}`,
		);
		expect(url.searchParams.get("X-Amz-Expires")).toBe("604800");
		expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
		expect(url.search).not.toContain("secret");
	});
});

describe("manifest", () => {
	const storage = parseStorage({
		remotes: { media: r2, private: { endpoint: r2.endpoint, bucket: "raw" } },
		default: "media",
	});

	it("reads from the custom domain, a pinned url, or a signature", () => {
		const hash = "cd".repeat(32);
		expect(readUrl({ sha256: hash, size: 1 }, storage)).toBe(
			`https://media.example.com/launch/sha256/cd/${hash}`,
		);
		expect(
			readUrl({ sha256: hash, size: 1, url: "https://x.dev/a.mp4" }, storage),
		).toBe("https://x.dev/a.mp4");
		expect(
			readUrl({ sha256: hash, size: 1, remote: "private" }, storage),
		).toBeUndefined();
		expect(
			readUrl({ sha256: hash, size: 1, remote: "private" }, storage, {
				[hash]: "https://signed",
			}),
		).toBe("https://signed");
	});

	it("names the field at fault", () => {
		expect(() =>
			parseStorage({ remotes: { media: { bucket: "films" } } }),
		).toThrow('storage.remotes.media needs "endpoint"');
		expect(() =>
			parseStorage({
				remotes: { media: { ...r2, publicUrl: "media.example.com" } },
			}),
		).toThrow('"publicUrl" must be an http(s) URL');
		expect(() =>
			parseAssets(
				{ "../x.mp4": { sha256: "ab".repeat(32), size: 1 } },
				storage,
			),
		).toThrow("must be a path inside the project");
		expect(() =>
			parseAssets({ "a.mp4": { sha256: "AB", size: 1 } }, storage),
		).toThrow('needs "sha256"');
		expect(() =>
			parseAssets(
				{ "a.mp4": { sha256: "ab".repeat(32), size: 1, remote: "nope" } },
				storage,
			),
		).toThrow('"remote" must name a remote');
		expect(() =>
			parseAssets({ "a.mp4": { sha256: "ab".repeat(32), size: 1 } }),
		).toThrow('needs a "url"');
	});

	it("takes keys per remote, then the AWS variables", () => {
		expect(
			credentialsFromEnv("raw-footage", {
				FRAMEFIELDS_STORAGE_RAW_FOOTAGE_ACCESS_KEY_ID: "a",
				FRAMEFIELDS_STORAGE_RAW_FOOTAGE_SECRET_ACCESS_KEY: "b",
				AWS_ACCESS_KEY_ID: "c",
				AWS_SECRET_ACCESS_KEY: "d",
			}),
		).toEqual({ accessKeyId: "a", secretAccessKey: "b" });
		expect(
			credentialsFromEnv("media", {
				AWS_ACCESS_KEY_ID: "c",
				AWS_SECRET_ACCESS_KEY: "d",
			}),
		).toEqual({
			accessKeyId: "c",
			secretAccessKey: "d",
		});
		expect(credentialsFromEnv("media", {})).toBeUndefined();
	});
});

describe("downloadVerified", () => {
	const serve = (body: string, status = 200) =>
		(async () =>
			new Response(status === 200 ? body : null, {
				status,
			})) as unknown as typeof fetch;

	it("writes the file only when it matches", async () => {
		const data = Buffer.from("pinned bytes");
		const dest = join(dir, "a/b.wav");
		await downloadVerified(
			"https://cdn/x",
			dest,
			{ sha256: sha(data), size: data.length },
			{ fetch: serve("pinned bytes") },
		);
		expect(readFileSync(dest, "utf8")).toBe("pinned bytes");
		const bad = downloadVerified(
			"https://cdn/x",
			join(dir, "c.wav"),
			{ sha256: sha(data), size: data.length },
			{ fetch: serve("pinned bytez") },
		);
		await expect(bad).rejects.toMatchObject({ code: "ASSET_HASH_MISMATCH" });
	});

	it("explains 403s and never prints signatures", async () => {
		const err = await downloadVerified(
			"https://acct.r2.cloudflarestorage.com/films/k?X-Amz-Signature=abc",
			join(dir, "d"),
			{ sha256: "ab".repeat(32), size: 1 },
			{ fetch: serve("", 403) },
		).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(AssetError);
		expect((err as AssetError).code).toBe("ASSET_FORBIDDEN");
		expect((err as AssetError).message).not.toContain("abc");
	});
});
