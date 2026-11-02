/**
 * The few S3 calls asset storage needs (HEAD, PUT, multipart upload,
 * presigned GET), signed with SigV4 by aws4fetch. Works with any
 * S3-compatible service; R2 is the one to pick, since it charges no egress.
 */
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { AwsClient } from "aws4fetch";
import { contentType } from "./files.js";
import { objectKey, type StorageRemote } from "./manifest.js";

export interface Credentials {
	accessKeyId: string;
	secretAccessKey: string;
	sessionToken?: string;
}

/**
 * Keys for `remote` from the environment:
 * `FRAMEFIELDS_STORAGE_<REMOTE>_ACCESS_KEY_ID` / `…_SECRET_ACCESS_KEY`
 * (the remote's name upper-cased, `-` as `_`), else the standard
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`.
 */
export function credentialsFromEnv(
	remote: string,
	env: Readonly<Record<string, string | undefined>> = process.env,
): Credentials | undefined {
	const scope = `FRAMEFIELDS_STORAGE_${remote.toUpperCase().replace(/-/g, "_")}`;
	const own = env[`${scope}_ACCESS_KEY_ID`];
	const ownSecret = env[`${scope}_SECRET_ACCESS_KEY`];
	if (own && ownSecret) return { accessKeyId: own, secretAccessKey: ownSecret };
	const id = env.AWS_ACCESS_KEY_ID;
	const secret = env.AWS_SECRET_ACCESS_KEY;
	if (!id || !secret) return undefined;
	return {
		accessKeyId: id,
		secretAccessKey: secret,
		...(env.AWS_SESSION_TOKEN && { sessionToken: env.AWS_SESSION_TOKEN }),
	};
}

/** The env vars `credentialsFromEnv` reads for `remote`, for messages. */
export function credentialEnvNames(remote: string): [string, string] {
	const scope = `FRAMEFIELDS_STORAGE_${remote.toUpperCase().replace(/-/g, "_")}`;
	return [`${scope}_ACCESS_KEY_ID`, `${scope}_SECRET_ACCESS_KEY`];
}

export class StorageError extends Error {
	override name = "StorageError";
	constructor(
		message: string,
		readonly status?: number,
	) {
		super(message);
	}
}

export interface UploadProgress {
	sent: number;
	total: number;
}

export interface BucketOptions {
	fetch?: typeof fetch;
	/** Files above this go up in parts. Default 64 MiB. */
	multipartThreshold?: number;
	/** Default 16 MiB; grows so a file never needs more than 10,000 parts. */
	partSize?: number;
	/** Parts in flight at once. Default 4. */
	concurrency?: number;
}

const MiB = 1024 * 1024;
/**
 * Content-addressed objects never change: CDNs and browsers may keep them
 * forever, which is what makes a custom domain in front of the bucket cheap.
 */
const IMMUTABLE = "public, max-age=31536000, immutable";

/** One remote's bucket, signed with `credentials`. */
export class Bucket {
	private readonly aws: AwsClient;
	private readonly fetch: typeof fetch;

	constructor(
		readonly remote: StorageRemote,
		credentials: Credentials,
		private readonly options: BucketOptions = {},
	) {
		this.aws = new AwsClient({
			...credentials,
			service: "s3",
			region: remote.region ?? "auto",
			retries: 3,
		});
		this.fetch = options.fetch ?? fetch;
	}

	keyFor(sha256: string): string {
		return objectKey(sha256, this.remote.prefix);
	}

	/** Whether the bucket holds `sha256` at the expected size. */
	async has(sha256: string, size: number): Promise<boolean> {
		const res = await this.send(this.keyFor(sha256), { method: "HEAD" });
		if (res.status === 404) return false;
		if (!res.ok) throw await this.failure("HEAD", res);
		return Number(res.headers.get("content-length")) === size;
	}

	/**
	 * Uploads `file` (already hashed) under its content key. The bucket
	 * checks every byte against the sha256 sent with it.
	 */
	async upload(
		file: string,
		digest: { sha256: string; size: number },
		onProgress?: (p: UploadProgress) => void,
	): Promise<void> {
		const key = this.keyFor(digest.sha256);
		const headers = {
			"content-type": contentType(file),
			"cache-control": IMMUTABLE,
		};
		const threshold = this.options.multipartThreshold ?? 64 * MiB;
		if (digest.size <= threshold) {
			const handle = await open(file);
			try {
				const body = await handle.readFile();
				await this.put(key, body, digest.sha256, headers);
			} finally {
				await handle.close();
			}
			onProgress?.({ sent: digest.size, total: digest.size });
			return;
		}
		await this.uploadParts(file, key, digest.size, headers, onProgress);
	}

	/** A GET URL anyone can use until it expires (at most 7 days). */
	async presign(sha256: string, expiresSec = 86_400): Promise<string> {
		const url = new URL(this.url(this.keyFor(sha256)));
		url.searchParams.set(
			"X-Amz-Expires",
			String(Math.min(expiresSec, 604_800)),
		);
		const signed = await this.aws.sign(url, {
			method: "GET",
			aws: { signQuery: true },
		});
		return signed.url;
	}

	private async put(
		key: string,
		body: Uint8Array,
		sha256: string,
		headers: Record<string, string>,
		query = "",
	): Promise<Response> {
		const res = await this.send(key, {
			method: "PUT",
			body,
			headers: { ...headers, "x-amz-content-sha256": sha256 },
			query,
		});
		if (!res.ok) throw await this.failure("PUT", res);
		return res;
	}

	private async uploadParts(
		file: string,
		key: string,
		size: number,
		headers: Record<string, string>,
		onProgress?: (p: UploadProgress) => void,
	): Promise<void> {
		const partSize = Math.max(
			this.options.partSize ?? 16 * MiB,
			Math.ceil(size / 10_000),
			5 * MiB,
		);
		const created = await this.send(key, {
			method: "POST",
			query: "uploads=",
			headers,
		});
		if (!created.ok) throw await this.failure("CreateMultipartUpload", created);
		const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(
			await created.text(),
		)?.[1];
		if (!uploadId)
			throw new StorageError("CreateMultipartUpload returned no UploadId");
		const id = encodeURIComponent(uploadId);
		const count = Math.ceil(size / partSize);
		const etags: string[] = new Array(count);
		const handle = await open(file);
		let next = 0;
		let sent = 0;
		const worker = async () => {
			while (next < count) {
				const index = next++;
				const length = Math.min(partSize, size - index * partSize);
				const chunk = Buffer.alloc(length);
				await handle.read(chunk, 0, length, index * partSize);
				const sha = createHash("sha256").update(chunk).digest("hex");
				const res = await this.put(
					key,
					chunk,
					sha,
					{},
					`partNumber=${index + 1}&uploadId=${id}`,
				);
				etags[index] = res.headers.get("etag") ?? "";
				sent += length;
				onProgress?.({ sent, total: size });
			}
		};
		try {
			await Promise.all(
				Array.from(
					{ length: Math.min(this.options.concurrency ?? 4, count) },
					worker,
				),
			);
			const body = `<CompleteMultipartUpload>${etags
				.map(
					(etag, i) =>
						`<Part><PartNumber>${i + 1}</PartNumber><ETag>${escapeXml(etag)}</ETag></Part>`,
				)
				.join("")}</CompleteMultipartUpload>`;
			const done = await this.send(key, {
				method: "POST",
				query: `uploadId=${id}`,
				body,
				headers: { "content-type": "application/xml" },
			});
			// S3 can answer 200 with an <Error> body.
			const text = await done.text();
			if (!done.ok || text.includes("<Error>"))
				throw new StorageError(
					`CompleteMultipartUpload failed (${done.status}): ${errorCode(text)}`,
					done.status,
				);
		} catch (err) {
			await this.send(key, { method: "DELETE", query: `uploadId=${id}` }).catch(
				() => undefined,
			);
			throw err;
		} finally {
			await handle.close();
		}
	}

	private url(key: string, query = ""): string {
		const base = this.remote.endpoint.replace(/\/+$/, "");
		const path = key.split("/").map(encodeURIComponent).join("/");
		return `${base}/${this.remote.bucket}/${path}${query ? `?${query}` : ""}`;
	}

	private async send(
		key: string,
		init: {
			method: string;
			query?: string;
			body?: Uint8Array | string;
			headers?: Record<string, string>;
		},
	): Promise<Response> {
		const signed = await this.aws.sign(this.url(key, init.query), {
			method: init.method,
			headers: init.headers,
			body: init.body,
		});
		return this.fetch(signed);
	}

	private async failure(what: string, res: Response): Promise<StorageError> {
		const text = await res.text().catch(() => "");
		const hint =
			res.status === 403
				? ": check the remote's keys and that they may write to the bucket"
				: res.status === 404
					? ": check the remote's endpoint and bucket"
					: "";
		return new StorageError(
			`${what} ${this.remote.bucket} failed (${res.status} ${errorCode(text)})${hint}`,
			res.status,
		);
	}
}

function errorCode(xml: string): string {
	return /<Code>([^<]+)<\/Code>/.exec(xml)?.[1] ?? "no error code";
}

function escapeXml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/"/g, "&quot;");
}
