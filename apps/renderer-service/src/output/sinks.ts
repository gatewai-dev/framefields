import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
	GetObjectCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
	S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import type { RendererConfig } from "../config/index.js";
import { RenderError } from "../errors.js";
import type { DeliveredFile } from "../jobs/pipeline.js";
import { redact } from "../redact.js";
import type { VerifiedFile } from "./verify.js";

const ATTEMPTS = 3;

/** Retries transient storage failures with backoff. */
async function withRetries<T>(
	signal: AbortSignal,
	fn: () => Promise<T>,
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await fn();
		} catch (err) {
			const classified = classifyUploadError(err);
			if (!classified.retryable || attempt >= ATTEMPTS || signal.aborted)
				throw classified;
			await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
		}
	}
}

export function classifyUploadError(err: unknown): RenderError {
	if (err instanceof RenderError) return err;
	const name = err instanceof S3ServiceException ? err.name : "";
	const status =
		err instanceof S3ServiceException
			? err.$metadata?.httpStatusCode
			: undefined;
	const message = redact(err instanceof Error ? err.message : String(err));
	if (
		/AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch|InvalidToken|ExpiredToken|AllAccessDisabled/.test(
			name,
		)
	) {
		return new RenderError("UPLOAD_AUTH_FAILED", `${name}: ${message}`, {
			phase: "upload",
			hint: "Check STORAGE_ACCESS_KEY_ID / STORAGE_SECRET_ACCESS_KEY and that they may write to the bucket.",
			cause: err,
		});
	}
	if (/NoSuchBucket/.test(name)) {
		return new RenderError(
			"UPLOAD_AUTH_FAILED",
			`Bucket does not exist: ${message}`,
			{ phase: "upload", cause: err },
		);
	}
	if (/ENOSPC/.test(message))
		return new RenderError("DISK_FULL", message, { phase: "upload" });
	return new RenderError(
		"UPLOAD_FAILED",
		status ? `HTTP ${status}: ${message}` : message,
		{
			phase: "upload",
			cause: err,
		},
	);
}

let client: S3Client | undefined;
export function s3Client(config: RendererConfig): S3Client {
	client ??= new S3Client({
		region: config.storage.region,
		endpoint: config.storage.endpoint,
		forcePathStyle: config.storage.forcePathStyle,
		credentials: {
			accessKeyId: config.storage.accessKeyId ?? "",
			secretAccessKey: config.storage.secretAccessKey ?? "",
		},
		maxAttempts: 2,
	});
	return client;
}

export function publicUrl(
	config: RendererConfig,
	key: string,
): string | undefined {
	const base = config.storage.publicBaseUrl;
	if (!base) return undefined;
	return `${base.replace(/\/+$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export interface Delivery {
	file: VerifiedFile;
	signal: AbortSignal;
}

export async function deliverS3(
	{ file, signal }: Delivery,
	config: RendererConfig,
	bucket: string,
	key: string,
	metadata: Record<string, string>,
): Promise<DeliveredFile> {
	await withRetries(signal, async () => {
		const upload = new Upload({
			client: s3Client(config),
			params: {
				Bucket: bucket,
				Key: key,
				Body: createReadStream(file.path),
				ContentType: file.contentType,
				ContentLength: file.bytes,
				Metadata: metadata,
			},
			queueSize: 4,
			partSize: 16 * 1024 * 1024,
			leavePartsOnError: false,
		});
		const onAbort = () => void upload.abort();
		signal.addEventListener("abort", onAbort, { once: true });
		try {
			await upload.done();
		} finally {
			signal.removeEventListener("abort", onAbort);
		}
	});
	return summary(file, { key, url: publicUrl(config, key) });
}

export async function deliverPresigned(
	{ file, signal }: Delivery,
	url: string,
	headers: Record<string, string> = {},
): Promise<DeliveredFile> {
	await withRetries(signal, async () => {
		const res = await fetch(url, {
			method: "PUT",
			body: createReadStream(file.path) as unknown as RequestInit["body"],
			// Node's fetch needs this for streamed request bodies.
			duplex: "half",
			headers: {
				"content-type": file.contentType,
				"content-length": String(file.bytes),
				...headers,
			},
			signal,
		} as RequestInit);
		if (res.ok) return;
		const text = await res.text().catch(() => "");
		if (
			(res.status === 403 || res.status === 400) &&
			/expired|Request has expired|AccessDenied/i.test(text)
		) {
			throw new RenderError(
				"UPLOAD_URL_EXPIRED",
				`The presigned URL was rejected (${res.status}).`,
				{
					phase: "upload",
					hint: "Sign upload URLs with an expiry at least as long as the job timeout.",
				},
			);
		}
		const error = new RenderError(
			"UPLOAD_FAILED",
			`Presigned PUT failed with HTTP ${res.status}.`,
			{
				phase: "upload",
				details: { body: redact(text.slice(0, 500)) },
			},
		);
		if (res.status < 500 && res.status !== 429) {
			throw new RenderError("UPLOAD_AUTH_FAILED", error.message, {
				phase: "upload",
				details: error.details,
			});
		}
		throw error;
	});
	return summary(file, { url: url.split("?")[0] });
}

/** Copies into FF_OUTPUT_DIR atomically (temp file + rename). */
export async function deliverLocal(
	{ file }: Delivery,
	outputDir: string,
	relPath: string,
): Promise<DeliveredFile> {
	const root = path.resolve(outputDir);
	const target = path.resolve(root, relPath);
	if (!target.startsWith(root + path.sep)) {
		throw new RenderError(
			"PATH_ESCAPE",
			`Output path ${relPath} leaves FF_OUTPUT_DIR.`,
			{ phase: "upload" },
		);
	}
	await fs.mkdir(path.dirname(target), { recursive: true });
	const tmp = `${target}.partial-${process.pid}`;
	try {
		await fs.copyFile(file.path, tmp);
		await fs.rename(tmp, target);
	} catch (err) {
		await fs.rm(tmp, { force: true });
		throw classifyUploadError(err);
	}
	return summary(file, { path: relPath });
}

export async function deliverInline({
	file,
}: Delivery): Promise<DeliveredFile> {
	return summary(file, {
		base64: (await fs.readFile(file.path)).toString("base64"),
	});
}

function summary(
	file: VerifiedFile,
	extra: Partial<DeliveredFile>,
): DeliveredFile {
	return {
		name: file.name,
		bytes: file.bytes,
		sha256: file.sha256,
		contentType: file.contentType,
		...(file.durationMs !== undefined && { durationMs: file.durationMs }),
		...(file.frames !== undefined && { frames: file.frames }),
		...(file.qa !== undefined && { qa: file.qa }),
		...extra,
	};
}

// ─── Idempotency manifest (PLAN.md §8.7) ─────────────────────────────────────

export interface Manifest {
	idempotencyKey: string;
	sha: string;
	outputs: DeliveredFile[];
	createdAt: string;
}

export function manifestKey(idempotencyKey: string): string {
	return `.ff-idempotency/${Buffer.from(idempotencyKey).toString("base64url")}.json`;
}

/** Returns the earlier result for this key when it rendered the same commit and its objects still exist. */
export async function readManifest(
	config: RendererConfig,
	bucket: string,
	idempotencyKey: string,
	sha: string,
): Promise<Manifest | undefined> {
	const s3 = s3Client(config);
	try {
		const res = await s3.send(
			new GetObjectCommand({
				Bucket: bucket,
				Key: manifestKey(idempotencyKey),
			}),
		);
		const manifest = JSON.parse(
			(await res.Body?.transformToString()) ?? "{}",
		) as Manifest;
		if (manifest.sha !== sha || manifest.idempotencyKey !== idempotencyKey)
			return undefined;
		for (const output of manifest.outputs) {
			if (!output.key) return undefined;
			await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: output.key }));
		}
		return manifest;
	} catch (err) {
		if (
			err instanceof S3ServiceException &&
			(err.name === "NoSuchKey" || err.name === "NotFound")
		)
			return undefined;
		throw classifyUploadError(err);
	}
}

export async function writeManifest(
	config: RendererConfig,
	bucket: string,
	manifest: Manifest,
): Promise<void> {
	await s3Client(config).send(
		new PutObjectCommand({
			Bucket: bucket,
			Key: manifestKey(manifest.idempotencyKey),
			Body: JSON.stringify(manifest),
			ContentType: "application/json",
		}),
	);
}
