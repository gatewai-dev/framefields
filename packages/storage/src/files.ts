/**
 * Hashing and verified downloads: every byte an asset contributes is checked
 * against the sha256 its manifest entry pins.
 */
import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export type AssetErrorCode =
	| "ASSET_NOT_FOUND"
	| "ASSET_FORBIDDEN"
	| "ASSET_DOWNLOAD_FAILED"
	| "ASSET_HASH_MISMATCH";

export class AssetError extends Error {
	override name = "AssetError";
	constructor(
		readonly code: AssetErrorCode,
		message: string,
		options?: { cause?: unknown },
	) {
		super(message, options);
	}
}

export interface FileDigest {
	sha256: string;
	size: number;
}

export async function hashFile(path: string): Promise<FileDigest> {
	const hash = createHash("sha256");
	let size = 0;
	for await (const chunk of createReadStream(path)) {
		hash.update(chunk as Buffer);
		size += (chunk as Buffer).length;
	}
	return { sha256: hash.digest("hex"), size };
}

export interface DownloadOptions {
	fetch?: typeof fetch;
	signal?: AbortSignal;
	/** Attempts for network errors and 5xx/429 responses. Default 3. */
	attempts?: number;
}

/**
 * Downloads `url` to `dest` through a temporary file, and only renames it
 * into place once its size and sha256 match `expected`.
 */
export async function downloadVerified(
	url: string,
	dest: string,
	expected: FileDigest,
	options: DownloadOptions = {},
): Promise<void> {
	const attempts = options.attempts ?? 3;
	for (let attempt = 1; ; attempt++) {
		try {
			await downloadOnce(url, dest, expected, options);
			return;
		} catch (err) {
			const transient =
				err instanceof AssetError
					? err.code === "ASSET_DOWNLOAD_FAILED"
					: !options.signal?.aborted;
			if (!transient || attempt >= attempts) throw err;
			await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
		}
	}
}

async function downloadOnce(
	url: string,
	dest: string,
	expected: FileDigest,
	options: DownloadOptions,
): Promise<void> {
	const shown = redactQuery(url);
	const res = await (options.fetch ?? fetch)(url, { signal: options.signal });
	if (!res.ok || !res.body) {
		await res.body?.cancel();
		if (res.status === 404)
			throw new AssetError("ASSET_NOT_FOUND", `${shown} returned 404`);
		if (res.status === 401 || res.status === 403)
			throw new AssetError(
				"ASSET_FORBIDDEN",
				`${shown} returned ${res.status}: the bucket isn't public there, or the signed URL expired`,
			);
		throw new AssetError(
			"ASSET_DOWNLOAD_FAILED",
			`${shown} returned ${res.status}`,
		);
	}
	await mkdir(dirname(dest), { recursive: true });
	const temp = `${dest}.${randomBytes(4).toString("hex")}.part`;
	const hash = createHash("sha256");
	let size = 0;
	const tap = new Transform({
		transform(chunk: Buffer, _encoding, done) {
			size += chunk.length;
			if (size > expected.size)
				return done(
					new AssetError(
						"ASSET_HASH_MISMATCH",
						`${shown} is larger than the ${expected.size} bytes framefields.json pins`,
					),
				);
			hash.update(chunk);
			done(null, chunk);
		},
	});
	try {
		await pipeline(
			Readable.fromWeb(res.body as WebReadableStream<Uint8Array>),
			tap,
			createWriteStream(temp),
			{ signal: options.signal },
		).catch((err: unknown) => {
			if (err instanceof AssetError || options.signal?.aborted) throw err;
			throw new AssetError(
				"ASSET_DOWNLOAD_FAILED",
				`${shown}: ${(err as Error).message}`,
				{ cause: err },
			);
		});
		const sha256 = hash.digest("hex");
		if (size !== expected.size || sha256 !== expected.sha256)
			throw new AssetError(
				"ASSET_HASH_MISMATCH",
				`${shown} is not the file framefields.json pins (got ${size} bytes, sha256 ${sha256.slice(0, 12)}…; expected ${expected.size} bytes, ${expected.sha256.slice(0, 12)}…)`,
			);
		await rename(temp, dest);
	} finally {
		await rm(temp, { force: true });
	}
}

/** Signed URLs carry credentials in the query: never print them. */
export function redactQuery(url: string): string {
	const q = url.indexOf("?");
	return q < 0 ? url : `${url.slice(0, q)}?…`;
}

const TYPES: Record<string, string> = {
	mp4: "video/mp4",
	m4v: "video/mp4",
	mov: "video/quicktime",
	webm: "video/webm",
	mkv: "video/x-matroska",
	mp3: "audio/mpeg",
	m4a: "audio/mp4",
	aac: "audio/aac",
	wav: "audio/wav",
	flac: "audio/flac",
	ogg: "audio/ogg",
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	avif: "image/avif",
	gif: "image/gif",
	svg: "image/svg+xml",
	json: "application/json",
	lottie: "application/zip",
	glb: "model/gltf-binary",
	gltf: "model/gltf+json",
	ttf: "font/ttf",
	otf: "font/otf",
	woff2: "font/woff2",
	cube: "text/plain",
	srt: "text/plain",
	vtt: "text/vtt",
};

/** The Content-Type a CDN serves the file with. */
export function contentType(path: string): string {
	const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
	return TYPES[ext] ?? "application/octet-stream";
}
