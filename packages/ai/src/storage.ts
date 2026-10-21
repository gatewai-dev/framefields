import { errorFromResponse } from "./errors.js";
import { gatewayJson } from "./transport.js";

/** Files above this size upload in parts. */
const MULTIPART_THRESHOLD = 90 * 1024 * 1024;
const PART_SIZE = 10 * 1024 * 1024;
const PART_TRIES = 3;

interface UploadTicket {
	upload_url: string;
	file_url: string;
}

interface UploadedPart {
	partNumber: number;
	etag: string;
}

export interface Storage {
	/** Uploads a file and returns a URL any model accepts as input. */
	upload(file: Blob): Promise<string>;
	/** Replaces every `Blob` in an input (nested objects and arrays included) with its uploaded URL. */
	transformInput<T>(input: T): Promise<T>;
}

const EXTENSIONS: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"video/mp4": "mp4",
	"audio/mpeg": "mp3",
	"audio/wav": "wav",
};

function fileName(file: Blob, contentType: string): string {
	if ("name" in file && typeof file.name === "string" && file.name) {
		return file.name;
	}
	return `${Date.now()}.${EXTENSIONS[contentType] ?? "bin"}`;
}

function initiate(file: Blob, multipart: boolean): Promise<UploadTicket> {
	const contentType = file.type || "application/octet-stream";
	return gatewayJson<UploadTicket>({
		service: "storage",
		path: multipart ? "upload/initiate-multipart" : "upload/initiate",
		body: { content_type: contentType, file_name: fileName(file, contentType) },
	}).then((r) => r.data);
}

async function put(url: string, init: RequestInit): Promise<Response> {
	const response = await fetch(url, init);
	if (!response.ok) throw await errorFromResponse(response);
	return response;
}

async function uploadPart(url: string, chunk: Blob): Promise<UploadedPart> {
	for (let attempt = 1; ; attempt++) {
		try {
			const response = await put(url, { method: "PUT", body: chunk });
			return (await response.json()) as UploadedPart;
		} catch (err) {
			if (attempt >= PART_TRIES) throw err;
		}
	}
}

async function uploadMultipart(file: Blob): Promise<string> {
	const ticket = await initiate(file, true);
	const base = new URL(ticket.upload_url);
	const partUrl = (suffix: string | number) =>
		`${base.origin}${base.pathname}/${suffix}${base.search}`;
	const parts: UploadedPart[] = [];
	for (let start = 0; start < file.size; start += PART_SIZE) {
		const chunk = file.slice(start, Math.min(start + PART_SIZE, file.size));
		parts.push(await uploadPart(partUrl(parts.length + 1), chunk));
	}
	await put(partUrl("complete"), {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })),
		}),
	});
	return ticket.file_url;
}

async function upload(file: Blob): Promise<string> {
	if (file.size > MULTIPART_THRESHOLD) return uploadMultipart(file);
	const ticket = await initiate(file, false);
	await put(ticket.upload_url, {
		method: "PUT",
		body: file,
		headers: { "Content-Type": file.type || "application/octet-stream" },
	});
	return ticket.file_url;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" &&
	value !== null &&
	Object.getPrototypeOf(value) === Object.prototype;

async function transformInput<T>(input: T): Promise<T> {
	if (input instanceof Blob) return (await upload(input)) as T;
	if (Array.isArray(input)) {
		return (await Promise.all(input.map((item) => transformInput(item)))) as T;
	}
	if (isPlainObject(input)) {
		const entries = await Promise.all(
			Object.entries(input).map(
				async ([key, value]) => [key, await transformInput(value)] as const,
			),
		);
		return Object.fromEntries(entries) as T;
	}
	return input;
}

export const storage: Storage = { upload, transformInput };
